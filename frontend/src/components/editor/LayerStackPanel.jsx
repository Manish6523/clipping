import React, { useState } from 'react';
import { 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  GripVertical, 
  Copy, 
  ArrowUp, 
  ArrowDown, 
  Maximize2, 
  Minimize2,
  Type,
  ShieldCheck,
  Sparkles,
  Palette,
  LayoutTemplate
} from 'lucide-react';
import { useTemplateEditorStore } from '../../store/templateEditorStore';

const LAYER_PRESETS = [
  { name: 'Gameplay', color: '#00F0FF', src: { x: 0.20, y: 0.0, w: 0.60, h: 1.0 }, dst: { x: 0.0, y: 0.38, w: 1.0, h: 0.62 } },
  { name: 'Facecam', color: '#FFB020', src: { x: 0.05, y: 0.05, w: 0.35, h: 0.45 }, dst: { x: 0.0, y: 0.0, w: 1.0, h: 0.38 } },
  { name: 'Chat Box', color: '#A855F7', src: { x: 0.80, y: 0.20, w: 0.20, h: 0.60 }, dst: { x: 0.05, y: 0.85, w: 0.40, h: 0.12 } },
  { name: 'Custom Layer', color: '#EC4899', src: { x: 0.10, y: 0.10, w: 0.40, h: 0.40 }, dst: { x: 0.10, y: 0.10, w: 0.80, h: 0.30 } },
];

export default function LayerStackPanel({ isCompact = false }) {
  const { 
    layout, 
    selection, 
    setSelection, 
    updateLayer, 
    addLayer, 
    deleteLayer, 
    reorderLayers,
    watermark,
    subtitles
  } = useTemplateEditorStore();

  const layers = layout.layers || [];
  const [editingNameId, setEditingNameId] = useState(null);
  const [tempName, setTempName] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);

  const handleStartRename = (layer) => {
    setEditingNameId(layer.id);
    setTempName(layer.name);
  };

  const handleFinishRename = (layerId) => {
    if (tempName.trim()) {
      updateLayer(layerId, { name: tempName.trim() });
    }
    setEditingNameId(null);
  };

  const handleMoveZ = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= layers.length) return;
    const next = [...layers];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    reorderLayers(next);
  };

  const handleAddPreset = (preset) => {
    if (layers.length >= 8) {
      alert('Maximum 8 layers allowed.');
      return;
    }
    const newId = `l_${Date.now().toString().slice(-6)}`;
    const newLayer = {
      id: newId,
      name: `${preset.name} ${layers.length + 1}`,
      color: preset.color,
      visible: true,
      locked: false,
      aspect_lock: true,
      fit: 'cover',
      src: { ...preset.src },
      dst: { ...preset.dst },
      style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
      tracking: { mode: 'off', smooth: 0.8 }
    };
    addLayer(newLayer);
    setShowAddMenu(false);
  };

  return (
    <div className="w-full h-full flex flex-col bg-surface select-none overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/[0.08] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold uppercase text-[11px] tracking-wider text-slate-300">
            Layers Stack ({layers.length}/8)
          </span>
          {layers.length >= 5 && (
            <span className="text-[10px] text-amber-400 font-bold px-1 rounded bg-amber-500/10" title="Rendering 5+ video layers increases VPS processing time">
              Render Cost
            </span>
          )}
        </div>

        {/* Add Layer Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            disabled={layers.length >= 8}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 border border-accent/40 text-accent font-extrabold text-[11px] disabled:opacity-40 transition-all cursor-pointer"
          >
            <Plus size={12} /> Add Layer
          </button>

          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-48 bg-raised border border-white/10 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1">
              {LAYER_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => handleAddPreset(p)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-bold text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Layer Items List (Figma Style: top of list = topmost on canvas) */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 custom-scrollbar">
        <div className="text-[10px] font-mono text-slate-500 px-2 py-0.5 uppercase tracking-wider flex justify-between">
          <span>Top of canvas</span>
          <span>Z-Order</span>
        </div>

        {layers.slice().reverse().map((layer, revIdx) => {
          const actualIdx = layers.length - 1 - revIdx;
          const isSelected = selection.type === 'layer' && selection.id === layer.id;

          return (
            <div
              key={layer.id}
              onClick={() => setSelection({ type: 'layer', id: layer.id })}
              className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? 'bg-raised border-accent text-white shadow-sm'
                  : 'bg-surface/60 hover:bg-raised/60 border-white/5 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: layer.color || '#3B82F6' }} />

                {editingNameId === layer.id ? (
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={() => handleFinishRename(layer.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleFinishRename(layer.id)}
                    autoFocus
                    className="bg-black/50 border border-accent rounded px-1.5 py-0.5 text-xs text-white font-bold w-full focus:outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={() => handleStartRename(layer)}
                    className="font-bold text-xs truncate cursor-text"
                    title="Double-click to rename"
                  >
                    {layer.name}
                  </span>
                )}
              </div>

              {/* Action Icons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateLayer(layer.id, { visible: !layer.visible });
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                >
                  {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-muted" />}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateLayer(layer.id, { locked: !layer.locked });
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
                  title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                >
                  {layer.locked ? <Lock size={12} className="text-amber-400" /> : <Unlock size={12} />}
                </button>

                {/* Z-order nudges */}
                <button
                  type="button"
                  disabled={actualIdx === layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveZ(actualIdx, 1);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20"
                  title="Bring forward"
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  disabled={actualIdx === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveZ(actualIdx, -1);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20"
                  title="Send backward"
                >
                  <ArrowDown size={11} />
                </button>

                {layers.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteLayer(layer.id);
                    }}
                    className="p-1 rounded text-rose-400 hover:bg-rose-500/10"
                    title="Delete layer"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div className="text-[10px] font-mono text-slate-500 px-2 py-0.5 uppercase tracking-wider">
          Bottom of canvas
        </div>

        {/* Pinned Studio Entities (Captions, Hook, Watermark, Background) */}
        <div className="pt-2 mt-2 border-t border-white/[0.08] flex flex-col gap-1">
          <div className="text-[10px] font-mono text-slate-400 px-2 uppercase tracking-wider">
            Pinned Elements
          </div>

          {[
            { id: 'captions', label: 'Captions & Subtitles', icon: Type, type: 'captions', active: true },
            { id: 'hook', label: 'Hook Title Card', icon: Sparkles, type: 'hook', active: true },
            { id: 'watermark', label: 'Channel Watermark', icon: ShieldCheck, type: 'watermark', active: watermark.enabled },
            { id: 'background', label: 'Canvas Background', icon: Palette, type: 'background', active: true },
          ].map((item) => {
            const Icon = item.icon;
            const isSelected = selection.type === item.type;
            return (
              <div
                key={item.id}
                onClick={() => setSelection({ type: item.type, id: item.id })}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-accent/15 border-accent text-accent font-bold'
                    : 'bg-surface/40 hover:bg-raised/60 border-white/5 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={13} className={isSelected ? 'text-accent' : 'text-slate-400'} />
                  <span className="text-xs font-semibold">{item.label}</span>
                </div>
                {item.id === 'watermark' && item.active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
