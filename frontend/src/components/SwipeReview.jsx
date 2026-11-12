import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, Check, Scissors, Zap, Undo2, Volume2, VolumeX, Pencil, LayoutList, PartyPopper, Loader2,
} from 'lucide-react';
import { getClips, queueClip, discardClip, postClipNow, updateClip } from '../api';
import { censorFlagInfo } from '../utils/profanity';

const REASONS = [
  { code: 'boring', label: 'Boring' },
  { code: 'no_context', label: 'No context' },
  { code: 'bad_start', label: 'Bad start' },
  { code: 'bad_end', label: 'Bad end' },
  { code: 'bad_crop', label: 'Bad crop' },
  { code: 'audio', label: 'Audio' },
  { code: 'duplicate', label: 'Duplicate' },
  { code: 'unsafe', label: 'Unsafe' },
];

const SWIPE_X = 100;      // px to commit left / right
const SWIPE_UP = 120;     // px to commit up (edit)
const UNDO_MS = { reject: 5000, queue: 3500 };

const vibrate = (ms = 10) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

function ClipCard({ clip, isTop, muted, onToggleMute, drag, onPointerDown, onPointerMove, onPointerUp }) {
  const videoRef = useRef(null);
  const dur = Math.max(0, (clip.adjusted_end ?? clip.raw_end ?? 0) - (clip.adjusted_start ?? clip.raw_start ?? 0));
  const censor = censorFlagInfo(clip.flags);
  const unscored = !clip.virality_score || String(clip.flags || '').includes('unscored');

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isTop) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isTop]);

  const { dx = 0, dy = 0, active = false } = isTop ? drag : {};
  const rotate = dx / 18;
  const style = isTop
    ? {
        transform: `translate(${dx}px, ${Math.min(dy, 0)}px) rotate(${rotate}deg)`,
        transition: active ? 'none' : 'transform 0.25s ease-out',
        touchAction: 'none',
      }
    : { transform: 'scale(0.95) translateY(10px)', transition: 'transform 0.25s ease-out' };

  const queueOpacity = Math.max(0, Math.min(1, dx / SWIPE_X));
  const rejectOpacity = Math.max(0, Math.min(1, -dx / SWIPE_X));
  const editOpacity = Math.max(0, Math.min(1, -dy / SWIPE_UP)) * (Math.abs(dx) < 60 ? 1 : 0);

  return (
    <div
      className={`absolute inset-0 rounded-3xl overflow-hidden bg-black border border-white/10 shadow-2xl select-none ${isTop ? 'z-20' : 'z-10 pointer-events-none'}`}
      style={style}
      onPointerDown={isTop ? onPointerDown : undefined}
      onPointerMove={isTop ? onPointerMove : undefined}
      onPointerUp={isTop ? onPointerUp : undefined}
      onPointerCancel={isTop ? onPointerUp : undefined}
    >
      {clip.video_url ? (
        <video
          ref={videoRef}
          src={clip.video_url}
          poster={clip.thumbnail_url || undefined}
          muted={muted}
          loop
          playsInline
          preload={isTop ? 'auto' : 'metadata'}
          className="absolute inset-0 w-full h-full object-contain bg-black pointer-events-none"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">No render yet</div>
      )}

      {/* Swipe stamps */}
      <div className="absolute top-6 left-5 px-3 py-1 rounded-xl border-4 border-emerald-400 text-emerald-300 font-black text-2xl rotate-[-12deg] pointer-events-none" style={{ opacity: queueOpacity }}>QUEUE</div>
      <div className="absolute top-6 right-5 px-3 py-1 rounded-xl border-4 border-rose-500 text-rose-400 font-black text-2xl rotate-[12deg] pointer-events-none" style={{ opacity: rejectOpacity }}>REJECT</div>
      <div className="absolute bottom-40 inset-x-0 mx-auto w-max px-3 py-1 rounded-xl border-4 border-sky-400 text-sky-300 font-black text-2xl pointer-events-none" style={{ opacity: editOpacity }}>EDIT</div>

      {/* Top chips */}
      <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2 pointer-events-none">
        <span className="px-2 py-1 rounded-lg bg-black/60 backdrop-blur text-[11px] font-bold text-white truncate max-w-[55%]">
          @{clip.channel_id}
        </span>
        <span className="flex items-center gap-1.5">
          {censor && (
            <span className={`px-2 py-1 rounded-lg text-[11px] font-bold backdrop-blur ${censor.slur ? 'bg-red-600/80 text-white' : 'bg-black/60 text-rose-200'}`}>
              {censor.slur ? '⚠️ slur' : `🔇 ${censor.count}`}
            </span>
          )}
          <span className="px-2 py-1 rounded-lg bg-black/60 backdrop-blur text-[11px] font-black font-mono text-amber-300">
            {unscored ? 'unscored' : `🔥 ${clip.virality_score}`}
          </span>
        </span>
      </div>

      {/* Mute toggle */}
      {isTop && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleMute}
          className="absolute right-3 bottom-28 z-30 p-2.5 rounded-full bg-black/60 backdrop-blur text-white"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      )}

      {/* Bottom gradient + meta */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />
      <div className="absolute inset-x-3 bottom-3 pointer-events-none">
        <p className="text-[11px] text-slate-300 font-mono mb-1">#{clip.id} · {dur.toFixed(0)}s · {clip.template_name}</p>
      </div>
    </div>
  );
}

