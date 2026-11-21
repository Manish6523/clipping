"""Auto-edit plan: building, windowing for re-renders, validation of editor/AI plans, smooth zoom."""
from src.compositor import edit_plan as ep
from src.compositor.auto_edit import _is_hype_word, resolve_config

W = [{"word": w, "start": s, "end": s + 0.3} for w, s in
     (("so", 0.4), ("never", 2.0), ("he", 5.0), ("won", 6.4), ("NO", 9.0), ("WAY!", 9.4), ("100", 16.0), ("dollars", 16.5), ("ok", 20.0))]


def test_build_plan_punchy():
    cfg = resolve_config({"enabled": True, "style": "punchy"})
    plan = ep.build_plan(cfg, W, 22.0, [9.4, 16.3], [(9.4, 12.0), (16.3, 15.0)], [3.0, 3.4, 11.0],
                         {"layer": "cam", "name": "Facecam"}, "Hook line", _is_hype_word)
    assert [z["t"] for z in plan["zooms"]] == [9.4, 16.3] and plan["zooms"][0]["amount"] == 0.22
    assert plan["cold_open"]["on"] and plan["cold_open"]["start"] == 15.8 and plan["cold_open"]["end"] == 17.6
    assert len(plan["emphasis"]) <= 5 and all(e["on"] for e in plan["emphasis"])
    cats = [(s["cat"], s["t"]) for s in plan["sfx"]]
    assert ("hit", 9.38) in cats and ("pop", 16.28) in cats and ("swish", 2.92) in cats
    assert all(t >= 2.5 for c, t in cats if c == "ding")
    assert plan["hook"] == {"on": True, "text": "Hook line"}
    assert len({x["id"] for x in plan["zooms"] + plan["sfx"] + plan["emphasis"]}) == len(plan["zooms"] + plan["sfx"] + plan["emphasis"])


def test_clean_style_has_no_sfx_or_cold_open():
    plan = ep.build_plan(resolve_config({"enabled": True, "style": "clean"}), W, 22.0, [9.4], [(9.4, 12.0)], [], None, None, _is_hype_word)
    assert plan["sfx"] == [] and plan["cold_open"] == {"on": False} and plan["hook"]["on"] is False
    assert plan["zooms"][0]["amount"] == 0.07                       # whole-frame amount when there's no box


def test_window_and_shift_for_rerenders():
    plan = {"zooms": [{"id": "z1", "t": 12.0, "on": True}, {"id": "z2", "t": 30.0, "on": True}],
            "emphasis": [], "sfx": [{"id": "s1", "t": 11.98, "cat": "hit", "on": True}],
            "cold_open": {"on": True, "start": 20.0, "end": 21.5}, "hook": {"on": False}}
    w = ep.window(plan, 10.0, 25.0)
    assert [z["t"] for z in w["zooms"]] == [2.0] and w["sfx"][0]["t"] == 1.98
    assert w["cold_open"]["on"] and w["cold_open"]["start"] == 10.0
    w2 = ep.window(plan, 0.0, 20.5)                                 # payoff cut off by a trim
    assert w2["cold_open"]["on"] is False
    assert plan["zooms"][0]["t"] == 12.0                            # original untouched


def test_validate_cleans_editor_and_ai_input():
    p = ep.validate({"zooms": [{"t": "4.5", "amount": 9}, {"t": -1}, {"t": 50}, {"nope": 1}],
                     "sfx": [{"t": 3, "cat": "laser", "vol": 5}], "emphasis": [{"t": 2, "word": "x" * 99}],
                     "cold_open": {"on": True, "start": 5, "end": 30}, "hook": {"on": 1, "text": "hi"}}, dur=20)
    assert [z["t"] for z in p["zooms"]] == [4.5] and p["zooms"][0]["amount"] == 0.6 and p["zooms"][0]["id"]
    assert p["sfx"][0]["cat"] == "pop" and p["sfx"][0]["vol"] == 1.0
    assert len(p["emphasis"][0]["word"]) == 40
    assert p["cold_open"]["on"] is False                            # 25 s teaser / past the end: refused
    assert p["hook"] == {"on": True, "text": "hi"}


def test_smooth_zoom_expression_skips_undone_items():
    z = ep.zoom_expression([{"t": 3.0, "amount": 0.2}, {"t": 8.0, "amount": 0.2, "on": False}])
    assert z.startswith("1+0.200*clip((it-3.000)/0.22,0,1)") and "8.000" not in z and "(3-2*" in z
    assert ep.zoom_expression([{"t": 3.0, "on": False}]) is None
