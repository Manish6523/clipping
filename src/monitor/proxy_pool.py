"""Free public proxy pool for yt-dlp, used when YouTube blocks the server's own IP.

Adapted from proxy_manager.py (FreeProxyManager): same public sources and parallel validation,
with the changes needed for yt-dlp to actually work through them (measured on the VPS):

  * A proxy only counts as valid if https://www.youtube.com/generate_204 answers through it WITH
    certificate verification. The old ip-api check passed proxies that can't reach YouTube, and
    some free proxies intercept TLS - with verification off they would see everything we send.
  * Only plain http:// proxies (HTTPS CONNECT tunnel). The "https://ip:443" entries in public
    lists all failed the TLS handshake.
  * No country filter by default (YTDLP_PROXY_COUNTRY=IN to restrict): YouTube doesn't care, and
    filtering shrinks a pool where only ~10% of candidates work at all.

Proxies that fail in real use are dropped; the pool refills itself when it runs low or gets old.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
import random
import threading
import time
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

INDIA_SOURCES = [
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/IN/data.txt",
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=IN&ssl=all&anonymity=all",
    "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&proxy_format=ipport&format=text&country=IN",
    "https://proxylist.geonode.com/api/proxy-list?country=IN&protocols=http%2Chttps&limit=100&page=1&sort_by=lastChecked&sort_type=desc",
]
GLOBAL_SOURCES = [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt",
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=yes&anonymity=all",
]
CHECK_URL = "https://www.youtube.com/generate_204"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

POOL_TARGET = int(os.getenv("YTDLP_PROXY_POOL", "20"))
POOL_MIN = 3                       # refill below this
POOL_MAX_AGE_S = 45 * 60           # free proxies die quickly; revalidate after this
BAD_FOR_S = 3600                   # a failed proxy (and every port of its host) is skipped this long
HOST_STRIKES = 2                   # failures on different ports before the whole host is skipped
SUBNET_STRIKES = 3                 # failures across one /24 before the whole block is skipped


def _host(proxy: str) -> str:
    return proxy.split("://", 1)[-1].rsplit(":", 1)[0]


def _subnet(proxy: str) -> str:
    h = _host(proxy)
    return h.rsplit(".", 1)[0] + ".*" if h.count(".") == 3 else h


def _parse(url: str, text: str, json_body=None) -> List[str]:
    out: List[str] = []
    if json_body is not None:
        for item in (json_body or {}).get("data", []):
            if item.get("ip") and item.get("port") and "http" in (item.get("protocols") or ["http"]):
                out.append(f"http://{item['ip']}:{item['port']}")
        return out
    for line in text.splitlines():
        c = line.strip()
        if c.startswith("http://"):
            out.append(c)
        elif "://" not in c and c.count(":") == 1:
            host, port = c.rsplit(":", 1)
            if host and port.isdigit() and 0 < int(port) < 65536:
                out.append(f"http://{host}:{port}")
    return out


class ProxyPool:
    def __init__(self, country: Optional[str] = None, timeout: float = 6.0, workers: int = 100,
                 max_candidates: int = 1500):
        self.country = (country if country is not None else os.getenv("YTDLP_PROXY_COUNTRY", "")).strip().upper()
        self.timeout = timeout
        self.workers = workers
        self.max_candidates = max_candidates
        self._pool: List[str] = []
        self._latency: Dict[str, float] = {}
        self._bad: Dict[str, float] = {}          # proxy -> time it failed (skipped for a while)
        self._host_strikes: Dict[str, List[float]] = {}   # host -> failure times (one host often has many ports)
        self._lock = threading.Lock()
        self._refresh_lock: Optional[asyncio.Lock] = None
        self.preferred: Optional[str] = None      # last proxy that worked - tried first
        self.last_refresh: Optional[float] = None
        self.last_stats: Dict[str, int] = {}

    # ---------------------------------------------------------------- discovery
    def scrape_candidates(self) -> List[str]:
        import requests
        found: set = set()

        def fetch(url: str):
            try:
                r = requests.get(url, timeout=8, headers={"User-Agent": UA})
                if r.ok:
                    found.update(_parse(url, r.text, r.json() if "geonode.com" in url else None))
            except Exception:
                pass

        sources = INDIA_SOURCES + ([] if self.country == "IN" else GLOBAL_SOURCES)
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(sources)) as ex:
            list(ex.map(fetch, sources))
        now = time.time()
        cands = [p for p in found if not self._is_bad(p, now)]
        random.shuffle(cands)
        return cands[: self.max_candidates]

    def _country_of(self, proxy: str) -> Optional[str]:
        import requests
        try:
            r = requests.get("http://ip-api.com/json?fields=countryCode", proxies={"http": proxy, "https": proxy},
                             timeout=self.timeout)
            return (r.json().get("countryCode") or "").upper()
        except Exception:
            return None

    def validate(self, proxy: str) -> Optional[float]:
        """Seconds YouTube took to answer through `proxy` with a verified certificate, else None."""
        import requests
        t = time.time()
        try:
            r = requests.get(CHECK_URL, proxies={"http": proxy, "https": proxy}, timeout=self.timeout,
                             headers={"User-Agent": UA}, allow_redirects=False)      # verify=True (default)
            if r.status_code != 204:
                return None
        except Exception:
            return None
        if self.country and self._country_of(proxy) != self.country:
            return None
        return time.time() - t

    def refresh(self, target: int = POOL_TARGET) -> Dict[str, int]:
        cands = [p for p in self.scrape_candidates() if p not in self._pool]
        good: Dict[str, float] = {}
        ex = concurrent.futures.ThreadPoolExecutor(max_workers=self.workers)
        try:
            futs = {ex.submit(self.validate, p): p for p in cands}
            for f in concurrent.futures.as_completed(futs):
                lat = f.result()
                if lat is not None:
                    good[futs[f]] = lat
                    if len(good) + len(self._pool) >= target:
                        break
        finally:
            ex.shutdown(wait=False, cancel_futures=True)
        with self._lock:
            self._latency.update(good)
            merged = list(dict.fromkeys(self._pool + list(good)))
            self._pool = sorted(merged, key=lambda p: self._latency.get(p, 99))[: max(target, POOL_MIN)]
            self.last_refresh = time.time()
            self.last_stats = {"candidates": len(cands), "valid": len(good), "pool": len(self._pool)}
        logger.info("Proxy pool refreshed: %d of %d candidates reach YouTube; %d ready.", len(good), len(cands), len(self._pool))
        return self.last_stats

    # ---------------------------------------------------------------- use
    def needs_refresh(self) -> bool:
        with self._lock:
            return len(self._pool) < POOL_MIN or not self.last_refresh or time.time() - self.last_refresh > POOL_MAX_AGE_S

    async def ensure(self) -> None:
        """Refill in a worker thread when low/stale; concurrent callers share one refresh."""
        if self._refresh_lock is None:
            self._refresh_lock = asyncio.Lock()
        async with self._refresh_lock:
            if self.needs_refresh():
                await asyncio.get_running_loop().run_in_executor(None, self.refresh)

    def _is_bad(self, proxy: str, now: Optional[float] = None) -> bool:
        now = now or time.time()
        if now - self._bad.get(proxy, 0) <= BAD_FOR_S:
            return True
        recent = lambda key: len([t for t in self._host_strikes.get(key, []) if now - t <= BAD_FOR_S])
        return recent(_host(proxy)) >= HOST_STRIKES or recent(_subnet(proxy)) >= SUBNET_STRIKES

    def candidates(self, n: int) -> List[str]:
        """Up to n proxies to try, last-known-good first, then fastest."""
        with self._lock:
            order = ([self.preferred] if self.preferred in self._pool else []) + [p for p in self._pool if p != self.preferred]
        return order[:n]

    def mark_good(self, proxy: str) -> None:
        self.preferred = proxy

    def mark_bad(self, proxy: str) -> None:
        """Drop a proxy; after HOST_STRIKES failures on one host drop all its ports, after
        SUBNET_STRIKES in one /24 drop the block (seen on the VPS: 147.161.246.34/.37/... on dozens
        of ports kept serving cut-off downloads)."""
        with self._lock:
            now = time.time()
            self._bad[proxy] = now
            self._host_strikes.setdefault(_host(proxy), []).append(now)
            if _subnet(proxy) != _host(proxy):
                self._host_strikes.setdefault(_subnet(proxy), []).append(now)
            self._pool = [p for p in self._pool if not self._is_bad(p, now)]
            if self.preferred and self._is_bad(self.preferred, now):
                self.preferred = None

    def status(self) -> dict:
        with self._lock:
            return {"ready": len(self._pool), "preferred": self.preferred, "last_refresh": self.last_refresh,
                    "country": self.country or "any", **({"last": self.last_stats} if self.last_stats else {})}


POOL = ProxyPool()
