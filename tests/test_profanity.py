"""Tests for profanity detection, caption masking, audio windows and the FFmpeg censor graph."""

import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.compositor.ass_generator import generate_ass_subtitles  # noqa: E402
from src.compositor.profanity import (  # noqa: E402
    annotate_words,
    build_censor_audio_graph,
    censor_text,
    classify_word,
    compute_windows,
    mask_word,
    merge_config,
    merge_flags,
    summarize,
)


@pytest.mark.parametrize("word,tier", [
    ("fuck", "strong"), ("Fucking!", "strong"), ("motherfucker", "strong"), ("fuckin'", "strong"),
    ("shit,", "strong"), ("bullshit", "strong"), ("bitch", "strong"), ("asshole", "strong"),
    ("f***", "strong"), ("sh*t", "strong"),
    ("damn", "mild"), ("hell", "mild"), ("ass", "mild"),
    ("nigga", "slur"),
])
def test_classify_profane(word, tier):
    assert classify_word(word) == tier


@pytest.mark.parametrize("word", [
    "hello", "class", "assist", "assassin", "cocktail", "shell", "pass", "classic", "Scunthorpe", "witch", "",
])
def test_classify_clean(word):
    assert classify_word(word) is None


def test_custom_and_allow_words():
    cfg = merge_config({"custom_words": ["frick"], "allow_words": ["damn"], "censor_mild": True})
    assert classify_word("frick", cfg) == "strong"
    assert classify_word("damn", cfg) is None


@pytest.mark.parametrize("style,expected", [
    ("vowels", "F*CK!"), ("middle", "F**K!"), ("first", "F***!"), ("full", "****!"),
])
def test_mask_styles(style, expected):
    assert mask_word("FUCK!", style) == expected


def test_mask_without_vowels_falls_back_and_keeps_existing_mask():
    assert mask_word("fck", "vowels") == "f*k"
    assert mask_word("f***", "vowels") == "f***"


def test_censor_text_titles():
    assert censor_text("He said FUCK this shit, classic") == "He said F*CK this sh*t, classic"
    assert censor_text("damn") == "damn"  # mild not censored by default
    assert censor_text("damn", merge_config({"censor_mild": True})) == "d*mn"
    assert censor_text("fuck", merge_config({"censor_titles": False})) == "fuck"


def test_annotate_respects_user_override_and_mild_toggle():
    words = [
        {"word": "fuck", "start": 0, "end": 0.3},
        {"word": "fuck", "start": 1, "end": 1.3, "censor": False},  # user un-bleeped
        {"word": "nice", "start": 2, "end": 2.3, "censor": True},   # user bleeped a clean word
        {"word": "damn", "start": 3, "end": 3.3},
    ]
    out = annotate_words(words, merge_config({}))
    assert [w["censored"] for w in out] == [True, False, True, False]
    assert out[0]["profanity"] == "strong" and out[2]["profanity"] is None
    out = annotate_words(words, merge_config({"censor_mild": True}))
    assert out[3]["censored"] is True
    out = annotate_words(words, merge_config({"enabled": False}))
    assert [w["censored"] for w in out] == [False, False, True, False]


def test_compute_windows_offsets_padding_and_merging():
    cfg = merge_config({"pad_before_ms": 100, "pad_after_ms": 100})
    words = annotate_words([
        {"word": "fuck", "start": 10.0, "end": 10.3},
        {"word": "shit", "start": 10.35, "end": 10.6},   # overlaps after padding -> merged
        {"word": "bitch", "start": 13.0, "end": 13.2, "deleted": True},  # cut from the clip
        {"word": "fuck", "start": 30.0, "end": 30.4},    # outside the clip
        {"word": "hello", "start": 11.0, "end": 11.5},
    ], cfg)
    assert compute_windows(words, time_offset=9.0, duration=8.0, cfg=cfg) == [(0.9, 1.7)]


def test_window_clamped_to_clip_start():
    words = annotate_words([{"word": "fuck", "start": 0.0, "end": 0.2}], merge_config({}))
    assert compute_windows(words, 0.0, 5.0, merge_config({}))[0][0] == 0.0


