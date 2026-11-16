"""Old-format templates must open WITH their layers (the Studio used to show 0 layers for them)."""

import asyncio
import glob
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.compositor.template_migration import (  # noqa: E402
    is_legacy_layout, migrate_layout_to_v2, normalize_template_for_client, strip_client_only_keys,
)

FILES = sorted(glob.glob(str(ROOT / "templates" / "*.json")))


def load(path):
    return json.load(open(path, encoding="utf-8"))


def test_at_least_one_legacy_template_is_covered():
    assert any(is_legacy_layout(load(f)) for f in FILES), "no legacy template left to cover this regression"


@pytest.mark.parametrize("path", FILES, ids=[Path(f).stem for f in FILES])
def test_every_template_opens_with_the_layers_the_renderer_uses(path):
    raw = load(path)
    served = normalize_template_for_client(raw)
    renderer_layers = migrate_layout_to_v2(raw)["layers"]                  # what actually gets rendered
    assert len(served["layout"]["layers"]) == len(renderer_layers) > 0, f"{Path(path).name} would open empty"
    assert [l["id"] for l in served["layout"]["layers"]] == [l["id"] for l in renderer_layers]
    for layer in served["layout"]["layers"]:                               # geometry is usable
        for rect in (layer["src"], layer["dst"]):
            assert all(0.0 <= rect[k] <= 1.0001 for k in "xywh")
    if is_legacy_layout(raw):
        assert served["_migrated_from_legacy"] and served["legacy_layout"] == raw["layout"]
    else:
        assert served is raw or served == raw                              # schema-2 templates untouched


def test_casoh_layout_is_facecam_top_gameplay_bottom():
    served = normalize_template_for_client(load(ROOT / "templates" / "casoh_layout.json"))
    names = {l["name"]: l for l in served["layout"]["layers"]}
    assert set(names) == {"Facecam", "Gameplay"}
    assert names["Facecam"]["dst"]["y"] == 0.0 and names["Gameplay"]["dst"]["y"] > 0.3     # cam on top
    assert abs(names["Facecam"]["src"]["y"] - 0.155) < 1e-6                                # crop kept losslessly


def test_truly_empty_schema2_template_stays_empty():
    t = {"name": "x", "layout": {"schema": 2, "layers": []}}
    assert normalize_template_for_client(t) is t


def test_editor_only_keys_are_never_persisted():
    served = normalize_template_for_client(load(ROOT / "templates" / "casoh_layout.json"))
    clean = strip_client_only_keys(served)
    assert "legacy_layout" not in clean and "_migrated_from_legacy" not in clean


def test_api_serves_migrated_layers_and_save_upgrades_the_file(tmp_path, monkeypatch):
    from src.web import routes_templates as rt
    tdir = tmp_path / "templates"
    tdir.mkdir()
    (tdir / "casoh_layout.json").write_text((ROOT / "templates" / "casoh_layout.json").read_text())
    monkeypatch.setattr(rt, "TEMPLATES_DIR", str(tdir))

    class Req:
        def __init__(self, body=None):
            self._b = body
            self.match_info = {}

        async def json(self):
            return self._b

    served = json.loads(asyncio.run(rt.get_templates(Req())).body)
    assert len(served[0]["layout"]["layers"]) == 2 and served[0]["_migrated_from_legacy"]

    resp = asyncio.run(rt.save_template(Req(served[0])))          # the editor sends it back unchanged
    assert resp.status == 200
    on_disk = json.loads((tdir / "casoh_layout.json").read_text())
    assert on_disk["layout"]["schema"] == 2 and len(on_disk["layout"]["layers"]) == 2
    assert "legacy_layout" not in on_disk and "_migrated_from_legacy" not in on_disk

    m = json.loads(asyncio.run(rt.migrate_template(Req({"layout": json.loads((ROOT / "templates/casoh_layout.json").read_text())["layout"]}))).body)
    assert m["migrated"] and len(m["layout"]["layers"]) == 2
