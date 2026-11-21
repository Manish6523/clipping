import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Square, Check, Trash2, Layers, X, Loader2, Film, PartyPopper } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Sheet, Button, Confirm, EmptyState } from '../ui';
import { withToken, batchDiscardClips, queueClip } from '../../api';
import BulkTemplateSheet from '../BulkTemplateSheet';
import ClipDetails from './ClipDetails';
import ClipActionBar from './ClipActionBar';
import { statusMeta, scoreOf, scoreTone, clipLength, timeAgo } from './model';

const TONE_BG = { good: 'bg-good text-canvas', warn: 'bg-warn text-canvas', bad: 'bg-bad text-white', accent: 'bg-accent text-canvas', idle: 'bg-white/20 text-ink' };

function ClipCard({ clip, active, selecting, selected, onOpen, onToggle, busy }) {
  const [hover, setHover] = useState(false);
  const score = scoreOf(clip);
  const m = statusMeta(clip.status);
  const len = clipLength(clip);
  const thumb = withToken(clip.thumbnail_url);
  return (
    <div className={`group relative rounded-xl overflow-hidden bg-surface border transition-colors ${active ? 'border-accent ring-1 ring-accent' : selected ? 'border-accent/70' : 'border-line hover:border-line-strong'}`}
      data-testid="clip-card" data-clip-id={clip.id}>
      <button type="button" onClick={() => (selecting ? onToggle(clip) : onOpen(clip))} className="block w-full text-left"
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-label={`Open clip ${clip.id}: ${clip.title}`}>
        <div className="relative aspect-[9/16] bg-black">
          {thumb ? <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            : <div className="absolute inset-0 flex items-center justify-center text-muted"><Film size={22} /></div>}
          {hover && !selecting && clip.video_url && (
            <video src={withToken(clip.video_url)} muted autoPlay loop playsInline preload="none" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span className={`absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${TONE_BG[scoreTone(score)]}`}>{score}</span>
          {len && <span className="absolute top-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10.5px] text-white tabular-nums">{len}s</span>}
          {busy && <span className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-1 text-[11px] text-white"><Loader2 size={18} className="animate-spin" />{busy}</span>}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-1.5 pt-6">
            <span className={`inline-block rounded px-1 text-[9.5px] font-semibold mb-0.5 ${TONE_BG[m.tone]}`}>{m.label}</span>
            <p className="text-[11.5px] leading-tight font-semibold text-white line-clamp-2">{clip.title || 'Untitled'}</p>
            <p className="text-[10px] text-white/70 truncate">@{clip.channel_id} · {timeAgo(clip.created_at)}</p>
          </div>
        </div>
      </button>
      <button type="button" onClick={() => onToggle(clip)} aria-label={selected ? 'Unselect' : 'Select'}
        className={`absolute top-1 right-1 w-9 h-9 flex items-center justify-center rounded-lg ${selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'} ${len ? 'top-7' : ''}`}>
        {selected ? <CheckSquare size={19} className="text-accent drop-shadow" /> : <Square size={19} className="text-white drop-shadow" />}
      </button>
    </div>
  );
}

/** Video + actions + every detail of one clip. Used by the grid side panel / sheet and the reels side panel. */
export function ClipPanel({ clip, actions, onPublish, onStyle, onEdits, onSkip, showVideo = true }) {
  if (!clip) return null;
  return (
    <div className="space-y-3">
      {showVideo && (clip.video_url
        ? <video key={actions.videoFor(clip)} src={actions.videoFor(clip)} controls autoPlay playsInline
            poster={withToken(clip.thumbnail_url) || undefined} className="w-full max-h-[52dvh] aspect-[9/16] object-contain rounded-xl bg-black" />
        : <div className="w-full aspect-[9/16] max-h-[40dvh] rounded-xl bg-black flex items-center justify-center text-muted text-xs">No rendered video</div>)}
      {actions.applying[clip.id] && <p className="text-xs text-accent flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Re-rendering: {actions.applying[clip.id]}</p>}
      <ClipActionBar clip={clip} actions={actions} onPublish={onPublish} onStyle={onStyle} onEdits={onEdits} onSkip={onSkip} busy={!!actions.applying[clip.id]} />
      <ClipDetails clip={clip} actions={actions} />
    </div>
  );
}

const GROUPS = { none: null, channel: (c) => `@${c.channel_id || 'unknown'}`, day: (c) => new Date(c.created_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) };

export default function ClipGrid({ feed, clips, actions, onPublish, onStyle, onEdits, isWide, group }) {
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [bulkTemplate, setBulkTemplate] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const sentinel = useRef(null);
  const open = clips.find((c) => c.id === openId) || null;

  // Desktop: keep a clip open in the side panel
  useEffect(() => {
    if (isWide && !open && clips.length) setOpenId(clips[0].id);
  }, [isWide, open, clips]);

  // Undo brings the clip back into the panel
  useEffect(() => { if (actions.undone) setOpenId(actions.undone.id); }, [actions.undone]);

  // Load more when the end of the grid scrolls into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [feed]);

  // Keep the selection to clips still listed
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => clips.some((c) => c.id === id))));
  }, [clips]);

  const toggle = (clip) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(clip.id)) n.delete(clip.id); else n.add(clip.id);
    if (n.size) setSelecting(true);
    return n;
  });
  const clearSel = () => { setSelected(new Set()); setSelecting(false); };

  // Next clip after acting on the open one (so the panel never goes empty)
  const nextAfter = (clip) => {
    const i = clips.findIndex((c) => c.id === clip.id);
    return clips[i + 1] || clips[i - 1] || null;
  };
  const panelActions = useMemo(() => ({
    ...actions,
    approve: (c) => { const n = nextAfter(c); actions.approve(c); setOpenId(isWide && n ? n.id : null); },
    reject: (c) => { const n = nextAfter(c); actions.reject(c); setOpenId(isWide && n ? n.id : null); },
  }), [actions, clips, isWide]); // eslint-disable-line react-hooks/exhaustive-deps

  const bulkApprove = async () => {
    setBulkBusy(true);
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try { await queueClip(id); ok += 1; } catch { /* reported below */ }
    }
    setBulkBusy(false);
    clearSel();
    actions.flash(`${ok} of ${ids.length} approved and queued`, ok === ids.length ? 'ok' : 'error');
    actions.refresh();
  };
  const bulkReject = async () => {
    setConfirmReject(false);
    setBulkBusy(true);
    try {
      const r = await batchDiscardClips([...selected]);
      actions.flash(`${r.deleted_count} clip(s) rejected`, 'ok');
    } catch (e) {
      actions.flash(`Reject failed: ${e.message}`, 'error');
    } finally {
      setBulkBusy(false);
      clearSel();
      actions.refresh();
    }
  };

  const sections = useMemo(() => {
    const keyOf = GROUPS[group];
    if (!keyOf) return [{ key: 'all', title: null, items: clips }];
    const map = new Map();
    clips.forEach((c) => { const k = keyOf(c); if (!map.has(k)) map.set(k, []); map.get(k).push(c); });
    return [...map.entries()].map(([k, items]) => ({ key: k, title: k, items }));
  }, [clips, group]);

  if (feed.isLoading) {
    return <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <div key={i} className="aspect-[9/16] rounded-xl bg-white/[0.04] animate-pulse" />)}</div>;
  }
  if (!clips.length) {
    return (
      <EmptyState icon={PartyPopper} title={feed.filters.status === 'pending_approval' ? 'All caught up' : 'No clips here'}
        text={feed.filters.q ? 'Nothing matches your search.' : 'New clips appear here automatically while streams are live.'}
        action={<Link to="/quickclip"><Button variant="primary">Quick Clip a video</Button></Link>} />
    );
  }

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={selecting ? 'primary' : 'ghost'} icon={CheckSquare} onClick={() => (selecting ? clearSel() : setSelecting(true))}>
            {selecting ? `${selected.size} selected` : 'Select'}
          </Button>
          {selecting && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(clips.map((c) => c.id)))}>All {clips.length}</Button>}
        </div>
        {sections.map((s) => (
          <section key={s.key}>
            {s.title && <h3 className="text-[12px] font-semibold text-muted mb-1.5">{s.title} <span className="font-normal">· {s.items.length}</span></h3>}
            <div className={`grid gap-2 grid-cols-3 sm:grid-cols-4 ${isWide ? 'xl:grid-cols-5 2xl:grid-cols-6' : 'lg:grid-cols-6'}`}>
              {s.items.map((c) => (
                <ClipCard key={c.id} clip={c} active={c.id === openId} selecting={selecting} selected={selected.has(c.id)}
                  onOpen={(x) => setOpenId(x.id)} onToggle={toggle} busy={actions.applying[c.id]} />
              ))}
            </div>
          </section>
        ))}
        <div ref={sentinel} className="h-10 flex items-center justify-center text-xs text-muted">
          {feed.isFetchingNextPage ? <Loader2 size={16} className="animate-spin" /> : feed.hasNextPage ? '' : `${clips.length} clip${clips.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {isWide && open && (
        <aside className="w-[360px] xl:w-[400px] shrink-0 sticky top-[72px] max-h-[calc(100dvh-88px)] overflow-y-auto rounded-2xl bg-surface border border-line p-3" data-testid="clip-panel">
          <ClipPanel clip={open} actions={panelActions} onPublish={onPublish} onStyle={onStyle} onEdits={onEdits} />
        </aside>
      )}
      {!isWide && (
        <Sheet open={!!open} onClose={() => setOpenId(null)} title={open ? `Clip #${open.id}` : ''} wide>
          {open && <ClipPanel clip={open} actions={panelActions} onPublish={onPublish} onStyle={onStyle} onEdits={onEdits} />}
        </Sheet>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-3 md:left-1/2 md:-translate-x-1/2 md:w-auto z-[60] rounded-2xl bg-surface/95 backdrop-blur border border-line-strong shadow-2xl p-2 flex items-center gap-1.5 flex-wrap justify-center"
          style={{ bottom: 'calc(76px + var(--safe-bottom))' }} data-testid="bulk-bar">
          <span className="text-xs text-ink font-semibold px-1">{selected.size} selected</span>
          <Button size="sm" variant="good" icon={Check} loading={bulkBusy} onClick={bulkApprove}>Approve</Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={bulkBusy} onClick={() => setConfirmReject(true)}>Reject</Button>
          <Button size="sm" icon={Layers} disabled={bulkBusy} onClick={() => setBulkTemplate(true)}>Template</Button>
          <Button size="sm" variant="ghost" icon={X} onClick={clearSel} aria-label="Clear selection" />
        </div>
      )}
      <Confirm open={confirmReject} danger title={`Reject ${selected.size} clip(s)?`} confirmLabel="Reject"
        text="They're deleted with their files. This can't be undone." onConfirm={bulkReject} onCancel={() => setConfirmReject(false)} />
      <BulkTemplateSheet open={bulkTemplate} clipIds={[...selected]} onClose={() => setBulkTemplate(false)}
        onFinished={() => { setBulkTemplate(false); clearSel(); actions.refresh(); }} />
    </div>
  );
}
