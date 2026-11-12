"""AI Hook & Virality Scoring Engine using Gemini with structured JSON outputs.

All imports placed at the top of the file according to standards.
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

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

from config.settings import GEMINI_API_KEY, GEMINI_API_KEYS, GEMINI_MODEL, DEFAULT_MIN_VIRALITY_SCORE

logger = logging.getLogger(__name__)


class ViralHookCandidate(BaseModel):
    """Structured Pydantic schema for viral short-form candidates."""
    start_time: float = Field(..., description="Start timestamp of the clip in seconds")
    end_time: float = Field(..., description="End timestamp of the clip in seconds (25-58s total)")
    teaser_hook_timestamp: Optional[float] = Field(None, description="1.5s climax snippet timestamp to pre-roll at 00:00")
    virality_score: int = Field(..., ge=0, le=100, description="Predicted virality retention score (0-100)")
    suggested_title: str = Field(..., description="Engaging, clickable Title (no clickbait spam)")
    hashtags: List[str] = Field(default_factory=list, description="Relevant hashtags including #Shorts, #Reels")
    hook_summary: str = Field(..., description="Why the first 3 seconds grab immediate attention")
    punchline_summary: str = Field(..., description="The payoff or resolution of the clip")


class ViralAnalysisResponse(BaseModel):
    """Container for multiple detected hooks."""
    candidates: List[ViralHookCandidate] = Field(default_factory=list)


WINDOW_SECONDS = 600.0      # transcript chunk sent per AI call
WINDOW_OVERLAP = 60.0       # so moments spanning a boundary aren't lost
MAX_WINDOWS = 18            # ~3 hours of content per run
MAX_SEGMENTS_PER_WINDOW = 400


def build_windows(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Split transcript segments into overlapping time windows with formatted text."""
    windows: List[Dict[str, Any]] = []
    i = 0
    n = len(segments)
    while i < n and len(windows) < MAX_WINDOWS:
        w_start = float(segments[i]["start"])
        w_end_limit = w_start + WINDOW_SECONDS
        j = i
        while j < n and float(segments[j]["start"]) < w_end_limit and (j - i) < MAX_SEGMENTS_PER_WINDOW:
            j += 1
        chunk = segments[i:j]
        windows.append({
            "start": w_start,
            "end": float(chunk[-1]["end"]),
            "text": "\n".join(f"[{float(s['start']):.1f}s - {float(s['end']):.1f}s]: {s['text'].strip()}" for s in chunk),
        })
        if j >= n:
            break
        # next window starts WINDOW_OVERLAP seconds before this one ended
        overlap_from = float(chunk[-1]["end"]) - WINDOW_OVERLAP
        k = j
        while k > i + 1 and float(segments[k - 1]["start"]) > overlap_from:
            k -= 1
        i = max(k, i + 1)
    return windows


