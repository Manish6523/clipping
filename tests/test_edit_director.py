"""AI edit director: the model's plan is validated and merged; failures fall back. Gemini is faked."""
import asyncio

from src.compositor import edit_plan as ep
from src.compositor.auto_edit import _is_hype_word, resolve_config
from src.intelligence import edit_director as ed

WORDS = [{"word": w, "start": s, "end": s + 0.3} for w, s in
         (("so", 0.5), ("he", 3.0), ("won", 4.1), ("a", 5.0), ("hundred", 6.0), ("dollars", 6.5), ("NO", 12.0), ("WAY!", 12.4),
          ("fuck", 14.0), ("that", 17.0), ("was", 17.3), ("insane", 17.6))]
WORDS[8]["censored"] = True
CFG = resolve_config({"enabled": True, "style": "punchy"})
AUTO = ep.build_plan(CFG, WORDS, 22.0, [12.0], [(12.0, 10.0), (17.6, 12.0)], [8.0], {"layer": "l_face", "name": "Facecam"},
                     "auto hook", _is_hype_word)


def test_model_plan_is_clamped_and_merged():
    ai = ed.DirectorPlan(
        zooms=[ed.DZoom(t=1.0, strength="strong"), ed.DZoom(t=4.1, strength="medium"), ed.DZoom(t=5.0, strength="strong"),
               ed.DZoom(t=12.4, strength="strong"), ed.DZoom(t=21.5)],
        emphasis_word_indexes=[2, 3, 6, 8, 99, 11],
        sounds=[ed.DSound(t=4.1, type="ding"), ed.DSound(t=16.5, type="riser"), ed.DSound(t=30, type="pop")],
        cold_open=ed.DColdOpen(use=True, start=17.0, end=18.8), hook="He bet a hundred dollars and WON", notes="good beats")
    plan = ed._apply(AUTO, ai, WORDS, 22.0, CFG)
    assert plan["by"] == "ai" and [(z["t"], z["amount"]) for z in plan["zooms"]] == [(4.1, 0.18), (12.4, 0.25)]
    assert [e["word"] for e in plan["emphasis"]] == ["won", "NO", "insane"]          # 'a' too short, censored + bad index dropped
    cats = [(s["cat"], s["t"]) for s in plan["sfx"]]
    assert ("hit", 4.08) in cats and ("pop", 12.38) in cats and ("swish", 7.92) in cats and ("riser", 16.5) in cats
    assert ("ding", 4.1) not in cats                                               # too close to the zoom hit
    assert plan["cold_open"] == {"on": True, "start": 17.0, "end": 18.8, "by": "ai"}
    assert plan["hook"]["text"] == "He bet a hundred dollars and WON" and plan["hook"]["on"]
    assert all(it["by"] == "ai" for it in plan["zooms"] + plan["emphasis"])
    ep.validate(plan, 22.0)                                                         # still a valid plan


def test_bad_cold_open_and_hook_are_ignored():
    ai = ed.DirectorPlan(cold_open=ed.DColdOpen(use=True, start=1.0, end=6.0), hook="x " * 20)
    plan = ed._apply(AUTO, ai, WORDS, 22.0, CFG)
    assert plan["cold_open"] == AUTO["cold_open"] and plan["hook"]["text"] == "auto hook"
    assert plan["zooms"] == []                                                      # the model chose no zooms


def test_direct_uses_gemini_and_fails_open(monkeypatch):
    class FakeClient:
        answer = ed.DirectorPlan(zooms=[ed.DZoom(t=12.0, strength="strong")])

        def __init__(self, **kw):
            pass

        async def generate_structured(self, system_instruction, user_prompt, response_model):
            assert "[6] 12.00 NO" in user_prompt and "Facecam" in user_prompt
            return FakeClient.answer
    monkeypatch.setattr("src.intelligence.llm.client.GeminiClient", FakeClient)
    plan = asyncio.run(ed.direct(AUTO, WORDS, 22.0, [], CFG, "auto hook"))
    assert plan["zooms"][0]["t"] == 12.0 and plan["zooms"][0]["amount"] == 0.25
    FakeClient.answer = None
    assert asyncio.run(ed.direct(AUTO, WORDS, 22.0, [], CFG, None)) is None
