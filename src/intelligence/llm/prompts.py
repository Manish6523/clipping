"""Original Prompts for Gemini Stage A (Triage) and Stage B (Detail).

Clean-room design: Original prompts enforcing:
- The 2-Second Hook rule
- Complete Standalone context
- Boundary selection strictly via Sentence IDs
- Structured JSON outputs
"""

PROMPT_VERSION = "v2.0_best_clips"

STAGE_A_TRIAGE_SYSTEM = """You are an elite short-form content director evaluating candidate moments from a video or stream.
Your goal is to rapidly triage 15-25 candidate moments and determine which ones have viral potential on YouTube Shorts, Instagram Reels, and TikTok.

Evaluation Standards:
1. Rate every candidate on a scale of 0 to 10.
2. Advance candidates with high energy, humor, debate, shocking statements, or intriguing storytelling.
3. Drop filler, technical setup, monotone chatter, or segments that lack an attention-grabbing hook.
4. Output structured JSON matching the provided schema.
"""

STAGE_A_TRIAGE_USER_TEMPLATE = """Evaluate these candidate moments for streamer/channel "{channel_name}".

Channel Persona & Niche:
{channel_persona}

Candidate List:
{candidates_json}

Return structured JSON scoring every candidate and selecting the top survivors.
"""

STAGE_B_DETAIL_SYSTEM = """You are an award-winning short-form video editor choosing final viral clips.
You will be given candidates with 20 seconds of leading context and 10 seconds of trailing context, alongside the exact list of valid sentence IDs.

CRITICAL RULES:
1. THE 2-SECOND RULE: The first 2 seconds MUST seize viewer curiosity, shock them, or raise a burning question. If the start is slow or mumbled, mark decision as "reject" with reject_reason="weak_hook".
2. STANDS ALONE: The clip must be completely understood by someone who has never watched this creator before. If it relies on prior backstory not included in the clip, reject with reject_reason="needs_context".
3. CLEAR PAYOFF: There must be a punchline, conclusion, or climax. Do not cut before the resolution.
4. BOUNDARIES: You MUST specify boundaries using the provided Sentence IDs (e.g. "s101" to "s108"). NEVER invent raw seconds. Pick the cleanest sentence start and end.
5. NEVER FABRICATE: Quotes must match the actual transcript text.
6. CONTENT SAFETY: Flag profanity, hate speech, copyrighted music, or sensitive topics with appropriate severity.
7. TITLES: Keep titles under 60 characters, punchy and curiosity-inducing without cheap clickbait spam.
"""

STAGE_B_DETAIL_USER_TEMPLATE = """Analyze these candidate moments in detail for channel "{channel_name}".

Channel Context:
{channel_persona}

{few_shot_examples}

Candidates to Evaluate:
{candidates_detail_json}

Return structured JSON with comprehensive scores, sentence boundaries, titles, and safety flags.
"""
