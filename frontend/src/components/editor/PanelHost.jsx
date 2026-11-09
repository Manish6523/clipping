import React, { useEffect, useRef } from 'react';
import { 
  X, 
  ChevronDown, 
  ChevronUp, 
  Maximize2, 
  Minimize2,
  SlidersHorizontal,
  Layers,
  Type,
  FileText,
  Clock,
  Volume2,
  Bookmark,
  Share2,
  Sparkles
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import ClipPanel from './panels/ClipPanel';
import LayoutPanel from './panels/LayoutPanel';
import CaptionsPanel from './panels/CaptionsPanel';
import TranscriptPanel from './panels/TranscriptPanel';
import AudioPanel from './panels/AudioPanel';
import PresetsPanel from './panels/PresetsPanel';
import PublishPanel from './panels/PublishPanel';

const PANEL_CONFIG = {
  clip: { label: 'Clip Length & Overview', icon: Clock, component: ClipPanel },
  layout: { label: 'Frames & Crop Layout', icon: Layers, component: LayoutPanel },
  captions: { label: 'Karaoke Captions', icon: Type, component: CaptionsPanel },
  transcript: { label: 'Interactive Script', icon: FileText, component: TranscriptPanel },
  length: { label: 'Clip Length', icon: Clock, component: ClipPanel },
  audio: { label: 'Audio & Normalization', icon: Volume2, component: AudioPanel },
  presets: { label: 'Layout Presets', icon: Bookmark, component: PresetsPanel },
  publish: { label: 'Publish & Queue', icon: Share2, component: PublishPanel },
};

/**
 * PanelHost
 * Container-agnostic panel renderer:
 *  - On desktop: renders inside the right sidebar / inspector column.
 *  - On landscape: renders inside an animated right side drawer.
 *  - On phone: renders inside a touch-friendly bottom sheet with peek (28%), half (50%), and full (90%) snap points.
 */
export default function PanelHost({ 
  mode = 'desktop', 
  activePanel: propActivePanel = null, 
  onClose,
  sheetSnap = 'closed',
  onSetSnap
}) {
  const { selection, activePanel: storeActivePanel, setActivePanel } = useEditorStore();
  const touchStartY = useRef(0);
  const currentSnapRef = useRef(sheetSnap);
  currentSnapRef.current = sheetSnap;

  // Prioritize active panel from props or store; fallback contextually based on selection
  let resolvedPanel = propActivePanel || storeActivePanel;
  if (!resolvedPanel) {
    if (selection?.type === 'layer') resolvedPanel = 'layout';
    else if (selection?.type === 'caption') resolvedPanel = 'captions';
    else if (selection?.type === 'word') resolvedPanel = 'transcript';
    else resolvedPanel = 'clip';
  }

  const config = PANEL_CONFIG[resolvedPanel] || PANEL_CONFIG.clip;
  const PanelComponent = config.component;

  // Touch gesture drag handle for Bottom Sheet
  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const endY = e.changedTouches[0].clientY;
    const diff = endY - touchStartY.current;

    // Swiped down (> 40px)
    if (diff > 40) {
      if (currentSnapRef.current === 'full') onSetSnap?.('half');
      else if (currentSnapRef.current === 'half') onSetSnap?.('peek');
      else onClose?.();
    } 
    // Swiped up (< -40px)
    else if (diff < -40) {
      if (currentSnapRef.current === 'peek') onSetSnap?.('half');
      else if (currentSnapRef.current === 'half') onSetSnap?.('full');
    }
  };

  // Back button handling on mobile (Android back gesture support)
  useEffect(() => {
    if (mode === 'phone' && sheetSnap !== 'closed') {
      const handlePop = () => {
        onClose?.();
      };
      window.history.pushState({ sheetOpen: true }, '');
      window.addEventListener('popstate', handlePop, { once: true });
      return () => {
        window.removeEventListener('popstate', handlePop);
      };
    }
  }, [mode, sheetSnap, onClose]);

  // 1. DESKTOP SIDEBAR EMBED
  const tabs = [
    { id: 'layout', label: 'Layout', icon: Layers },
    { id: 'captions', label: 'Captions', icon: Type },
    { id: 'transcript', label: 'Script', icon: FileText },
    { id: 'presets', label: 'Presets', icon: Bookmark },
    { id: 'clip', label: 'Overview', icon: Clock },
    { id: 'audio', label: 'Audio', icon: Volume2 },
    { id: 'publish', label: 'Publish', icon: Share2 },
  ];

  if (mode === 'desktop') {
    return (
      <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl flex flex-col shadow-xl select-none overflow-hidden">
        {/* Unified Tool Tabs Header */}
        <div className="grid grid-cols-7 gap-0.5 bg-[#0A0B0E] p-1.5 border-b border-white/[0.06] shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = (resolvedPanel === t.id);
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActivePanel(t.id);
                  if (t.id === 'captions') {
                    useEditorStore.getState().setSelection({ type: 'caption', id: 'main' });
                  } else if (t.id === 'layout') {
                    const layers = useEditorStore.getState().edl?.layers;
                    const firstId = layers && layers.length > 0 ? layers[0].id : null;
                    if (firstId) {
                      useEditorStore.getState().setSelection({ type: 'layer', id: firstId });
                    }
                  } else {
                    useEditorStore.getState().setSelection({ type: 'none', id: null });
                  }
                }}
                className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#1A1D24] text-[#8FD3FF] shadow-sm border border-white/[0.08]'
                    : 'text-[#8B90A0] hover:text-[#E8EAF0] hover:bg-white/[0.02]'
                }`}
                title={t.label}
              >
                <Icon size={13} />
                <span className="truncate mt-0.5">{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <PanelComponent isCompact={false} />
        </div>
      </div>
    );
  }

  // 2. LANDSCAPE SIDE DRAWER EMBED
  if (mode === 'tablet' && window.innerWidth > window.innerHeight && window.innerHeight < 520) {
    if (!activePanel) return null;
    return (
      <div className="fixed inset-y-0 right-0 w-80 bg-[#0E1118]/95 backdrop-blur-xl border-l border-white/10 z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <config.icon size={14} className="text-[#8FD3FF]" />
            <span className="font-bold text-white text-xs">{config.label}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <PanelComponent isCompact={true} />
        </div>
      </div>
    );
  }

  // 3. PHONE / TABLET BOTTOM SHEET EMBED
  if (sheetSnap === 'closed' || !activePanel) {
    return null;
  }

  const snapHeightClasses = {
    peek: 'h-[28vh]',
    half: 'h-[52vh]',
    full: 'h-[88vh]',
  }[sheetSnap] || 'h-[52vh]';

  return (
    <div 
      className={`w-full bg-[#0E1118]/98 backdrop-blur-2xl border-t border-white/[0.1] rounded-t-3xl shadow-[0_-10px_30px_rgba(0,0,0,0.8)] flex flex-col shrink-0 z-40 transition-all duration-300 ease-out select-none ${snapHeightClasses}`}
      style={{ overscrollBehavior: 'none' }}
    >
      {/* 44dp Touch Drag Handle Header */}
      <div 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="h-11 px-4 flex items-center justify-between shrink-0 cursor-grab active:cursor-grabbing border-b border-white/[0.04]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <config.icon size={15} className="text-[#8FD3FF] shrink-0" />
          <span className="font-extrabold text-white text-xs truncate">
            {config.label}
          </span>
        </div>

        {/* Center Pill Grab Bar */}
        <div className="w-12 h-1.5 rounded-full bg-white/20 hover:bg-white/40 transition-colors" />

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              if (sheetSnap === 'half') onSetSnap?.('full');
              else if (sheetSnap === 'full') onSetSnap?.('peek');
              else onSetSnap?.('half');
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white"
            title="Toggle sheet height"
          >
            {sheetSnap === 'full' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white"
            title="Close"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Sheet Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
        <PanelComponent isCompact={sheetSnap === 'peek'} />
      </div>
    </div>
  );
}

