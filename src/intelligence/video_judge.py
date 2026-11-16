"""Video-aware judge: re-rank the best transcript candidates by what is SEEN and HEARD.

The text judge only reads the transcript, so a silent jumpscare, a clutch kill or the streamer
falling off their chair scores like dead air. Here the top-K candidates are cut into a tiny
proxy (360p, 2 fps, mono audio; ~1-2 MB a minute) and Gemini watches each one.

Fail-open everywhere: no key, quota, ffmpeg or parse errors keep the original order.
"""

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

PROXY_MAX_SECONDS = 75.0
DEFAULT_TOP_K = 3
TEXT_WEIGHT = 0.75          # blended = 0.75 * text score + 0.25 * visual score
MAX_PROXY_BYTES = 18 * 1024 * 1024   # inline request limit is 20 MB


class VisualVerdict(BaseModel):
    visual_score: int = Field(..., ge=1, le=10, description="How strong the moment is VISUALLY (action, gameplay event, on-screen surprise) for a stranger scrolling Shorts")
    reaction_score: int = Field(..., ge=1, le=10, description="How strong the streamer's visible/audible reaction is (face, body, scream, laugh)")
    visible_events: List[str] = Field(default_factory=list, description="Up to 5 short phrases of what visibly happens, in order")
    verdict: Literal["boost", "neutral", "weak"] = Field(..., description="boost = the video is better than the transcript suggests; weak = nothing worth watching on screen")
    reason: str = Field(..., description="One sentence explaining the verdict")


SYSTEM_PROMPT = """You judge short-form clip candidates cut from a livestream (gameplay + facecam).
You WATCH the attached video (with audio). Judge only what a viewer would see and hear:
gameplay events, surprises, fails, wins, the streamer's face/body reaction, screams, laughter, chat-worthy chaos.
Static talking with nothing happening on screen is 'weak' even if the words are fine.
Do not reward on-screen UI text, overlays or alerts by themselves. Be strict and calibrated: 5 is average."""

USER_TEMPLATE = """Candidate title: {title}
Transcript (may be imperfect): {text}
Text-judge score: {score}/100

Return the visual verdict for this clip."""


def blend_score(text_score: float, verdict: Optional[VisualVerdict], text_weight: float = TEXT_WEIGHT) -> float:
    """Blend the text score (0-100) with the visual verdict (two 1-10 scores -> 10-100)."""
    if verdict is None:
        return float(text_score)
    visual = (verdict.visual_score + verdict.reaction_score) * 5.0
    return round(text_weight * float(text_score) + (1.0 - text_weight) * visual, 1)


def proxy_command(source: str, start: float, end: float, out_path: str) -> List[str]:
    dur = max(1.0, min(PROXY_MAX_SECONDS, end - start))
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{max(0.0, start):.3f}", "-t", f"{dur:.3f}", "-i", str(source),
        "-vf", "scale=-2:360,fps=2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "32",
        "-c:a", "aac", "-ac", "1", "-ar", "32000", "-b:a", "48k",
        "-movflags", "+faststart", str(out_path),
    ]


async def make_proxy(source: str, start: float, end: float) -> Optional[bytes]:
    """Cut a tiny proxy of [start, end] and return its bytes (None on failure / too big)."""
    with tempfile.TemporaryDirectory(prefix="vjudge_") as tmp:
        out = Path(tmp) / "proxy.mp4"
        try:
            proc = await asyncio.create_subprocess_exec(
                *proxy_command(source, start, end, str(out)),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            )
            _, err = await asyncio.wait_for(proc.communicate(), timeout=120)
        except Exception as e:
            logger.warning("Video judge proxy failed for %s: %s", source, e)
            return None
        if proc.returncode != 0 or not out.exists():
            logger.warning("Video judge proxy ffmpeg error: %s", (err or b"").decode(errors="ignore")[-300:])
            return None
        data = out.read_bytes()
        if len(data) > MAX_PROXY_BYTES:
            logger.info("Video judge proxy too large (%d bytes); skipping.", len(data))
            return None
        return data


