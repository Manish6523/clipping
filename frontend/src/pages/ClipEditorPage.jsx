import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { 
  Home, 
  FolderKanban, 
  Palette, 
  Star, 
  Settings, 
  HelpCircle 
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import TopBar from '../components/editor/TopBar';
import LeftPanel from '../components/editor/LeftPanel';
import PreviewStage from '../components/editor/PreviewStage';
import Inspector from '../components/editor/Inspector';
import Timeline from '../components/editor/Timeline';

export default function ClipEditorPage() {
  const { clipId } = useParams();
  const { initClip, loading, saveEDL, undo, redo, splitSegmentAtPlayhead } = useEditorStore();
  const videoRef = useRef(null);

  useEffect(() => {
    if (clipId) {
      initClip(clipId);
    }
  }, [clipId, initClip]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveEDL();
      } else if (e.key === 'c' || e.key === 'C') {
        splitSegmentAtPlayhead();
      } else if (e.key === ' ') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) {
          if (v.paused) v.play();
          else v.pause();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, saveEDL, splitSegmentAtPlayhead]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-[#0A0B0E] flex flex-col items-center justify-center gap-4 text-[#8B90A0]">
        <div className="w-10 h-10 border-2 border-[#8FD3FF] border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono tracking-wider text-[#8FD3FF]">
          LOADING CLIP EDL &amp; SOURCE MEDIA...
        </span>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#0A0B0E] text-[#E8EAF0] flex overflow-hidden">
      {/* Slim 48px Far-Left Icon Rail */}
      <aside className="w-12 bg-[#0A0B0E] border-r border-white/[0.06] flex flex-col items-center justify-between py-4 select-none shrink-0 z-40">
        <div className="flex flex-col items-center gap-5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#8FD3FF] to-[#A9B8FF] flex items-center justify-center text-[#0A0B0E] font-black text-sm shadow-md shadow-[#8FD3FF]/20">
            M
          </div>
          <nav className="flex flex-col items-center gap-3">
            <button className="p-2 rounded-xl text-[#8FD3FF] bg-white/[0.06]">
              <FolderKanban size={15} />
            </button>
            <button className="p-2 rounded-xl text-[#8B90A0] hover:text-white transition-all">
              <Palette size={15} />
            </button>
          </nav>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button className="p-2 rounded-xl text-[#8B90A0] hover:text-white transition-all">
            <Settings size={15} />
          </button>
        </div>
      </aside>

      {/* Main Studio Viewport (One Screen, Height-Fit 100dvh, No Page Scroll) */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Slim Top Bar */}
        <TopBar />

        {/* Floating 3-Panel Main Row */}
        <div className="flex-1 px-3 py-2 grid grid-cols-[230px_1fr_240px] gap-3 min-h-0 overflow-hidden">
          {/* Left Tools Panel (Scrolls internally) */}
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            <LeftPanel />
          </div>

          {/* Center Stage Row: 16:9 Source Picker & 9:16 Live Canvas */}
          <div className="h-full min-h-0 flex flex-col">
            <PreviewStage videoRef={videoRef} />
          </div>

          {/* Right Inspector Panel (Scrolls internally, never clipped) */}
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            <Inspector />
          </div>
        </div>

        {/* Unified Bottom Timeline Bar */}
        <div className="px-3 pb-2 shrink-0">
          <Timeline videoRef={videoRef} />
        </div>
      </div>
    </div>
  );
}
