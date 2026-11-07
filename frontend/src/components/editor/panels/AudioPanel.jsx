import React from 'react';
import { Volume2, Music, Mic, VolumeX } from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';

export default function AudioPanel({ isCompact = false }) {
  const { edl, updateEDL } = useEditorStore();
  const audio = edl?.audio || { normalize: true, duck: true, music: null };

  const updateAudio = (partial) => {
    updateEDL((prev) => ({
      ...prev,
      audio: { ...(prev.audio || {}), ...partial }
    }));
  };

  return (
    <div className="flex flex-col gap-3 text-xs select-none">
      <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-[#8FD3FF]" />
          <div>
            <div className="font-bold text-white text-xs">Loudness Normalization</div>
            <div className="text-[10px] text-slate-400">EBU R128 (-14 LUFS dialogue target)</div>
          </div>
        </div>
        <input
          type="checkbox"
          checked={audio.normalize !== false}
          onChange={(e) => updateAudio({ normalize: e.target.checked })}
          className="w-4 h-4 accent-[#8FD3FF] rounded cursor-pointer"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-emerald-400" />
          <div>
            <div className="font-bold text-white text-xs">Speech Auto-Ducking</div>
            <div className="text-[10px] text-slate-400">Lower background audio when streamer speaks</div>
          </div>
        </div>
        <input
          type="checkbox"
          checked={audio.duck !== false}
          onChange={(e) => updateAudio({ duck: e.target.checked })}
          className="w-4 h-4 accent-[#8FD3FF] rounded cursor-pointer"
        />
      </div>
    </div>
  );
}

