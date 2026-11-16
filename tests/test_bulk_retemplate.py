"""Bulk re-template: background batch, per-clip status, partial failure, concurrency, cancel."""
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from src.web import routes_clips as rc


def _routes_registered():
    return rc.register_clips_routes


async def _wait(client, bid):
    for _ in range(200):
        r = await (await client.get(f"/api/clips/bulk-retemplate/{bid}")).json()
        if r["finished"]:
            return r
        await asyncio.sleep(0.02)
    raise AssertionError("batch never finished")


@pytest.mark.asyncio
async def test_partial_failure_does_not_stop_batch(monkeypatch, tmp_path):
    tpl = tmp_path / "tplx.json"; tpl.write_text("{}")
    monkeypatch.setattr(rc, "resolve_template_file", lambda name: tpl if name == "tplx" else None)
    rc._BATCHES.clear()
    order = []

    async def fake(clip_id, t_file):
        order.append(clip_id)
        if clip_id == 2:
            raise rc.RetemplateError("RENDER_FAILED", "source missing", 409)
        return {"success": True, "clip_id": clip_id, "template_name": "tplx", "video_url": f"/v/{clip_id}"}

    monkeypatch.setattr(rc, "_retemplate_one", fake)
    app = web.Application(); _routes_registered()(app)
    async with TestClient(TestServer(app)) as c:
        r = await c.post("/api/clips/bulk-retemplate", json={"clip_ids": [1, 2, 3, 3], "template": "tplx"})
        assert r.status == 200
        body = await r.json()
        assert body["total"] == 3                       # duplicates removed
        done = await _wait(c, body["batch_id"])
    assert order == [1, 2, 3]                           # concurrency 1 -> strict order
    st = {i["clip_id"]: i["status"] for i in done["items"]}
    assert st == {1: "done", 2: "failed", 3: "done"}
    assert done["items"][1]["error"] == "source missing"


@pytest.mark.asyncio
async def test_validation_and_single_running_batch(monkeypatch, tmp_path):
    tpl = tmp_path / "tplx.json"; tpl.write_text("{}")
    monkeypatch.setattr(rc, "resolve_template_file", lambda name: tpl if name == "tplx" else None)
    rc._BATCHES.clear()
    gate = asyncio.Event()

    async def slow(clip_id, t_file):
        await gate.wait()
        return {"success": True, "clip_id": clip_id, "template_name": "tplx", "video_url": "/v"}

    monkeypatch.setattr(rc, "_retemplate_one", slow)
    app = web.Application(); _routes_registered()(app)
    async with TestClient(TestServer(app)) as c:
        assert (await c.post("/api/clips/bulk-retemplate", json={"clip_ids": [], "template": "tplx"})).status == 400
        assert (await c.post("/api/clips/bulk-retemplate", json={"clip_ids": ["x"], "template": "tplx"})).status == 400
        assert (await c.post("/api/clips/bulk-retemplate", json={"clip_ids": [1], "template": "nope"})).status == 404
        first = await (await c.post("/api/clips/bulk-retemplate", json={"clip_ids": [1, 2], "template": "tplx"})).json()
        assert (await c.post("/api/clips/bulk-retemplate", json={"clip_ids": [3], "template": "tplx"})).status == 409
        # cancel: the running clip finishes, the queued one is cancelled
        await asyncio.sleep(0.05)
        await c.post(f"/api/clips/bulk-retemplate/{first['batch_id']}/cancel")
        gate.set()
        done = await _wait(c, first["batch_id"])
    assert [i["status"] for i in done["items"]] == ["done", "cancelled"]
