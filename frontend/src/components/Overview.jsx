import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Check, CheckSquare, Flame, Film, LayoutTemplate, Trash2, X, Activity, Clock, Send, XCircle, BookOpen, Wand2, Pencil, ListChecks,
} from 'lucide-react';
import { getClips, getStatus, getPipelineStatus, batchDiscardClips } from '../api';
import { Page, Segmented, Select, Button, Badge, Pill, Stat, Sheet, Confirm, Notice, EmptyState, Skeleton, fmtDur, timeAgo } from './ui';
import BulkTemplateSheet from './BulkTemplateSheet';

const STATUS_META = {
  pending_approval: { label: 'To review', tone: 'warn', icon: Clock },
  approved: { label: 'Approved', tone: 'good', icon: Check },
  queued: { label: 'Queued', tone: 'accent', icon: Send },
  published: { label: 'Published', tone: 'good', icon: Send },
  rejected: { label: 'Rejected', tone: 'bad', icon: XCircle },
};
const STATUS_ORDER = ['pending_approval', 'approved', 'queued', 'published', 'rejected'];
const meta = (s) => STATUS_META[s] || { label: s || 'unknown', tone: 'idle', icon: Film };

const clipDur = (c) => Math.max(0, (c.adjusted_end ?? c.raw_end ?? 0) - (c.adjusted_start ?? c.raw_start ?? 0));
const hasFlag = (c, type) => String(c.flags || '').includes(type);
const dayKey = (iso) => (iso ? String(iso).slice(0, 10) : 'unknown');
const dayLabel = (k) => {
  if (k === 'unknown') return 'Unknown date';
  const d = new Date(`${k}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

function scoreTone(v) { return v >= 80 ? 'text-good' : v >= 65 ? 'text-warn' : 'text-muted'; }

function Tile({ clip, selecting, selected, onToggle, onOpen }) {
  const [hover, setHover] = useState(false);
  const press = useRef({ t: 0, fired: false });
  // long-press a tile (touch) to start selecting
  const onDown = (e) => {
    if (e.pointerType === 'mouse') return;
    press.current.fired = false;
    clearTimeout(press.current.t);
    press.current.t = setTimeout(() => { press.current.fired = true; try { navigator.vibrate?.(8); } catch { /* unsupported */ } onToggle(clip.id); }, 450);
  };
  const cancelPress = () => clearTimeout(press.current.t);
  const m = meta(clip.status);
  const score = Math.round(clip.final_score ?? clip.virality_score ?? 0);
  const click = () => {
    if (press.current.fired) { press.current.fired = false; return; }    // the long-press already handled it
    if (selecting) onToggle(clip.id); else onOpen(clip);
  };
  return (
    <div
      data-testid="clip-tile" data-clip-id={clip.id} data-selected={selected ? 'true' : 'false'}
      className={`group relative overflow-hidden rounded-2xl border bg-black ${selected ? 'border-accent ring-2 ring-accent/60' : 'border-line'}`}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)} onPointerLeave={() => setHover(false)}
    >
      <button
        type="button" onClick={click} className="block w-full text-left select-none" aria-label={`Clip ${clip.id}: ${clip.title || 'untitled'}`}
        onPointerDown={onDown} onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress} onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: 'none' }}
      >
        <div className="relative aspect-[9/16] bg-raised">
          {hover && clip.video_url
            ? <video src={clip.video_url} muted autoPlay loop playsInline className="absolute inset-0 h-full w-full object-cover" />
            : clip.thumbnail_url
              ? <img src={clip.thumbnail_url} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              : <div className="absolute inset-0 flex items-center justify-center text-faint"><Film size={28} /></div>}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1.5 bg-gradient-to-b from-black/70 to-transparent">
            <span className={`rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${scoreTone(score)}`}>{score || '—'}</span>
            <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-200 tabular-nums">{fmtDur(clipDur(clip))}</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 space-y-1 p-1.5 pt-6 bg-gradient-to-t from-black/85 to-transparent">
            <p className="line-clamp-2 text-[11.5px] font-semibold leading-tight text-white">{clip.title || `Clip #${clip.id}`}</p>
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone={m.tone} className="!px-1.5 !py-0 text-[9.5px]">{m.label}</Badge>
              {(clip.stitched || clip.story_link) && <span title="Story setup + payoff" className="text-[10px]"><BookOpen size={11} className="inline text-accent" /></span>}
              {hasFlag(clip, 'auto_edited') && <span title="Auto-edited"><Wand2 size={11} className="inline text-warn" /></span>}
            </div>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between gap-1 px-2 py-1 text-[10.5px] text-muted">
        <span className="truncate">{clip.channel_id}</span>
        <span className="shrink-0 truncate max-w-[45%]" title={clip.template_name}>{clip.template_name}</span>
      </div>
      <button
        type="button" aria-label={selected ? `Deselect clip ${clip.id}` : `Select clip ${clip.id}`} aria-pressed={selected}
        onClick={() => onToggle(clip.id)}
        data-compact
        className={`absolute left-1 top-7 h-9 w-9 items-center justify-center rounded-full border ${selecting || selected ? 'flex' : 'hidden [@media(hover:hover)]:group-hover:flex'} ${selected ? 'border-accent bg-accent text-white' : 'border-white/60 bg-black/55 text-transparent'}`}
      >
        <Check size={16} />
      </button>
    </div>
  );
}

