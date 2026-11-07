"""Pydantic Schemas for Gemini Structured JSON Outputs (Stages A & B)."""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class TriageCandidateResult(BaseModel):
    id: str = Field(..., description="Candidate ID (e.g. c01)")
    triage_score: float = Field(..., ge=0.0, le=10.0, description="Score 0 to 10 on viral potential")
    keep: bool = Field(..., description="Whether this candidate should advance to Stage B detail evaluation")
    one_line_reason: str = Field(..., description="Concise justification for keep or drop")


class StageATriageResponse(BaseModel):
    candidates: List[TriageCandidateResult] = Field(default_factory=list)


class SubScores(BaseModel):
    hook_2s: float = Field(..., ge=0.0, le=10.0, description="Grabs attention in the first 2 seconds")
    stands_alone: float = Field(..., ge=0.0, le=10.0, description="Requires zero outside context to understand")
    payoff: float = Field(..., ge=0.0, le=10.0, description="Punchline or climax payoff strength")
    emotion: float = Field(..., ge=0.0, le=10.0, description="Surprise, laughter, excitement, or tension")
    shareability: float = Field(..., ge=0.0, le=10.0, description="Likelihood of a viewer sending this to a friend")
    pacing: float = Field(..., ge=0.0, le=10.0, description="Tight delivery without dead air or filler")
    clarity: float = Field(..., ge=0.0, le=10.0, description="Message and speech are easy to follow")


class Evidence(BaseModel):
    hook_quote: str = Field(..., description="Exact starting words grabbing attention")
    payoff_quote: str = Field(..., description="Exact climax or punchline phrase")


class SentenceBoundaries(BaseModel):
    start_sentence_id: str = Field(..., description="Sentence ID for the clip start (e.g. s101)")
    end_sentence_id: str = Field(..., description="Sentence ID for the clip end (e.g. s109)")


class ContentFlag(BaseModel):
    type: Literal[
        "profanity", "hate_or_slur", "sexual", "violence",
        "minors", "personal_info", "copyrighted_music",
        "sensitive_politics", "dangerous_or_illegal"
    ]
    severity: Literal["low", "medium", "high"]
    note: str = ""


class StageBDetailCandidate(BaseModel):
    candidate_id: str = Field(..., description="Candidate identifier")
    decision: Literal["keep", "reject"]
    reject_reason: Optional[Literal[
        "needs_context", "weak_hook", "no_payoff", "duplicate_idea", "unsafe", "off_topic", "boring"
    ]] = None
    scores: SubScores
    evidence: Evidence
    boundaries: SentenceBoundaries
    predicted_score: float = Field(..., ge=0.0, le=100.0, description="Overall viral potential (0-100)")
    title: str = Field(..., max_length=65, description="High-converting YouTube Short title")
    title_alts: List[str] = Field(default_factory=list, description="Alternative engaging titles")
    hook_text: str = Field(..., max_length=60, description="On-screen hook subtitle text (<= 8 words)")
    description: str = Field(..., description="Shorts/Reels description copy")
    hashtags: List[str] = Field(default_factory=list, description="Targeted trending hashtags")
    flags: List[ContentFlag] = Field(default_factory=list, description="Safety or copyright flags")
    reason: str = Field(..., description="Comprehensive editorial rationale")


class StageBDetailResponse(BaseModel):
    candidates: List[StageBDetailCandidate] = Field(default_factory=list)
