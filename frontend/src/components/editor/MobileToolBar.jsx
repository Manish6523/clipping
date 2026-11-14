import React, { useState } from 'react';
import {
  Layers,
  Type,
  FileText,
  Clock,
  Volume2,
  Bookmark,
  Share2,
  SlidersHorizontal,
  ChevronLeft,
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

// Everyday tools first; layout/crop work lives behind "More" on phones.
const PRIMARY_ITEMS = [
  { id: 'transcript', label: 'Script', icon: FileText },
  { id: 'captions', label: 'Captions', icon: Type },
  { id: 'length', label: 'Length', icon: Clock },
  { id: 'publish', label: 'Publish', icon: Share2 },
];
const ADVANCED_ITEMS = [
  { id: 'layout', label: 'Layout', icon: Layers },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'presets', label: 'Presets', icon: Bookmark },
];

export default function MobileToolBar() {
  const { activePanel, setActivePanel } = useEditorStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const advancedActive = ADVANCED_ITEMS.some((i) => i.id === activePanel);
  const advanced = showAdvanced || advancedActive;

  const handleTap = (id) => {
    setActivePanel(activePanel === id ? null : id); // toggle closed if same tapped
  };

  const items = advanced ? ADVANCED_ITEMS : PRIMARY_ITEMS;

  const renderButton = ({ id, label, icon: Icon }) => {
    const isActive = activePanel === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => handleTap(id)}
        aria-pressed={isActive}
        className={`min-w-0 flex-1 h-12 px-0.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${
          isActive
            ? 'bg-raised text-accent border border-accent/30 shadow-md shadow-accent/10'
            : 'text-slate-400 active:text-white active:bg-white/[0.04]'
        }`}
      >
        <Icon size={16} />
        <span className="text-[11px] font-bold tracking-tight truncate max-w-full">{label}</span>
      </button>
    );
  };

  return (
    <nav
      className="bg-canvas border-t border-white/[0.08] px-1 pt-1 flex items-stretch gap-0.5 select-none shrink-0 z-30"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 4px)' }}
    >
      {advanced && (
        <button
          type="button"
          onClick={() => { setShowAdvanced(false); if (advancedActive) setActivePanel(null); }}
          className="min-w-0 flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-1 text-slate-400 active:text-white"
          aria-label="Back to main tools"
        >
          <ChevronLeft size={16} />
          <span className="text-[11px] font-bold">Back</span>
        </button>
      )}
      {items.map(renderButton)}
      {!advanced && (
        <button
          type="button"
          onClick={() => setShowAdvanced(true)}
          className="min-w-0 flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-1 text-slate-400 active:text-white"
        >
          <SlidersHorizontal size={16} />
          <span className="text-[11px] font-bold">More</span>
        </button>
      )}
    </nav>
  );
}
