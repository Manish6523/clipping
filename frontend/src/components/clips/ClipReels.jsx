import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Volume2, VolumeX, Play, Loader2, PartyPopper, ChevronUp, ChevronDown, Film } from 'lucide-react';
import { Sheet, Button } from '../ui';
import { withToken } from '../../api';
import ClipDetails from './ClipDetails';
import { clipActions } from './ClipActionBar';
import { statusMeta, scoreOf, scoreTone, clipLength } from './model';

const TONE_TXT = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', accent: 'text-accent', idle: 'text-muted' };
const RAIL_TONE = { good: 'text-good', bad: 'text-bad', accent: 'text-accent' };

function ReelItem({ clip, index, active, near, muted, onToggleMute, actions, railFor, onOpenDetails }) {
  const videoRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [more, setMore] = useState(false);
  const score = scoreOf(clip);
  const m = statusMeta(clip.status);
  const len = clipLength(clip);
  const src = actions.videoFor(clip);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      const p = v.play();
      if (p?.catch) p.catch(() => setPaused(true));          // autoplay blocked: show the play button
      setPaused(false);
    } else {
      v.pause();
      setMore(false);
    }
  }, [active, src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); }
  };

  const rail = railFor(clip);
  const tags = String(clip.hashtags || '').split(/\s+/).filter(Boolean);

  return (
    <section className="relative h-full w-full snap-start snap-always bg-black overflow-hidden" data-index={index} data-clip-id={clip.id}
      data-testid="reel" aria-label={`Clip ${clip.id}: ${clip.title}`}>
      {near && src ? (
        <video ref={videoRef} src={src} muted={muted} loop playsInline preload={active ? 'auto' : 'metadata'}
          poster={withToken(clip.thumbnail_url) || undefined} onClick={togglePlay}
          className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        clip.thumbnail_url
          ? <img src={withToken(clip.thumbnail_url)} alt="" className="absolute inset-0 h-full w-full object-contain" loading="lazy" />
          : <div className="absolute inset-0 flex items-center justify-center text-muted"><Film size={28} /></div>
      )}
      {active && paused && (
        <button type="button" onClick={togglePlay} aria-label="Play" className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-black/50 flex items-center justify-center">
          <Play size={30} className="text-white ml-1" />
        </button>
      )}
      {actions.applying[clip.id] && (
        <div className="absolute top-14 inset-x-0 mx-auto w-fit rounded-full bg-black/70 px-3 py-1.5 text-xs text-white flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" />Re-rendering: {actions.applying[clip.id]}
        </div>
      )}

      {/* top: mute */}
      <button type="button" onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'}
        className="absolute top-3 right-3 z-10 w-11 h-11 rounded-full bg-black/45 flex items-center justify-center text-white">
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      {/* right rail: every action */}
      <div className="absolute right-1.5 bottom-4 z-10 flex flex-col items-center gap-0.5" data-testid="reel-rail">
        {rail.map((a) => (
          <button key={a.id} type="button" onClick={a.run} disabled={a.disabled} data-action={a.id}
            title={a.key ? `${a.label} (${a.key})` : a.label} aria-label={a.label}
            className="w-14 flex flex-col items-center gap-0.5 py-1 text-white disabled:opacity-40">
            <span className={`w-11 h-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center ${RAIL_TONE[a.tone] || ''}`}>
              <a.icon size={20} />
            </span>
            <span className="text-[10px] font-semibold leading-none drop-shadow">{a.label}</span>
          </button>
        ))}
      </div>

      {/* bottom: who / score / title / description */}
      <div className="absolute inset-x-0 bottom-0 pr-20 pl-3 pb-4 pt-16 bg-gradient-to-t from-black/90 via-black/55 to-transparent">
        <div className="flex items-center gap-2 text-[12px] text-white/85 mb-1">
          <span className="font-semibold">@{clip.channel_id}</span>
          <span className={`font-bold ${TONE_TXT[scoreTone(score)]}`}>{score}</span>
          <span className={TONE_TXT[m.tone]}>{m.label}</span>
          {len && <span className="text-white/60">{len}s</span>}
        </div>
        <h2 className="text-[15px] font-bold text-white leading-snug line-clamp-2">{clip.title || 'Untitled'}</h2>
        {(clip.description || tags.length > 0) && (
          more ? (
            <div className="mt-1 max-h-[34dvh] overflow-y-auto text-[12.5px] text-white/90 leading-relaxed space-y-1.5" onClick={() => setMore(false)}>
              {clip.description && <p className="whitespace-pre-line">{clip.description}</p>}
              {tags.length > 0 && <p className="text-accent">{tags.join(' ')}</p>}
              <button type="button" className="text-white/60 text-[12px] font-semibold">less</button>
            </div>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="mt-0.5 block text-left text-[12.5px] text-white/80 leading-snug w-full">
              <span className="line-clamp-1">{clip.description || tags.join(' ')}</span>
              <span className="text-white/60 font-semibold">…more</span>
            </button>
          )
        )}
        <button type="button" onClick={() => onOpenDetails(clip)} className="mt-1 text-[11.5px] text-white/60 underline-offset-2 hover:underline">
          Edit title, description & hashtags
        </button>
      </div>
    </section>
  );
}

