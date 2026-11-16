import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SquarePlay, Camera, AudioLines, Send, CalendarClock, Clock, CheckCircle2, XCircle, Loader2, ExternalLink, Info } from 'lucide-react';
import { Sheet, Button, Notice, Spinner, Input } from './ui';
import { getPublishTargets, publishClip, getPublishStatus } from '../api';

const POLL_MS = 1500;

const PLATFORMS = [
  { id: 'youtube', label: 'YouTube Shorts', icon: SquarePlay, color: '#ff4e45' },
  { id: 'tiktok', label: 'TikTok', icon: AudioLines, color: '#25f4ee' },
  { id: 'instagram', label: 'Instagram Reels', icon: Camera, color: '#e1306c' },
];

const WHEN = [
  { id: 'now', label: 'Post now', icon: Send },
  { id: 'slot', label: 'Next free slot', icon: Clock },
  { id: 'pick', label: 'Pick a time', icon: CalendarClock },
];

const STATE = {
  uploading: { icon: Loader2, cls: 'text-accent animate-spin', label: 'Uploading' },
  pending: { icon: Clock, cls: 'text-muted', label: 'Scheduled' },
  uploaded: { icon: CheckCircle2, cls: 'text-good', label: 'Posted' },
  failed: { icon: XCircle, cls: 'text-bad', label: 'Failed' },
};

function localInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function accountLabel(t, id) {
  if (!t) return '';
  if (id === 'youtube') return t.youtube.accounts.map((a) => a.name).join(', ');
  if (id === 'tiktok') return t.tiktok.account ? `${t.tiktok.account.name}${t.tiktok.account.mode === 'inbox' ? ' · to drafts' : ''}` : '';
  return t.instagram.account || '';
}

/**
 * One-tap publish: pick platforms -> Post now / next free slot / pick a time. Works as a bottom sheet on phones
 * and a dialog on desktop. Unconnected platforms are shown disabled with a link to set them up.
 */
