import React, { useState } from 'react';
import { VolumeX, Volume2, Scissors, Pencil, RotateCcw, Undo2 } from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';
import { isWordCensored, maskWord } from '../../../utils/profanity';

const CLIP_AUDIO_MODES = [
  { id: '', label: 'Default' },
  { id: 'bleep', label: 'Bleep' },
  { id: 'sfx', label: 'Sound FX' },
  { id: 'mute', label: 'Mute' },
  { id: 'off', label: 'Off' },
];

export default function TranscriptPanel() {
  const {
    edl, currentTime, setCurrentTime, toggleWordDeleted, editWordText,
    toggleWordCensor, resetWordCensors, setClipCensor,
  } = useEditorStore();
  const words = edl?.words || [];
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');

  const censorCfg = edl?._censor_cfg ? { ...edl._censor_cfg, ...(edl?.censor || {}) } : null;
  const maskStyle = censorCfg?.caption_style && censorCfg.caption_style !== 'none' ? censorCfg.caption_style : 'vowels';
  const censoredCount = words.filter((w) => !w.deleted && isWordCensored(w)).length;
  const hasOverrides = words.some((w) => typeof w.censor === 'boolean');
  const clipAudioMode = edl?.censor?.audio_mode || '';

  const startEdit = (idx) => {
    setEditingIndex(idx);
    setEditText(words[idx]?.word || '');
  };

  const saveEdit = (idx) => {
    if (editingIndex !== null) {
      const t = editText.trim();
      if (t) editWordText(idx, t);
      setEditingIndex(null);
    }
  };

  if (!words.length) {
    return (
      <div className="text-center py-12 text-[#8B90A0] text-xs">
        No word-level transcript available for this clip.
      </div>
    );
  }

  const sel = selectedIdx !== null ? words[selectedIdx] : null;
  const selCensored = sel ? isWordCensored(sel) : false;

  return (
    <div className="flex flex-col gap-2.5 text-xs select-none">
      {/* Censor summary + per-clip audio mode */}
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-rose-500/[0.06] border border-rose-500/20">
        <span className="flex items-center gap-1.5 text-rose-200 font-semibold">
          <VolumeX className="w-3.5 h-3.5" />
          {censoredCount} bleeped
        </span>
        <label className="flex items-center gap-1.5 ml-auto text-[11px] text-[#8B90A0]">
          This clip
          <select
            value={clipAudioMode}
            onChange={(e) => setClipCensor({ audio_mode: e.target.value || null })}
            className="bg-[#0A0B0E] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none"
            aria-label="Censor audio mode for this clip"
          >
            {CLIP_AUDIO_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        {hasOverrides && (
          <button
            type="button"
            onClick={resetWordCensors}
            className="flex items-center gap-1 text-[11px] text-[#8B90A0] hover:text-white"
            title="Clear manual bleep toggles"
          >
            <RotateCcw className="w-3 h-3" /> Auto
          </button>
        )}
      </div>

      <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
        <span className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider">
          Tap a word to seek &amp; edit
        </span>
        <span className="text-[10px] font-mono text-slate-400 font-bold">{words.length} words</span>
      </div>

      {/* Action bar for the selected word */}
      {sel && editingIndex === null && (
        <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
          <span className="px-2 font-bold text-white truncate max-w-[30%]">{sel.word}</span>
          <button
            type="button"
            onClick={() => toggleWordCensor(selectedIdx)}
            className={`flex-1 min-h-[36px] rounded-lg font-semibold flex items-center justify-center gap-1.5 ${
              selCensored ? 'bg-rose-500 text-white' : 'bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]'
            }`}
          >
            {selCensored ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {selCensored ? 'Bleeped' : 'Bleep'}
          </button>
          <button
            type="button"
            onClick={() => toggleWordDeleted(selectedIdx)}
            className={`flex-1 min-h-[36px] rounded-lg font-semibold flex items-center justify-center gap-1.5 ${
              sel.deleted ? 'bg-amber-500/20 text-amber-200' : 'bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]'
            }`}
          >
            {sel.deleted ? <Undo2 className="w-3.5 h-3.5" /> : <Scissors className="w-3.5 h-3.5" />}
            {sel.deleted ? 'Restore' : 'Cut'}
          </button>
          <button
            type="button"
            onClick={() => startEdit(selectedIdx)}
            className="min-h-[36px] px-3 rounded-lg bg-white/[0.06] text-slate-200 hover:bg-white/[0.1] flex items-center justify-center"
            aria-label="Edit word text"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Wrapping interactive touch chips */}
      <div className="flex flex-wrap gap-1.5 max-h-[360px] overflow-y-auto custom-scrollbar p-1">
        {words.map((w, idx) => {
          const isPlayingWord = currentTime >= w.start && currentTime < w.end;
          const isDeleted = Boolean(w.deleted);
          const isCensored = isWordCensored(w);
          const isSelected = selectedIdx === idx;
          const detectedOnly = !isCensored && w.profanity;

          if (editingIndex === idx) {
            return (
              <input
                key={idx}
                type="text"
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={() => saveEdit(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit(idx);
                  if (e.key === 'Escape') setEditingIndex(null);
                }}
                className="px-2 py-1 bg-white text-black font-bold text-xs rounded-lg outline-none w-24 shadow-md"
              />
            );
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => { setCurrentTime(w.start); setSelectedIdx(isSelected ? null : idx); }}
              onDoubleClick={() => startEdit(idx)}
              title={w.profanity ? `Detected: ${w.profanity}` : undefined}
              className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all border shrink-0 min-h-[36px] flex items-center justify-center gap-1 ${
                isDeleted
                  ? 'line-through opacity-40 bg-rose-950/20 text-rose-300 border-rose-900/30'
                  : isCensored
                  ? 'bg-rose-500/20 text-rose-200 border-rose-500/50'
                  : isPlayingWord
                  ? 'bg-[#8FD3FF] text-[#0A0B0E] border-[#8FD3FF] shadow-md shadow-[#8FD3FF]/20 scale-105 z-10'
                  : detectedOnly
                  ? 'bg-amber-500/10 text-amber-200 border-amber-500/30 border-dashed'
                  : 'bg-white/[0.04] text-slate-200 border-white/[0.06] hover:bg-white/[0.08]'
              } ${isSelected ? 'ring-2 ring-white/70' : ''}`}
            >
              {isCensored && !isDeleted && <VolumeX className="w-3 h-3 shrink-0" />}
              <span>{isCensored && !isDeleted ? maskWord(w.word || '', maskStyle) : w.word}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
