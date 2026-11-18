"""Live auto-edit flag: adding it must not crash (it did: merge_flags got a JSON string) and must survive censor merging."""
import json

from main import add_flag
from src.compositor.auto_edit import summary_flag
from src.compositor.profanity import merge_flags


def test_auto_edit_flag_survives_censor_merge():
    flag = summary_flag({"style": "punchy", "cuts": 3, "removed_seconds": 2.7, "zooms": 7, "hook_card": True})
    fj = add_flag(None, flag)
    fj = add_flag(fj, flag)                                    # re-adding replaces, never duplicates
    fj = merge_flags(fj, {"censored": 2}, {"audio_mode": "bleep"})
    types = [f["type"] for f in json.loads(fj)]
    assert types == ["auto_edited", "profanity_censored"]
    assert "3 cuts" in json.loads(fj)[0]["note"]
    assert json.loads(add_flag("not json", flag))[0]["type"] == "auto_edited"
