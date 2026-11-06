import React from 'react';
import { 
  Check, 
  Type, 
  AlignLeft,
  AlignCenter,
  AlignRight,
  Maximize,
  Sliders
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export default function Inspector() {
  const { edl, updateEDL, updateCaptionPos } = useEditorStore();

  const formats = [
    { id: '9:16', label: '9:16' },
    { id: '3:4', label: '3:4' },
    { id: '1:1', label: '1:1' },
    { id: '4:3', label: '4:3' },
  ];

  const qualities = [
    { id: '720p', label: '720p' },
    { id: '1080p', label: '1080p' },
    { id: '4K', label: '4K Adv' },
  ];

  const captionsPos = edl?.captions?.position || { x: 0.5, y: 0.76, max_width: 0.85 };

  const handleQuickPlace = (placement) => {
    const anchors = {
      top: { x: 0.5, y: 0.15 },
      upper_third: { x: 0.5, y: 0.33 },
      middle: { x: 0.5, y: 0.50 },
      lower_third: { x: 0.5, y: 0.67 },
      bottom: { x: 0.5, y: 0.78 },
      on_seam: { x: 0.5, y: 0.38 },
    };
    if (anchors[placement]) {
      updateCaptionPos(anchors[placement]);
    }
  };

  return (
    <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-3 shadow-xl select-none overflow-y-auto">
      {/* Target Aspect Format */}
      <div>
        <span className="text-[#8B90A0] font-bold uppercase tracking-wider text-[10px] block mb-1">
          Target Format
        </span>
        <div className="grid grid-cols-4 gap-1">
          {formats.map((f) => {
            const isSelected = (edl?.export?.format || '9:16') === f.id;
            return (
              <button
                key={f.id}
                onClick={() => updateEDL((prev) => ({ ...prev, export: { ...prev.export, format: f.id } }))}
                className={`py-1 rounded-lg font-bold text-xs flex items-center justify-center gap-0.5 transition-all ${
                  isSelected
                    ? 'bg-[#1A1D24] border border-[#8FD3FF] text-white shadow-sm'
                    : 'bg-[#1A1D24]/60 border border-white/[0.04] text-[#8B90A0] hover:text-white'
                }`}
              >
                <span>{f.label}</span>
                {isSelected && <Check size={10} className="text-[#8FD3FF]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subtitle Placement Section (Direct Manipulation & Quick Anchors) */}
      <div className="pt-2 border-t border-white/[0.06] flex flex-col gap-2">
        <span className="text-[#8B90A0] font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
          <Sliders size={12} className="text-[#8FD3FF]" /> Caption Placement
        </span>

        {/* Quick Placement Buttons */}
        <div className="grid grid-cols-3 gap-1">
          {[
            { id: 'top', label: 'Top' },
            { id: 'upper_third', label: 'Upper 1/3' },
            { id: 'on_seam', label: 'On Seam' },
            { id: 'middle', label: 'Middle' },
            { id: 'lower_third', label: 'Lower 1/3' },
            { id: 'bottom', label: 'Bottom' },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => handleQuickPlace(btn.id)}
              className="py-1 px-1 bg-[#1A1D24] hover:bg-[#1A1D24]/80 border border-white/[0.06] rounded-lg text-[10px] font-bold text-[#8FD3FF] hover:text-white transition-all text-center"
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Numeric Placement Offsets */}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <div>
            <label className="text-[9px] text-[#8B90A0] block">Y Offset (%)</label>
            <input
              type="number"
              min="5"
              max="95"
              value={Math.round(captionsPos.y * 100)}
              onChange={(e) => updateCaptionPos({ y: Number(e.target.value) / 100 })}
              className="w-full bg-[#1A1D24] border border-white/[0.06] rounded-lg p-1 text-xs text-white font-mono"
            />
          </div>
          <div>
            <label className="text-[9px] text-[#8B90A0] block">X Offset (%)</label>
            <input
              type="number"
              min="5"
              max="95"
              value={Math.round(captionsPos.x * 100)}
              onChange={(e) => updateCaptionPos({ x: Number(e.target.value) / 100 })}
              className="w-full bg-[#1A1D24] border border-white/[0.06] rounded-lg p-1 text-xs text-white font-mono"
            />
          </div>
          <div>
            <label className="text-[9px] text-[#8B90A0] block">Max W (%)</label>
            <input
              type="number"
              min="30"
              max="100"
              value={Math.round((captionsPos.max_width || 0.85) * 100)}
              onChange={(e) => updateCaptionPos({ max_width: Number(e.target.value) / 100 })}
              className="w-full bg-[#1A1D24] border border-white/[0.06] rounded-lg p-1 text-xs text-white font-mono"
            />
          </div>
        </div>

        {/* Words Per Line */}
        <div className="pt-1">
          <div className="flex items-center justify-between text-[10px] text-[#8B90A0] mb-1">
            <span>Words Per Line</span>
            <span className="font-mono text-white font-bold">{edl?.captions?.words_per_line || 3}</span>
          </div>
          <input
            type="range"
            min="1"
            max="6"
            value={edl?.captions?.words_per_line || 3}
            onChange={(e) => updateEDL((prev) => ({
              ...prev,
              captions: { ...prev.captions, words_per_line: Number(e.target.value) }
            }))}
            className="w-full h-1 accent-[#8FD3FF] cursor-pointer"
          />
        </div>
      </div>

      {/* Caption Typography & Style */}
      <div className="pt-2 border-t border-white/[0.06] flex flex-col gap-2.5">
        <span className="text-[#8B90A0] font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
          <Type size={12} className="text-[#8FD3FF]" /> Caption Typography
        </span>

        <div>
          <label className="text-[10px] text-[#8B90A0] block mb-1">Font Family</label>
          <select
            value={edl?.captions?.font || 'Montserrat ExtraBold'}
            onChange={(e) => updateEDL((prev) => ({ ...prev, captions: { ...prev.captions, font: e.target.value } }))}
            className="w-full bg-[#1A1D24] border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#8FD3FF]"
          >
            <option value="Montserrat ExtraBold">Montserrat ExtraBold</option>
            <option value="TheBoldFont">TheBoldFont</option>
            <option value="Anton">Anton</option>
            <option value="Bangers">Bangers</option>
            <option value="Poppins Black">Poppins Black</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[#8B90A0] block mb-1">Primary Color</label>
            <div className="flex items-center gap-1.5 bg-[#1A1D24] p-1.5 rounded-lg border border-white/[0.06]">
              <input
                type="color"
                value={edl?.captions?.color || '#FFFFFF'}
                onChange={(e) => updateEDL((prev) => ({ ...prev, captions: { ...prev.captions, color: e.target.value } }))}
                className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
              />
              <span className="text-[10px] font-mono uppercase text-slate-300">{edl?.captions?.color || '#FFFFFF'}</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#8B90A0] block mb-1">Highlight Word</label>
            <div className="flex items-center gap-1.5 bg-[#1A1D24] p-1.5 rounded-lg border border-white/[0.06]">
              <input
                type="color"
                value={edl?.captions?.highlight || '#FACC15'}
                onChange={(e) => updateEDL((prev) => ({ ...prev, captions: { ...prev.captions, highlight: e.target.value } }))}
                className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
              />
              <span className="text-[10px] font-mono uppercase text-slate-300">{edl?.captions?.highlight || '#FACC15'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
