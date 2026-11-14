import React from 'react';
import { 
  Layers, 
  FileText, 
  Bookmark, 
  Volume2, 
  Share2, 
  Plus, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Trash2, 
  Sparkles,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export default function LeftPanel() {
  const { activeTab, setActiveTab } = useEditorStore();

  const tabs = [
    { id: 'layers', label: 'Layers', icon: Layers },
    { id: 'transcript', label: 'Script', icon: FileText },
    { id: 'presets', label: 'Presets', icon: Bookmark },
    { id: 'audio', label: 'Audio', icon: Volume2 },
    { id: 'publish', label: 'Publish', icon: Share2 },
  ];

  return (
    <div className="w-full h-full bg-surface border border-white/[0.06] rounded-2xl p-2.5 flex flex-col gap-2.5 shadow-xl select-none overflow-hidden">
      {/* Compact Tab Header Bar */}
      <div className="grid grid-cols-5 gap-1 bg-canvas p-1 rounded-xl border border-white/[0.04] shrink-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center justify-center gap-1 py-1 rounded-lg text-[11px] font-bold transition-all ${
                isActive
                  ? 'bg-raised text-accent shadow-sm border border-white/[0.06]'
                  : 'text-muted hover:text-ink'
              }`}
              title={t.label}
            >
              <Icon size={12} />
              <span className="hidden xl:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto pr-0.5 text-xs">
        {activeTab === 'layers' && <LayersShelf />}
        {activeTab === 'transcript' && <TranscriptSubTab />}
        {activeTab === 'presets' && <PresetsSubTab />}
        {activeTab === 'audio' && <AudioSubTab />}
        {activeTab === 'publish' && <PublishSubTab />}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Compact Layers Shelf (28px rows, drag, eye, lock, double-click rename)
// -------------------------------------------------------------
function LayersShelf() {
  const { edl, updateEDL, selection, setSelection } = useEditorStore();
  const layers = edl?.layout?.layers || [];

  const handleSelectLayer = (id) => {
    setSelection({ type: 'layer', id });
  };

  const handleAddLayer = () => {
    if (layers.length >= 8) return;
    const colors = ['#FFB020', '#00F0FF', '#A855F7', '#EC4899', '#10B981', '#F59E0B', '#3B82F6', '#EF4444'];
    const color = colors[layers.length % colors.length];
    const newId = `l_${Date.now()}`;
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
      tracking: { mode: 'off', smooth: 0.8 },
    };

    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layers: [...(prev.layout?.layers || []), newLayer],
      },
    }));
    setSelection({ type: 'layer', id: newId });
  };

  const updateLayer = (layerId, partial) => {
    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layers: (prev.layout?.layers || []).map((l) => (l.id === layerId ? { ...l, ...partial } : l)),
      },
    }));
  };

  const deleteLayer = (layerId) => {
    if (layers.length <= 1) return;
    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layers: (prev.layout?.layers || []).filter((l) => l.id !== layerId),
      },
    }));
    if (selection?.id === layerId) {
      setSelection({ type: 'none', id: null });
    }
  };

  const moveZ = (layerId, delta) => {
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= layers.length) return;
    const next = [...layers];
    const [moved] = next.splice(idx, 1);
    next.splice(newIdx, 0, moved);
    updateEDL((prev) => ({
      ...prev,
      layout: { ...prev.layout, layers: next },
    }));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Frames ({layers.length}/8)
        </span>
        <button
          onClick={handleAddLayer}
          disabled={layers.length >= 8}
          className="flex items-center gap-1 bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent px-2 py-0.5 rounded text-[11px] font-bold"
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {/* 28px Rows List */}
      <div className="flex flex-col gap-1">
        {layers.slice().reverse().map((layer, revIdx) => {
          const origIdx = layers.length - 1 - revIdx;
          const isSelected = selection?.type === 'layer' && selection?.id === layer.id;

          return (
            <div
              key={layer.id}
              onClick={() => handleSelectLayer(layer.id)}
              className={`h-7 px-2 rounded-lg border flex items-center justify-between gap-1.5 cursor-pointer transition-all ${
                isSelected
                  ? 'bg-raised border-accent shadow-sm'
                  : 'bg-surface border-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  style={{ backgroundColor: layer.color || '#00F0FF' }}
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                />
                <input
                  type="text"
                  value={layer.name}
                  onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent text-[11px] font-bold text-white focus:outline-none truncate w-24"
                />
              </div>

              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => moveZ(layer.id, 1)}
                  disabled={origIdx === layers.length - 1}
                  title="Forward"
                  className="text-slate-400 hover:text-white disabled:opacity-20"
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  onClick={() => moveZ(layer.id, -1)}
                  disabled={origIdx === 0}
                  title="Backward"
                  className="text-slate-400 hover:text-white disabled:opacity-20"
                >
                  <ArrowDown size={11} />
                </button>
                <button
                  onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                  title={layer.visible ? 'Hide' : 'Show'}
                  className="text-slate-400 hover:text-white"
                >
                  {layer.visible ? <Eye size={11} /> : <EyeOff size={11} className="text-slate-600" />}
                </button>
                <button
                  onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                  title={layer.locked ? 'Unlock' : 'Lock'}
                  className="text-slate-400 hover:text-white"
                >
                  {layer.locked ? <Lock size={11} className="text-amber-400" /> : <Unlock size={11} />}
                </button>
                <button
                  onClick={() => deleteLayer(layer.id)}
                  title="Delete"
                  className="text-slate-500 hover:text-rose-400"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Transcript Tab (Descript-style interactive word list)
// -------------------------------------------------------------
function TranscriptSubTab() {
  const { edl, currentTime, toggleWordDeleted, setSelection } = useEditorStore();
  const words = edl?.words || [];

  if (!words.length) {
    return (
      <div className="text-center py-6 text-slate-500 text-xs">
        No transcription words available. Click "Transcribe" in Clip Overview.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 leading-relaxed select-text">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
        Interactive Script ({words.length} words)
      </span>
      <div className="flex flex-wrap gap-1">
        {words.map((w, idx) => {
          const isActive = currentTime >= w.start && currentTime <= w.end;
          return (
            <span
              key={idx}
              onClick={() => setSelection({ type: 'word', id: idx, data: w })}
              onDoubleClick={() => toggleWordDeleted(idx)}
              className={`px-1 py-0.5 rounded cursor-pointer transition-all ${
                w.deleted
                  ? 'line-through text-rose-500/50 bg-rose-950/20'
                  : isActive
                  ? 'bg-amber-400 text-black font-black shadow-sm'
                  : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              {w.word || w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Presets Tab
// -------------------------------------------------------------
function PresetsSubTab() {
  const { applyPresetToEDL } = useEditorStore();

  const presets = [
    { id: 'facecam_top_gameplay_bottom', name: 'Facecam Top 38% + Game 62%' },
    { id: 'split_screen_50_50', name: '50/50 Vertical Split' },
    { id: 'single_crop_9_16', name: 'Full 9:16 Single Crop' },
    { id: 'blurred_bg_center', name: '16:9 Center with Blurred BG' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
        Layout Presets
      </span>
      {presets.map((p) => (
        <button
          key={p.id}
          onClick={() => {
            import('../LayoutBuilder').then(({ PRESET_STARTERS }) => {
              const starter = PRESET_STARTERS[p.id];
              if (starter) {
                applyPresetToEDL({
                  layout: {
                    schema: 2,
                    canvas: { w: 1080, h: 1920 },
                    background: starter.background,
                    layers: starter.layers,
                  }
                });
              }
            });
          }}
          className="text-left p-2 rounded-lg bg-raised hover:bg-raised/80 border border-white/5 text-xs text-white"
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

function AudioSubTab() {
  return (
    <div className="text-slate-400 text-xs py-4 text-center">
      Master volume: 100% (Original Audio Track Active)
    </div>
  );
}

function PublishSubTab() {
  return (
    <div className="text-slate-400 text-xs py-4 text-center">
      Ready to render &amp; queue for automatic publishing.
    </div>
  );
}
