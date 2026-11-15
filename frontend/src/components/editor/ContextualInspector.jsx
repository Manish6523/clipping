import React, { useState } from 'react';
import { 
  Sliders, 
  Type, 
  ShieldCheck, 
  Sparkles, 
  Palette, 
  Layers, 
  LayoutTemplate,
  Lock, 
  Unlock,
  Eye,
  EyeOff,
  Upload,
  Trash2,
  Check,
  CheckCircle2,
  RefreshCw,
  Info
} from 'lucide-react';
import { useTemplateEditorStore } from '../../store/templateEditorStore';
import { hexToAss, assToHex } from '../../utils/colorConversions';
import { CAPTION_PRESET_STYLES } from '../../lib/captionStyles';
import { HOOK_PRESET_STYLES } from '../../lib/hookStyles';

export default function ContextualInspector({ channels = [] }) {
  const { 
    selection, 
    layout, 
    updateLayer, 
    subtitles, 
    updateSubtitles, 
    watermark, 
    updateWatermark, 
    updateBackground,
    templateName, 
    setTemplateName, 
    description, 
    setDescription,
    sampleText,
    setSampleText,
    defaultCaptionStyle,
    defaultHookStyle
  } = useTemplateEditorStore();

  const selectedLayer = selection.type === 'layer' 
    ? (layout.layers || []).find((l) => l.id === selection.id) 
    : null;

  // 1. LAYER INSPECTOR
  if (selection.type === 'layer' && selectedLayer) {
    const src = selectedLayer.src || { x: 0, y: 0, w: 1, h: 1 };
    const dst = selectedLayer.dst || { x: 0, y: 0, w: 1, h: 1 };
    const style = selectedLayer.style || {};

    return (
      <div className="w-full h-full flex flex-col bg-surface overflow-y-auto p-3 text-xs gap-4 custom-scrollbar select-none">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedLayer.color }} />
            <h3 className="font-extrabold text-white text-sm truncate">{selectedLayer.name}</h3>
          </div>
          <button
            onClick={() => updateLayer(selectedLayer.id, { aspect_lock: !selectedLayer.aspect_lock })}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border transition-all ${
              selectedLayer.aspect_lock
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            {selectedLayer.aspect_lock ? <Lock size={10} /> : <Unlock size={10} />}
            <span>Aspect Lock</span>
          </button>
        </div>

        {/* Fit Mode */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted">Fit Mode</label>
          <div className="grid grid-cols-3 gap-1 bg-raised p-1 rounded-xl border border-white/5">
            {['cover', 'contain', 'stretch'].map((mode) => (
              <button
                key={mode}
                onClick={() => updateLayer(selectedLayer.id, { fit: mode })}
                className={`py-1 rounded-lg font-bold text-xs capitalize transition-all ${
                  (selectedLayer.fit || 'cover') === mode
                    ? 'bg-accent text-black shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* Output Placement (dst) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted">9:16 Canvas Placement</label>
          <div className="grid grid-cols-2 gap-2 bg-raised p-2 rounded-xl border border-white/5">
            <div>
              <span className="text-[10px] text-slate-400">Y Offset</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={Number(dst.y).toFixed(2)}
                onChange={(e) => updateLayer(selectedLayer.id, { dst: { ...dst, y: parseFloat(e.target.value) || 0 } })}
                className="w-full bg-surface border border-white/10 rounded px-1.5 py-0.5 font-mono text-white text-xs mt-0.5"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Height</span>
              <input
                type="number"
                step="0.01"
                min="0.05"
                max="1"
                value={Number(dst.h).toFixed(2)}
                onChange={(e) => updateLayer(selectedLayer.id, { dst: { ...dst, h: parseFloat(e.target.value) || 0.1 } })}
                className="w-full bg-surface border border-white/10 rounded px-1.5 py-0.5 font-mono text-white text-xs mt-0.5"
              />
            </div>
          </div>
        </div>

        {/* Source Crop (src) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted">16:9 Source Crop</label>
          <div className="grid grid-cols-2 gap-2 bg-raised p-2 rounded-xl border border-white/5">
            <div>
              <span className="text-[10px] text-slate-400">X Center</span>
              <input
                type="number"
                step="0.01"
                value={Number(src.x).toFixed(2)}
                onChange={(e) => updateLayer(selectedLayer.id, { src: { ...src, x: parseFloat(e.target.value) || 0 } })}
                className="w-full bg-surface border border-white/10 rounded px-1.5 py-0.5 font-mono text-white text-xs mt-0.5"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Width</span>
              <input
                type="number"
                step="0.01"
                value={Number(src.w).toFixed(2)}
                onChange={(e) => updateLayer(selectedLayer.id, { src: { ...src, w: parseFloat(e.target.value) || 0.1 } })}
                className="w-full bg-surface border border-white/10 rounded px-1.5 py-0.5 font-mono text-white text-xs mt-0.5"
              />
            </div>
          </div>
        </div>

        {/* Shape & Corner Radius */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted">Layer Style & Shape</label>
          <div className="flex items-center gap-2 bg-raised p-2 rounded-xl border border-white/5">
            <button
              onClick={() => updateLayer(selectedLayer.id, { style: { ...style, shape: style.shape === 'circle' ? 'rect' : 'circle' } })}
              className={`flex-1 py-1 px-2 rounded-lg font-bold text-xs border ${
                style.shape === 'circle'
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-white/5 border-white/10 text-slate-300'
              }`}
            >
              {style.shape === 'circle' ? 'Circle (Avatar)' : 'Rectangle'}
            </button>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-[10px] text-slate-400">Radius:</span>
              <input
                type="range"
                min="0"
                max="50"
                value={style.radius || 0}
                onChange={(e) => updateLayer(selectedLayer.id, { style: { ...style, radius: parseInt(e.target.value, 10) } })}
                className="flex-1 accent-accent cursor-pointer"
              />
              <span className="font-mono text-slate-300 text-[10px] w-6">{style.radius || 0}px</span>
            </div>
          </div>
        </div>

        {/* Mirror Horizontal */}
        <div className="flex items-center justify-between bg-raised p-2.5 rounded-xl border border-white/5">
          <span className="text-xs font-bold text-slate-300">Flip / Mirror Horizontal</span>
          <button
            onClick={() => updateLayer(selectedLayer.id, { style: { ...style, mirror: !style.mirror } })}
            className={`px-3 py-1 rounded-lg font-bold text-xs border transition-all ${
              style.mirror
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            {style.mirror ? 'Mirrored (ON)' : 'Off'}
          </button>
        </div>
      </div>
    );
  }

  // 2. CAPTIONS & SUBTITLES INSPECTOR
  if (selection.type === 'captions') {
    const primaryHex = assToHex(subtitles.primary_color).hex;
    const highlightHex = assToHex(subtitles.highlight_color).hex;
    const outlineHex = assToHex(subtitles.outline_color).hex;

    return (
      <div className="w-full h-full flex flex-col bg-surface overflow-y-auto p-3 text-xs gap-4 custom-scrollbar select-none">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
          <div className="flex items-center gap-2 text-yellow-400">
            <Type size={16} />
            <h3 className="font-extrabold text-white text-sm">Karaoke Captions</h3>
          </div>
          <span className="text-[10px] font-mono text-muted">ASS Subtitle Engine</span>
        </div>

        {/* Inline Curated Caption Styles Strip */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted flex items-center justify-between">
            <span>Curated Creator Styles</span>
            <span className="text-[10px] font-mono text-accent">Click to Apply</span>
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {CAPTION_PRESET_STYLES.slice(0, 8).map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  updateSubtitles({
                    font_name: preset.font_name || preset.family?.replace(/['"]/g, '') || subtitles.font_name,
                    font_size: preset.size || subtitles.font_size,
                    primary_color: hexToAss(preset.color || '#FFFFFF'),
                    highlight_color: hexToAss(preset.highlight || '#FACC15'),
                    outline_color: hexToAss(preset.outline || '#000000'),
                    outline: preset.outlineWidth ?? subtitles.outline,
                    shadow: preset.shadow ?? subtitles.shadow,
                    animation: preset.anim || subtitles.animation,
                    uppercase: preset.upper !== false,
                  });
                }}
                className="shrink-0 p-2 rounded-xl bg-raised hover:bg-white/[0.08] border border-white/10 text-left w-28 flex flex-col justify-between transition-all"
              >
                <div className="text-[11px] font-black truncate text-white">{preset.name}</div>
                <div className="text-[9px] text-muted truncate mt-1">{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Sample Text Field */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase font-bold text-muted">Preview Sample Text</label>
          <input
            type="text"
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            placeholder="Sample text..."
            className="w-full bg-raised border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-accent"
          />
        </div>

        {/* Typography Controls */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-400">Font</label>
            <select
              value={subtitles.font_name}
              onChange={(e) => updateSubtitles({ font_name: e.target.value })}
              className="bg-raised border border-white/10 rounded-xl px-2 py-1 text-xs text-white"
            >
              <option value="Montserrat">Montserrat</option>
              <option value="Anton">Anton (Bold)</option>
              <option value="Bangers">Bangers (Comic)</option>
              <option value="Poppins">Poppins</option>
              <option value="Inter">Inter</option>
              <option value="Oswald">Oswald</option>
              <option value="Russo One">Russo One</option>
              <option value="Permanent Marker">Marker</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-400">Size ({subtitles.font_size}px)</label>
            <input
              type="range"
              min="30"
              max="140"
              value={subtitles.font_size}
              onChange={(e) => updateSubtitles({ font_size: parseInt(e.target.value, 10) })}
              className="accent-accent cursor-pointer mt-1.5"
            />
          </div>
        </div>

        {/* Colors & Palette */}
        <div className="grid grid-cols-3 gap-2 bg-raised p-2 rounded-xl border border-white/5">
          <div className="flex flex-col gap-1 items-center">
            <span className="text-[10px] text-slate-400">Primary</span>
            <input
              type="color"
              value={primaryHex}
              onChange={(e) => updateSubtitles({ primary_color: hexToAss(e.target.value) })}
              className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
            />
          </div>
          <div className="flex flex-col gap-1 items-center">
            <span className="text-[10px] text-slate-400">Highlight</span>
            <input
              type="color"
              value={highlightHex}
              onChange={(e) => updateSubtitles({ highlight_color: hexToAss(e.target.value) })}
              className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
            />
          </div>
          <div className="flex flex-col gap-1 items-center">
            <span className="text-[10px] text-slate-400">Outline</span>
            <input
              type="color"
              value={outlineHex}
              onChange={(e) => updateSubtitles({ outline_color: hexToAss(e.target.value) })}
              className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
            />
          </div>
        </div>

        {/* Position Y & Quick Anchors */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted flex justify-between">
            <span>Vertical Placement</span>
            <span className="font-mono text-accent">{Math.round((subtitles.position?.y || 0.76) * 100)}%</span>
          </label>
          <input
            type="range"
            min="10"
            max="90"
            value={Math.round((subtitles.position?.y || 0.76) * 100)}
            onChange={(e) => updateSubtitles({ position: { ...subtitles.position, y: parseInt(e.target.value, 10) / 100 } })}
            className="accent-accent cursor-pointer"
          />
          <div className="grid grid-cols-4 gap-1 mt-1">
            {[
              { label: 'Top', y: 0.18 },
              { label: 'Middle', y: 0.50 },
              { label: 'Lower 3rd', y: 0.76 },
              { label: 'Bottom', y: 0.88 },
            ].map((anchor) => (
              <button
                key={anchor.label}
                onClick={() => updateSubtitles({ position: { ...subtitles.position, y: anchor.y } })}
                className="py-1 rounded bg-raised hover:bg-white/10 text-[10px] font-bold text-slate-300"
              >
                {anchor.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 3. HOOK TITLE CARD INSPECTOR
  if (selection.type === 'hook') {
    return (
      <div className="w-full h-full flex flex-col bg-surface overflow-y-auto p-3 text-xs gap-4 custom-scrollbar select-none">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
          <div className="flex items-center gap-2 text-pink-400">
            <Sparkles size={16} />
            <h3 className="font-extrabold text-white text-sm">Hook Title Card</h3>
          </div>
          <span className="text-[10px] font-mono text-muted">First 1.5s Intro</span>
        </div>

        <p className="text-muted text-[11px]">
          Animated title card stamped during the first 1.5 seconds of each short to boost retention.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {HOOK_PRESET_STYLES.map((hook) => (
            <button
              key={hook.id}
              onClick={() => {
                useTemplateEditorStore.setState({ defaultHookStyle: hook.id, isDirty: true });
              }}
              className={`p-3 rounded-xl border text-left transition-all ${
                defaultHookStyle === hook.id
                  ? 'bg-pink-500/15 border-pink-400 text-pink-200 font-bold'
                  : 'bg-raised border-white/5 text-slate-300 hover:text-white'
              }`}
            >
              <div className="text-xs font-bold">{hook.name}</div>
              <div className="text-[10px] text-muted truncate mt-0.5">{hook.anim} anim</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 4. WATERMARK INSPECTOR
  if (selection.type === 'watermark') {
    return (
      <div className="w-full h-full flex flex-col bg-surface overflow-y-auto p-3 text-xs gap-4 custom-scrollbar select-none">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
          <div className="flex items-center gap-2 text-emerald-400">
            <ShieldCheck size={16} />
            <h3 className="font-extrabold text-white text-sm">Watermark & Logo</h3>
          </div>
          <button
            onClick={() => updateWatermark({ enabled: !watermark.enabled })}
            className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${
              watermark.enabled
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            {watermark.enabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Upload Dropzone */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted">Logo Image (PNG)</label>
          <div className="border border-dashed border-white/15 rounded-xl p-3 flex flex-col items-center justify-center gap-2 bg-raised/40">
            {watermark.url || watermark.path ? (
              <div className="flex items-center gap-2.5 w-full">
                <div className="w-12 h-12 rounded bg-black/60 p-1 shrink-0 flex items-center justify-center">
                  <img src={watermark.url} alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-emerald-400 truncate">{watermark.path || 'logo.png'}</div>
                  <div className="text-[10px] text-slate-400">Ready for compositing</div>
                </div>
                <button
                  onClick={() => updateWatermark({ enabled: false, path: '', url: '' })}
                  className="p-1 rounded text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <div className="text-center text-muted text-[11px]">No watermark uploaded</div>
            )}
          </div>
        </div>

        {/* Opacity & Width */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-bold text-slate-300">Opacity</span>
            <span className="font-mono text-emerald-400 text-xs">{Math.round(watermark.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={watermark.opacity}
            onChange={(e) => updateWatermark({ opacity: parseFloat(e.target.value) })}
            className="accent-emerald-500 cursor-pointer"
          />

          <div className="flex justify-between items-center mt-2">
            <span className="text-[11px] font-bold text-slate-300">Logo Width</span>
            <span className="font-mono text-emerald-400 text-xs">{watermark.width}px</span>
          </div>
          <input
            type="range"
            min="60"
            max="600"
            step="10"
            value={watermark.width}
            onChange={(e) => updateWatermark({ width: parseInt(e.target.value, 10) })}
            className="accent-emerald-500 cursor-pointer"
          />
        </div>

        {/* Quick Position Anchors */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase font-bold text-muted">Quick Anchors</label>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { id: 'top_left', label: 'Top-L' },
              { id: 'top_center', label: 'Top-C' },
              { id: 'top_right', label: 'Top-R' },
              { id: 'bottom_left', label: 'Bot-L' },
              { id: 'bottom_center', label: 'Bot-C' },
              { id: 'bottom_right', label: 'Bot-R' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => updateWatermark({ position: p.id, x: null, y: null })}
                className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  watermark.position === p.id && watermark.x === null
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'bg-raised border-white/5 text-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 5. BACKGROUND INSPECTOR
  if (selection.type === 'background') {
    const bg = layout.background || { type: 'solid', color: '#000000', blur: 35, dim: 0.35 };

    return (
      <div className="w-full h-full flex flex-col bg-surface overflow-y-auto p-3 text-xs gap-4 custom-scrollbar select-none">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
          <div className="flex items-center gap-2 text-cyan-400">
            <Palette size={16} />
            <h3 className="font-extrabold text-white text-sm">Canvas Background</h3>
          </div>
          <span className="text-[10px] font-mono text-muted">Base Layer</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 bg-raised p-1 rounded-xl border border-white/5">
          <button
            onClick={() => updateBackground({ type: 'solid' })}
            className={`py-1.5 rounded-lg font-bold text-xs ${bg.type === 'solid' ? 'bg-accent text-black shadow' : 'text-slate-300'}`}
          >
            Solid Color
          </button>
          <button
            onClick={() => updateBackground({ type: 'blur' })}
            className={`py-1.5 rounded-lg font-bold text-xs ${bg.type === 'blur' ? 'bg-accent text-black shadow' : 'text-slate-300'}`}
          >
            Blurred Video
          </button>
        </div>

        {bg.type === 'solid' ? (
          <div className="flex items-center justify-between bg-raised p-2.5 rounded-xl border border-white/5">
            <span className="text-xs font-bold text-slate-300">Background Color</span>
            <input
              type="color"
              value={bg.color || '#000000'}
              onChange={(e) => updateBackground({ color: e.target.value })}
              className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2 bg-raised p-3 rounded-xl border border-white/5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-bold text-slate-300">Blur Intensity</span>
              <span className="font-mono text-cyan-400 text-xs">{bg.blur || 35}px</span>
            </div>
            <input
              type="range"
              min="10"
              max="60"
              value={bg.blur || 35}
              onChange={(e) => updateBackground({ blur: parseInt(e.target.value, 10) })}
              className="accent-cyan-400 cursor-pointer"
            />
          </div>
        )}
      </div>
    );
  }

  // 6. DEFAULT: TEMPLATE METADATA & CHANNEL ASSIGNMENT
  return (
    <div className="w-full h-full flex flex-col bg-surface overflow-y-auto p-3 text-xs gap-4 custom-scrollbar select-none">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
        <div className="flex items-center gap-2 text-accent">
          <LayoutTemplate size={16} />
          <h3 className="font-extrabold text-white text-sm">Template Properties</h3>
        </div>
        <span className="text-[10px] font-mono text-muted">Global Metadata</span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase font-bold text-muted">Template Name</label>
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="w-full bg-raised border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-accent"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase font-bold text-muted">Description</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-raised border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-accent resize-none"
        />
      </div>

      {/* Used by Channels */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.08]">
        <label className="text-[11px] uppercase font-bold text-muted flex items-center justify-between">
          <span>Assigned Streamers</span>
          <span className="text-[10px] font-mono text-emerald-400">
            {channels.filter((c) => c.template_name === templateName).length} active
          </span>
        </label>
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {channels.map((c) => {
            const isAssigned = c.template_name === templateName;
            return (
              <div
                key={c.channel_id_or_handle}
                className="flex items-center justify-between p-2 rounded-xl bg-raised border border-white/5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">@{c.display_name || c.channel_id_or_handle}</span>
                  <span className="text-[10px] text-muted">({c.platform})</span>
                </div>
                {isAssigned && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    <Check size={10} /> Active
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
