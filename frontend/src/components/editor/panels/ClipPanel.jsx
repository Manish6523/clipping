import React from 'react';
import { 
  Sparkles, 
  Clock, 
  Film, 
  Trash2, 
  Layers, 
  Type, 
  FileText, 
  SlidersHorizontal,
  Bookmark,
  Volume2,
  Share2
} from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';

export default function ClipPanel({ isCompact = false }) {
  const { clip, edl, duration, sourceInfo, extending, changeClipBounds, transcribeClip } = useEditorStore();

  const curStart = clip?.adjusted_start ?? edl?.source?.start ?? 0;
  const curEnd = clip?.adjusted_end ?? edl?.source?.end ?? (curStart + duration);
  const maxAvailable = sourceInfo?.available_end ?? 60.0;

  const handleSetDuration = (targetSec) => {
    const desiredSec = Math.max(3, targetSec);
    const newEnd = Math.min(maxAvailable, curStart + desiredSec);
    changeClipBounds(curStart, newEnd);
  };

  const handleShiftWindow = (deltaSec) => {
    let newStart = curStart + deltaSec;
    let newEnd = curEnd + deltaSec;
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd > maxAvailable) {
      newStart -= (newEnd - maxAvailable);
      newEnd = maxAvailable;
      if (newStart < 0) newStart = 0;
    }
    changeClipBounds(newStart, newEnd);
  };

  return (
    <div className="flex flex-col gap-3 text-xs select-none">
      {/* Clip Header Details with Virality Score */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div>
          <div className="font-extrabold text-white text-sm truncate max-w-[220px]">
            {clip?.title || 'Clip Overview'}
          </div>
          <div className="text-[11px] text-muted font-mono mt-0.5">
            Channel: @{clip?.channel_id || 'streamer'}
          </div>
        </div>
        <div className="px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-extrabold text-xs flex items-center gap-1 shadow-sm">
          🔥 {clip?.virality_score || 85}/100
        </div>
      </div>

      {/* Length Presets */}
      <div>
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1.5">
          Target Duration
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {[15, 30, 45, 60].map((sec) => (
            <button
              key={sec}
              onClick={() => handleSetDuration(sec)}
              className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                Math.round(duration) === sec
                  ? 'bg-accent text-canvas border-accent'
                  : 'bg-white/[0.04] text-ink border-white/[0.06] hover:bg-white/[0.08]'
              }`}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {/* Start / End Timestamp Steppers */}
      <div>
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1.5">
          Boundary Window
        </label>
        <div className="grid grid-cols-2 gap-2 font-mono">
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col gap-1">
            <span className="text-[11px] text-slate-400 font-sans">Start Point</span>
            <div className="flex items-center justify-between">
              <span className="text-white font-bold">{curStart.toFixed(1)}s</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => changeClipBounds(Math.max(0, curStart - 1), curEnd)}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold text-xs"
                >
                  -1
                </button>
                <button
                  onClick={() => changeClipBounds(Math.min(curEnd - 3, curStart + 1), curEnd)}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold text-xs"
                >
                  +1
                </button>
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col gap-1">
            <span className="text-[11px] text-slate-400 font-sans">End Point</span>
            <div className="flex items-center justify-between">
              <span className="text-white font-bold">{curEnd.toFixed(1)}s</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => changeClipBounds(curStart, Math.max(curStart + 3, curEnd - 1))}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold text-xs"
                >
                  -1
                </button>
                <button
                  onClick={() => changeClipBounds(curStart, Math.min(maxAvailable, curEnd + 1))}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold text-xs"
                >
                  +1
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Nudge Window Buttons */}
      <div>
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1.5">
          Nudge Segment
        </label>
        <div className="grid grid-cols-4 gap-1.5 font-mono text-xs">
          {[-5, -1, 1, 5].map((delta) => (
            <button
              key={delta}
              onClick={() => handleShiftWindow(delta)}
              className="py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border border-white/[0.06] font-bold"
            >
              {delta > 0 ? `+${delta}s` : `${delta}s`}
            </button>
          ))}
        </div>
      </div>

      {/* Run Transcriber */}
      <div className="pt-2">
        <button
          onClick={transcribeClip}
          className="w-full py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
        >
          <Sparkles size={14} className="text-indigo-400" />
          <span>Re-Transcribe Audio (faster-whisper)</span>
        </button>
      </div>
    </div>
  );
}

