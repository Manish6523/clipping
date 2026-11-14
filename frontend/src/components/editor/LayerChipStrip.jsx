import React from 'react';
import { Plus } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

const LAYER_COLORS = [
  '#FFB020', '#00F0FF', '#A855F7', '#EC4899', 
  '#10B981', '#F59E0B', '#3B82F6', '#EF4444'
];

export default function LayerChipStrip() {
  const { edl, updateEDL, selection, setSelection, setActivePanel } = useEditorStore();
  const layers = edl?.layout?.layers || [];
  const selectedLayerId = selection?.type === 'layer' ? selection.id : null;

  const handleSelect = (id) => {
    setSelection({ type: 'layer', id });
    setActivePanel('layout');
  };

  const handleAdd = () => {
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
    setActivePanel('layout');
  };

  return (
    <div className="h-9 px-3 bg-canvas/90 border-t border-white/[0.04] flex items-center gap-1.5 overflow-x-auto custom-scrollbar shrink-0 select-none z-20">
      {layers.map((layer) => {
        const isSelected = selectedLayerId === layer.id;
        return (
          <button
            key={layer.id}
            onClick={() => handleSelect(layer.id)}
            className={`h-7 px-2.5 rounded-full flex items-center gap-1.5 text-xs font-bold transition-all shrink-0 border ${
              isSelected
                ? 'bg-raised border-accent text-accent shadow-md shadow-accent/20 scale-105'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:text-white'
            }`}
          >
            <span 
              style={{ backgroundColor: layer.color || '#00F0FF' }}
              className="w-2.5 h-2.5 rounded-full shadow-sm"
            />
            <span className="truncate max-w-[80px]">{layer.name}</span>
          </button>
        );
      })}

      {layers.length < 8 && (
        <button
          onClick={handleAdd}
          className="h-7 w-7 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-accent flex items-center justify-center shrink-0 active:scale-95 transition-transform"
          title="Add Frame"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