export default function SwipeReview({ onSwitchClassic }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['clips', 'swipe', 'pending_approval'],
    queryFn: () => getClips('pending_approval', 50),
    refetchInterval: 30000,
  });

  const [handled, setHandled] = useState(() => new Set()); // ids acted on locally
  const [pending, setPending] = useState(null); // { type, clip, reason }
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const startRef = useRef(null);
  const crossedRef = useRef(false);
  const [toast, setToast] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleOverrides, setTitleOverrides] = useState({});
  const [busy, setBusy] = useState(false);

  const clips = useMemo(
    () => (data?.clips || []).filter((c) => !handled.has(c.id)),
    [data, handled]
  );
  const top = clips[0];
  const next = clips[1];

  const flash = (msg, tone = 'info') => {
    setToast({ msg, tone });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 2600);
  };

  // Send a deferred action to the server
  const commit = useCallback(async (action) => {
    if (!action) return;
    try {
      if (action.type === 'reject') await discardClip(action.clip.id, action.reason || null);
      if (action.type === 'queue') await queueClip(action.clip.id);
    } catch (e) {
      // Put the clip back so nothing is silently lost
      setHandled((prev) => { const n = new Set(prev); n.delete(action.clip.id); return n; });
      flash(`Couldn't ${action.type} #${action.clip.id}: ${e.response?.data?.error || e.message}`, 'error');
    } finally {
      queryClient.invalidateQueries({ queryKey: ['clips'] });
    }
  }, [queryClient]);

  const flushPending = useCallback(() => {
    clearTimeout(timerRef.current);
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p) commit(p);
  }, [commit]);

  // Commit any pending action when leaving the page or backgrounding the app
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushPending(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flushPending();
    };
  }, [flushPending]);

  const startAction = (type, clip) => {
    flushPending();
    vibrate(type === 'reject' ? 18 : 10);
    setHandled((prev) => new Set(prev).add(clip.id));
    const action = { type, clip, reason: null };
    pendingRef.current = action;
    setPending(action);
    setEditingTitle(false);
    timerRef.current = setTimeout(flushPending, UNDO_MS[type]);
  };

  const undo = () => {
    clearTimeout(timerRef.current);
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p) setHandled((prev) => { const n = new Set(prev); n.delete(p.clip.id); return n; });
  };

  const setReason = (code) => {
    if (!pendingRef.current) return;
    pendingRef.current = { ...pendingRef.current, reason: code };
    flushPending();
    flash('Thanks — the AI learns from this', 'ok');
  };

  const goEdit = (clip) => {
    flushPending();
    navigate(`/clips/${clip.id}/editor`);
  };

  const postNow = async (clip) => {
    if (!window.confirm(`Upload clip #${clip.id} right now to its mapped accounts?`)) return;
    flushPending();
    setBusy(true);
    try {
      await postClipNow(clip.id);
      setHandled((prev) => new Set(prev).add(clip.id));
      flash(`Clip #${clip.id} is uploading`, 'ok');
      queryClient.invalidateQueries({ queryKey: ['clips'] });
    } catch (e) {
      flash(`Upload failed: ${e.response?.data?.error || e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = async () => {
    const t = titleDraft.trim();
    setEditingTitle(false);
    if (!top || !t || t === (titleOverrides[top.id] ?? top.title)) return;
    setTitleOverrides((o) => ({ ...o, [top.id]: t }));
    try {
      await updateClip(top.id, { title: t });
    } catch (e) {
      flash(`Title not saved: ${e.message}`, 'error');
    }
  };

  // ---- gestures ----
  const onPointerDown = (e) => {
    if (editingTitle) return;
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    crossedRef.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ dx: 0, dy: 0, active: true });
  };
  const onPointerMove = (e) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    const crossed = Math.abs(dx) > SWIPE_X || dy < -SWIPE_UP;
    if (crossed && !crossedRef.current) vibrate(6);
    crossedRef.current = crossed;
    setDrag({ dx, dy, active: true });
  };
  const onPointerUp = () => {
    if (!startRef.current || !top) return;
    const { dx, dy } = drag;
    const moved = Math.abs(dx) + Math.abs(dy);
    startRef.current = null;
    if (moved < 8) {
      setMuted((m) => !m); // tap = toggle sound
    } else if (dx > SWIPE_X) {
      startAction('queue', top);
    } else if (dx < -SWIPE_X) {
      startAction('reject', top);
    } else if (dy < -SWIPE_UP && Math.abs(dx) < 60) {
      goEdit(top);
    }
    setDrag({ dx: 0, dy: 0, active: false });
  };

  const titleOf = (c) => titleOverrides[c.id] ?? c.title ?? 'Untitled clip';

  return (
    <div className="flex flex-col px-3 pt-2 h-[calc(100dvh-56px-64px-env(safe-area-inset-bottom))] min-h-[480px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="text-sm font-bold text-white">
          {isLoading ? 'Loading…' : `${clips.length} to review`}
        </div>
        <button
          type="button"
          onClick={() => { flushPending(); onSwitchClassic?.(); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-xs text-slate-300"
        >
          <LayoutList size={14} /> Classic view
        </button>
      </div>

      {/* Card stack */}
      <div className="relative flex-1 min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
        )}
        {!isLoading && !top && (
          <div className="absolute inset-0 rounded-3xl border border-dashed border-white/10 flex flex-col items-center justify-center text-center p-6 gap-3">
            <PartyPopper className="text-amber-300" size={36} />
            <p className="text-white font-bold">All caught up</p>
            <p className="text-xs text-slate-400">New clips appear here automatically while streams are live.</p>
            <Link to="/quickclip" className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold flex items-center gap-1.5">
              <Zap size={15} /> Quick Clip a video
            </Link>
          </div>
        )}
        {next && <ClipCard key={next.id} clip={next} isTop={false} muted />}
        {top && (
          <ClipCard
            key={top.id}
            clip={top}
            isTop
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            drag={drag}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )}
      </div>

      {/* Title (editable) */}
      {top && (
        <div className="shrink-0 mt-2 min-h-[40px] flex items-center gap-2">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              maxLength={100}
              className="flex-1 min-w-0 bg-slate-950 border border-indigo-500 rounded-xl px-3 py-2 text-base text-white focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setTitleDraft(titleOf(top)); setEditingTitle(true); }}
              className="flex-1 min-w-0 text-left flex items-center gap-2"
            >
              <span className="text-sm font-semibold text-white line-clamp-2">{titleOf(top)}</span>
              <Pencil size={13} className="text-slate-500 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="shrink-0 flex items-center justify-center gap-4 py-3">
        <button type="button" disabled={!top} onClick={() => top && startAction('reject', top)}
          className="w-14 h-14 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-300 flex items-center justify-center active:scale-90 transition disabled:opacity-30"
          aria-label="Reject">
          <X size={26} />
        </button>
        <button type="button" disabled={!top} onClick={() => top && goEdit(top)}
          className="w-11 h-11 rounded-full bg-sky-500/15 border border-sky-500/40 text-sky-300 flex items-center justify-center active:scale-90 transition disabled:opacity-30"
          aria-label="Edit">
          <Scissors size={18} />
        </button>
        <button type="button" disabled={!top || busy} onClick={() => top && postNow(top)}
          className="w-11 h-11 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 flex items-center justify-center active:scale-90 transition disabled:opacity-30"
          aria-label="Post now">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
        </button>
        <button type="button" disabled={!top} onClick={() => top && startAction('queue', top)}
          className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center active:scale-90 transition disabled:opacity-30"
          aria-label="Approve and queue">
          <Check size={26} />
        </button>
      </div>

      {/* Undo / reason sheet */}
      {pending && (
        <div className="fixed inset-x-3 z-50 rounded-2xl bg-[#121620]/95 backdrop-blur border border-white/10 shadow-2xl p-3"
          style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-white font-semibold">
              {pending.type === 'reject' ? `Rejected #${pending.clip.id}` : `Queued #${pending.clip.id}`}
            </span>
            <button type="button" onClick={undo} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold">
              <Undo2 size={14} /> Undo
            </button>
          </div>
          {pending.type === 'reject' && (
            <div className="mt-2">
              <p className="text-[11px] text-slate-400 mb-1.5">Why? (teaches the AI)</p>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button key={r.code} type="button" onClick={() => setReason(r.code)}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-slate-200 active:bg-rose-500/30">
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {toast && !pending && (
        <div className={`fixed inset-x-6 z-50 rounded-xl px-3 py-2 text-sm text-center shadow-xl ${
          toast.tone === 'error' ? 'bg-rose-600 text-white' : toast.tone === 'ok' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'}`}
          style={{ bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
