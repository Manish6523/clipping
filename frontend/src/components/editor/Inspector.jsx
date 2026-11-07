import React, { useState } from 'react';
import { 
  Check, 
  Type, 
  Sliders, 
  Layers, 
  Clock, 
  Volume2, 
  Sparkles, 
  Scissors, 
  Trash2, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  ChevronDown, 
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export default function Inspector() {
  const { 
    clip, 
    edl, 
    duration, 
    sourceInfo,
    extending, 
    selection, 
    setSelection,
    updateEDL, 
    updateCaptionPos, 
    updateCaptionStyle, 
    changeClipBounds, 
    splitSegmentAtPlayhead, 
    deleteSegment, 
    toggleWordDeleted,
    editWordText,
    transcribeClip
  } = useEditorStore();

  const [advancedOpen, setAdvancedOpen] = useState(false);

  // If no specific selection, render Clip Overview
  if (!selection || selection.type === 'none') {
    return <ClipOverviewSection />;
  }

  if (selection.type === 'layer') {
    return <LayerInspectorSection layerId={selection.id} advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} />;
  }

  if (selection.type === 'caption') {
    return <CaptionInspectorSection advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} />;
  }

  if (selection.type === 'word') {
    return <WordInspectorSection wordId={selection.id} />;
  }

  if (selection.type === 'segment') {
    return <SegmentInspectorSection segmentId={selection.id} />;
  }

  return <ClipOverviewSection />;
}

