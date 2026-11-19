"""yt-dlp proxy fallback: direct first, proxies after a block, dead proxies dropped, no cookies through proxies.
yt-dlp and the proxy pool are faked - nothing touches the network."""
import asyncio

import pytest
from pathlib import Path

from src.monitor import ytdlp
from src.monitor import proxy_pool as pp

BOT = "ERROR: [youtube] x: Sign in to confirm you're not a bot."


class FakePool:
    def __init__(self, proxies):
        self.proxies = list(proxies)
        self.bad, self.good, self.ensured = [], [], 0
        self.preferred = None

    async def ensure(self):
        self.ensured += 1

    def candidates(self, n):
        return [p for p in self.proxies if p not in self.bad][:n]

    def mark_bad(self, p):
        self.bad.append(p)

    def mark_good(self, p):
        self.good.append(p)
        self.preferred = p


@pytest.fixture
def env(monkeypatch, tmp_path):
    cookies = tmp_path / "c.txt"
    cookies.write_text("x")
    monkeypatch.setattr(ytdlp, "cookies_path", lambda: cookies)
    monkeypatch.setattr(ytdlp, "_direct_blocked_until", 0.0)
    monkeypatch.delenv("YTDLP_PROXY", raising=False)
    monkeypatch.delenv("YTDLP_PROXY_FALLBACK", raising=False)
    calls = []
    answers = {}

    async def fake_exec(cmd, timeout):
        proxy = cmd[cmd.index("--proxy") + 1] if "--proxy" in cmd else None
        calls.append({"proxy": proxy, "cookies": "--cookies" in cmd, "probe": "--print" in cmd and "id" in cmd})
        ans = answers.get(proxy, (0, b"ok", ""))
        if isinstance(ans, float):                 # a slow proxy: sleeps, then succeeds
            await asyncio.sleep(ans)
            killed_or_done.append(proxy)
            return 0, b"slow", ""
        return ans
    killed_or_done = []
    monkeypatch.setattr(ytdlp, "_exec", fake_exec)
    return calls, answers, monkeypatch


def use_pool(monkeypatch, proxies):
    pool = FakePool(proxies)
    monkeypatch.setattr(pp, "POOL", pool)
    return pool


def test_direct_success_never_touches_proxies(env):
    calls, answers, mp = env
    pool = use_pool(mp, ["http://p1:80"])
    rc, out, _ = asyncio.run(ytdlp.run(["--simulate", "u"]))
    assert rc == 0 and out == b"ok" and len(calls) == 1 and calls[0]["proxy"] is None and calls[0]["cookies"]
    assert pool.ensured == 0


def test_lookup_races_proxies_without_cookies_and_drops_dead_ones(env):
    calls, answers, mp = env
    pool = use_pool(mp, ["http://dead:80", "http://botted:80", "http://slow:80", "http://good:80"])
    answers[None] = (1, b"", BOT)
    answers["http://dead:80"] = (1, b"", "ERROR: Unable to download API page: ('Unable to connect to proxy', ...)")
    answers["http://botted:80"] = (1, b"", BOT)
    answers["http://slow:80"] = 5.0
    rc, out, _ = asyncio.run(asyncio.wait_for(ytdlp.run(["--simulate", "u"], timeout=60), 3))   # slow one is killed, not awaited
    assert rc == 0 and out == b"ok"
    assert calls[0]["proxy"] is None and {c["proxy"] for c in calls[1:]} == {"http://dead:80", "http://botted:80", "http://slow:80", "http://good:80"}
    assert all(not c["cookies"] for c in calls[1:])            # login cookies never go through a free proxy
    assert sorted(pool.bad) == ["http://botted:80", "http://dead:80"] and pool.good == ["http://good:80"]


