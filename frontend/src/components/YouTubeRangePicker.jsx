import React, { useEffect, useRef, useState } from 'react';
import { Flag, FlagOff, Play } from 'lucide-react';

/** Extracts a YouTube video id from watch / youtu.be / shorts / live / embed URLs. */
export function youtubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
      if (m) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

/** Parses YouTube's t= / start= (e.g. 90, 90s, 1m30s) into seconds. */
export function youtubeStartParam(url) {
  try {
    const u = new URL(url.trim());
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    if (!t) return null;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return null;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  } catch {
    return null;
  }
}

let apiPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('Could not load YouTube player')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const fmt = (s) => {
  if (s == null || Number.isNaN(s)) return '--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export default function YouTubeRangePicker({ videoId, start, end, onSetStart, onSetEnd, initialTime }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    setReady(false);
    setError(null);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(initialTime || 0) },
          events: {
            onReady: () => {
              if (cancelled) return;
              setReady(true);
              timer = setInterval(() => {
                try { setNow(playerRef.current?.getCurrentTime?.() || 0); } catch { /* player gone */ }
              }, 250);
            },
            onError: () => setError('This video can’t be embedded — type the times instead.'),
          },
        });
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      clearInterval(timer);
      try { playerRef.current?.destroy?.(); } catch { /* already destroyed */ }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const seekTo = (t) => {
    try { playerRef.current?.seekTo(t, true); playerRef.current?.playVideo(); } catch { /* not ready */ }
  };

  const len = start != null && end != null && end > start ? end - start : null;

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
      <div className="relative w-full aspect-video bg-black">
        <div ref={hostRef} className="absolute inset-0" />
        {error && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-400">{error}</div>}
      </div>
      <div className="p-2.5 bg-slate-950 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>Now {fmt(now)}</span>
          <span className={len && len > 180 ? 'text-rose-300' : ''}>
            {fmt(start)} → {fmt(end)}{len ? ` · ${Math.round(len)}s` : ''}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={!ready} onClick={() => onSetStart(Math.round(now * 10) / 10)}
            className="h-11 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
            <Flag size={14} /> Set start
          </button>
          <button type="button" disabled={!ready || start == null} onClick={() => seekTo(start)}
            className="h-11 rounded-lg bg-white/[0.06] border border-white/10 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
            <Play size={14} /> From start
          </button>
          <button type="button" disabled={!ready} onClick={() => onSetEnd(Math.round(now * 10) / 10)}
            className="h-11 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
            <FlagOff size={14} /> Set end
          </button>
        </div>
      </div>
    </div>
  );
}
