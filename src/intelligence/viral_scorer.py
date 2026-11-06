"""AI Hook & Virality Scoring Engine using Gemini with structured JSON outputs.

All imports placed at the top of the file according to standards.
"""

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

from config.settings import GEMINI_API_KEY, GEMINI_MODEL, DEFAULT_MIN_VIRALITY_SCORE

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


class ViralScorer:
    """Evaluates transcripts and multimodal signals via Gemini to pinpoint viral hooks."""

    def __init__(self, api_key: str = GEMINI_API_KEY, model_name: str = GEMINI_MODEL):
        self.api_key = api_key
        self.model_name = model_name
        self._client = None
        self._init_client()

    def _init_client(self):
        if not self.api_key:
            logger.warning("GEMINI_API_KEY is not configured.")
            return

        if HAS_GENAI and genai is not None:
            try:
                self._client = genai.Client(api_key=self.api_key)
                self._mode = "genai"
                logger.info("Initialized Google GenAI client.")
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

    async def analyze_transcript(
        self,
        transcript_data: Dict[str, Any],
        min_score: int = DEFAULT_MIN_VIRALITY_SCORE,
        chat_spikes: Optional[List[Dict[str, Any]]] = None,
        audio_peaks: Optional[List[Dict[str, Any]]] = None,
        heatmap_peaks: Optional[List[Dict[str, Any]]] = None,
    ) -> List[ViralHookCandidate]:
        """
        Evaluate full transcript and metadata to discover 25-58s viral clips.
        """
        if not self._client or not self.api_key:
            logger.warning("No Gemini client available; using heuristic viral scorer.")
            return self._heuristic_fallback(transcript_data, min_score)

        system_instruction = (
            "You are an elite short-form social video editor specializing in YouTube Shorts and Instagram Reels.\n"
            "Your objective is to find 25-58 second viral gold moments from this stream transcript.\n"
            "Criteria:\n"
            "1. First 3 seconds MUST have a strong hook, question, curiosity gap, or shouting/reaction.\n"
            "2. Rising tension or narrative flow in the middle.\n"
            "3. Clear climax, punchline, or resolution before the end.\n"
            "4. Never cut mid-sentence.\n"
            "5. If a huge climax occurs, specify its exact timestamp in 'teaser_hook_timestamp' so we can pre-roll a 1.5s teaser.\n"
            "6. Rank clips by predicted virality score (0-100). Return ONLY JSON matching the schema."
        )

        segments = transcript_data.get("segments", [])
        formatted_segments = "\n".join(
            [f"[{s['start']:.1f}s - {s['end']:.1f}s]: {s['text']}" for s in segments[:100]]
        )

        prompt = f"""Analyze this segment and metadata:

Metadata:
- Chat Velocity Spikes: {json.dumps(chat_spikes or [])}
- Audio dB Peaks: {json.dumps(audio_peaks or [])}
- YouTube Retention Heatmap Peaks: {json.dumps(heatmap_peaks or [])}

Transcript:
{formatted_segments}

Return JSON with candidate clips meeting all criteria.
"""

        try:
            if self._mode == "genai":
                response = self._client.models.generate_content(
                    model=self.model_name,
                    contents=f"{system_instruction}\n\n{prompt}",
                    config={
                        "response_mime_type": "application/json",
                        "response_schema": ViralAnalysisResponse,
                    },
                )
                raw_json = response.text
            else:
                response = self._client.generate_content(
                    f"{system_instruction}\n\n{prompt}",
                    generation_config={"response_mime_type": "application/json"},
                )
                raw_json = response.text

            data = json.loads(raw_json)
            candidates_raw = data.get("candidates", []) if isinstance(data, dict) else data
            candidates = [ViralHookCandidate(**item) for item in candidates_raw]
            logger.info("Gemini scored %d candidates: %s", len(candidates), [(c.suggested_title, c.virality_score) for c in candidates])

            filtered = [c for c in candidates if c.virality_score >= min_score]
            filtered.sort(key=lambda x: x.virality_score, reverse=True)
            return filtered

        except Exception as e:
            logger.error("Gemini API call failed: %s", e)
            return self._heuristic_fallback(transcript_data, min_score)

    def _heuristic_fallback(self, transcript_data: Dict[str, Any], min_score: int) -> List[ViralHookCandidate]:
        """Heuristic rule-based fallback when Gemini API is offline or unconfigured."""
        segments = transcript_data.get("segments", [])
        if not segments:
            return [
                ViralHookCandidate(
                    start_time=0.0,
                    end_time=30.0,
                    teaser_hook_timestamp=None,
                    virality_score=80,
                    suggested_title="INSANE Stream Moment!",
                    hashtags=["#Shorts", "#Viral", "#Trending"],
                    hook_summary="Opening reaction grabs attention",
                    punchline_summary="High-energy conclusion",
                )
            ]

        candidates: List[ViralHookCandidate] = []
        cur_start = segments[0]["start"]
        cur_end = segments[0]["end"]

        for seg in segments[1:]:
            cur_end = seg["end"]
            duration = cur_end - cur_start
            if 25.0 <= duration <= 55.0:
                candidates.append(
                    ViralHookCandidate(
                        start_time=cur_start,
                        end_time=cur_end,
                        teaser_hook_timestamp=cur_end - 2.0,
                        virality_score=78,
                        suggested_title="You Won't Believe What Happened!",
                        hashtags=["#Shorts", "#Reels", "#Viral"],
                        hook_summary="Immediate dialogue hook",
                        punchline_summary="Scene resolution",
                    )
                )
                cur_start = seg["start"]
                if len(candidates) >= 3:
                    break

        if not candidates:
            total_dur = segments[-1]["end"]
            clip_end = min(total_dur, 35.0)
            candidates.append(
                ViralHookCandidate(
                    start_time=0.0,
                    end_time=clip_end,
                    teaser_hook_timestamp=None,
                    virality_score=75,
                    suggested_title="Crazy Stream Moment!",
                    hashtags=["#Shorts", "#Viral"],
                    hook_summary="Opening segment hook",
                    punchline_summary="Stream highlight",
                )
            )

        return [c for c in candidates if c.virality_score >= min_score]