def test_download_races_proxies_into_separate_folders(env, tmp_path):
    calls, answers, mp = env
    pool = use_pool(mp, ["http://dead:80", "http://slow:80", "http://good:80"])
    answers[None] = (1, b"", BOT)
    answers["http://dead:80"] = (1, b"", "ERROR: ffmpeg exited with code 146")
    answers["http://slow:80"] = 5.0
    outs = {}

    async def writing_exec(cmd, timeout):
        proxy = cmd[cmd.index("--proxy") + 1] if "--proxy" in cmd else None
        out = cmd[cmd.index("--output") + 1]
        outs[proxy] = out
        calls.append(proxy)
        if proxy == "http://good:80":
            Path(out).write_bytes(b"video")
            Path(out + ".part").write_bytes(b"x")
            return 0, b"", ""
        ans = answers.get(proxy)
        if isinstance(ans, float):
            Path(out + ".part").write_bytes(b"partial")
            await asyncio.sleep(ans)
            return 0, b"", ""
        return ans
    mp.setattr(ytdlp, "_exec", writing_exec)
    dest = tmp_path / "out" / "clip.mp4"
    rc, _, _ = asyncio.run(asyncio.wait_for(
        ytdlp.run(["--download-sections", "*1-2", "--output", str(dest), "https://youtu.be/x"], timeout=60), 3))
    assert rc == 0 and dest.read_bytes() == b"video"
    assert not any(c.get("probe") for c in calls if isinstance(c, dict))          # no separate lookup round
    assert {p for p in outs if p} == {"http://dead:80", "http://slow:80", "http://good:80"}
    assert len({outs[p] for p in outs if p}) == 3                                  # every proxy writes elsewhere
    assert sorted(f.name for f in dest.parent.iterdir()) == ["clip.mp4"]          # temp folders and .part cleaned
    assert pool.bad == ["http://dead:80"] and pool.good == ["http://good:80"]


def test_race_replaces_dead_proxies_right_away(env):
    calls, answers, mp = env
    pool = use_pool(mp, ["http://d1:80", "http://d2:80", "http://slow:80", "http://spare:80"])
    answers[None] = (1, b"", BOT)
    answers["http://d1:80"] = (1, b"", "ERROR: Unable to connect to proxy")
    answers["http://d2:80"] = (1, b"", "ERROR: ffmpeg exited with code 146")
    answers["http://slow:80"] = 5.0
    mp.setattr(ytdlp, "DOWNLOAD_RACE_WIDTH", 3)
    rc, _, _ = asyncio.run(asyncio.wait_for(ytdlp.run(["-o", "/tmp/x_never_written.mp4", "https://youtu.be/x"], timeout=60), 3))
    assert rc == 0 and pool.good == ["http://spare:80"]          # spare joined the race once d1/d2 died


def test_truncated_proxy_download_is_rejected(env, tmp_path):
    """ffmpeg exits 0 when a proxy drops mid-stream; a short file must not win the race."""
    calls, answers, mp = env
    pool = use_pool(mp, ["http://cut:80", "http://full:80"])
    answers[None] = (1, b"", BOT)
    lengths = {}

    async def writing_exec(cmd, timeout):
        if "--proxy" not in cmd:
            return answers[None]
        proxy = cmd[cmd.index("--proxy") + 1]
        out = Path(cmd[cmd.index("--output") + 1])
        Path(cmd[cmd.index("--print-to-file") + 2]).write_text("4043\n")
        out.write_bytes(proxy.encode())
        lengths[str(out)] = 56.0 if proxy == "http://cut:80" else 4043.0
        if proxy == "http://full:80":
            await asyncio.sleep(0.05)                     # the truncated one "finishes" first
        return 0, b"", ""

    async def fake_probe(path):
        return lengths[str(path)]
    mp.setattr(ytdlp, "_exec", writing_exec)
    mp.setattr(ytdlp, "_media_seconds", fake_probe)
    dest = tmp_path / "a" / "audio_extract.webm"
    rc, _, _ = asyncio.run(ytdlp.run(["-f", "wa", "--download-sections", "*0-10800", "--output", str(dest),
                                      "https://youtu.be/x"], timeout=60))
    assert rc == 0 and dest.read_bytes() == b"http://full:80"
    assert pool.bad == ["http://cut:80"] and pool.good == ["http://full:80"]
    assert sorted(f.name for f in dest.parent.iterdir()) == ["audio_extract.webm"]


def test_expected_seconds(tmp_path):
    (tmp_path / ytdlp.DURATION_FILE).write_text("635\n")
    assert ytdlp._expected_seconds(["--download-sections", "*60.00-90.00"], tmp_path) == 30
    assert ytdlp._expected_seconds(["--download-sections", "*0-10800"], tmp_path) == 635
    assert ytdlp._expected_seconds([], tmp_path) == 635
    (tmp_path / ytdlp.DURATION_FILE).write_text("NA\n")                        # live / unknown
    assert ytdlp._expected_seconds(["--download-sections", "*0-10800"], tmp_path) is None
    assert ytdlp._expected_seconds([], tmp_path) is None


def test_real_errors_are_not_retried(env):
    calls, answers, mp = env
    use_pool(mp, ["http://p1:80", "http://p2:80"])
    answers[None] = (1, b"", BOT)
    answers["http://p1:80"] = (1, b"", "ERROR: [youtube] x: Private video. Sign in if you've been granted access")
    answers["http://p2:80"] = 2.0                            # slower than the real answer from p1
    rc, _, err = asyncio.run(ytdlp.run(["--simulate", "u"], timeout=60))
    assert rc == 1 and "Private video" in err


