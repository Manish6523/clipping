"""Narrative storyline engine: trigger rule, fail-closed re-judge, word timeline, and a REAL ffmpeg stitch."""
import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.intelligence import storyline_matcher as sm
from src.intelligence.story_stitch import (
    StitchError, build_stitched_source, snap_setup_range, stitch_words, window_words,
)


# ---------------- trigger rule ----------------
@pytest.mark.parametrize("bd,expected", [
    ({"stands_alone": 2, "payoff": 2}, True),     # needs context
    ({"stands_alone": 3, "payoff": 1}, True),
    ({"stands_alone": 4, "payoff": 5}, True),     # strong payoff can still gain a point
    ({"stands_alone": 4, "payoff": 3}, False),
    ({"stands_alone": 5, "payoff": 5}, False),    # cannot improve
])
def test_should_try_match(bd, expected):
    assert sm.should_try_match(bd) is expected


# ---------------- word timeline ----------------
def test_stitch_words_timeline():
    setup = [{"word": "every", "start": 10.0, "end": 10.4}, {"word": "time", "start": 10.4, "end": 10.8},
             {"word": "later", "start": 20.0, "end": 20.5}]
    payoff = [{"word": "before", "start": 50.0, "end": 50.5}, {"word": "boom", "start": 61.0, "end": 61.5},
              {"word": "after", "start": 90.0, "end": 90.5}]
    words, setup_dur, total = stitch_words(setup, payoff, 10.0, 14.0, 60.0, 65.0)
    assert setup_dur == 4.0 and total == 9.0
    assert [w["word"] for w in words] == ["every", "time", "boom"]   # out-of-window words dropped
    assert words[0]["start"] == 0.0
    assert words[2]["start"] == pytest.approx(4.0 + 1.0)             # payoff shifted behind the setup


def test_window_words_clamps_partial_overlap():
    w = window_words([{"word": "x", "start": 9.5, "end": 10.5}], 10.0, 12.0, 0.0)
    assert w[0]["start"] == 0.0 and w[0]["end"] == pytest.approx(0.5)


def test_snap_setup_range_never_cuts_mid_word():
    words = [{"start": 0.0, "end": 1.0}, {"start": 1.0, "end": 3.9}, {"start": 3.9, "end": 7.6}]
    s, e = snap_setup_range(words, 0.0, 7.0)
    assert e == 3.9      # the 7.6 word would straddle the 7.0 limit


# ---------------- matcher with a fake LLM ----------------
class FakeLLM:
    def __init__(self, match, rejudge):
        self.match, self.rejudge, self.calls = match, rejudge, []

    async def generate_structured(self, system_instruction, user_prompt, response_model):
        self.calls.append(response_model.__name__)
        if response_model is sm.StoryMatchResponse:
            return self.match, None, None
        if isinstance(self.rejudge, Exception):
            raise self.rejudge
        return self.rejudge, None, None


SEED = {
    "id": 7, "kind": "challenge", "summary": "10 pushups per death", "quote": "every time I die I do ten pushups",
    "snippet_path": "/nonexistent.ts", "stream_epoch_start": 0, "duration": 20, "session_id": "s1", "channel_id": "c",
    "transcript_json": json.dumps({
        "segments": [{"text": "Every time I die I do ten pushups.", "start": 2.0, "end": 6.0}],
        "words": [{"word": "Every", "start": 2.0, "end": 2.4}, {"word": "pushups", "start": 5.0, "end": 6.0}],
    }),
}
MATCH = sm.StoryMatchResponse(match_found=True, relation="payoff", seed_id=7, confidence=0.9,
                              setup_quote="every time I die I do ten pushups", payoff_quote="he died ten pushups")


def _matcher(monkeypatch, llm):
    async def seeds(session_id, limit=30):
        return [SEED]
    monkeypatch.setattr(sm, "get_active_seeds_for_session", seeds)
    m = sm.StorylineMatcher.__new__(sm.StorylineMatcher)
    m.llm = llm
    return m


def run(coro):
    return asyncio.run(coro)


def test_match_accepted_when_rejudge_improves(monkeypatch):
    llm = FakeLLM(MATCH, sm.StitchJudgement(hook_2s=4, stands_alone=4.5, payoff=4, reasoning="clear"))
    res = run(_matcher(monkeypatch, llm).match_moment_to_seeds(
        "s1", "he died ten pushups", {"stands_alone": 2, "payoff": 4, "hook_2s": 3}, 70))
    assert res and res["seed_id"] == 7 and res["setup_duration"] >= 1.5
    assert llm.calls == ["StoryMatchResponse", "StitchJudgement"]      # a REAL second judgement happened