export default function PublishSheet({ open, clip, onClose, onDone }) {
  const [targets, setTargets] = useState(null);
  const [chosen, setChosen] = useState({});
  const [when, setWhen] = useState('now');
  const [pickAt, setPickAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const timer = useRef(0);
  const clipId = clip?.id;

  useEffect(() => {
    if (!open || !clipId) return undefined;
    let live = true;
    setTargets(null); setError(''); setStatus(null); setBusy(false); setWhen('now');
    setPickAt(localInputValue(new Date(Date.now() + 60 * 60 * 1000)));
    getPublishTargets(clipId).then((t) => {
      if (!live) return;
      setTargets(t);
      setChosen({ youtube: t.youtube.ready, tiktok: t.tiktok.ready, instagram: t.instagram.ready });
      if (t.status && t.status.running) { setStatus(t.status); poll(); }
    }).catch((e) => live && setError(e.response?.data?.error || e.message));
    return () => { live = false; clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clipId]);

  const poll = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const s = await getPublishStatus(clipId);
        setStatus(s);
        if (s.running) poll(); else onDone?.(s);
      } catch { poll(); }
    }, POLL_MS);
  };

  const picked = PLATFORMS.filter((p) => chosen[p.id] && targets?.[p.id]?.ready).map((p) => p.id);

  const submit = async () => {
    if (!picked.length || busy) return;
    setBusy(true); setError('');
    try {
      const at = when === 'pick' ? new Date(pickAt).toISOString() : when;
      const res = await publishClip(clipId, picked, at);
      setStatus(res.status);
      if (res.now) poll(); else onDone?.(res.status);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const done = status && !status.running && (when !== 'now' || ['uploaded', 'failed'].some((s) => [status.youtube, status.tiktok, status.instagram].includes(s)));
  const title = clip?.title ? `Publish · ${clip.title}` : 'Publish';

  const footer = status ? (
    <Button variant="primary" block onClick={onClose}>{status.running ? 'Keep uploading in background' : 'Done'}</Button>
  ) : (
    <Button variant="primary" block icon={when === 'now' ? Send : CalendarClock} loading={busy} disabled={!picked.length || !targets}
      onClick={submit} data-testid="publish-submit">
      {when === 'now' ? `Post now to ${picked.length || 0} platform${picked.length === 1 ? '' : 's'}` : when === 'slot' ? 'Schedule in next free slot' : 'Schedule'}
    </Button>
  );

  return (
    <Sheet open={open} onClose={onClose} title={title} footer={footer}>
      <div data-testid="publish-sheet" className="flex flex-col gap-4">
        {!targets && !error && <div className="flex justify-center py-8"><Spinner /></div>}
        {error && <Notice tone="bad" icon={XCircle}>{error}</Notice>}

        {targets && !status && (
          <>
            <div className="flex flex-col gap-2" role="group" aria-label="Platforms">
              {PLATFORMS.map((p) => {
                const t = targets[p.id];
                const on = !!chosen[p.id] && t.ready;
                return (
                  <label key={p.id} data-testid={`platform-${p.id}`}
                    className={`flex min-h-[56px] items-center gap-3 rounded-2xl border px-3 py-2 ${t.ready ? 'cursor-pointer' : 'opacity-60'} ${on ? 'border-accent/60 bg-accent/10' : 'border-line bg-raised'}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${p.color} 18%, transparent)`, color: p.color }}>
                      <p.icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-ink">{p.label}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {t.ready ? accountLabel(targets, p.id) : <Link to="/accounts" className="text-accent" onClick={onClose}>{t.hint || 'Set up'}</Link>}
                      </span>
                    </span>
                    <input type="checkbox" className="h-5 w-5 accent-[var(--color-accent)]" disabled={!t.ready} checked={on}
                      aria-label={p.label} onChange={(e) => setChosen((c) => ({ ...c, [p.id]: e.target.checked }))} />
                  </label>
                );
              })}
            </div>

            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="When">
                {WHEN.map((w) => (
                  <button key={w.id} type="button" role="radio" aria-checked={when === w.id} onClick={() => setWhen(w.id)} data-testid={`when-${w.id}`}
                    className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 text-[12px] font-semibold ${when === w.id ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-raised text-muted'}`}>
                    <w.icon size={16} />{w.label}
                  </button>
                ))}
              </div>
              {when === 'pick' && (
                <Input type="datetime-local" value={pickAt} min={localInputValue(new Date())} onChange={(e) => setPickAt(e.target.value)} aria-label="Publish time" />
              )}
              {when === 'slot' && <p className="text-[12px] text-muted">Uses each YouTube account's posting slots and daily cap. TikTok and Instagram go out with the first slot.</p>}
            </div>

            {chosen.tiktok && targets.tiktok.account?.mode === 'inbox' && (
              <Notice tone="accent" icon={Info}>TikTok gets the video as a draft in your inbox. Open TikTok to add a sound and post it.</Notice>
            )}
          </>
        )}

        {status && (
          <div className="flex flex-col gap-2" data-testid="publish-progress">
            {PLATFORMS.filter((p) => status[p.id]).map((p) => {
              const st = STATE[status[p.id]] || STATE.pending;
              return (
                <div key={p.id} data-status={status[p.id]} className="flex min-h-[48px] items-center gap-3 rounded-xl bg-raised px-3">
                  <p.icon size={18} style={{ color: p.color }} />
                  <span className="flex-1 text-[14px] font-medium text-ink">{p.label}</span>
                  <span className="flex items-center gap-1.5 text-[12px] text-muted"><st.icon size={15} className={st.cls} />{st.label}</span>
                </div>
              );
            })}
            {status.scheduled_for && !status.running && when !== 'now' && (
              <p className="text-[12px] text-muted">First upload: {new Date(status.scheduled_for).toLocaleString()}</p>
            )}
            {status.youtube_urls?.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-2 text-[13px] font-semibold text-accent">
                <ExternalLink size={14} />Open on YouTube
              </a>
            ))}
            {done && status.errors?.length > 0 && <Notice tone="bad" icon={XCircle}>{status.errors.join(' · ')}</Notice>}
          </div>
        )}
      </div>
    </Sheet>
  );
}