def test_no_proxy_gives_clear_error_and_alertable(env):
    calls, answers, mp = env
    use_pool(mp, [])
    answers[None] = (1, b"", BOT)
    rc, _, err = asyncio.run(ytdlp.run(["u"], timeout=60))
    assert rc == 1 and "no working proxy" in err and ytdlp.is_blocked(err)
    assert "none of the free proxies" in ytdlp.explain(err)


def test_fallback_off_and_pinned_proxy(env):
    calls, answers, mp = env
    pool = use_pool(mp, ["http://p1:80"])
    answers[None] = (1, b"", BOT)
    mp.setenv("YTDLP_PROXY_FALLBACK", "0")
    assert asyncio.run(ytdlp.run(["u"]))[0] == 1 and len(calls) == 1 and pool.ensured == 0
    calls.clear()
    mp.setenv("YTDLP_PROXY", "http://mine:3128")
    assert asyncio.run(ytdlp.run(["u"]))[0] == 0 and calls == [{"proxy": "http://mine:3128", "cookies": True, "probe": False}]


def test_pool_parsing_and_bookkeeping():
    assert pp._parse("x", "1.2.3.4:80\nhttp://5.6.7.8:3128\nsocks5://9.9.9.9:1\nbad\n1.1.1.1:99999") == \
        ["http://1.2.3.4:80", "http://5.6.7.8:3128"]
    assert pp._parse("geonode", "", {"data": [{"ip": "1.1.1.1", "port": "8080", "protocols": ["http"]},
                                               {"ip": "2.2.2.2", "port": "1080", "protocols": ["socks5"]}]}) == ["http://1.1.1.1:8080"]
    pool = pp.ProxyPool(country="")
    pool._pool = ["http://a:1", "http://b:1", "http://c:1"]
    pool.mark_good("http://b:1")
    assert pool.candidates(2) == ["http://b:1", "http://a:1"]
    pool.mark_bad("http://b:1")
    assert pool.candidates(5) == ["http://a:1", "http://c:1"] and pool.preferred is None


def test_a_host_that_keeps_failing_is_dropped_on_every_port():
    pool = pp.ProxyPool(country="")
    pool._pool = ["http://9.9.9.9:1", "http://9.9.9.9:2", "http://9.9.9.9:3", "http://8.8.8.8:1"]
    pool.mark_bad("http://9.9.9.9:1")
    assert pool.candidates(5) == ["http://9.9.9.9:2", "http://9.9.9.9:3", "http://8.8.8.8:1"]   # one strike: other ports stay
    pool.mark_bad("http://9.9.9.9:2")
    assert pool.candidates(5) == ["http://8.8.8.8:1"]
    assert pool._is_bad("http://9.9.9.9:4444")            # new ports of that host are skipped at refresh too


def test_a_stalled_direct_download_falls_back_to_proxies_without_cooldown(env):
    calls, answers, mp = env
    pool = use_pool(mp, ["http://good:80"])
    answers[None] = (1, b"", "[in#0] Error opening input: Connection timed out\nERROR: ffmpeg exited with code 146")
    rc, _, _ = asyncio.run(ytdlp.run(["--download-sections", "*0-60", "-o", "/tmp/never_written_x.webm", "https://youtu.be/x"], timeout=60))
    assert rc == 0 and pool.good == ["http://good:80"] and ytdlp._direct_blocked_until == 0.0
    # a lookup that times out is just returned (no proxy hunt for a flaky metadata call)
    calls.clear()
    answers[None] = (1, b"", "ERROR: timed out")
    assert asyncio.run(ytdlp.run(["--simulate", "u"]))[0] == 1 and len(calls) == 1


def test_every_call_has_a_stall_timeout():
    args = ytdlp.base_args(use_cookies=False)
    assert args[args.index("--downloader-args") + 1] == f"ffmpeg_i:-rw_timeout {ytdlp.STALL_TIMEOUT_S * 1_000_000}"


def test_a_failing_address_block_is_dropped():
    pool = pp.ProxyPool(country="")
    pool._pool = ["http://5.5.5.1:1", "http://5.5.5.2:1", "http://5.5.5.3:1", "http://5.5.5.4:1", "http://6.6.6.6:1"]
    pool.mark_bad("http://5.5.5.1:1")
    pool.mark_bad("http://5.5.5.2:1")
    assert "http://5.5.5.3:1" in pool.candidates(9)
    pool.mark_bad("http://5.5.5.3:1")
    assert pool.candidates(9) == ["http://6.6.6.6:1"] and pool._is_bad("http://5.5.5.99:8080")
