import React, { useState, useEffect } from 'react';
import { Flame, ArrowUpRight, Scissors, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function HypeMomentToasts({ activePipelines = [], toasts = [], onDismissToast }) {
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);

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

  const count = activePipelines.length;
  const primary = activePipelines[0] || null;

  return (
    <aside
      aria-label="Active Hype Moments Feed"
      className="fixed top-16 left-5 z-50 flex flex-col gap-2.5 max-w-[340px] w-full pointer-events-auto select-none transition-all duration-300"
    >
      {/* 1. Live Processing Hype Moments (Stacked Card with fluid 3D tilt & expand animation) */}
      {count > 0 && (
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="relative transition-all duration-300 ease-out"
        >
          {/* Collapsed Stack Mode with layered edge animation */}
          {!isHovered && count > 1 ? (
            <div className="relative group cursor-pointer transition-transform duration-300 hover:scale-[1.02]">
              {/* Backing Card 2 (Bottom Stack Edge) */}
              {count > 2 && (
                <div className="absolute -bottom-2.5 inset-x-4 h-6 bg-[#0D111A]/60 border border-white/[0.04] rounded-2xl shadow-md pointer-events-none transition-all duration-300 transform group-hover:translate-y-1" />
              )}
              {/* Backing Card 1 (Middle Stack Edge) */}
              <div className="absolute -bottom-1.5 inset-x-2 h-6 bg-[#0D111A]/80 border border-white/[0.06] rounded-2xl shadow-md pointer-events-none transition-all duration-300 transform group-hover:translate-y-0.5" />

              {/* Front Primary Card */}
              <div className="bg-[#0D111A]/95 backdrop-blur-xl border border-white/[0.1] hover:border-amber-500/40 rounded-2xl p-3.5 shadow-2xl shadow-black/90 flex flex-col gap-2 text-xs relative z-10 transition-all duration-300">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                      <Loader2 size={13} className="animate-spin" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-white text-xs tracking-tight flex items-center gap-1.5 truncate">
                        <span>@{primary.channel_id || 'Streamer'}</span>
                        <span className="text-[10px] text-amber-400/90 font-mono font-normal">
                          (+{count - 1} more)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full shrink-0">
                    <span>Step {Math.min(5, Math.max(1, primary.current_step || 1))} of 5</span>
                  </div>
                </div>

                {/* Smooth Gradient Progress Bar */}
                <div className="relative w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden mt-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                    style={{ width: `${Math.round((Math.min(5, Math.max(1, primary.current_step || 1)) / 5) * 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-0.5">
                  <span className="truncate pr-2">{primary.step_name || 'Processing clip...'}</span>
                  <span className="font-mono text-slate-500 shrink-0">
                    {Math.round((Math.min(5, Math.max(1, primary.current_step || 1)) / 5) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Expanded Full List (Smooth Slide-Down Stagger Animation) */
            <div className="flex flex-col gap-2 transition-all duration-300">
              {activePipelines.map((pipeline, idx) => {
                const channel = pipeline.channel_id || 'Streamer';
                const step = Math.min(5, Math.max(1, pipeline.current_step || 1));
                const progressPercent = Math.round((step / 5) * 100);
                const stepName = pipeline.step_name || 'Processing clip...';

                return (
                  <div
                    key={`live-${channel}`}
                    style={{ animationDelay: `${idx * 40}ms` }}
                    className="bg-[#0D111A]/95 backdrop-blur-xl border border-white/[0.08] hover:border-amber-500/40 rounded-2xl p-3.5 shadow-2xl shadow-black/80 flex flex-col gap-2 text-xs transition-all duration-200 relative overflow-hidden animate-in slide-in-from-top-2 fade-in"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                          <Loader2 size={13} className="animate-spin" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-extrabold text-white text-xs tracking-tight truncate">
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
                        className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-0.5">
                      <span className="truncate pr-2">{stepName}</span>
                      <span className="font-mono text-slate-500 shrink-0">{progressPercent}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. Ready-To-Review Completed Clips (Slide-In from Top with Fade & Auto-Dismiss) */}
      {toasts.map((toast) => {
        const isRendered = Boolean(toast.clip_id || toast.id);
        const score = toast.virality_score || 85;
        const channel = toast.channel_id || 'Streamer';
        const title = toast.title || 'Viral Hype Moment Detected!';
        const toastId = toast.toast_id || toast.clip_id;

        return (
          <div
            key={toastId}
            className="bg-[#0D111A]/95 backdrop-blur-xl border border-emerald-500/30 rounded-2xl p-3.5 shadow-2xl shadow-black/80 flex flex-col gap-2 text-xs transition-all duration-300 border-l-4 border-l-emerald-400 animate-in slide-in-from-top-3 fade-in duration-300"
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
