"""Quality check parsers and the caption-height fix (no video needed)."""
from src.compositor import quality_check as q


def test_parsers():
    assert q.parse_black("x black_start:0 black_end:1.2 black_duration:1.2\nblack_start:9.5 black_end:10 black_duration:0.5") == \
        [{"start": 0.0, "end": 1.2, "dur": 1.2}, {"start": 9.5, "end": 10.0, "dur": 0.5}]
    assert q.parse_freeze("lavfi.freezedetect.freeze_duration: 2.40") == [2.4]
    assert q.parse_volume("mean_volume: -21.3 dB\nmax_volume: 0.0 dB") == {"max": 0.0, "mean": -21.3}
    assert q.parse_silence("silence_duration: 3.1") == [3.1]


def test_caption_fix_moves_below_or_above_the_face():
    face_top = [[(540, 500, 300, 360)]] * 6                 # face in the upper part, caption band at 0.30 covers it
    assert q.caption_fix(face_top, 0.30) == 0.5            # below it (not higher than the 50% floor)
    face_low = [[(540, 1500, 300, 360)]] * 6               # face low (IRL), captions at 0.76 -> move above
    y = q.caption_fix(face_low, 0.76)
    assert y is not None and y < 0.7
    assert q.caption_fix([[(540, 500, 300, 360)]] * 6, 0.76) is None        # no overlap
    assert q.caption_fix([[(540, 1459, 300, 360)]] + [[]] * 5, 0.76) is None  # only 1 of 6 frames


def test_summary_and_flag_note():
    from src.compositor.auto_edit import summary_flag
    qc = {"issues": [{"code": "captions_over_face", "severity": "medium", "note": "captions covered the face; moved to 50% height"},
                     {"code": "black_frames", "severity": "medium", "note": "1.2s of black at 0.0s"}]}
    s = q.summarize(qc, ["captions_over_face"])
    assert s["fixed"] == ["captions_over_face"] and [i["code"] for i in s["issues"]] == ["black_frames"]
    flag = summary_flag({"style": "punchy", "zooms": 2, "zoom_target": "box: Facecam", "quality": s, "plan_by": "ai"})
    assert "2 zooms on Facecam" in flag["note"] and "AI director" in flag["note"]
    assert "Fixed: captions covered the face" in flag["note"] and "Check: 1.2s of black" in flag["note"]
    assert flag["severity"] == "medium"
