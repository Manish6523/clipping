import React from 'react';
import { Flame, X, ArrowUpRight, Scissors } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function HypeMomentToasts({ toasts, onDismiss }) {
  const navigate = useNavigate();

  if (!toasts || toasts.length === 0) return null;

  return (
    <aside
      aria-label="Hype Moment Notifications"
      className="fixed bottom-5 left-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-auto select-none"
    >
      {toasts.map((toast) => {
        const isRendered = Boolean(toast.clip_id || toast.id);
        const score = toast.virality_score || 85;
        const channel = toast.channel_id || 'Streamer';
        const title = toast.title || 'Viral Hype Moment Detected!';

        return (
          <div
            key={toast.toast_id || toast.clip_id || toast.timestamp}
            className="bg-[#0e121a]/95 backdrop-blur-md border border-amber-500/40 rounded-xl p-3.5 shadow-2xl shadow-black/80 flex flex-col gap-2 text-xs animate-in slide-in-from-bottom-3 duration-200 transition-all border-l-4 border-l-amber-400"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                  <Flame size={16} className="animate-pulse" />
                </span>
                <div>
                  <div className="font-extrabold text-white text-xs flex items-center gap-1.5">
                    <span>@{channel}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30">
                      Score: {score}/100
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {toast.time || new Date().toLocaleTimeString()}
                  </div>
                </div>
              </div>

              <button
                onClick={() => onDismiss(toast.toast_id)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-slate-300 line-clamp-2 leading-relaxed text-[11px] font-medium pl-1">
              {title}
            </p>

            <div className="flex items-center justify-between pt-1 border-t border-white/5 mt-1">
              <span className="text-[10px] text-emerald-400 font-semibold">
                Ready to Review
              </span>

              <div className="flex items-center gap-1.5">
                {isRendered && (
                  <button
                    onClick={() => navigate(`/clips/${toast.clip_id || toast.id}/editor`)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] shadow transition-colors"
                  >
                    <Scissors size={11} /> Edit
                  </button>
                )}
                <button
                  onClick={() => navigate('/')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white font-bold text-[10px] transition-colors"
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
