import React, { useEffect } from 'react';
import { Flame, ArrowUpRight, Scissors, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, IconButton, Badge, Dot } from './ui';

const AUTO_DISMISS_MS = 7000;

/** "New clip ready" toasts. Slides in under the top bar; closes itself after 7 s. */
export default function HypeMomentToasts({ toasts = [], onDismissToast }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!toasts?.length || !onDismissToast) return undefined;
    const timers = toasts.map((t) => setTimeout(() => onDismissToast(t.toast_id || t.clip_id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, onDismissToast]);

  if (!toasts?.length) return null;

  return (
    <aside aria-label="New clips" aria-live="polite"
      className="fixed top-16 inset-x-3 sm:inset-x-auto sm:right-5 sm:w-[340px] z-[70] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const clipId = toast.clip_id || toast.id;
        const toastId = toast.toast_id || toast.clip_id;
        const go = (path) => { onDismissToast?.(toastId); navigate(path); };
        return (
          <div key={toastId} role="status"
            className="ds-sheet pointer-events-auto rounded-2xl bg-surface/95 backdrop-blur-xl border border-line-strong border-l-4 border-l-good shadow-2xl shadow-black/70 p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-good/15 text-good flex items-center justify-center shrink-0"><Flame size={16} /></div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                    <span className="truncate">@{toast.channel_id || 'streamer'}</span>
                    <Badge tone="good">{toast.virality_score || 85}/100</Badge>
                  </div>
                  <div className="text-[11px] text-muted flex items-center gap-1.5"><Dot tone="good" live /> New clip · {toast.time || new Date().toLocaleTimeString()}</div>
                </div>
              </div>
              <IconButton icon={X} label="Dismiss" size="sm" onClick={() => onDismissToast?.(toastId)} />
            </div>
            <p className="text-xs text-slate-300 line-clamp-2 leading-snug">{toast.title || 'A new highlight is ready to review.'}</p>
            <div className="flex gap-2">
              {clipId && <Button size="sm" icon={Scissors} className="flex-1" onClick={() => go(`/clips/${clipId}/editor`)}>Edit</Button>}
              <Button size="sm" variant="primary" icon={ArrowUpRight} className="flex-1" onClick={() => go('/')}>Review</Button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