def test_audio_graph_modes():
    windows = [(1.0, 1.5), (3.0, 3.4)]
    assert build_censor_audio_graph(windows, merge_config({"audio_mode": "off"})) is None
    assert build_censor_audio_graph([], merge_config({})) is None

    g = build_censor_audio_graph(windows, merge_config({"audio_mode": "mute"}), tail_filters=["atempo=1.02"])
    assert "between(t,1.000,1.500)+between(t,3.000,3.400)" in g
    assert "sine=" not in g and g.endswith("atempo=1.02[aout]")

    g = build_censor_audio_graph(windows, merge_config({"audio_mode": "bleep"}), tail_filters=["atempo=1.02"])
    assert g.count("sine=frequency=1000") == 2 and "adelay=3000:all=1" in g
    assert "amix=inputs=3" in g and g.endswith("atempo=1.02[aout]")

    g = build_censor_audio_graph(windows, merge_config({"audio_mode": "sfx"}), sfx_input_index=1)
    assert "[1:a]" in g and "asplit=2" in g and "amix=inputs=3" in g

    # sfx requested but no file -> falls back to bleep
    g = build_censor_audio_graph(windows, merge_config({"audio_mode": "sfx"}), sfx_input_index=None)
    assert "sine=" in g


def test_summary_and_flags():
    cfg = merge_config({})
    words = annotate_words([
        {"word": "fuck", "start": 5.0, "end": 5.2},
        {"word": "nigga", "start": 6.0, "end": 6.2},
        {"word": "shit", "start": 50.0, "end": 50.2},  # outside clip
    ], cfg)
    summary = summarize(words, time_offset=4.0, duration=10.0)
    assert summary == {"censored": 2, "slurs": 1, "detected": 2}
    flags = json.loads(merge_flags(json.dumps([{"type": "unscored"}]), summary, cfg))
    types = [f["type"] for f in flags]
    assert types == ["unscored", "profanity_censored", "slur_detected"]
    # idempotent: re-merging replaces instead of duplicating
    flags2 = json.loads(merge_flags(json.dumps(flags), summary, cfg))
    assert [f["type"] for f in flags2] == types


def test_ass_captions_are_masked(tmp_path):
    cfg = merge_config({"caption_style": "vowels", "censored_color": "#FF0000"})
    words = [{"word": "what", "start": 0.0, "end": 0.3}, {"word": "the", "start": 0.3, "end": 0.5},
             {"word": "fuck", "start": 0.5, "end": 0.9}]
    out = generate_ass_subtitles(words, tmp_path / "c.ass", {"subtitles": {"uppercase": True}}, censor_cfg=cfg)
    text = out.read_text()
    assert "F*CK" in text and "FUCK" not in text
    assert "&H000000FF" in text  # #FF0000 in ASS BGR order

    out = generate_ass_subtitles(words, tmp_path / "plain.ass", {"subtitles": {}})
    assert "FUCK" in out.read_text()  # no censor config -> untouched (backwards compatible)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_render_bleeps_only_the_censored_window(tmp_path):
    from src.compositor.ffmpeg_renderer import FFmpegRenderer

    src = tmp_path / "src.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=6",
        "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:d=6", "-ac", "2",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(src),
    ], check=True)

    def mean_volume(path, ss, t):
        err = subprocess.run(["ffmpeg", "-v", "info", "-ss", str(ss), "-t", str(t), "-i", str(path),
                              "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
        return float(next(l for l in err.splitlines() if "mean_volume" in l).split(":")[1].split()[0])

    cfg = merge_config({"audio_mode": "mute"})
    words = annotate_words([{"word": "fuck", "start": 102.0, "end": 102.6}], cfg)
    out = tmp_path / "out.mp4"
    template = {"layout": {"type": "blurred_bg_center"}, "anti_shadowban": {"speed_multiplier": 1.0}}
    asyncio.run(FFmpegRenderer(use_vaapi=False).render_clip(
        str(src), 0.0, 6.0, str(out), template,
        censor_words=words, censor_cfg=cfg, words_time_offset=100.0,
    ))
    clean, censored = mean_volume(out, 0.5, 1.0), mean_volume(out, 2.1, 0.4)
    assert censored < clean - 20, (clean, censored)