// -------------------------------------------------------------
// 1. Clip Overview (selection.type === 'none')
// -------------------------------------------------------------
function ClipOverviewSection() {
  const { clip, edl, duration, sourceInfo, extending, changeClipBounds, transcribeClip } = useEditorStore();

  const formats = ['9:16', '3:4', '1:1', '4:3'];
  const curStart = clip?.adjusted_start ?? edl?.source?.start ?? 0;
  const curEnd = clip?.adjusted_end ?? edl?.source?.end ?? (curStart + duration);
  const maxAvailable = sourceInfo?.available_end ?? 60.0;

  const handleSetDuration = (targetSec) => {
    const desiredSec = Math.max(3, targetSec);
    let newEnd = curStart + desiredSec;
    let newStart = curStart;
    if (newEnd > maxAvailable) {
      newEnd = maxAvailable;
      newStart = Math.max(0, newEnd - desiredSec);
    }
    changeClipBounds(Math.round(newStart * 10) / 10, Math.round(newEnd * 10) / 10);
  };

  const handleAdjustStart = (delta) => {
    const s = Math.max(0, Math.min(curEnd - 3.0, curStart + delta));
    changeClipBounds(Math.round(s * 10) / 10, curEnd);
  };

  const handleAdjustEnd = (delta) => {
    const e = Math.max(curStart + 3.0, Math.min(maxAvailable, curEnd + delta));
    changeClipBounds(curStart, Math.round(e * 10) / 10);
  };

  return (
    <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-3 shadow-xl select-none overflow-y-auto">
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Clock size={12} className="text-[#8FD3FF]" /> Clip Overview
        </span>
        <span className="text-[11px] font-mono text-[#8FD3FF] font-bold">
          {duration.toFixed(1)}s
        </span>
      </div>

      {/* Target Aspect Format */}
      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Target Format</label>
        <div className="grid grid-cols-4 gap-1">
          {formats.map((fmt) => {
            const isSelected = (edl?.export?.format || '9:16') === fmt;
            return (
              <button
                key={fmt}
                className={`py-1 rounded-lg font-bold text-xs flex items-center justify-center transition-all ${
                  isSelected
                    ? 'bg-[#1A1D24] border border-[#8FD3FF] text-white'
                    : 'bg-[#1A1D24]/60 border border-white/[0.04] text-[#8B90A0] hover:text-white'
                }`}
              >
                {fmt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Clip Length / Boundaries Adjustment */}
      <div className="pt-2 border-t border-white/[0.06] flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[9px] font-bold uppercase text-[#8B90A0]">Clip Boundaries</label>
          {extending && <span className="text-[10px] text-amber-400 font-mono animate-pulse">Updating...</span>}
        </div>

        {/* Start Trim Row */}
        <div className="bg-[#1A1D24] p-1.5 rounded-lg border border-white/[0.06] flex items-center justify-between text-xs">
          <div>
            <span className="text-[9px] text-slate-400 block uppercase">In Point</span>
            <span className="font-mono font-bold text-white">{curStart.toFixed(1)}s</span>
          </div>
          <div className="flex items-center gap-1">
            {[-1.0, -0.1, 0.1, 1.0].map((d) => (
              <button
                key={d}
                onClick={() => handleAdjustStart(d)}
                className="px-1.5 py-0.5 bg-white/5 hover:bg-white/10 text-[10px] font-mono rounded text-slate-300 hover:text-white"
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
        </div>

        {/* End Trim Row */}
        <div className="bg-[#1A1D24] p-1.5 rounded-lg border border-white/[0.06] flex items-center justify-between text-xs">
          <div>
            <span className="text-[9px] text-slate-400 block uppercase">Out Point</span>
            <span className="font-mono font-bold text-white">{curEnd.toFixed(1)}s</span>
          </div>
          <div className="flex items-center gap-1">
            {[-1.0, -0.1, 0.1, 1.0].map((d) => (
              <button
                key={d}
                onClick={() => handleAdjustEnd(d)}
                className="px-1.5 py-0.5 bg-white/5 hover:bg-white/10 text-[10px] font-mono rounded text-slate-300 hover:text-white"
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Length Chips */}
        <div>
          <label className="text-[9px] text-slate-400 block mb-1">Quick Target Length</label>
          <div className="grid grid-cols-4 gap-1">
            {[15, 30, 45, 60].map((sec) => (
              <button
                key={sec}
                onClick={() => handleSetDuration(sec)}
                className={`py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                  Math.round(duration) === sec
                    ? 'bg-[#8FD3FF]/20 border border-[#8FD3FF] text-[#8FD3FF]'
                    : 'bg-[#1A1D24] border border-white/5 text-slate-400 hover:text-white'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transcription Status */}
      <div className="pt-2 border-t border-white/[0.06] flex flex-col gap-2">
        <label className="text-[9px] font-bold uppercase text-[#8B90A0]">Transcription</label>
        <button
          onClick={transcribeClip}
          className="w-full py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-[#8FD3FF] flex items-center justify-center gap-1.5"
        >
          <Sparkles size={12} className="text-amber-400" /> Transcribe / Re-align Words
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 2. Layer Inspector (selection.type === 'layer')
// -------------------------------------------------------------
function LayerInspectorSection({ layerId, advancedOpen, setAdvancedOpen }) {
  const { edl, updateEDL, setSelection } = useEditorStore();
  const layers = edl?.layout?.layers || [];
  const layer = layers.find((l) => l.id === layerId);

  if (!layer) {
    return (
      <div className="w-full h-full bg-[#13151A] rounded-2xl p-4 flex flex-col items-center justify-center text-slate-500 text-xs">
        Frame not found
      </div>
    );
  }

  const updateSelectedLayer = (partial) => {
    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layers: (prev.layout?.layers || []).map((l) => (l.id === layerId ? { ...l, ...partial } : l)),
      },
    }));
  };

  return (
    <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-3 shadow-xl select-none overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span style={{ backgroundColor: layer.color || '#00F0FF' }} className="w-3 h-3 rounded-full" />
          <span className="text-xs font-bold text-white truncate max-w-[130px]">{layer.name}</span>
        </div>
        <button
          onClick={() => setSelection({ type: 'none', id: null })}
          className="text-[10px] text-slate-400 hover:text-white"
        >
          Done
        </button>
      </div>

      {/* Rename */}
      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Frame Name</label>
        <input
          type="text"
          value={layer.name}
          onChange={(e) => updateSelectedLayer({ name: e.target.value })}
          className="w-full bg-[#1A1D24] border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#8FD3FF]"
        />
      </div>

      {/* Fit Mode */}
      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Fit Mode</label>
        <select
          value={layer.fit || 'cover'}
          onChange={(e) => updateSelectedLayer({ fit: e.target.value })}
          className="w-full bg-[#1A1D24] border border-white/10 rounded-lg p-1.5 text-xs text-white focus:outline-none"
        >
          <option value="cover">Cover (Fill slot, crop overflow)</option>
          <option value="contain">Contain (Letterbox inside slot)</option>
          <option value="stretch">Stretch (Fill slot directly)</option>
        </select>
      </div>

      {/* Shape / Radius */}
      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Corner Shape</label>
        <select
          value={layer.style?.shape || 'rect'}
          onChange={(e) => updateSelectedLayer({ style: { ...layer.style, shape: e.target.value } })}
          className="w-full bg-[#1A1D24] border border-white/10 rounded-lg p-1.5 text-xs text-white focus:outline-none"
        >
          <option value="rect">Rectangle</option>
          <option value="circle">Circle / Bubble</option>
        </select>
      </div>

      {/* Opacity Slider */}
      <div>
        <div className="flex items-center justify-between text-[9px] font-bold uppercase text-[#8B90A0] mb-1">
          <span>Opacity</span>
          <span className="font-mono text-white">{Math.round((layer.style?.opacity ?? 1.0) * 100)}%</span>
        </div>
        <input
          type="range"
          min="10"
          max="100"
          value={Math.round((layer.style?.opacity ?? 1.0) * 100)}
          onChange={(e) => updateSelectedLayer({
            style: { ...layer.style, opacity: Number(e.target.value) / 100 }
          })}
          className="w-full h-1 accent-[#8FD3FF] cursor-pointer"
        />
      </div>

      {/* Advanced Accordion (Border & Shadow) */}
      <div className="pt-2 border-t border-white/[0.06]">
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="w-full flex items-center justify-between text-[10px] font-bold uppercase text-slate-400 hover:text-white"
        >
          <span>Advanced Styling</span>
          {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {advancedOpen && (
          <div className="flex flex-col gap-2.5 pt-2">
            <div>
              <label className="text-[9px] text-slate-400 block mb-1">Border Width ({layer.style?.border?.w || 0}px)</label>
              <input
                type="range"
                min="0"
                max="12"
                value={layer.style?.border?.w || 0}
                onChange={(e) => updateSelectedLayer({
                  style: { ...layer.style, border: { ...layer.style?.border, w: Number(e.target.value) } }
                })}
                className="w-full h-1 accent-[#8FD3FF]"
              />
            </div>

            <div>
              <label className="text-[9px] text-slate-400 block mb-1">Shadow Blur ({layer.style?.shadow?.blur || 0}px)</label>
              <input
                type="range"
                min="0"
                max="30"
                value={layer.style?.shadow?.blur || 0}
                onChange={(e) => updateSelectedLayer({
                  style: { ...layer.style, shadow: { ...layer.style?.shadow, blur: Number(e.target.value) } }
                })}
                className="w-full h-1 accent-[#8FD3FF]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. Caption Inspector (selection.type === 'caption')
// -------------------------------------------------------------
function CaptionInspectorSection({ advancedOpen, setAdvancedOpen }) {
  const { edl, updateCaptionPos, updateCaptionStyle } = useEditorStore();
  const captions = edl?.captions || {};
  const captionsPos = captions.position || { x: 0.5, y: 0.76, max_width: 0.85 };

  const handleQuickPlace = (placement) => {
    const anchors = {
      top: { x: 0.5, y: 0.15 },
      upper_third: { x: 0.5, y: 0.33 },
      middle: { x: 0.5, y: 0.50 },
      lower_third: { x: 0.5, y: 0.67 },
      bottom: { x: 0.5, y: 0.82 },
      on_seam: { x: 0.5, y: 0.38 },
    };
    if (anchors[placement]) updateCaptionPos(anchors[placement]);
  };

  return (
    <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-3 shadow-xl select-none overflow-y-auto">
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Type size={12} className="text-[#8FD3FF]" /> Caption Customizer
        </span>
        <span className="text-[10px] font-mono text-[#8FD3FF] font-bold">Live Sync</span>
      </div>

      {/* Quick Placement Anchors */}
      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Position Presets</label>
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
      </div>

      {/* Words Per Line */}
      <div>
        <div className="flex items-center justify-between text-[9px] font-bold uppercase text-[#8B90A0] mb-1">
          <span>Words Per Line</span>
          <span className="font-mono text-white">{captions.words_per_line || 3}</span>
        </div>
        <input
          type="range"
          min="1"
          max="5"
          value={captions.words_per_line || 3}
          onChange={(e) => updateCaptionStyle({ words_per_line: Number(e.target.value) })}
          className="w-full h-1 accent-[#8FD3FF] cursor-pointer"
        />
      </div>

      {/* Animation Style */}
      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Word Animation</label>
        <select
          value={captions.animation || 'pop'}
          onChange={(e) => updateCaptionStyle({ animation: e.target.value })}
          className="w-full bg-[#1A1D24] border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
        >
          <option value="pop">Pop Scale (Punchy)</option>
          <option value="bounce">Bounce Jump</option>
          <option value="fade">Fade In</option>
          <option value="none">Static (No Animation)</option>
        </select>
      </div>

      {/* Typography Font Family */}
      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Font Family</label>
        <select
          value={captions.font || 'Montserrat ExtraBold'}
          onChange={(e) => updateCaptionStyle({ font: e.target.value })}
          className="w-full bg-[#1A1D24] border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
        >
          <option value="Montserrat ExtraBold">Montserrat ExtraBold</option>
          <option value="TheBoldFont">TheBoldFont</option>
          <option value="Anton">Anton</option>
          <option value="Bangers">Bangers</option>
          <option value="Poppins Black">Poppins Black</option>
        </select>
      </div>

      {/* Colors: Primary & Active Highlight */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-[#8B90A0] block mb-1">Base Color</label>
          <div className="flex items-center gap-1.5 bg-[#1A1D24] p-1 rounded-lg border border-white/[0.06]">
            <input
              type="color"
              value={captions.color || '#FFFFFF'}
              onChange={(e) => updateCaptionStyle({ color: e.target.value })}
              className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
            />
            <span className="text-[9px] font-mono uppercase text-slate-300">{captions.color || '#FFFFFF'}</span>
          </div>
        </div>
        <div>
          <label className="text-[9px] text-[#8B90A0] block mb-1">Active Word</label>
          <div className="flex items-center gap-1.5 bg-[#1A1D24] p-1 rounded-lg border border-white/[0.06]">
            <input
              type="color"
              value={captions.highlight || '#FACC15'}
              onChange={(e) => updateCaptionStyle({ highlight: e.target.value })}
              className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
            />
            <span className="text-[9px] font-mono uppercase text-slate-300">{captions.highlight || '#FACC15'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 4. Word Inspector (selection.type === 'word')
// -------------------------------------------------------------
function WordInspectorSection({ wordId }) {
  const { edl, updateEDL, toggleWordDeleted, editWordText } = useEditorStore();
  const words = edl?.words || [];
  const wordIdx = words.findIndex((w, idx) => (w.id === wordId) || (w.start === wordId) || (idx === wordId));
  const wordItem = words[wordIdx];

  if (!wordItem) {
    return (
      <div className="w-full h-full bg-[#13151A] rounded-2xl p-4 flex flex-col items-center justify-center text-slate-500 text-xs">
        Word not found
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-3 shadow-xl select-none overflow-y-auto">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Word Inspector</span>
        <span className="text-[10px] font-mono text-[#8FD3FF]">{wordItem.start.toFixed(2)}s - {wordItem.end.toFixed(2)}s</span>
      </div>

      <div>
        <label className="text-[9px] font-bold uppercase text-[#8B90A0] block mb-1">Spoken Text</label>
        <input
          type="text"
          value={wordItem.word || wordItem.text || ''}
          onChange={(e) => editWordText(wordId, e.target.value)}
          className="w-full bg-[#1A1D24] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
        />
      </div>

      <div className="pt-2">
        <button
          onClick={() => toggleWordDeleted(wordId)}
          className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all ${
            wordItem.deleted
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
          }`}
        >
          {wordItem.deleted ? 'Restore Word' : 'Cut / Jump-Cut Word'}
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 5. Segment Inspector (selection.type === 'segment')
// -------------------------------------------------------------
function SegmentInspectorSection({ segmentId }) {
  const { edl, deleteSegment } = useEditorStore();
  const segments = edl?.segments || [];
  const seg = segments.find((s) => s.id === segmentId);

  if (!seg) {
    return (
      <div className="w-full h-full bg-[#13151A] rounded-2xl p-4 flex flex-col items-center justify-center text-slate-500 text-xs">
        Segment not found
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-3 shadow-xl select-none overflow-y-auto">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Segment Inspector</span>
        <span className="text-[10px] font-mono text-[#8FD3FF] font-bold">{(seg.src_out - seg.src_in).toFixed(1)}s</span>
      </div>

      <div className="text-xs text-slate-400 font-mono">
        <div>In: {seg.src_in.toFixed(2)}s</div>
        <div>Out: {seg.src_out.toFixed(2)}s</div>
      </div>

      <button
        onClick={() => deleteSegment(segmentId)}
        className="w-full py-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 rounded-lg text-xs font-bold"
      >
        Ripple Delete Segment
      </button>
    </div>
  );
}
