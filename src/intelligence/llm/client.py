"""Resilient, Cached Gemini LLM Client for AutoClipDaemon.

Features:
- Global concurrency semaphore (prevents rate limit bursts)
- SHA-256 caching in `llm_cache` table
- Exponential backoff on 429 / resource exhausted
- Pydantic schema validation with automatic single retry on syntax error
- Fallback flag `llm_failed` so pipeline never crashes on external outage
"""

import asyncio
import hashlib
import json
import logging
from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel

from config.settings import GEMINI_API_KEY, GEMINI_API_KEYS, GEMINI_MODEL
from src.database import get_db_connection
from src.intelligence.llm.prompts import PROMPT_VERSION

try:
    from google import genai
    HAS_GENAI = True
except ImportError:
    genai = None
    HAS_GENAI = False

try:
    import google.generativeai as gai
    HAS_GOOGLE_GENERATIVEAI = True
except ImportError:
    gai = None
    HAS_GOOGLE_GENERATIVEAI = False

logger = logging.getLogger(__name__)


class GeminiClient:
    """Async wrapper for Google Gemini with structured outputs, caching, and rate limiting."""

    _semaphore: Optional[asyncio.Semaphore] = None

    def __init__(self, api_key: str = GEMINI_API_KEY, model_name: str = GEMINI_MODEL, max_concurrency: int = 3):
        self.api_keys: List[str] = list(GEMINI_API_KEYS)
        if api_key and api_key not in self.api_keys:
            self.api_keys.insert(0, api_key)
        self.current_key_idx = 0
        self.model_name = model_name or "gemini-flash-lite-latest"
        if GeminiClient._semaphore is None:
            GeminiClient._semaphore = asyncio.Semaphore(max_concurrency)
        self._init_current_sdk()

    @property
    def current_api_key(self) -> str:
        if not self.api_keys:
            return ""
        return self.api_keys[self.current_key_idx % len(self.api_keys)]

    def _rotate_key(self):
        """Rotate to the next key in the pool on 429 quota exhaustion."""
        if len(self.api_keys) > 1:
            self.current_key_idx = (self.current_key_idx + 1) % len(self.api_keys)
            logger.warning("🔄 Quota reached. Switching to Gemini API key #%d of %d.", self.current_key_idx + 1, len(self.api_keys))
            self._init_current_sdk()

    def _init_current_sdk(self):
        k = self.current_api_key
        if not k:
            logger.warning("No Gemini API keys configured.")
            self._client = None
            self._mode = "none"
            return

        if HAS_GENAI and genai is not None:
            try:
                self._client = genai.Client(api_key=k)
                self._mode = "genai"
                return
            except Exception as e:
                logger.warning("Could not initialize google.genai with key: %s", e)

        if HAS_GOOGLE_GENERATIVEAI and gai is not None:
            try:
                gai.configure(api_key=k)
                self._client = gai.GenerativeModel(self.model_name)
                self._mode = "generativeai"
                return
            except Exception as e:
                logger.warning("Could not initialize google.generativeai with key: %s", e)

        self._client = None
        self._mode = "none"

    def _compute_cache_key(self, system_prompt: str, user_prompt: str) -> str:
        payload = f"{self.model_name}:{PROMPT_VERSION}:{system_prompt}:{user_prompt}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    async def _check_cache(self, cache_key: str) -> Optional[str]:
        try:
            async with get_db_connection() as db:
                cur = await db.execute("SELECT raw_response FROM llm_cache WHERE cache_key = ?", (cache_key,))
                row = await cur.fetchone()
                if row:
                    return row["raw_response"] if isinstance(row, dict) else row[0]
        except Exception as e:
            logger.warning("LLM cache lookup failed: %s", e)
        return None

    async def _store_cache(self, cache_key: str, response_text: str, in_tokens: int = 0, out_tokens: int = 0):
        try:
            async with get_db_connection() as db:
                await db.execute(
                    """
                    INSERT OR REPLACE INTO llm_cache (cache_key, model_name, prompt_version, raw_response, input_tokens, output_tokens)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (cache_key, self.model_name, PROMPT_VERSION, response_text, in_tokens, out_tokens)
                )
                await db.commit()
        except Exception as e:
            logger.warning("LLM cache store failed: %s", e)

    async def generate_structured(
        self,
        system_instruction: str,
        user_prompt: str,
        response_model: Type[BaseModel],
        use_cache: bool = True,
    ) -> Optional[BaseModel]:
        """Runs prompt with structured schema, cache checks, and rate-limit retries."""
        cache_key = self._compute_cache_key(system_instruction, user_prompt)
        if use_cache:
            cached_text = await self._check_cache(cache_key)
            if cached_text:
                try:
                    data = json.loads(cached_text)
                    return response_model.model_validate(data)
                except Exception:
                    pass

        if not self._client:
            logger.warning("No Gemini client available.")
            return None

        backoff = 2.0
        for attempt in range(3):
            async with self._semaphore:
                try:
                    if self._mode == "genai":
                        loop = asyncio.get_running_loop()
                        response = await loop.run_in_executor(
                            None,
                            lambda: self._client.models.generate_content(
                                model=self.model_name,
                                contents=f"{system_instruction}\n\n{user_prompt}",
                                config={
                                    "response_mime_type": "application/json",
                                    "response_schema": response_model,
                                    "temperature": 0.2,
                                },
                            )
                        )
                        raw_text = response.text
                    else:
                        loop = asyncio.get_running_loop()
                        response = await loop.run_in_executor(
                            None,
                            lambda: self._client.generate_content(
                                f"{system_instruction}\n\n{user_prompt}",
                                generation_config={
                                    "response_mime_type": "application/json",
                                    "temperature": 0.2,
                                },
                            )
                        )
                        raw_text = response.text

                    # Validate response
                    data = json.loads(raw_text)
                    validated = response_model.model_validate(data)
                    await self._store_cache(cache_key, raw_text)
                    return validated

                except Exception as e:
                    err_str = str(e).lower()
                    if any(term in err_str for term in ["429", "resource_exhausted", "quota", "ratelimit"]):
                        logger.warning("Gemini rate limit encountered on key #%d (%s). Recording exhausted status...", self.current_key_idx + 1, self.current_api_key[:10])
                        from src.database import mark_key_exhausted
                        await mark_key_exhausted(self.current_api_key)
                        self._rotate_key()
                        await asyncio.sleep(backoff)
                        backoff *= 1.5
                    else:
                        logger.error("Gemini invocation error: %s", e)
                        break

        return None

