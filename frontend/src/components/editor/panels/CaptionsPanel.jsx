import React from 'react';
import { Type, Sparkles, SlidersHorizontal } from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';

const FONTS = [
  'Montserrat ExtraBold',
  'Anton',
  'Bangers',
  'Poppins Black',
  'Inter Black',
  'Impact',
  'Arial Black'
];

const PRESET_COLORS = [
  '#FFFFFF', '#FACC15', '#00F0FF', '#FF0055', '#10B981', '#A855F7', '#FF8800'
];

export default function CaptionsPanel({ isCompact = false }) {
  const { edl, updateCaptionStyle, updateCaptionPos } = useEditorStore();
  const captions = edl?.captions || {};

  const curFont = captions.font || 'Montserrat ExtraBold';
  const curSize = captions.size || 72;
  const curColor = captions.color || '#FFFFFF';
  const curHighlight = captions.highlight || '#FACC15';
  const curAnimation = captions.animation || 'pop';
  const curWordsPerLine = captions.words_per_line || 3;
  const curPosY = Math.round((captions.position?.y ?? 0.76) * 100);

  return (
    <div className="flex flex-col gap-3 text-xs select-none">
      {/* Font Family Picker */}
      <div>
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1">
          Font Family
        </label>
        <select
          value={curFont}
          onChange={(e) => updateCaptionStyle({ font: e.target.value })}
          className="w-full bg-raised border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-accent"
        >
          {FONTS.map((f) => (
            <option key={f} value={f} className="bg-slate-900 text-white">
              {f}
            </option>
          ))}
        </select>
      </div>

      {/* Animation Preset */}
      <div>
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1">
          Karaoke Pop Animation
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { id: 'pop', label: 'Pop' },
            { id: 'bounce', label: 'Bounce' },
            { id: 'typewriter', label: 'Type' },
            { id: 'none', label: 'Static' },
          ].map((anim) => (
            <button
              key={anim.id}
              onClick={() => updateCaptionStyle({ animation: anim.id })}
              className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                curAnimation === anim.id
                  ? 'bg-accent text-canvas border-accent'
                  : 'bg-white/[0.04] text-slate-300 border-white/[0.06] hover:bg-white/[0.08]'
              }`}
            >
              {anim.label}
            </button>
          ))}
        </div>
      </div>

      {/* Colors: Primary & Active Highlight */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col gap-1.5">
          <span className="text-[11px] text-slate-400 uppercase font-bold">Text Color</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={curColor}
              onChange={(e) => updateCaptionStyle({ color: e.target.value })}
              className="w-7 h-7 rounded-lg bg-transparent cursor-pointer border-0"
            />
            <span className="font-mono text-white text-xs">{curColor}</span>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col gap-1.5">
          <span className="text-[11px] text-slate-400 uppercase font-bold">Karaoke Highlight</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={curHighlight}
              onChange={(e) => updateCaptionStyle({ highlight: e.target.value })}
              className="w-7 h-7 rounded-lg bg-transparent cursor-pointer border-0"
            />
            <span className="font-mono text-white text-xs">{curHighlight}</span>
          </div>
        </div>
      </div>

      {/* Color Swatch Quick Row */}
      <div className="flex items-center justify-between gap-1.5 px-1">
        {PRESET_COLORS.map((hex) => (
          <button
            key={hex}
            onClick={() => updateCaptionStyle({ highlight: hex })}
            style={{ backgroundColor: hex }}
            className="w-6 h-6 rounded-full border-2 border-white/20 hover:scale-110 transition-transform shadow-sm"
          />
        ))}
      </div>

      {/* Vertical Position & Words Per Line */}
      <div className="space-y-2 pt-1 border-t border-white/[0.06]">
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-400">Vertical Position (Y)</span>
            <span className="font-mono text-white">{curPosY}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="90"
            value={curPosY}
            onChange={(e) => updateCaptionPos({ y: Number(e.target.value) / 100 })}
            className="w-full accent-accent cursor-pointer"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-400">Words Per Line</span>
            <span className="font-mono text-white">{curWordsPerLine} words</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => updateCaptionStyle({ words_per_line: n })}
                className={`py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  curWordsPerLine === n
                    ? 'bg-accent text-canvas border-accent'
                    : 'bg-white/[0.04] text-slate-300 border-white/[0.06]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

