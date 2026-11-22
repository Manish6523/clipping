import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Volume2, VolumeX, Play, Loader2, PartyPopper, ChevronUp, ChevronDown,
  Film, MoreVertical, Check, X, Send, Scissors, Download, Palette, Info, Wand2, Trash2,
} from 'lucide-react';
import { Sheet, Button } from '../ui';
import { withToken } from '../../api';
import ClipDetails from './ClipDetails';
import { clipActions } from './ClipActionBar';
import { statusMeta, scoreOf, scoreTone, clipLength } from './model';

const TONE_TXT = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', accent: 'text-accent', idle: 'text-muted' };

function ReelItem({
  clip,
  index,
  active,
  near,
  muted,
  onToggleMute,
  actions,
  isPhone,
  onPublish,
  onStyle,
  onEdits,
  onOpenDetails,
  onNext,
  navigate,
}) {
  const videoRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [more, setMore] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
      if (p?.catch) p.catch(() => setPaused(true)); // autoplay blocked: show play state
      setPaused(false);
    } else {
      v.pause();
      setMore(false);
      setMenuOpen(false);
    }
  }, [active, src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };

  const reviewable = ['pending_approval', 'approved'].includes(clip.status);
  const tags = String(clip.hashtags || '').split(/\s+/).filter(Boolean);

  return (
    <section
      className="relative h-full w-full snap-start snap-always bg-black overflow-hidden select-none"
      data-index={index}
      data-clip-id={clip.id}
      data-testid="reel"
      aria-label={`Clip ${clip.id}: ${clip.title}`}
    >
      {near && src ? (
        <video
          ref={videoRef}
          src={src}
          muted={muted}
          loop
          playsInline
          preload={active ? 'auto' : 'metadata'}
          poster={withToken(clip.thumbnail_url) || undefined}
          onClick={togglePlay}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        clip.thumbnail_url ? (
          <img
            src={withToken(clip.thumbnail_url)}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <Film size={28} />
          </div>
        )
      )}

      {/* Play indicator when actively paused */}
      {active && paused && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white pointer-events-auto transition-transform active:scale-90 shadow-2xl z-20"
        >
          <Play size={28} className="text-white ml-1 fill-white" />
        </button>
      )}

      {actions.applying[clip.id] && (
        <div className="absolute top-16 inset-x-0 mx-auto w-fit rounded-full bg-black/80 backdrop-blur-md px-3.5 py-1.5 text-xs text-white flex items-center gap-2 border border-white/10 shadow-lg z-20">
          <Loader2 size={13} className="animate-spin text-accent" />
          <span>Re-rendering: {actions.applying[clip.id]}</span>
        </div>
      )}

      {/* Floating Mute button */}
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="absolute top-3 right-3 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white transition-all active:scale-95 shadow-md"
      >
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>

      {/* RIGHT ACTION RAIL (Uniform, clean 5 actions for both PC & Mobile) */}
      <div
        className="absolute right-2 bottom-5 sm:bottom-6 z-20 flex flex-col items-center gap-2 sm:gap-2.5"
        data-testid="reel-rail"
      >
        {reviewable && (
          <button
            type="button"
            onClick={() => actions.approve(clip)}
            aria-label="Approve clip"
            className="group flex flex-col items-center gap-0.5 text-white active:scale-95 transition-transform"
          >
            <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-good/20 text-good border border-good/40 backdrop-blur-md flex items-center justify-center shadow-lg group-hover:bg-good/30">
              <Check size={19} strokeWidth={2.5} />
            </span>
            <span className="text-[10px] font-semibold tracking-tight drop-shadow">Approve</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => actions.reject(clip)}
          aria-label={reviewable ? 'Reject clip' : 'Delete clip'}
          className="group flex flex-col items-center gap-0.5 text-white active:scale-95 transition-transform"
        >
          <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-bad/20 text-bad border border-bad/40 backdrop-blur-md flex items-center justify-center shadow-lg group-hover:bg-bad/30">
            {reviewable ? <X size={19} strokeWidth={2.5} /> : <Trash2 size={17} />}
          </span>
          <span className="text-[10px] font-semibold tracking-tight drop-shadow">
            {reviewable ? 'Reject' : 'Delete'}
          </span>
        </button>

        {clip.status !== 'published' && (
          <button
            type="button"
            onClick={() => onPublish(clip)}
            aria-label="Publish clip"
            className="group flex flex-col items-center gap-0.5 text-white active:scale-95 transition-transform"
          >
            <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-accent/20 text-accent border border-accent/40 backdrop-blur-md flex items-center justify-center shadow-lg group-hover:bg-accent/30">
              <Send size={17} />
            </span>
            <span className="text-[10px] font-semibold tracking-tight drop-shadow">Publish</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate(`/clips/${clip.id}/editor`)}
          aria-label="Edit clip layout & captions"
          className="group flex flex-col items-center gap-0.5 text-white active:scale-95 transition-transform"
        >
          <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/50 text-white border border-white/15 backdrop-blur-md flex items-center justify-center shadow-lg group-hover:bg-black/70">
            <Scissors size={17} />
          </span>
          <span className="text-[10px] font-semibold tracking-tight drop-shadow">Edit</span>
        </button>

        {/* More options menu sheet (on mobile) or popup (on pc) */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="More options"
          className="group flex flex-col items-center gap-0.5 text-white active:scale-95 transition-transform"
        >
          <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/50 text-white/90 border border-white/15 backdrop-blur-md flex items-center justify-center shadow-lg group-hover:bg-black/70">
            <MoreVertical size={17} />
          </span>
          <span className="text-[10px] font-semibold tracking-tight drop-shadow">More</span>
        </button>
      </div>

      {/* BOTTOM INFO OVERLAY */}
      <div className="absolute inset-x-0 bottom-0 pr-18 sm:pr-20 pl-4 pb-4 pt-16 bg-gradient-to-t from-black/95 via-black/60 to-transparent pointer-events-auto">
        <div className="flex items-center gap-2 text-[12px] text-white/90 mb-1">
          <span className="font-semibold text-accent">@{clip.channel_id}</span>
          <span className={`font-bold px-1.5 py-0.2 rounded bg-black/40 ${TONE_TXT[scoreTone(score)]}`}>
            {score}
          </span>
          <span className={`text-[11px] font-medium ${TONE_TXT[m.tone]}`}>{m.label}</span>
          {len && <span className="text-white/60 text-[11px]">{len}s</span>}
        </div>

        <h2 className="text-[14px] sm:text-[15px] font-bold text-white leading-snug line-clamp-2 drop-shadow">
          {clip.title || 'Untitled'}
        </h2>

        {(clip.description || tags.length > 0) && (
          more ? (
            <div
              className="mt-1.5 max-h-[30dvh] overflow-y-auto text-[12px] text-white/90 leading-relaxed space-y-1.5 bg-black/60 p-2.5 rounded-xl border border-white/10 backdrop-blur-sm"
              onClick={() => setMore(false)}
            >
              {clip.description && <p className="whitespace-pre-line">{clip.description}</p>}
              {tags.length > 0 && <p className="text-accent font-medium">{tags.join(' ')}</p>}
              <button type="button" className="text-white/60 text-[11px] font-semibold pt-1">
                Tap to collapse
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMore(true)}
              className="mt-1 block text-left text-[12px] text-white/75 leading-snug w-full"
            >
              <span className="line-clamp-1">{clip.description || tags.join(' ')}</span>
              <span className="text-white/50 font-semibold ml-1">…more</span>
            </button>
          )
        )}
      </div>

      {/* More Options Sheet */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Clip Options">
        <div className="grid grid-cols-2 gap-2 pb-3">
          <Button
            variant="secondary"
            icon={Palette}
            onClick={() => {
              setMenuOpen(false);
              onStyle(clip);
            }}
            className="justify-start py-3"
          >
            Style & Fonts
          </Button>
          {onEdits && (
            <Button
              variant="secondary"
              icon={Wand2}
              onClick={() => {
                setMenuOpen(false);
                onEdits(clip);
              }}
              className="justify-start py-3"
            >
              Auto-Edits
            </Button>
          )}
          <Button
            variant="secondary"
            icon={Download}
            disabled={!clip.download_url}
            onClick={() => {
              setMenuOpen(false);
              actions.download(clip);
            }}
            className="justify-start py-3"
          >
            Download
          </Button>
          <Button
            variant="secondary"
            icon={Info}
            onClick={() => {
              setMenuOpen(false);
              onOpenDetails(clip);
            }}
            className="justify-start py-3"
          >
            Clip Details
          </Button>
        </div>
      </Sheet>
    </section>
  );
}

export default function ClipReels({ feed, clips, actions, onPublish, onStyle, onEdits, isWide }) {
  const navigate = useNavigate();
  const scroller = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('autoclip_reels_muted') !== '0';
    } catch {
      return true;
    }
  });
  const [detailsFor, setDetailsFor] = useState(null);
  const activeIdRef = useRef(null);
  const active = clips[Math.min(activeIdx, clips.length - 1)] || null;

  const toggleMute = () =>
    setMuted((m) => {
      try {
        localStorage.setItem('autoclip_reels_muted', m ? '0' : '1');
      } catch {
        /* */
      }
      return !m;
    });

  // Which reel is on screen
  useEffect(() => {
    const root = scroller.current;
    if (!root) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveIdx(Number(e.target.dataset.index));
        });
      },
      { root, threshold: 0.6 }
    );
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

  const go = useCallback(
    (delta) => {
      const root = scroller.current;
      if (!root) return;
      const next = Math.max(0, Math.min(clips.length - 1, activeIdx + delta));
      root.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [activeIdx, clips.length]
  );

  // Keyboard: arrows / J K move, A R S P E D act, M mute, space pause
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowdown' || k === 'j') {
        e.preventDefault();
        go(1);
        return;
      }
      if (k === 'arrowup' || k === 'k') {
        e.preventDefault();
        go(-1);
        return;
      }
      if (k === 'm') {
        toggleMute();
        return;
      }
      if (k === ' ') {
        e.preventDefault();
        const v = scroller.current?.querySelector(`[data-index="${activeIdx}"] video`);
        if (v) {
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }
        return;
      }
      if (!active) return;
      const hit = clipActions(active, {
        actions,
        navigate,
        rail: true,
        onPublish,
        onStyle,
        onSkip: () => go(1),
        onDetails: (c) => setDetailsFor(c.id),
      }).find((a) => a.key && a.key.toLowerCase() === k);
      if (hit && !hit.disabled) {
        e.preventDefault();
        hit.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, activeIdx, actions, navigate, onPublish, onStyle, go]);

  const height = 'h-full';
  const detailsClip = clips.find((c) => c.id === detailsFor) || null;

  if (feed.isLoading)
    return (
      <div className={`${height} flex items-center justify-center`}>
        <Loader2 className="animate-spin text-muted" />
      </div>
    );
  if (!clips.length) {
    return (
      <div className={`${height} flex flex-col items-center justify-center text-center gap-3 px-6`}>
        <PartyPopper className="text-warn" size={36} />
        <p className="text-ink font-semibold">
          {feed.filters.status === 'pending_approval' ? 'All caught up' : 'No clips here'}
        </p>
        <p className="text-xs text-muted">
          {feed.filters.q ? 'Nothing matches your search.' : 'New clips appear here automatically while streams are live.'}
        </p>
        <Link to="/quickclip">
          <Button variant="primary">Quick Clip a video</Button>
        </Link>
      </div>
    );
  }

  const reel = (
    <div
      ref={scroller}
      className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain no-scrollbar"
      data-testid="reels"
      tabIndex={-1}
    >
      {clips.map((c, i) => (
        <div key={c.id} className="h-full">
          <ReelItem
            clip={c}
            index={i}
            active={i === activeIdx}
            near={Math.abs(i - activeIdx) <= 1}
            muted={muted}
            onToggleMute={toggleMute}
            actions={actions}
            isPhone={!isWide}
            onPublish={onPublish}
            onStyle={onStyle}
            onEdits={onEdits}
            onOpenDetails={(x) => setDetailsFor(x.id)}
            onNext={() => go(1)}
            navigate={navigate}
          />
        </div>
      ))}
      {feed.isFetchingNextPage && (
        <div className="h-16 flex items-center justify-center">
          <Loader2 className="animate-spin text-muted" />
        </div>
      )}
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

  // Modern PC / Desktop Reels layout
  return (
    <div className="h-full flex items-center justify-center gap-6 py-2 select-none">
      {/* 9:16 Video Stage with floating overlay & action rail */}
      <div className="h-full max-h-[820px] aspect-[9/16] rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative shrink-0 bg-black">
        {reel}
      </div>

      {/* Up/Down Floating Nav Buttons */}
      <div className="flex flex-col justify-center items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={activeIdx === 0}
          title="Previous clip (Up arrow / K)"
          aria-label="Previous clip (↑)"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 flex items-center justify-center disabled:opacity-20 transition-all text-white shadow-md active:scale-95"
        >
          <ChevronUp size={18} />
        </button>
        <span className="text-[11.5px] font-semibold text-muted text-center tabular-nums px-2 py-0.5 rounded-full bg-white/[0.05]">
          {activeIdx + 1}/{clips.length}
          {feed.hasNextPage ? '+' : ''}
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={activeIdx >= clips.length - 1}
          title="Next clip (Down arrow / J)"
          aria-label="Next clip (↓)"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 flex items-center justify-center disabled:opacity-20 transition-all text-white shadow-md active:scale-95"
        >
          <ChevronDown size={18} />
        </button>
      </div>

      {/* Clean Right Details Card */}
      <aside
        className="w-[380px] max-w-[420px] shrink-0 h-full max-h-[820px] overflow-y-auto rounded-2xl bg-surface border border-white/10 p-4 shadow-xl flex flex-col justify-between"
        data-testid="reel-details"
      >
        <div className="space-y-3">
          {active && <ClipDetails clip={active} actions={actions} />}
        </div>
        <div className="pt-3 border-t border-white/10 text-[11px] text-muted flex items-center justify-between">
          <span>Shortcuts: <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">↑</kbd> <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">↓</kbd> <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">A</kbd> <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">R</kbd></span>
          <span><kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">Space</kbd> pause</span>
        </div>
      </aside>
    </div>
  );
}
