"""Video-aware judge: blend maths, re-rank order, fail-open, real ffmpeg proxy."""
import asyncio
import subprocess
from pathlib import Path

import pytest

from src.intelligence.video_judge import (
    VideoJudge, VisualVerdict, blend_score, make_proxy, proxy_command,
)


def v(visual, reaction, verdict="neutral"):
    return VisualVerdict(visual_score=visual, reaction_score=reaction, visible_events=["x"], verdict=verdict, reason="r")


def test_blend_score():
    assert blend_score(80, None) == 80.0
    assert blend_score(80, v(10, 10)) == 85.0          # 0.75*80 + 0.25*100
    assert blend_score(80, v(1, 1)) == 62.5            # 0.75*80 + 0.25*10
    assert blend_score(60, v(9, 9)) > blend_score(70, v(2, 2))


def test_proxy_command_caps_duration():
    cmd = proxy_command("in.mp4", 10.0, 500.0, "out.mp4")
    assert cmd[cmd.index("-t") + 1] == "75.000"
    assert "scale=-2:360,fps=2" in cmd


class FakeClient:
    _client = object()

    def __init__(self, verdicts):
        self.verdicts = verdicts
        self.calls = 0

    async def generate_structured_media(self, system_instruction, user_prompt, media, mime_type, response_model):
        assert mime_type == "video/mp4" and media
        self.calls += 1
        for key, verdict in self.verdicts.items():
            if key in user_prompt:
                return verdict
        return None


@pytest.fixture(scope="module")
def tiny_video(tmp_path_factory):
    out = tmp_path_factory.mktemp("vj") / "src.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25",
                    "-f", "lavfi", "-i", "sine=frequency=440", "-t", "12", "-c:v", "libx264", "-c:a", "aac",
                    "-shortest", str(out)], check=True)
    return str(out)


def test_make_proxy_is_small(tiny_video):
    data = asyncio.run(make_proxy(tiny_video, 2.0, 8.0))
    assert data and len(data) < 500_000


def test_rerank_promotes_visual_moment(tiny_video):
    cands = [
        {"start": 0, "end": 5, "score": 82, "title": "Talking head"},
        {"start": 5, "end": 10, "score": 76, "title": "Jumpscare"},
        {"start": 2, "end": 7, "score": 50, "title": "Filler"},
    ]
    client = FakeClient({"Talking head": v(2, 2, "weak"), "Jumpscare": v(9, 10, "boost")})
    ranked = asyncio.run(VideoJudge(client=client).rerank(cands, tiny_video, top_k=2))
    assert [c["title"] for c in ranked] == ["Jumpscare", "Talking head", "Filler"]
    assert client.calls == 2                        # only top-K are watched
    assert ranked[0]["video_judge"]["verdict"] == "boost"
    assert "video_judge" not in ranked[2]


def test_rerank_fails_open(tiny_video):
    cands = [{"start": 0, "end": 5, "score": 70, "title": "A"}, {"start": 5, "end": 9, "score": 90, "title": "B"}]
    ranked = asyncio.run(VideoJudge(client=FakeClient({})).rerank(cands, tiny_video))
    assert ranked is cands                          # untouched order when nothing was judged

    class NoClient:
        _client = None
    assert asyncio.run(VideoJudge(client=NoClient()).rerank(cands, tiny_video)) is cands
    assert asyncio.run(VideoJudge(client=FakeClient({})).rerank(cands, "/nope.mp4")) is cands