export default function ClipReels({ feed, clips, actions, onPublish, onStyle, isWide }) {
  const navigate = useNavigate();
  const scroller = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('autoclip_reels_muted') !== '0'; } catch { return true; } });
  const [detailsFor, setDetailsFor] = useState(null);
  const activeIdRef = useRef(null);
  const active = clips[Math.min(activeIdx, clips.length - 1)] || null;

  const toggleMute = () => setMuted((m) => { try { localStorage.setItem('autoclip_reels_muted', m ? '0' : '1'); } catch { /* */ } return !m; });

  // Which reel is on screen
  useEffect(() => {
    const root = scroller.current;
    if (!root) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActiveIdx(Number(e.target.dataset.index)); });
    }, { root, threshold: 0.6 });
    root.querySelectorAll('[data-testid="reel"]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [clips]);

  // When a clip leaves the list (approved / rejected) stay on the same position = the next clip
  useEffect(() => {
    if (active) activeIdRef.current = active.id;
    if (activeIdx > clips.length - 1 && clips.length) setActiveIdx(clips.length - 1);
  }, [active, activeIdx, clips.length]);

  // Fetch more before reaching the end
  useEffect(() => {
    if (activeIdx >= clips.length - 4 && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
  }, [activeIdx, clips.length, feed]);

  const go = useCallback((delta) => {
    const root = scroller.current;
    if (!root) return;
    const next = Math.max(0, Math.min(clips.length - 1, activeIdx + delta));
    root.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeIdx, clips.length]);

  const railFor = useCallback((clip) => clipActions(clip, {
    actions, navigate, rail: true, onPublish, onStyle,
    onSkip: () => go(1),
    onDetails: (c) => setDetailsFor(c.id),
  }).filter((a) => !(isWide && a.id === 'details')), [actions, navigate, onPublish, onStyle, go, isWide]);

  // Keyboard: arrows / J K move, A R S P E D act, M mute, space pause
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowdown' || k === 'j') { e.preventDefault(); go(1); return; }
      if (k === 'arrowup' || k === 'k') { e.preventDefault(); go(-1); return; }
      if (k === 'm') { toggleMute(); return; }
      if (k === ' ') {
        e.preventDefault();
        const v = scroller.current?.querySelector(`[data-index="${activeIdx}"] video`);
        if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); }
        return;
      }
      if (!active) return;
      const hit = clipActions(active, { actions, navigate, rail: true, onPublish, onStyle, onSkip: () => go(1), onDetails: (c) => setDetailsFor(c.id) })
        .find((a) => a.key && a.key.toLowerCase() === k);
      if (hit && !hit.disabled) { e.preventDefault(); hit.run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, activeIdx, actions, navigate, onPublish, onStyle, go]);

  const height = "h-full";
  const detailsClip = clips.find((c) => c.id === detailsFor) || null;

  if (feed.isLoading) return <div className={`${height} flex items-center justify-center`}><Loader2 className="animate-spin text-muted" /></div>;
  if (!clips.length) {
    return (
      <div className={`${height} flex flex-col items-center justify-center text-center gap-3 px-6`}>
        <PartyPopper className="text-warn" size={36} />
        <p className="text-ink font-semibold">{feed.filters.status === 'pending_approval' ? 'All caught up' : 'No clips here'}</p>
        <p className="text-xs text-muted">{feed.filters.q ? 'Nothing matches your search.' : 'New clips appear here automatically while streams are live.'}</p>
        <Link to="/quickclip"><Button variant="primary">Quick Clip a video</Button></Link>
      </div>
    );
  }

  const reel = (
    <div ref={scroller} className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain no-scrollbar" data-testid="reels" tabIndex={-1}>
      {clips.map((c, i) => (
        <div key={c.id} className="h-full">
          <ReelItem clip={c} index={i} active={i === activeIdx} near={Math.abs(i - activeIdx) <= 1} muted={muted} onToggleMute={toggleMute}
            actions={actions} railFor={railFor} onOpenDetails={(x) => setDetailsFor(x.id)} />
        </div>
      ))}
      {feed.isFetchingNextPage && <div className="h-16 flex items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>}
    </div>
  );

  if (!isWide) {
    return (
      <div className={`${height} relative`}>
        {reel}
        <Sheet open={!!detailsClip} onClose={() => setDetailsFor(null)} title={detailsClip ? `Clip #${detailsClip.id}` : ''} wide>
          {detailsClip && <ClipDetails clip={detailsClip} actions={actions} />}
        </Sheet>
      </div>
    );
  }

  return (
    <div className={`${height} flex gap-4 justify-center py-3`}>
      <div className="h-full aspect-[9/16] max-w-[min(56vw,520px)] rounded-2xl overflow-hidden border border-line relative shrink-0">{reel}</div>
      <div className="flex flex-col justify-center gap-2 shrink-0">
        <button type="button" onClick={() => go(-1)} disabled={activeIdx === 0} aria-label="Previous clip (↑)"
          className="w-11 h-11 rounded-full bg-white/[0.07] hover:bg-white/[0.12] flex items-center justify-center disabled:opacity-30"><ChevronUp size={20} /></button>
        <span className="text-[11px] text-muted text-center tabular-nums">{activeIdx + 1}/{clips.length}{feed.hasNextPage ? '+' : ''}</span>
        <button type="button" onClick={() => go(1)} disabled={activeIdx >= clips.length - 1} aria-label="Next clip (↓)"
          className="w-11 h-11 rounded-full bg-white/[0.07] hover:bg-white/[0.12] flex items-center justify-center disabled:opacity-30"><ChevronDown size={20} /></button>
      </div>
      <aside className="w-[380px] shrink-0 h-full overflow-y-auto rounded-2xl bg-surface border border-line p-3" data-testid="reel-details">
        {active && <ClipDetails clip={active} actions={actions} />}
        <p className="mt-4 text-[11px] text-muted leading-relaxed">
          Keys: ↑ ↓ move · A approve · R reject · S skip · P publish · E edit · M mute · Space pause
        </p>
      </aside>
    </div>
  );
}
