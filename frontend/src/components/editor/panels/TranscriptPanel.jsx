import React, { useState } from 'react';
import { FileText, Scissors, Trash2, Clock, RotateCcw } from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';

export default function TranscriptPanel({ isCompact = false }) {
  const { edl, currentTime, setCurrentTime, toggleWordDeleted, editWordText } = useEditorStore();
  const words = edl?.words || [];
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');

  const handleWordClick = (startSec) => {
    setCurrentTime(startSec);
  };

  const handleStartEdit = (idx, currentWord) => {
    setEditingIndex(idx);
    setEditText(currentWord);
  };

  const handleSaveEdit = (idx) => {
    if (editingIndex !== null) {
      editWordText(idx, editText.trim());
      setEditingIndex(null);
    }
  };

  if (!words || words.length === 0) {
    return (
      <div className="text-center py-12 text-[#8B90A0] text-xs">
        No word-level transcript available for this clip.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 text-xs select-none">
      <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
        <span className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider">
          Click word to seek • Double-tap to edit • Tap to strike
        </span>
        <span className="text-[10px] font-mono text-slate-400 font-bold">
          {words.length} words
        </span>
      </div>

      {/* Wrapping interactive touch chips */}
      <div className="flex flex-wrap gap-1.5 max-h-[360px] overflow-y-auto custom-scrollbar p-1">
        {words.map((w, idx) => {
          const isPlayingWord = currentTime >= w.start && currentTime < w.end;
          const isDeleted = Boolean(w.deleted);
          const isEditing = editingIndex === idx;

          if (isEditing) {
            return (
              <input
                key={idx}
                type="text"
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={() => handleSaveEdit(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit(idx);
                  if (e.key === 'Escape') setEditingIndex(null);
                }}
                className="px-2 py-1 bg-white text-black font-bold text-xs rounded-lg outline-none w-20 shadow-md"
              />
            );
          }

          return (
            <button
              key={idx}
              onClick={() => handleWordClick(w.start)}
              onDoubleClick={() => handleStartEdit(idx, w.word)}
              className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all border shrink-0 min-h-[36px] flex items-center justify-center ${
                isDeleted
                  ? 'line-through opacity-40 bg-rose-950/20 text-rose-300 border-rose-900/30'
                  : isPlayingWord
                  ? 'bg-[#8FD3FF] text-[#0A0B0E] border-[#8FD3FF] shadow-md shadow-[#8FD3FF]/20 scale-105 z-10'
                  : 'bg-white/[0.04] text-slate-200 border-white/[0.06] hover:bg-white/[0.08]'
              }`}
            >
              <span>{w.word}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

