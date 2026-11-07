import React from 'react';
import { 
  Layers, 
  Type, 
  FileText, 
  Clock, 
  Volume2, 
  Bookmark, 
  Share2 
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

const TOOLBAR_ITEMS = [
  { id: 'layout', label: 'Layout', icon: Layers },
  { id: 'captions', label: 'Captions', icon: Type },
  { id: 'transcript', label: 'Script', icon: FileText },
  { id: 'length', label: 'Length', icon: Clock },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'presets', label: 'Presets', icon: Bookmark },
  { id: 'publish', label: 'Publish', icon: Share2 },
];

export default function MobileToolBar() {
  const { activePanel, setActivePanel } = useEditorStore();

  const handleTap = (id) => {
    if (activePanel === id) {
      setActivePanel(null); // Toggle closed if same tapped
    } else {
      setActivePanel(id);
    }
  };

  return (
    <nav 
      className="h-14 bg-[#0A0B0E] border-t border-white/[0.08] px-2 flex items-center gap-1 overflow-x-auto custom-scrollbar select-none shrink-0 z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TOOLBAR_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activePanel === item.id;
        return (
          <button
            key={item.id}
            onClick={() => handleTap(item.id)}
            className={`min-w-[64px] flex-1 py-1 px-1.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all shrink-0 ${
              isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-slate-400 active:text-white active:bg-white/[0.04]'
            }`}
          >
            <Icon size={16} />
            <span className="text-[10px] font-bold tracking-tight">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
