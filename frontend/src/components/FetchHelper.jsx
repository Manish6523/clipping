import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Laptop, Copy, Check, RefreshCw } from 'lucide-react';
import { Button, Notice, Pill } from './ui';

function CopyLine({ value, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="flex items-start gap-2 rounded-lg bg-canvas border border-line p-2">
      <code className="font-mono text-[11px] text-good break-all flex-1 select-all leading-relaxed">{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="w-11 h-11 -m-1.5 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center text-muted">
        {done ? <Check size={14} className="text-good" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

const ago = (t) => {
  if (!t) return 'never';
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

/** Home fetch helper: yt-dlp runs on the user's PC (unblocked home connection) for this server. */
export default function FetchHelper() {
  const [st, setSt] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const r = await axios.get('/api/settings/fetch-helper'); if (live) setSt(r.data); } catch { /* keep last */ }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const rotate = async () => {
    setRotating(true);
    try { setSt((await axios.post('/api/settings/fetch-helper/rotate')).data); } finally { setRotating(false); setConfirmRotate(false); }
  };

  const origin = window.location.origin;
  const install = 'pip install -U requests "yt-dlp[default]"';
  const run = st?.token
    ? `curl -fsSLo fetch_helper.py ${origin}/api/fetcher/script && python3 fetch_helper.py --server ${origin} --token ${st.token}`
    : '';

  return (
    <div className="rounded-xl bg-canvas border border-line p-3 space-y-2.5" data-testid="fetch-helper">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Laptop size={15} className="text-accent shrink-0" />Download on my PC</div>
        {st && (
          <Pill tone={!st.enabled ? 'idle' : st.online ? 'good' : 'warn'}>
            {!st.enabled ? 'Off (FETCH_HELPER=0)' : st.online ? `Connected${st.helper?.name ? ` · ${st.helper.name}` : ''}` : 'Not connected'}
          </Pill>
        )}
      </div>
      <p className="text-[11.5px] text-muted leading-relaxed">
        YouTube blocks this server, but not your home internet. While this helper runs on your computer, the server sends its
        YouTube downloads to it - a 1-hour video takes minutes instead of crawling through free proxies. When it's off, the server
        falls back to its own route.
      </p>
      {st?.online && (
        <p className="text-[11.5px] text-slate-300">
          Last seen {ago(st.last_seen)} · {st.running} running · {st.queued} waiting · {st.done} done{st.failed ? ` · ${st.failed} failed` : ''}
          {st.helper?.yt_dlp ? ` · yt-dlp ${st.helper.yt_dlp}` : ''}
        </p>
      )}
      {st && !st.online && st.last_seen && <p className="text-[11.5px] text-warn">Last connected {ago(st.last_seen)}.</p>}
      <div className="space-y-1.5">
        <p className="text-[11px] text-muted">1. Once, on your computer (needs Python 3 and ffmpeg):</p>
        <CopyLine value={install} label="install command" />
        <p className="text-[11px] text-muted">2. Start it, and leave the window open:</p>
        {run ? <CopyLine value={run} label="start command" /> : <p className="text-[11px] text-muted">Loading…</p>}
      </div>
      <Notice tone="idle">The command contains this server's helper key - keep it private. The helper only runs plain yt-dlp downloads; it never reads your browser or runs anything else.</Notice>
      <div className="flex items-center gap-2 flex-wrap">
        {!confirmRotate ? (
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setConfirmRotate(true)}>New key</Button>
        ) : (
          <>
            <span className="text-xs text-warn">The running helper will stop working until restarted with the new command.</span>
            <Button size="sm" variant="danger" loading={rotating} onClick={rotate}>Make new key</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)}>Cancel</Button>
          </>
        )}
      </div>
    </div>
  );
}
