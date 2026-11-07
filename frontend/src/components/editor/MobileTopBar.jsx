import React, { useState } from 'react';
import { 
  ArrowLeft, 
  Scissors, 
  RotateCcw, 
  RotateCw, 
  MoreVertical,
  BookmarkPlus,
  Smartphone,
  Sparkles,
  HelpCircle,
  Maximize2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEditorStore } from '../../store/editorStore';

export default function MobileTopBar({ 
  onOpenOverflow, 
  onRender, 
  rendering = false,
  showSafeAreas,
  onToggleSafeAreas
}) {
  const navigate = useNavigate();
  const { clip, hasUnsavedChanges, saving, lastSaved, undo, redo } = useEditorStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleBack = () => {
    if (hasUnsavedChanges) {
      if (!confirm('Return to dashboard with unsaved changes?')) return;
    }
    navigate('/');
  };

  return (
    <header 
      className="h-12 bg-[#0A0B0E] border-b border-white/[0.06] px-3 flex items-center justify-between gap-2 select-none shrink-0 z-30"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Left: Back & Title with Save Indicator */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          onClick={handleBack}
          className="w-9 h-9 rounded-xl bg-white/[0.04] active:bg-white/10 text-[#8B90A0] hover:text-white flex items-center justify-center shrink-0 border border-white/[0.06]"
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <span className="font-extrabold text-white text-xs truncate max-w-[140px] sm:max-w-xs">
            {clip?.title || 'Clip Editor'}
          </span>
          {/* Status Dot */}
          <span 
            className={`w-2 h-2 rounded-full shrink-0 ${
              saving 
                ? 'bg-[#8FD3FF] animate-ping' 
                : hasUnsavedChanges 
                ? 'bg-amber-400' 
                : 'bg-emerald-400'
            }`} 
            title={saving ? 'Saving...' : hasUnsavedChanges ? 'Unsaved edits' : 'Saved'}
          />
        </div>
      </div>

      {/* Center: Undo / Redo */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={undo}
          className="w-8 h-8 rounded-lg text-[#8B90A0] active:text-white active:bg-white/10 flex items-center justify-center"
          title="Undo"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={redo}
          className="w-8 h-8 rounded-lg text-[#8B90A0] active:text-white active:bg-white/10 flex items-center justify-center"
          title="Redo"
        >
          <RotateCw size={14} />
        </button>
      </div>

      {/* Right: Primary Render + Overflow Menu */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onRender}
          disabled={rendering}
          className="h-8 px-3 rounded-xl bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] text-[#0A0B0E] font-black text-xs flex items-center gap-1.5 shadow-md shadow-[#8FD3FF]/20 active:scale-95 transition-all disabled:opacity-50"
        >
          <Scissors size={13} className={rendering ? "animate-spin" : ""} />
          <span>{rendering ? '...' : 'RENDER'}</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-8 h-8 rounded-lg text-[#8B90A0] active:text-white active:bg-white/10 flex items-center justify-center"
          >
            <MoreVertical size={16} />
          </button>

          {menuOpen && (
            <div 
              className="absolute right-0 top-full mt-1.5 w-48 bg-[#0E1118]/98 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95"
              onClick={() => setMenuOpen(false)}
            >
              <button
                onClick={onToggleSafeAreas}
                className="w-full px-3 py-2 text-left text-xs font-bold text-slate-200 hover:bg-white/5 rounded-xl flex items-center gap-2"
              >
                <Smartphone size={14} className={showSafeAreas ? "text-amber-400" : "text-slate-400"} />
                <span>Safe Areas: {showSafeAreas ? 'ON' : 'OFF'}</span>
              </button>
              <button
                onClick={() => onOpenOverflow?.('preset')}
                className="w-full px-3 py-2 text-left text-xs font-bold text-slate-200 hover:bg-white/5 rounded-xl flex items-center gap-2"
              >
                <BookmarkPlus size={14} className="text-[#8FD3FF]" />
                <span>Save as Preset</span>
              </button>
              <button
                onClick={() => onOpenOverflow?.('test_render')}
                className="w-full px-3 py-2 text-left text-xs font-bold text-slate-200 hover:bg-white/5 rounded-xl flex items-center gap-2"
              >
                <Sparkles size={14} className="text-amber-400" />
                <span>Test Render Frame</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