def test_match_rejected_when_setup_does_not_help(monkeypatch):
    llm = FakeLLM(MATCH, sm.StitchJudgement(hook_2s=3, stands_alone=2.5, payoff=3, reasoning="no gain"))
    assert run(_matcher(monkeypatch, llm).match_moment_to_seeds(
        "s1", "he died ten pushups", {"stands_alone": 2, "payoff": 4}, 70)) is None


def test_fail_closed_when_rejudge_errors(monkeypatch):
    llm = FakeLLM(MATCH, RuntimeError("quota"))
    assert run(_matcher(monkeypatch, llm).match_moment_to_seeds(
        "s1", "he died ten pushups", {"stands_alone": 2, "payoff": 4}, 70)) is None


def test_no_llm_call_when_clip_already_self_contained(monkeypatch):
    llm = FakeLLM(MATCH, None)
    assert run(_matcher(monkeypatch, llm).match_moment_to_seeds(
        "s1", "x", {"stands_alone": 5, "payoff": 5}, 70)) is None
    assert llm.calls == []


def test_hallucinated_quote_is_rejected(monkeypatch):
    bad = sm.StoryMatchResponse(match_found=True, relation="payoff", seed_id=7, confidence=0.95,
                                setup_quote="totally unrelated words about cooking pasta recipes", payoff_quote="he died ten pushups")
    llm = FakeLLM(bad, sm.StitchJudgement(hook_2s=5, stands_alone=5, payoff=5))
    assert run(_matcher(monkeypatch, llm).match_moment_to_seeds(
        "s1", "he died ten pushups", {"stands_alone": 2, "payoff": 4}, 70)) is None


# ---------------- real ffmpeg stitch (different sizes, one without audio) ----------------
pytestmark_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _make(path, size, dur, audio):
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc=duration={dur}:size={size}:rate=25"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={dur}", "-c:a", "aac"]
    subprocess.run(cmd + ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)


def _probe(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
                                   "-of", "json", str(path)])
    return json.loads(out)


@pytestmark_ffmpeg
def test_real_stitch_joins_mismatched_sources(tmp_path):
    setup = tmp_path / "setup.mp4"; payoff = tmp_path / "payoff.mp4"; out = tmp_path / "stitched.mp4"
    _make(setup, "640x360", 8, audio=False)        # smaller + silent: must not break the concat
    _make(payoff, "1280x720", 20, audio=True)
    seed = dict(SEED, snippet_path=str(setup))
    match = {"seed": seed, "setup_src_in": 1.0, "setup_src_out": 5.0}
    res = run(build_stitched_source(match, payoff, 10.0, 16.0, out))
    info = _probe(out)
    assert abs(float(info["format"]["duration"]) - 10.0) < 0.5            # 4 s setup + 6 s payoff
    types = [s["codec_type"] for s in info["streams"]]
    assert "video" in types and "audio" in types
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (640, 360)                # conformed to the first source
    assert res["setup_duration"] == 4.0


def test_stitch_fails_closed_when_snippet_missing(tmp_path):
    payoff = tmp_path / "p.mp4"; payoff.write_bytes(b"x" * 10)
    match = {"seed": dict(SEED, snippet_path=str(tmp_path / "gone.ts")), "setup_src_in": 0, "setup_src_out": 4}
    with pytest.raises(StitchError):
        run(build_stitched_source(match, payoff, 0, 5, tmp_path / "o.mp4"))


def test_story_settings_loaded_from_db(monkeypatch):
    import config.settings as cfg
    from src.intelligence import story_settings

    values = {"story_engine_enabled": "true", "story_mode": "live", "story_seed_cpu_budget": "0.2", "story_session_grace_minutes": "50"}

    async def fake(key, default=None):
        return values.get(key, default)

    monkeypatch.setattr(story_settings, "get_system_setting", fake)
    for name in ("STORY_ENGINE_ENABLED", "STORY_MODE", "STORY_SEED_CPU_BUDGET", "STORY_SESSION_GRACE_MINUTES"):
        monkeypatch.setattr(cfg, name, getattr(cfg, name))      # restore after the test
    run(story_settings.load_story_settings_from_db())
    assert cfg.STORY_ENGINE_ENABLED is True and cfg.STORY_MODE == "live"
    assert cfg.STORY_SEED_CPU_BUDGET == 0.2 and cfg.STORY_SESSION_GRACE_MINUTES == 50
