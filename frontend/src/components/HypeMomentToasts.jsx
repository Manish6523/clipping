import React from 'react';
import { Flame, ArrowUpRight, Scissors, Radio, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function HypeMomentToasts({ activePipelines = [], toasts = [] }) {
  const navigate = useNavigate();

  // Combine active live processing pipelines + finished hype moment toasts
  const hasItems = (activePipelines && activePipelines.length > 0) || (toasts && toasts.length > 0);
  if (!hasItems) return null;

  return (
    <aside
      aria-label="Active Hype Moments Feed"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-auto select-none max-h-[80vh] overflow-y-auto custom-scrollbar pr-1"
    >
      {/* 1. Live Processing Hype Moments (Non-cancellable, shows all streamers simultaneously) */}
      {activePipelines.map((pipeline) => {
        const channel = pipeline.channel_id || 'Streamer';
        const step = pipeline.current_step || 1;
        const stepName = pipeline.step_name || 'Processing clip...';

        const stepLabels = [
          'Buffer Sliced',
          'Transcribing',
          'Gemini Scoring',
          '9:16 Render',
          'Ready'
        ];

        return (
          <div
            key={`live-${channel}`}
            className="bg-[#0e121a]/95 backdrop-blur-md border border-amber-500/50 rounded-xl p-3 shadow-2xl shadow-black/90 flex flex-col gap-2 text-xs border-l-4 border-l-amber-400 animate-in slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-amber-500/20 text-amber-400">
                  <Flame size={15} className="animate-bounce" />
                </span>
                <div>
                  <div className="font-extrabold text-white text-xs flex items-center gap-1.5">
                    <span>@{channel}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[9px] font-bold border border-amber-500/30 animate-pulse">
                      LIVE PROCESSING
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]">
                    {stepName}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 text-[10px] font-bold font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 shrink-0">
                <Activity size={11} className="animate-spin" />
                <span>Step {step}/5</span>
              </div>
            </div>

            {/* Compact 5-step progress bar */}
            <div className="grid grid-cols-5 gap-1 pt-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <div key={s} className="flex flex-col gap-0.5 items-center">
                  <div
                    className={`h-1.5 w-full rounded-full transition-all ${
                      s < step
                        ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                        : s === step
                        ? 'bg-amber-400 animate-pulse ring-2 ring-amber-400/40'
                        : 'bg-white/10'
                    }`}
                  />
                  <span className="text-[8px] font-mono text-slate-500 truncate max-w-full">
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* 2. Ready-To-Review Completed Clips (Persistent, Non-cancellable) */}
      {toasts.map((toast) => {
        const isRendered = Boolean(toast.clip_id || toast.id);
        const score = toast.virality_score || 85;
        const channel = toast.channel_id || 'Streamer';
        const title = toast.title || 'Viral Hype Moment Detected!';

        return (
          <div
            key={toast.toast_id || toast.clip_id || toast.timestamp}
            className="bg-[#0e121a]/95 backdrop-blur-md border border-emerald-500/40 rounded-xl p-3 shadow-2xl shadow-black/80 flex flex-col gap-2 text-xs border-l-4 border-l-emerald-400 animate-in slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Flame size={15} />
                </span>
                <div>
                  <div className="font-extrabold text-white text-xs flex items-center gap-1.5">
                    <span>@{channel}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[9px] font-bold border border-emerald-500/30">
                      Score: {score}/100
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {toast.time || new Date().toLocaleTimeString()}
                  </div>
                </div>
              </div>

              <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 shrink-0">
                READY
              </span>
            </div>

            <p className="text-slate-300 line-clamp-1 leading-relaxed text-[11px] font-medium">
              {title}
            </p>

            <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-white/5">
              {isRendered && (
                <button
                  onClick={() => navigate(`/clips/${toast.clip_id || toast.id}/editor`)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] shadow transition-colors cursor-pointer"
                >
                  <Scissors size={11} /> Edit
                </button>
              )}
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-[10px] transition-colors cursor-pointer"
              >
                Review <ArrowUpRight size={11} />
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
