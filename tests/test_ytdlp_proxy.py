"""yt-dlp proxy fallback: direct first, proxies after a block, dead proxies dropped, no cookies through proxies.
yt-dlp and the proxy pool are faked - nothing touches the network."""
import asyncio

import pytest

from src.monitor import ytdlp
from src.monitor import proxy_pool as pp

BOT = "ERROR: [youtube] x: Sign in to confirm you're not a bot."


class FakePool:
    def __init__(self, proxies):
        self.proxies = list(proxies)
        self.bad, self.good, self.ensured = [], [], 0

    async def ensure(self):
        self.ensured += 1

    def candidates(self, n):
        return [p for p in self.proxies if p not in self.bad][:n]

    def mark_bad(self, p):
        self.bad.append(p)

    def mark_good(self, p):
        self.good.append(p)


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
        calls.append({"proxy": proxy, "cookies": "--cookies" in cmd})
        return answers.get(proxy, (0, b"ok", ""))
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


def test_blocked_direct_retries_through_proxy_without_cookies_and_drops_dead_ones(env):
    calls, answers, mp = env
    pool = use_pool(mp, ["http://dead:80", "http://botted:80", "http://good:80"])
    answers[None] = (1, b"", BOT)
    answers["http://dead:80"] = (1, b"", "ERROR: Unable to download API page: ('Unable to connect to proxy', ...)")
    answers["http://botted:80"] = (1, b"", BOT)
    rc, out, _ = asyncio.run(ytdlp.run(["u"], timeout=60))
    assert rc == 0 and out == b"ok"
    assert [c["proxy"] for c in calls] == [None, "http://dead:80", "http://botted:80", "http://good:80"]
    assert all(not c["cookies"] for c in calls[1:])            # login cookies never go through a free proxy
    assert pool.bad == ["http://dead:80", "http://botted:80"] and pool.good == ["http://good:80"]

    # while the IP is known to be blocked, the next call goes straight to a proxy
    calls.clear()
    assert asyncio.run(ytdlp.run(["u2"], timeout=60))[0] == 0
    assert calls[0]["proxy"] == "http://good:80"


def test_real_errors_are_not_retried(env):
    calls, answers, mp = env
    use_pool(mp, ["http://p1:80", "http://p2:80"])
    answers[None] = (1, b"", BOT)
    answers["http://p1:80"] = (1, b"", "ERROR: [youtube] x: Private video. Sign in if you've been granted access")
    rc, _, err = asyncio.run(ytdlp.run(["u"], timeout=60))
    assert rc == 1 and "Private video" in err and len(calls) == 2


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
    assert asyncio.run(ytdlp.run(["u"]))[0] == 0 and calls == [{"proxy": "http://mine:3128", "cookies": True}]


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
