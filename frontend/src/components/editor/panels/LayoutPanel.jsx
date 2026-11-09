import React, { useState, useEffect } from 'react';
import { 
  Layers, 
  Plus, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Trash2, 
  Copy, 
  ArrowUp, 
  ArrowDown, 
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Circle,
  Square,
  Sparkles,
  Bookmark,
  RotateCcw,
  LockKeyhole,
  UnlockKeyhole
} from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';
import { PRESET_STARTERS } from '../../LayoutBuilder';
import { getTemplates } from '../../../api';

const LAYER_COLORS = [
  '#FFB020', '#00F0FF', '#A855F7', '#EC4899', 
  '#10B981', '#F59E0B', '#3B82F6', '#EF4444'
];

export default function LayoutPanel({ isCompact = false }) {
  const { edl, updateEDL, selection, setSelection } = useEditorStore();
  const layers = edl?.layout?.layers || [];
  const selectedLayerId = selection?.type === 'layer' ? selection.id : null;
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || null;

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');

  useEffect(() => {
    getTemplates().then((tpls) => {
      setTemplates(tpls || []);
    }).catch(() => {});
  }, []);

  const handleApplyTemplate = (tplName) => {
    setSelectedTemplateName(tplName);
    const target = templates.find((t) => t.name === tplName);
    if (!target || !target.layout) return;

    updateEDL((prev) => ({
      ...prev,
      layout: target.layout,
      captions: {
        ...(prev.captions || {}),
        font: target.subtitles?.font_name || prev.captions?.font || 'Montserrat ExtraBold',
        size: target.subtitles?.font_size || prev.captions?.size || 72,
        animation: target.subtitles?.animation || prev.captions?.animation || 'pop',
      }
    }));
  };

  const handleApplyStarter = (starterId) => {
    const starter = PRESET_STARTERS[starterId];
    if (!starter) return;
    updateEDL((prev) => ({
      ...prev,
      layout: {
        schema: 2,
        canvas: { w: 1080, h: 1920 },
        background: { ...starter.background },
        layers: starter.layers.map((l) => ({ ...l, id: `l_${Date.now()}_${l.name.toLowerCase()}` }))
      }
    }));
  };

  const handleSelectLayer = (id) => {
    setSelection({ type: 'layer', id });
  };

  const handleAddLayer = () => {
    if (layers.length >= 8) return;
    const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];
    const newId = `l_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newLayer = {
      id: newId,
      name: `Frame ${layers.length + 1}`,
      color,
      visible: true,
      locked: false,
      src: { x: 0.25, y: 0.25, w: 0.50, h: 0.50 },
      dst: { x: 0.10, y: 0.20, w: 0.80, h: 0.40 },
      fit: 'cover',
      aspect_lock: true,
      style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
      tracking: { mode: 'off', smooth: 0.8 }
    };

    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...(prev.layout || { schema: 2 }),
        layers: [...(prev.layout?.layers || []), newLayer]
      }
    }));
    setSelection({ type: 'layer', id: newId });
  };

  const updateSelectedLayer = (partial) => {
    if (!selectedLayerId) return;
    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layers: prev.layout.layers.map((l) => (l.id === selectedLayerId ? { ...l, ...partial } : l))
      }
    }));
  };

  const handleNudge = (dx, dy) => {
    if (!selectedLayer) return;
    const curDst = selectedLayer.dst || { x: 0, y: 0, w: 1, h: 1 };
    const newX = Math.max(0, Math.min(1 - curDst.w, curDst.x + dx));
    const newY = Math.max(0, Math.min(1 - curDst.h, curDst.y + dy));
    updateSelectedLayer({
      dst: {
        ...curDst,
        x: Math.round(newX * 1000) / 1000,
        y: Math.round(newY * 1000) / 1000,
      }
    });
  };

  const handleDeleteLayer = (layerId) => {
    if (layers.length <= 1) return;
    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layers: prev.layout.layers.filter((l) => l.id !== layerId)
      }
    }));
    if (selectedLayerId === layerId) {
      setSelection({ type: 'none', id: null });
    }
  };

  const handleDuplicateLayer = (layerId) => {
    if (layers.length >= 8) return;
    const l = layers.find((item) => item.id === layerId);
    if (!l) return;
    const newId = `l_${Date.now()}_copy`;
    const copy = {
      ...l,
      id: newId,
      name: `${l.name} Copy`,
      dst: { ...l.dst, y: Math.min(0.6, (l.dst?.y || 0) + 0.05) }
    };
    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layers: [...prev.layout.layers, copy]
      }
    }));
    setSelection({ type: 'layer', id: newId });
  };

  const handleMoveZ = (layerId, direction) => {
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= layers.length) return;

    const newLayers = [...layers];
    const [moved] = newLayers.splice(idx, 1);
    newLayers.splice(newIdx, 0, moved);

    updateEDL((prev) => ({
      ...prev,
      layout: { ...prev.layout, layers: newLayers }
    }));
  };

  return (
    <div className="flex flex-col gap-3 text-xs select-none">
      {/* Template & Preset Selector */}
      <div className="bg-[#141722] border border-white/10 rounded-xl p-2.5 flex flex-col gap-2">
        <label className="text-[10px] uppercase font-bold text-[#8FD3FF] tracking-wider flex items-center gap-1.5">
          <Bookmark size={12} /> Apply Template / Preset
        </label>
        
        {/* Streamer Templates dropdown */}
        <div>
          <label className="text-[9px] uppercase font-bold text-slate-400 block mb-1">Streamer Template</label>
          <select
            value={selectedTemplateName}
            onChange={(e) => handleApplyTemplate(e.target.value)}
            className="w-full bg-[#0E1118] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white cursor-pointer"
          >
            <option value="">Select a template...</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Standard Starters dropdown */}
        <div>
          <label className="text-[9px] uppercase font-bold text-slate-400 block mb-1">Standard Starter Layout</label>
          <select
            onChange={(e) => {
              if (e.target.value) handleApplyStarter(e.target.value);
            }}
            defaultValue=""
            className="w-full bg-[#0E1118] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white cursor-pointer"
          >
            <option value="" disabled>Choose a starter layout...</option>
            {Object.values(PRESET_STARTERS).map((starter) => (
              <option key={starter.id} value={starter.id}>
                {starter.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Layer List Section */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider flex items-center gap-1.5">
            <Layers size={13} className="text-[#8FD3FF]" /> Frames ({layers.length}/8)
          </span>
          <button
            onClick={handleAddLayer}
            disabled={layers.length >= 8}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold text-[11px] border border-white/5 disabled:opacity-40"
          >
            <Plus size={12} className="text-[#8FD3FF]" />
            <span>Add</span>
          </button>
        </div>

        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-0.5">
          {layers.map((layer, idx) => {
            const isSelected = selectedLayerId === layer.id;
            return (
              <div
                key={layer.id}
                onClick={() => handleSelectLayer(layer.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#181C26] border-[#8FD3FF] shadow-md shadow-[#8FD3FF]/10 text-white'
                    : 'bg-white/[0.03] border-white/[0.06] text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    style={{ backgroundColor: layer.color || '#00F0FF' }}
                    className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                  />
                  <span className="font-bold text-xs truncate max-w-[130px]">
                    {layer.name}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => updateSelectedLayer({ visible: !layer.visible })}
                    className="p-1 rounded text-slate-400 hover:text-white"
                    title={layer.visible ? 'Hide' : 'Show'}
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-slate-600" />}
                  </button>
                  <button
                    onClick={() => updateSelectedLayer({ locked: !layer.locked })}
                    className="p-1 rounded text-slate-400 hover:text-white"
                    title={layer.locked ? 'Unlock' : 'Lock'}
                  >
                    {layer.locked ? <Lock size={13} className="text-amber-400" /> : <Unlock size={13} />}
                  </button>
                  <button
                    onClick={() => handleDuplicateLayer(layer.id)}
                    className="p-1 rounded text-slate-400 hover:text-white"
                    title="Duplicate"
                  >
                    <Copy size={12} />
                  </button>
                  {layers.length > 1 && (
                    <button
                      onClick={() => handleDeleteLayer(layer.id)}
                      className="p-1 rounded text-slate-400 hover:text-rose-400"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Frame Inspector */}
      {selectedLayer && (
        <div className="border-t border-white/[0.08] pt-2.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-[#8FD3FF] tracking-wider">
                Editing {selectedLayer.name}
              </span>
            </div>
            <div className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
              <span>{Math.round((selectedLayer.src?.w || 1) * 100)}% x {Math.round((selectedLayer.src?.h || 1) * 100)}%</span>
            </div>
          </div>

          {/* Aspect Ratio Lock & Reset */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Aspect Ratio Control</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updateSelectedLayer({ aspect_lock: !selectedLayer.aspect_lock })}
                className={`py-1.5 px-2 rounded-xl border flex items-center justify-center gap-1.5 font-bold text-xs transition-all ${
                  selectedLayer.aspect_lock
                    ? 'bg-[#181C26] border-[#8FD3FF] text-[#8FD3FF]'
                    : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {selectedLayer.aspect_lock ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}
                <span>{selectedLayer.aspect_lock ? 'Locked' : 'Unlocked'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const curDst = selectedLayer.dst || { x: 0, y: 0, w: 1, h: 1 };
                  const srcW = selectedLayer.src?.w || 1;
                  const srcH = selectedLayer.src?.h || 1;
                  const srcAspect = (srcW * 16) / (srcH * 9);
                  const newH = Math.min(1.0 - curDst.y, (curDst.w * 9) / (srcAspect * 16));
                  updateSelectedLayer({
                    dst: {
                      ...curDst,
                      h: Math.round(newH * 1000) / 1000,
                    },
                    aspect_lock: true,
                  });
                }}
                className="py-1.5 px-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white flex items-center justify-center gap-1.5 font-bold text-xs transition-all"
              >
                <RotateCcw size={12} />
                <span>Reset 16:9</span>
              </button>
            </div>
          </div>

          {/* Quick Fit Mode & Shape */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Fit Mode</label>
              <select
                value={selectedLayer.fit || 'cover'}
                onChange={(e) => updateSelectedLayer({ fit: e.target.value })}
                className="w-full bg-[#141722] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
              >
                <option value="cover">Cover (Crop)</option>
                <option value="contain">Contain (Letterbox)</option>
                <option value="stretch">Stretch</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Shape</label>
              <div className="grid grid-cols-2 gap-1 bg-[#141722] p-1 rounded-xl border border-white/10">
                <button
                  onClick={() => updateSelectedLayer({ style: { ...(selectedLayer.style || {}), shape: 'rect' } })}
                  className={`py-1 rounded-lg font-bold text-xs flex items-center justify-center gap-1 ${
                    (selectedLayer.style?.shape || 'rect') === 'rect' ? 'bg-[#8FD3FF] text-[#0A0B0E]' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Square size={11} /> Rect
                </button>
                <button
                  onClick={() => updateSelectedLayer({ style: { ...(selectedLayer.style || {}), shape: 'circle' } })}
                  className={`py-1 rounded-lg font-bold text-xs flex items-center justify-center gap-1 ${
                    selectedLayer.style?.shape === 'circle' ? 'bg-[#8FD3FF] text-[#0A0B0E]' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Circle size={11} /> Circle
                </button>
              </div>
            </div>
          </div>

          {/* Precision Nudge Pad */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Nudge Placement</label>
            <div className="grid grid-cols-4 gap-1.5 font-mono text-xs">
              <button
                onClick={() => handleNudge(-0.02, 0)}
                className="py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/[0.06] font-bold"
              >
                ← 2%
              </button>
              <button
                onClick={() => handleNudge(0.02, 0)}
                className="py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/[0.06] font-bold"
              >
                → 2%
              </button>
              <button
                onClick={() => handleNudge(0, -0.02)}
                className="py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/[0.06] font-bold"
              >
                ↑ 2%
              </button>
              <button
                onClick={() => handleNudge(0, 0.02)}
                className="py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/[0.06] font-bold"
              >
                ↓ 2%
              </button>
            </div>
          </div>

          {/* Accordion: Advanced Styling (Border, Corner Radius, Opacity) */}
          <div className="border border-white/[0.06] rounded-xl overflow-hidden mt-1">
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="w-full px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] flex items-center justify-between text-xs font-bold text-slate-300"
            >
              <span>Advanced Styling (Border &amp; Corners)</span>
              {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {advancedOpen && (
              <div className="p-3 bg-[#0E1118] space-y-2.5 border-t border-white/[0.06]">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Corner Radius</span>
                    <span className="font-mono text-white">{selectedLayer.style?.radius || 0}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    value={selectedLayer.style?.radius || 0}
                    onChange={(e) => updateSelectedLayer({
                      style: { ...(selectedLayer.style || {}), radius: Number(e.target.value) }
                    })}
                    className="w-full accent-[#8FD3FF] cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Border Width</span>
                    <span className="font-mono text-white">{selectedLayer.style?.border?.w || 0}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="16"
                    value={selectedLayer.style?.border?.w || 0}
                    onChange={(e) => updateSelectedLayer({
                      style: { 
                        ...(selectedLayer.style || {}), 
                        border: { ...(selectedLayer.style?.border || {}), w: Number(e.target.value) } 
                      }
                    })}
                    className="w-full accent-[#8FD3FF] cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

