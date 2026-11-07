import React, { useEffect } from 'react';
import { Flame, ArrowUpRight, Scissors, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function HypeMomentToasts({ activePipelines = [], toasts = [], onDismissToast }) {
  const navigate = useNavigate();

  // Auto-remove green completed toasts after 7 seconds
  useEffect(() => {
    if (!toasts || toasts.length === 0 || !onDismissToast) return;

    const timers = toasts.map((t) => {
      const id = t.toast_id || t.clip_id;
      return setTimeout(() => {
        onDismissToast(id);
      }, 7000);
    });

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [toasts, onDismissToast]);

  const hasItems = (activePipelines && activePipelines.length > 0) || (toasts && toasts.length > 0);
  if (!hasItems) return null;

  return (
    <aside
      aria-label="Active Hype Moments Feed"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-[340px] w-full pointer-events-auto select-none max-h-[82vh] overflow-y-auto custom-scrollbar pr-1"
    >
      {/* 1. Live Processing Hype Moments (Modern Minimalist Pill/Card Redesign) */}
      {activePipelines.map((pipeline) => {
        const channel = pipeline.channel_id || 'Streamer';
        const step = Math.min(5, Math.max(1, pipeline.current_step || 1));
        const progressPercent = Math.round((step / 5) * 100);
        const stepName = pipeline.step_name || 'Processing clip...';

        return (
          <div
            key={`live-${channel}`}
            className="bg-[#0D111A]/95 backdrop-blur-xl border border-white/[0.08] hover:border-amber-500/40 rounded-2xl p-3.5 shadow-2xl shadow-black/80 flex flex-col gap-2 text-xs transition-all duration-300 relative overflow-hidden group"
          >
            {/* Ambient subtle glow header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <Loader2 size={13} className="animate-spin" />
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-white text-xs tracking-tight flex items-center gap-1.5 truncate">
                    <span>@{channel}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full shrink-0">
                <span>Step {step} of 5</span>
              </div>
            </div>

            {/* Continuous Smooth Progress Bar */}
            <div className="relative w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden mt-0.5">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Bottom Status text with percentage */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-0.5">
              <span className="truncate pr-2">{stepName}</span>
              <span className="font-mono text-slate-500 shrink-0">{progressPercent}%</span>
            </div>
          </div>
        );
      })}

      {/* 2. Ready-To-Review Completed Clips (With Cancel Button & Auto-Remove after 7s) */}
      {toasts.map((toast) => {
        const isRendered = Boolean(toast.clip_id || toast.id);
        const score = toast.virality_score || 85;
        const channel = toast.channel_id || 'Streamer';
        const title = toast.title || 'Viral Hype Moment Detected!';
        const toastId = toast.toast_id || toast.clip_id;

        return (
          <div
            key={toastId}
            className="bg-[#0D111A]/95 backdrop-blur-xl border border-emerald-500/30 rounded-2xl p-3.5 shadow-2xl shadow-black/80 flex flex-col gap-2 text-xs transition-all duration-300 border-l-4 border-l-emerald-400 animate-in slide-in-from-bottom-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Flame size={13} />
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-white text-xs flex items-center gap-1.5 truncate">
                    <span>@{channel}</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[9px] font-bold border border-emerald-500/30">
                      {score}/100
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {toast.time || new Date().toLocaleTimeString()}
                  </div>
                </div>
              </div>

              {/* Cancel / Dismiss Button */}
              <button
                onClick={() => onDismissToast && onDismissToast(toastId)}
                className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                title="Dismiss (auto-closes in 7s)"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-slate-300 line-clamp-1 leading-relaxed text-[11px] font-medium">
              {title}
            </p>

            <div className="flex items-center justify-between pt-1 border-t border-white/[0.06] mt-0.5">
              <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Ready to review
              </span>

              <div className="flex items-center gap-1.5">
                {isRendered && (
                  <button
                    onClick={() => {
                      if (onDismissToast) onDismissToast(toastId);
                      navigate(`/clips/${toast.clip_id || toast.id}/editor`);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] shadow transition-colors cursor-pointer"
                  >
                    <Scissors size={11} /> Edit
                  </button>
                )}
                <button
                  onClick={() => {
                    if (onDismissToast) onDismissToast(toastId);
                    navigate('/');
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-[10px] transition-colors cursor-pointer"
                >
                  Review <ArrowUpRight size={11} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