async def load_video_judge_settings() -> Dict[str, Any]:
    """`video_judge_enabled` (default on) and `video_judge_top_k` (default 3) from Settings."""
    enabled, top_k = True, DEFAULT_TOP_K
    try:
        from src.database import get_system_setting
        raw = await get_system_setting("video_judge_enabled", "true")
        enabled = str(raw).strip().lower() in ("true", "1", "yes", "on")
        top_k = max(1, min(6, int(await get_system_setting("video_judge_top_k", str(DEFAULT_TOP_K)) or DEFAULT_TOP_K)))
    except Exception:
        pass
    return {"enabled": enabled, "top_k": top_k}


class VideoJudge:
    """Re-ranks candidates. Each candidate is a dict with start/end/score/title/text; it gets
    `video_judge` (verdict + scores) and `blended_score` added. Order is by blended score."""

    def __init__(self, client=None, model_name: Optional[str] = None):
        if client is None:
            from config.settings import GEMINI_API_KEY, GEMINI_JUDGE_MODEL
            from src.intelligence.llm.client import GeminiClient
            client = GeminiClient(api_key=GEMINI_API_KEY, model_name=model_name or GEMINI_JUDGE_MODEL)
        self.client = client

    async def judge_one(self, source: str, cand: Dict[str, Any]) -> Optional[VisualVerdict]:
        media = await make_proxy(source, float(cand["start"]), float(cand["end"]))
        if not media:
            return None
        prompt = USER_TEMPLATE.format(
            title=(cand.get("title") or "")[:140],
            text=(cand.get("text") or "")[:1200] or "(none)",
            score=int(cand.get("score") or 0),
        )
        try:
            return await self.client.generate_structured_media(
                system_instruction=SYSTEM_PROMPT, user_prompt=prompt,
                media=media, mime_type="video/mp4", response_model=VisualVerdict,
            )
        except Exception as e:
            logger.warning("Video judge call failed: %s", e)
            return None

    async def rerank(self, candidates: List[Dict[str, Any]], source: str, top_k: int = DEFAULT_TOP_K) -> List[Dict[str, Any]]:
        if not candidates or not source or not Path(source).exists():
            return candidates
        if getattr(self.client, "_client", None) is None:
            return candidates
        head = sorted(candidates, key=lambda c: float(c.get("score") or 0), reverse=True)
        judged, rest = head[:top_k], head[top_k:]
        verdicts = await asyncio.gather(*(self.judge_one(source, c) for c in judged), return_exceptions=True)
        any_verdict = False
        for cand, verdict in zip(judged, verdicts):
            if isinstance(verdict, VisualVerdict):
                any_verdict = True
                cand["video_judge"] = verdict.model_dump()
                cand["blended_score"] = blend_score(float(cand.get("score") or 0), verdict)
            else:
                cand["blended_score"] = float(cand.get("score") or 0)
        if not any_verdict:
            return candidates          # nothing learned: keep the caller's order untouched
        judged.sort(key=lambda c: c["blended_score"], reverse=True)
        for c in judged:
            vj = c.get("video_judge")
            if vj:
                logger.info("Video judge: '%s' %s -> %.1f (%s; %s)", (c.get("title") or "")[:50], c.get("score"),
                            c["blended_score"], vj["verdict"], ", ".join(vj.get("visible_events", [])[:3]))
        return judged + rest


async def video_rerank(candidates: List[Dict[str, Any]], source: str, judge: Optional[VideoJudge] = None) -> List[Dict[str, Any]]:
    """Settings-aware entry point used by the live and VOD paths."""
    cfg = await load_video_judge_settings()
    if not cfg["enabled"] or len(candidates) == 0:
        return candidates
    try:
        return await (judge or VideoJudge()).rerank(candidates, source, top_k=cfg["top_k"])
    except Exception as e:
        logger.warning("Video judge re-rank failed, keeping text order: %s", e)
        return candidates
