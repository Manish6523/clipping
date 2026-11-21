"""Tests for the Quick Clip auto-edit planner (cuts, remapping, punch-ins, presets)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.compositor.auto_edit import (  # noqa: E402
    add_hook_card,
    hook_text_lines,
    pick_punches,
    plan_segments,
    remap_time,
    remap_words,
    resolve_config,
    zoom_expression,
)


def w(word, s, e):
    return {"word": word, "start": s, "end": e}


PUNCHY = resolve_config({"style": "punchy"})


def test_resolve_config_presets_and_overrides():
    assert resolve_config(None) is None
    assert resolve_config({"enabled": False}) is None
    cfg = resolve_config({"style": "clean", "sfx": True, "zooms": False})
    assert cfg["style"] == "clean" and cfg["sfx"] is True and cfg["zooms"] is False
    assert resolve_config({"style": "bogus"})["style"] == "punchy"


SPEECH_A = [w(x, 3.0 + i * 0.35, 3.3 + i * 0.35) for i, x in enumerate("so what happened in the game today was just wild".split())]
SPEECH_B = [w(x, 9.0 + i * 0.35, 9.3 + i * 0.35) for i, x in enumerate("NO WAY! bro he really hit that shot".split())]


def speech_energy(words, loud_ranges=()):
    def level(t):
        if any(a <= t <= b for a, b in loud_ranges):
            return -12.0
        return -20.0 if any(x["start"] <= t <= x["end"] for x in words) else -45.0
    return [(t / 10, level(t / 10)) for t in range(0, 200)]


def test_plan_trims_lead_tail_gaps_and_fillers():
    words = SPEECH_A + [w("um", 7.0, 7.4)] + SPEECH_B     # filler in a 3.5s pause
    # the "um" is mumbled (quiet) like real fillers, so its island is dropped with the pause
    energy = speech_energy(SPEECH_A + SPEECH_B)
    segs = plan_segments(words, 20.0, PUNCHY, energy=energy)
    assert segs[0][0] == 2.88                              # 0.12s before first word
    assert segs[-1][1] == round(SPEECH_B[-1]["end"] + 0.45, 3)   # dead tail cut
    assert all(not (s <= 7.2 <= e) for s, e in segs)       # "um" and the pause gone
    assert len(segs) == 2


def test_loud_wordless_action_is_never_cut():
    words = SPEECH_A + SPEECH_B
    def talking(t):
        return any(x["start"] <= t <= x["end"] for x in words)
    quiet = [(t / 10, -20.0 if talking(t / 10) else -45.0) for t in range(0, 200)]   # speech loud, pauses quiet
    action = [(t, (-12.0 if 7.0 <= t <= 8.5 else v)) for t, v in quiet]   # gunfire in the pause
    cut = plan_segments(words, 20.0, PUNCHY, energy=quiet)
    kept = plan_segments(words, 20.0, PUNCHY, energy=action)
    assert len(cut) == 2 and len(kept) == 1                # the loud gap is kept
    loud_intro = [(t, (-10.0 if t < 2.5 else v)) for t, v in quiet]
    assert plan_segments(words, 20.0, PUNCHY, energy=loud_intro)[0][0] == 0.0


def test_plan_falls_back_to_full_clip_when_transcript_is_suspicious():
    # only 1s of speech in a 30s clip -> never butcher it
    assert plan_segments([w("hey", 10.0, 11.0)], 30.0, PUNCHY) == [(0.0, 30.0)]
    assert plan_segments([], 12.0, PUNCHY) == [(0.0, 12.0)]
    assert plan_segments([w("a", 1, 2)], 12.0, resolve_config({"style": "minimal", "tighten": False, "jump_cuts": False})) == [(0.0, 12.0)]


def test_remap_time_and_words():
    segs = [(2.0, 4.0), (6.0, 9.0)]
    assert remap_time(2.5, segs) == 0.5
    assert remap_time(6.5, segs) == 2.5
    assert remap_time(5.0, segs) is None
    out = remap_words([w("a", 2.5, 3.0), w("cut", 5.0, 5.5), w("b", 8.5, 9.6)], segs)
    assert [x["word"] for x in out] == ["a", "b"]
    assert out[1]["start"] == 4.5 and out[1]["end"] == 5.0   # clamped to segment end


def test_pick_punches_prefers_loud_hype_after_hook_and_spaces_them():
    energy = [(t / 10, -30.0) for t in range(0, 200)]
    energy[120] = (12.0, -12.0)                              # big spike at 12s
    energy[30] = (3.0, -10.0)                                # spike inside hook window -> ignored... at 3.0 it's allowed
    words = [w("WHAT!", 6.0, 6.4), w("ok", 7.0, 7.2), w("NO!", 6.5, 6.8)]
    p = pick_punches(words, energy, 20.0, PUNCHY)
    assert p == sorted(p)
    assert all(2.2 <= t <= 19.0 for t in p)
    assert any(abs(t - 12.0) < 0.2 for t in p)
    assert all(b - a >= PUNCHY["zoom_every"] * 0.7 for a, b in zip(p, p[1:]))
    assert pick_punches(words, energy, 20.0, resolve_config({"style": "minimal"})) == []


def test_zoom_expression():
    expr = zoom_expression([3.0, 9.5], PUNCHY)
    assert expr.startswith("1+") and "it-3.00" in expr and "it-9.50" in expr and "0.6-it" in expr
    assert zoom_expression([], resolve_config({"style": "clean"})) is None


def test_hook_card_is_inserted(tmp_path):
    ass = tmp_path / "c.ass"
    ass.write_text("[V4+ Styles]\nStyle: KineticCaption,Arial,60\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,KineticCaption,,0,0,0,,HI\n")
    add_hook_card(ass, "He was NOT ready for that one", "Arial", caption_y=0.76)
    text = ass.read_text()
    assert "Style: HookCard" in text and "HookCard,,0,0,0,," in text
    assert "\\pos(540,300)" in text                         # top third when captions are low
    assert hook_text_lines("A very long hook title that keeps going and going forever") [-1].endswith("…")


def test_zoom_xy_clamps_to_frame():
    from src.compositor.auto_edit import zoom_xy
    assert zoom_xy(None) == ("iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)")
    x, y = zoom_xy((0.5, 0.18))
    assert x.startswith("max(0,min(iw-iw/zoom,") and "0.1800*ih" in y
    assert "1.0000*iw" in zoom_xy((5.0, -1))[0] and "0.0000*ih" in zoom_xy((5.0, -1))[1]


def test_finish_with_face_target_renders(tmp_path):
    import asyncio, shutil, subprocess
    if not shutil.which("ffmpeg"):
        return
    from src.compositor.auto_edit import finish_clip, resolve_config
    base = tmp_path / "b.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=6",
                    "-f", "lavfi", "-i", "sine=d=6", "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", str(base)], check=True)
    out = tmp_path / "o.mp4"
    asyncio.run(finish_clip(base, out, None, [3.0], resolve_config({"style": "punchy"}), hook_card=False,
                            zoom_center=(0.5, 0.15)))
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
                         capture_output=True, text=True).stdout
    assert abs(float(dur) - 6.0) < 0.2


# ---- effective_auto_edit: explicit choice beats the Settings default --------------------------
import asyncio as _asyncio


def _with_settings(monkeypatch, values):
    async def fake(key, default=None):
        return values.get(key, default)
    monkeypatch.setattr("src.database.get_system_setting", fake)


def test_effective_auto_edit_falls_back_to_settings(monkeypatch):
    from src.compositor.auto_edit import effective_auto_edit
    _with_settings(monkeypatch, {"auto_edit_enabled": "true", "auto_edit_style": "clean", "auto_edit_hook_card": "false"})
    cfg = _asyncio.run(effective_auto_edit(None))
    assert cfg and cfg["style"] == "clean" and cfg["hook_card"] is False


def test_effective_auto_edit_settings_off(monkeypatch):
    from src.compositor.auto_edit import effective_auto_edit
    _with_settings(monkeypatch, {"auto_edit_enabled": "false"})
    assert _asyncio.run(effective_auto_edit(None)) is None


def test_explicit_off_beats_settings_on(monkeypatch):
    from src.compositor.auto_edit import effective_auto_edit
    _with_settings(monkeypatch, {"auto_edit_enabled": "true"})
    assert _asyncio.run(effective_auto_edit({"enabled": False})) is None


def test_explicit_on_beats_settings_off(monkeypatch):
    from src.compositor.auto_edit import effective_auto_edit
    _with_settings(monkeypatch, {"auto_edit_enabled": "false"})
    cfg = _asyncio.run(effective_auto_edit({"enabled": True, "style": "minimal"}))
    assert cfg and cfg["style"] == "minimal"


def test_only_the_chosen_box_zooms():
    from src.compositor.filter_graph_builder import build_filter_graph
    layout = {"schema": 2, "canvas": {"w": 1080, "h": 1920}, "layers": [
        {"id": "game", "src": {"x": 0.25, "y": 0, "w": 0.5, "h": 1}, "dst": {"x": 0, "y": 0.38, "w": 1, "h": 0.62}, "fit": "cover"},
        {"id": "cam", "src": {"x": 0, "y": 0.1, "w": 0.2, "h": 0.3}, "dst": {"x": 0, "y": 0, "w": 1, "h": 0.38}, "fit": "cover"}]}
    g = build_filter_graph(layout, layer_zoom={"cam": {"z": "1+0.2*clip((it-3)/0.1,0,1)", "fps": 30}})["filter_complex"]
    cam = next(p for p in g.split(";") if p.endswith("[l_1_proc]"))
    game = next(p for p in g.split(";") if p.endswith("[l_0_proc]"))
    assert "zoompan=z='1+0.2*clip((it-3)/0.1,0,1)'" in cam and ":s=1080x730:" in cam and "fps=30.000" in cam
    assert "zoompan" not in game


def test_zoom_box_choice(monkeypatch):
    import asyncio
    from src.compositor import auto_edit as ae

    def tpl(*layers):
        return {"layout": {"schema": 2, "layers": list(layers)}}
    game = {"id": "game", "name": "Gameplay", "src": {"x": 0, "y": 0, "w": 1, "h": 1}}
    cam = {"id": "cam", "name": "Facecam", "src": {"x": 0, "y": 0.1, "w": 0.25, "h": 0.4}}

    async def face(_):
        return (0.1, 0.3)
    monkeypatch.setattr(ae, "face_center", face)
    monkeypatch.setattr(ae, "_duration", lambda p: asyncio.sleep(0, result=0.0))     # skip YuNet, use face_center
    assert asyncio.run(ae.pick_zoom_layer(tpl(game, cam), "x.mp4")) == ("cam", "Facecam")       # smallest box with the face
    follow = {**game, "tracking": {"mode": "face"}}
    assert asyncio.run(ae.pick_zoom_layer(tpl(follow, cam), "x.mp4")) == ("game", "Gameplay")   # face-following box wins
    assert asyncio.run(ae.pick_zoom_layer({"layout": {"type": "facecam_top_gameplay_bottom"}}, "x.mp4")) is None   # legacy

    async def noface(_):
        return None
    monkeypatch.setattr(ae, "face_center", noface)
    assert asyncio.run(ae.pick_zoom_layer(tpl(game, cam), "x.mp4")) is None            # unsure -> whole frame
    assert asyncio.run(ae.pick_zoom_layer(tpl(game), "x.mp4")) == ("game", "Gameplay")


def test_sfx_plan_and_user_sounds(monkeypatch, tmp_path):
    from src.compositor import auto_edit as ae
    for f in ("whoosh.wav", "boom.wav", "pop.wav", "boop.wav"):
        (tmp_path / f).write_bytes(b"x")
    (tmp_path / "hit").mkdir()
    for f in ("a.mp3", "b.wav"):
        (tmp_path / "hit" / f).write_bytes(b"x")
    monkeypatch.setattr(ae, "SFX_DIR", tmp_path)
    cfg = ae.resolve_config({"enabled": True, "style": "punchy"})
    words = [{"word": "NO WAY!", "start": 9.0, "end": 9.4}, {"word": "hello", "start": 2.0, "end": 2.2}]
    plan = ae.plan_sfx([5.0, 12.0], cfg, True, cut_times=[0.2, 3.1, 3.3, 7.0], words=words, dur=20, seed=1)
    names = [(p.name, at) for p, at, _ in plan]
    assert names[0] == ("whoosh.wav", 0.0)
    assert ("b.wav", 4.98) in names                       # user's own "hit" sounds are used
    assert ("pop.wav", 11.98) in names and ("boop.wav", 9.0) in names
    assert ("whoosh.wav", 3.02) in names and ("whoosh.wav", 6.92) in names and len([n for n in names if n[1] in (3.22,)]) == 0
    assert ae.plan_sfx([5.0], ae.resolve_config({"enabled": True, "style": "minimal"}), True) == []