export default function Overview({ onOpenReview }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [group, setGroup] = useState('status');
  const [channel, setChannel] = useState('all');
  const [minScore, setMinScore] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIds, setBulkIds] = useState([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const { data: resp, isLoading } = useQuery({ queryKey: ['clips', 'overview'], queryFn: () => getClips('', 100), staleTime: 5000, refetchInterval: 15000 });
  const { data: status } = useQuery({ queryKey: ['overview-status'], queryFn: getStatus, refetchInterval: 12000 });
  const { data: pipe } = useQuery({ queryKey: ['overview-pipeline'], queryFn: getPipelineStatus, refetchInterval: 8000 });

  const all = useMemo(() => resp?.clips || (Array.isArray(resp) ? resp : []), [resp]);
  const channels = useMemo(() => [...new Set(all.map((c) => c.channel_id).filter(Boolean))].sort(), [all]);
  const clips = useMemo(
    () => all.filter((c) => (channel === 'all' || c.channel_id === channel) && (c.final_score ?? c.virality_score ?? 0) >= minScore),
    [all, channel, minScore],
  );

  const sections = useMemo(() => {
    const keyOf = group === 'channel' ? (c) => c.channel_id || 'unknown' : group === 'day' ? (c) => dayKey(c.created_at) : (c) => c.status || 'unknown';
    const map = new Map();
    clips.forEach((c) => { const k = keyOf(c); if (!map.has(k)) map.set(k, []); map.get(k).push(c); });
    let keys = [...map.keys()];
    if (group === 'status') keys.sort((a, b) => (STATUS_ORDER.indexOf(a) + 99) % 99 - (STATUS_ORDER.indexOf(b) + 99) % 99);
    else if (group === 'day') keys.sort().reverse();
    else keys.sort();
    return keys.map((k) => ({
      key: k,
      title: group === 'status' ? meta(k).label : group === 'day' ? dayLabel(k) : k,
      clips: map.get(k).sort((a, b) => (b.final_score ?? b.virality_score ?? 0) - (a.final_score ?? a.virality_score ?? 0)),
    }));
  }, [clips, group]);

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = all.filter((c) => dayKey(c.created_at) === today).length;
  const decided = all.filter((c) => ['approved', 'queued', 'published', 'rejected'].includes(c.status));
  const approvalRate = decided.length ? Math.round((decided.filter((c) => c.status !== 'rejected').length / decided.length) * 100) : null;
  const rendering = (pipe?.active_pipelines || []).length || (pipe && ['triggered', 'processing'].includes(pipe.status) ? 1 : 0);
  const stitched = all.filter((c) => c.stitched).length;

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const startSelecting = () => { setSelecting(true); };
  const clearSelection = () => { setSelected(new Set()); setSelecting(false); };
  const selectAllVisible = () => setSelected(new Set(clips.map((c) => c.id)));
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['clips'] }); queryClient.invalidateQueries({ queryKey: ['overview-status'] }); };

  const tileToggle = (id) => { if (!selecting) setSelecting(true); toggle(id); };
  const bulkTemplate = (ids) => { setBulkIds(ids); setBulkOpen(true); };
  const discard = async () => {
    setConfirmDiscard(false); setBusy(true);
    try { const r = await batchDiscardClips([...selected]); setMsg(`Discarded ${r.deleted_count ?? selected.size} clips`); clearSelection(); refresh(); }
    catch (e) { setMsg(`Discard failed: ${e.message}`); } finally { setBusy(false); }
  };

  return (
    <Page
      title="Overview" icon={Activity} subtitle="Every clip at a glance. Tap to preview - long-press (or Select) to pick several."
      actions={(
        <>
          <Button size="sm" icon={ListChecks} variant={selecting ? 'primary' : 'secondary'} onClick={() => (selecting ? clearSelection() : startSelecting())}>{selecting ? 'Done' : 'Select'}</Button>
          <Button size="sm" onClick={() => onOpenReview?.()}>Review mode</Button>
        </>
      )}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="overview-stats">
        <Stat label="To review" value={status?.pending_clips_count ?? '—'} tone="warn" icon={Clock} />
        <Stat label="Queued" value={status?.queued_count ?? '—'} icon={Send} />
        <Stat label="Published" value={status?.published_count ?? '—'} tone="good" icon={Check} />
        <Stat label="Made today" value={todayCount} icon={Flame} />
        <Stat label="Approval rate" value={approvalRate === null ? '—' : `${approvalRate}%`} sub={`${decided.length} decided`} />
        <Stat label="Rendering now" value={rendering} sub={stitched ? `${stitched} story-stitched` : undefined} tone={rendering ? 'accent' : undefined} icon={Activity} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={group} onChange={setGroup} ariaLabel="Group by" size="sm"
          options={[{ value: 'status', label: 'Status' }, { value: 'channel', label: 'Streamer' }, { value: 'day', label: 'Day' }]} />
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Streamer" className="!h-8 !w-auto !text-xs">
          <option value="all">All streamers</option>
          {channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select value={String(minScore)} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Minimum score" className="!h-8 !w-auto !text-xs">
          <option value="0">Any score</option><option value="65">65+</option><option value="80">80+</option>
        </Select>
        <Pill dot={false} className="ml-auto">{clips.length} clip{clips.length === 1 ? '' : 's'}</Pill>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="aspect-[9/16] rounded-2xl" />)}</div>
      ) : clips.length === 0 ? (
        <EmptyState icon={Film} title="No clips match" text="New clips appear here automatically while streams are live." />
      ) : sections.map((sec) => (
        <section key={sec.key} aria-label={sec.title} data-testid="overview-section">
          <h2 className="mb-1.5 mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-ink">
            {sec.title}<span className="text-[11px] font-normal text-faint tabular-nums">{sec.clips.length}</span>
          </h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-2.5 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {sec.clips.map((c) => <Tile key={c.id} clip={c} selecting={selecting} selected={selected.has(c.id)} onToggle={tileToggle} onOpen={setOpen} />)}
          </div>
        </section>
      ))}

      {msg && <p role="status" className="text-center text-xs text-muted">{msg}</p>}

      {selected.size > 0 && (
        <div data-testid="bulk-bar" className="fixed inset-x-2 z-[70] mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-line-strong bg-surface p-2 shadow-2xl"
          style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
          <span className="pl-2 text-[12.5px] font-semibold tabular-nums text-ink">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={selectAllVisible}><CheckSquare size={14} /> All</Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="primary" icon={LayoutTemplate} onClick={() => bulkTemplate([...selected])}>Template</Button>
            <Button size="sm" variant="danger" icon={Trash2} loading={busy} onClick={() => setConfirmDiscard(true)} aria-label="Discard selected" />
            <Button size="sm" variant="ghost" icon={X} onClick={clearSelection} aria-label="Clear selection" />
          </div>
        </div>
      )}

      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open ? (open.title || `Clip #${open.id}`) : ''}>
        {open && (
          <div className="space-y-3">
            {open.video_url
              ? <video key={open.id} src={open.video_url} controls autoPlay playsInline poster={open.thumbnail_url || undefined} className="mx-auto aspect-[9/16] max-h-[55dvh] rounded-xl bg-black" />
              : <div className="flex aspect-video items-center justify-center rounded-xl bg-raised text-muted">No rendered video</div>}
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
              <Badge tone={meta(open.status).tone}>{meta(open.status).label}</Badge>
              <span>#{open.id}</span><span>·</span><span>{open.channel_id}</span><span>·</span><span>{open.template_name}</span><span>·</span><span>{fmtDur(clipDur(open))}</span>
              {open.created_at && <><span>·</span><span>{timeAgo(open.created_at)}</span></>}
            </div>
            {open.story_link && (
              <Notice tone="accent">Story clip ({open.story_link.relation}) - setup: "{open.story_link.setup_quote}"</Notice>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button icon={LayoutTemplate} onClick={() => { const id = open.id; setOpen(null); bulkTemplate([id]); }}>Change template</Button>
              <Button icon={Pencil} onClick={() => navigate(`/clips/${open.id}/editor`)}>Open editor</Button>
            </div>
          </div>
        )}
      </Sheet>

      <BulkTemplateSheet open={bulkOpen} clipIds={bulkIds} onClose={() => setBulkOpen(false)} onFinished={refresh} />
      <Confirm open={confirmDiscard} danger title={`Discard ${selected.size} clip${selected.size === 1 ? '' : 's'}?`} text="They are removed from the queue and can't be restored." confirmLabel="Discard"
        onCancel={() => setConfirmDiscard(false)} onConfirm={discard} />
    </Page>
  );
}