def _overlap_ratio(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    inter = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    shorter = max(1e-6, min(a_end - a_start, b_end - b_start))
    return inter / shorter


def select_clips(
    candidates: List["ViralHookCandidate"],
    min_score: int,
    min_len: float,
    max_len: float,
    max_clips: int,
    max_overlap: float = 0.35,
) -> List["ViralHookCandidate"]:
    """Filter by score/length, drop overlapping duplicates (keep the higher score), rank."""
    lo, hi = min_len * 0.8, max_len * 1.15   # small tolerance: AI timestamps snap to sentences
    pool = []
    for c in candidates:
        dur = c.end_time - c.start_time
        if c.virality_score < min_score or dur <= 0 or dur < lo or dur > hi:
            continue
        pool.append(c)
    pool.sort(key=lambda c: c.virality_score, reverse=True)
    chosen: List[ViralHookCandidate] = []
    for c in pool:
        if any(_overlap_ratio(c.start_time, c.end_time, k.start_time, k.end_time) > max_overlap for k in chosen):
            continue
        chosen.append(c)
        if len(chosen) >= max_clips:
            break
    return chosen


class ViralScorer:
    """Evaluates transcripts and multimodal signals via Gemini to pinpoint viral hooks."""

    def __init__(self, api_key: str = GEMINI_API_KEY, model_name: str = GEMINI_MODEL):
        self.api_keys: List[str] = list(GEMINI_API_KEYS)
        if api_key and api_key not in self.api_keys:
            self.api_keys.insert(0, api_key)
        self.current_key_idx = 0
        self.model_name = model_name
        self._client = None
        self._init_client()

    @property
    def api_key(self) -> str:
        if not self.api_keys:
            return ""
        return self.api_keys[self.current_key_idx % len(self.api_keys)]

    def _rotate_key(self):
        if len(self.api_keys) > 1:
            self.current_key_idx = (self.current_key_idx + 1) % len(self.api_keys)
            logger.warning("🔄 Quota reached in ViralScorer. Rotating to key #%d of %d.", self.current_key_idx + 1, len(self.api_keys))
            self._init_client()

    def _init_client(self):
        if not self.api_key:
            logger.warning("GEMINI_API_KEY is not configured.")
            return

        if HAS_GENAI and genai is not None:
            try:
                self._client = genai.Client(api_key=self.api_key, http_options={"api_version": "v1beta"})
                self._mode = "genai"
                logger.info("Initialized Google GenAI client (v1beta).")
                return
            except Exception as e:
                logger.warning("Could not initialize google-genai: %s", e)

        if HAS_GOOGLE_GENERATIVEAI and gai is not None:
            try:
                gai.configure(api_key=self.api_key)
                self._client = gai.GenerativeModel(self.model_name)
                self._mode = "generativeai"
                logger.info("Initialized google.generativeai client.")
                return
            except Exception as e:
                logger.warning("Could not initialize google.generativeai: %s", e)

        self._client = None
        self._mode = "none"

    async def _sync_settings_from_db(self):
        """Dynamically synchronize keys, model, and quota status directly from system_settings."""
        try:
            from src.database import get_all_system_settings
            db_settings = await get_all_system_settings()

            # Dynamic model selection
            db_model = db_settings.get("gemini_model", {}).get("value")
            if db_model and db_model.strip():
                self.model_name = db_model.strip()

            # Dynamic API key pool
            keys_val = db_settings.get("gemini_api_keys", {}).get("value")
            if keys_val:
                loaded_keys = []
                try:
                    parsed = json.loads(keys_val)
                    if isinstance(parsed, list):
                        for item in parsed:
                            # Skip keys marked as Quota Exhausted if others exist
                            if isinstance(item, dict):
                                k_str = item.get("key", "").strip()
                                if k_str and item.get("status") != "Quota Exhausted":
                                    loaded_keys.append(k_str)
                            elif isinstance(item, str) and item.strip():
                                loaded_keys.append(item.strip())
                except Exception:
                    for k in keys_val.split(","):
                        if k.strip():
                            loaded_keys.append(k.strip())
                if loaded_keys:
                    self.api_keys = loaded_keys
        except Exception as e:
            logger.debug("Failed to sync settings from db: %s", e)

    async def analyze_transcript(
        self,
        transcript_data: Dict[str, Any],
        min_score: int = DEFAULT_MIN_VIRALITY_SCORE,
        chat_spikes: Optional[List[Dict[str, Any]]] = None,
        audio_peaks: Optional[List[Dict[str, Any]]] = None,
        heatmap_peaks: Optional[List[Dict[str, Any]]] = None,
        max_clips: int = 10,
        min_len: float = 25.0,
        max_len: float = 60.0,
        focus: Optional[str] = None,
    ) -> List[ViralHookCandidate]:
        """Find up to ``max_clips`` viral moments across the WHOLE transcript.

        Long videos are scanned in overlapping ~10-minute windows (previously only the
        first 100 segments were ever sent), candidates from every window are merged,
        de-duplicated by overlap, filtered by score/length and ranked.
        """
        await self._sync_settings_from_db()
        self._init_client()

        if not self._client or not self.api_key:
            logger.warning("No Gemini client or API key available. Skipping clip creation (heuristics disabled).")
            return []

        segments = [s for s in transcript_data.get("segments", []) if s.get("text", "").strip()]
        if not segments:
            return []

        windows = build_windows(segments)
        per_window = max(3, min(8, -(-max_clips * 2 // max(1, len(windows)))))  # over-generate, then rank
        logger.info("Scanning %d transcript window(s) for up to %d clips (%d-%ds)...",
                    len(windows), max_clips, int(min_len), int(max_len))

        sem = asyncio.Semaphore(2)

        async def run(win):
            async with sem:
                return await self._score_window(
                    win, per_window, min_len, max_len, focus, chat_spikes, audio_peaks, heatmap_peaks,
                )

        results = await asyncio.gather(*(run(w) for w in windows), return_exceptions=True)
        candidates: List[ViralHookCandidate] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Window scoring failed: %s", r)
            else:
                candidates.extend(r)

        selected = select_clips(candidates, min_score=min_score, min_len=min_len, max_len=max_len, max_clips=max_clips)
        logger.info("Gemini proposed %d candidates; selected %d: %s", len(candidates), len(selected),
                    [(c.suggested_title, c.virality_score) for c in selected])
        return selected

    async def _score_window(
        self,
        window: Dict[str, Any],
        n_clips: int,
        min_len: float,
        max_len: float,
        focus: Optional[str],
        chat_spikes, audio_peaks, heatmap_peaks,
        _retried: bool = False,
    ) -> List[ViralHookCandidate]:
        w_start, w_end = window["start"], window["end"]

        def in_window(items):
            out = []
            for it in items or []:
                t = it.get("time", it.get("start", it.get("timestamp")))
                try:
                    if t is None or w_start <= float(t) <= w_end:
                        out.append(it)
                except (TypeError, ValueError):
                    out.append(it)
            return out

        system_instruction = (
            "You are an elite short-form social video editor specializing in YouTube Shorts and Instagram Reels.\n"
            f"Find the {n_clips} best standalone viral moments in this part of the stream, each {int(min_len)}-{int(max_len)} seconds long.\n"
            "Criteria:\n"
            "1. First 3 seconds MUST have a strong hook, question, curiosity gap, or shouting/reaction.\n"
            "2. Rising tension or narrative flow in the middle.\n"
            "3. Clear climax, punchline, or resolution before the end.\n"
            "4. Never cut mid-sentence. Each clip must make sense without the rest of the stream.\n"
            "5. Clips must not overlap each other.\n"
            "6. If a huge climax occurs, put its exact timestamp in 'teaser_hook_timestamp'.\n"
            "7. Score honestly (0-100): most moments are NOT viral; reserve 85+ for exceptional ones.\n"
            + (f"8. Prioritise moments about: {focus}\n" if focus else "")
            + "Use the absolute timestamps shown. Return ONLY JSON matching the schema."
        )
        prompt = f"""Window {w_start:.0f}s - {w_end:.0f}s of the stream.

Metadata:
- Chat Velocity Spikes: {json.dumps(in_window(chat_spikes))}
- Audio dB Peaks: {json.dumps(in_window(audio_peaks))}
- YouTube Retention Heatmap Peaks: {json.dumps(in_window(heatmap_peaks))}

Transcript:
{window["text"]}

Return JSON with up to {n_clips} candidate clips meeting all criteria.
"""
        loop = asyncio.get_running_loop()

        def _call_gemini():
            if self._mode == "genai":
                resp = self._client.models.generate_content(
                    model=self.model_name,
                    contents=f"{system_instruction}\n\n{prompt}",
                    config={"response_mime_type": "application/json", "response_schema": ViralAnalysisResponse},
                )
                return resp.text
            resp = self._client.generate_content(
                f"{system_instruction}\n\n{prompt}",
                generation_config={"response_mime_type": "application/json"},
            )
            return resp.text

        try:
            raw_json = await loop.run_in_executor(None, _call_gemini)
            data = json.loads(raw_json)
            raw = data.get("candidates", []) if isinstance(data, dict) else data
            out = []
            for item in raw or []:
                try:
                    out.append(ViralHookCandidate(**item))
                except Exception as e:
                    logger.debug("Skipping malformed candidate %s: %s", item, e)
            return out
        except Exception as e:
            err_str = str(e).lower()
            if any(term in err_str for term in ["429", "resource_exhausted", "quota", "ratelimit", "rate limit"]):
                logger.warning("🛑 Gemini AI quota reached on key #%d (%s). Recording exhausted status...",
                               self.current_key_idx + 1, self.api_key[:10])
                from src.database import mark_key_exhausted
                await mark_key_exhausted(self.api_key)
                if len(self.api_keys) > 1 and not _retried:
                    self._rotate_key()
                    return await self._score_window(window, n_clips, min_len, max_len, focus,
                                                    chat_spikes, audio_peaks, heatmap_peaks, _retried=True)
            else:
                logger.error("Gemini API call failed for window %.0f-%.0fs: %s", w_start, w_end, e)
            return []

    def _heuristic_fallback(self, transcript_data: Dict[str, Any], min_score: int) -> List[ViralHookCandidate]:
        """
        Smart transcript-driven heuristic title generator when Gemini API is offline or quota-exceeded.
        Generates unique, engaging, content-derived titles based on actual speech words.
        """
        import re

        def generate_title_from_text(text: str) -> str:
            cleaned = re.sub(r"[^\w\s\?!']", "", text).strip()
            words = cleaned.split()
            if not words:
                return "Insane Stream Moment!"
            
            # If the segment has a question or strong exclamation, use that
            for s in re.split(r"[.!?]+", text):
                s = s.strip()
                if len(s.split()) >= 3 and len(s) <= 45:
                    return f'"{s.capitalize()}"'

            # Take the most impactful 4-7 words
            sample = " ".join(words[:6]).title()
            templates = [
                f'"{sample}..."',
                f"When He Said: {sample}!",
                f"{sample} (UNREAL)",
                f"No Way This Just Happened: {sample}",
            ]
            import random
            return random.choice(templates)

        segments = transcript_data.get("segments", [])
        if not segments:
            return [
                ViralHookCandidate(
                    start_time=0.0,
                    end_time=30.0,
                    teaser_hook_timestamp=None,
                    virality_score=0,
                    suggested_title="UNREAL Stream Highlight!",
                    hashtags=["#Shorts", "#Viral", "#Trending"],
                    hook_summary="Opening reaction grabs attention",
                    punchline_summary="High-energy conclusion",
                )
            ]

        candidates: List[ViralHookCandidate] = []
        cur_start = segments[0]["start"]
        cur_end = segments[0]["end"]
        clip_texts = [segments[0].get("text", "")]

        for seg in segments[1:]:
            cur_end = seg["end"]
            clip_texts.append(seg.get("text", ""))
            duration = cur_end - cur_start
            if 25.0 <= duration <= 55.0:
                combined_text = " ".join(clip_texts).strip()
                dynamic_title = generate_title_from_text(combined_text)

                candidates.append(
                    ViralHookCandidate(
                        start_time=cur_start,
                        end_time=cur_end,
                        teaser_hook_timestamp=cur_end - 2.0,
                        virality_score=0,
                        suggested_title=dynamic_title,
                        hashtags=["#Shorts", "#Reels", "#Viral"],
                        hook_summary="Immediate dialogue hook",
                        punchline_summary="Scene resolution",
                    )
                )
                cur_start = seg["start"]
                clip_texts = [seg.get("text", "")]
                if len(candidates) >= 3:
                    break

        if not candidates:
            total_dur = segments[-1]["end"]
            clip_end = min(total_dur, 35.0)
            combined_text = " ".join(s.get("text", "") for s in segments).strip()
            dynamic_title = generate_title_from_text(combined_text)
            candidates.append(
                ViralHookCandidate(
                    start_time=0.0,
                    end_time=clip_end,
                    teaser_hook_timestamp=None,
                    virality_score=0,
                    suggested_title=dynamic_title,
                    hashtags=["#Shorts", "#Viral"],
                    hook_summary="Opening segment hook",
                    punchline_summary="Stream highlight",
                )
            )

        return [c for c in candidates if c.virality_score >= min_score]
