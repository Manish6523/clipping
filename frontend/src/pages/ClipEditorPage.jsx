import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { 
  FolderKanban, 
  Palette, 
  Settings 
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import TopBar from '../components/editor/TopBar';
import LeftPanel from '../components/editor/LeftPanel';
import PreviewStage from '../components/editor/PreviewStage';
import Inspector from '../components/editor/Inspector';
import Timeline from '../components/editor/Timeline';

export default function ClipEditorPage() {
  const { clipId } = useParams();
  const { 
    initClip, 
    loading, 
    edl,
    clip,
    duration,
    currentTime,
    setCurrentTime,
    saveEDL, 
    undo, 
    redo, 
    splitSegmentAtPlayhead,
    changeClipBounds,
    selection,
    clearSelection
  } = useEditorStore();
  const videoRef = useRef(null);

  useEffect(() => {
    if (clipId) {
      initClip(clipId);
    }
  }, [clipId, initClip]);

  // Central useShortcuts handler (frame-by-frame, 1s step, word boundaries, escape, space)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if inside text input, textarea, select or contenteditable
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }

      const v = videoRef.current;
      const startOffset = edl?.source?.start || clip?.adjusted_start || 0;
      const endOffset = edl?.source?.end || clip?.adjusted_end || (startOffset + duration);

      // Escape clears selection
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      // Save EDL
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveEDL();
        return;
      }

      // Space Play / Pause
      if (e.key === ' ') {
        e.preventDefault();
        if (v) {
          if (v.paused) v.play();
          else v.pause();
        }
        return;
      }

      // Split at Playhead
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        splitSegmentAtPlayhead();
        return;
      }

      // Set In Point (I)
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        if (currentTime < endOffset - 3.0) {
          changeClipBounds(Math.round(currentTime * 10) / 10, endOffset);
        }
        return;
      }

      // Set Out Point (O)
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (currentTime > startOffset + 3.0) {
          changeClipBounds(startOffset, Math.round(currentTime * 10) / 10);
        }
        return;
      }

      // Home: Jump to clip start
      if (e.key === 'Home') {
        e.preventDefault();
        if (v) v.currentTime = startOffset;
        setCurrentTime(startOffset);
        return;
      }

      // End: Jump to clip end
      if (e.key === 'End') {
        e.preventDefault();
        if (v) v.currentTime = endOffset;
        setCurrentTime(endOffset);
        return;
      }

      // Arrow keys (Frame-stepping & word boundary navigation)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); // Stop timeline or window scroll
        const isRight = e.key === 'ArrowRight';
        const cur = v ? v.currentTime : currentTime;

        if (e.ctrlKey || e.metaKey) {
          // Jump to prev/next word boundary
          const words = (edl?.words || []).filter((w) => !w.deleted);
          if (isRight) {
            const nextWord = words.find((w) => w.start > cur + 0.05);
            if (nextWord) {
              if (v) v.currentTime = nextWord.start;
              setCurrentTime(nextWord.start);
            }
          } else {
            const prevWord = [...words].reverse().find((w) => w.start < cur - 0.05);
            if (prevWord) {
              if (v) v.currentTime = prevWord.start;
              setCurrentTime(prevWord.start);
            }
          }
        } else if (e.shiftKey) {
          // Step 1.0 second
          const target = Math.max(startOffset, Math.min(endOffset, cur + (isRight ? 1.0 : -1.0)));
          if (v) v.currentTime = target;
          setCurrentTime(target);
        } else {
          // Step 1 frame (1/30s = ~0.0333s)
          const frameTime = 1 / 30;
          const target = Math.max(startOffset, Math.min(endOffset, cur + (isRight ? frameTime : -frameTime)));
          if (v) v.currentTime = target;
          setCurrentTime(target);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    undo,
    redo,
    saveEDL,
    splitSegmentAtPlayhead,
    changeClipBounds,
    currentTime,
    duration,
    edl,
    clip,
    clearSelection,
    setCurrentTime
  ]);

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

        {/* 3-Column Studio: Left Tools (~220px) | Center Dual Canvases (Expanded) | Right Inspector (~280px) */}
        <div className="flex-1 px-3 py-2 grid grid-cols-[220px_1fr_280px] gap-3 min-h-0 overflow-hidden">
          {/* Left Tools Panel (Scrolls internally) */}
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            <LeftPanel />
          </div>

          {/* Center Stage Row: Dual Canvases get all freed height, bottom panel deleted */}
          <div className="h-full min-h-0 flex flex-col">
            <PreviewStage videoRef={videoRef} />
          </div>

          {/* Right Inspector Panel (Contextual sidebar driven by selection) */}
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
