"""Pydantic Schemas for Calibrated Gemini Judge (Phase D)."""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class RubricScores1to5(BaseModel):
    hook_2s: int = Field(..., ge=1, le=5, description="1-5 rating: Attention grab in first 2 seconds")
    stands_alone: int = Field(..., ge=1, le=5, description="1-5 rating: Complete context without prior knowledge")
    payoff: int = Field(..., ge=1, le=5, description="1-5 rating: Punchline, climax, or emotional resolution")
    emotion: int = Field(..., ge=1, le=5, description="1-5 rating: Energy, laughter, shock, or tension")
    shareability: int = Field(..., ge=1, le=5, description="1-5 rating: Likelihood of viewers sharing with friends")
    pacing: int = Field(..., ge=1, le=5, description="1-5 rating: Tight delivery without dead air")
    clarity: int = Field(..., ge=1, le=5, description="1-5 rating: Easy to hear, see, and follow")


class JudgeCandidateEvidence(BaseModel):
    hook_quote: str = Field(..., description="Exact opening words from transcript")
    payoff_quote: str = Field(..., description="Exact climax/punchline words from transcript")


class SentenceSelection(BaseModel):
    start_sentence_id: str = Field(..., description="Start sentence ID (e.g. s02)")
    end_sentence_id: str = Field(..., description="End sentence ID (e.g. s08)")


class JudgeContentFlag(BaseModel):
    type: Literal[
        "profanity", "hate_or_slur", "sexual", "violence",
        "minors", "personal_info", "copyrighted_music",
        "sensitive_politics", "dangerous_or_illegal"
    ]
    severity: Literal["low", "medium", "high"]
    note: str = ""


class JudgeClipEvaluation(BaseModel):
    candidate_id: str = Field(default="c01", description="Candidate ID")
    would_post: bool = Field(..., description="True only if this clip is genuinely worth publishing")
    reject_reason: Optional[Literal[
        "boring", "no_context", "bad_start", "bad_end", "off_topic",
        "unsafe", "duplicate", "bad_crop", "bad_captions", "audio", "other"
    ]] = None
    scores: RubricScores1to5
    evidence: JudgeCandidateEvidence
    boundaries: SentenceSelection
    teaser_hook_sentence_id: Optional[str] = Field(None, description="Optional climax sentence ID to pre-roll as 1.5s teaser")
    title: str = Field(..., max_length=65, description="Compelling YouTube Short title")
    title_alts: List[str] = Field(default_factory=list, description="Alternative engaging titles")
    hook_text: str = Field(..., max_length=60, description="On-screen hook caption text (<= 8 words)")
    description: str = Field(..., description="Engaging caption copy for Shorts/Reels")
    hashtags: List[str] = Field(default_factory=list, description="Targeted trending hashtags")
    flags: List[JudgeContentFlag] = Field(default_factory=list, description="Safety or copyright flags")
    editorial_reason: str = Field(..., description="Brief rationale explaining why this was selected or rejected")


class JudgeEvaluationResponse(BaseModel):
    candidates: List[JudgeClipEvaluation] = Field(default_factory=list)

