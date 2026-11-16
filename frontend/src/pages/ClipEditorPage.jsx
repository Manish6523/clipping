import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEditorStore } from '../store/editorStore';
import { useLayoutMode } from '../hooks/useLayoutMode';
import TopBar from '../components/editor/TopBar';
import LeftPanel from '../components/editor/LeftPanel';
import PreviewStage from '../components/editor/PreviewStage';
import Timeline from '../components/editor/Timeline';
import PanelHost from '../components/editor/PanelHost';

// Mobile specific components
import MobileTopBar from '../components/editor/MobileTopBar';
import MobileStage from '../components/editor/MobileStage';
import LayerChipStrip from '../components/editor/LayerChipStrip';
import MobileTimelineStrip from '../components/editor/MobileTimelineStrip';
import MobileToolBar from '../components/editor/MobileToolBar';

import { 
  FolderKanban, 
  Palette, 
  Settings,
  Layers,
  Sparkles
} from 'lucide-react';

export default function ClipEditorPage() {
  const { clipId } = useParams();
  const { 
    clip, 
    edl, 
    loading, 
    initClip, 
    saveEDL,
    updateEDL,
    undo,
    redo,
    setCurrentTime,
    currentTime,
    selection,
    setSelection,
    clearSelection,
    splitSegmentAtPlayhead,
    activePanel,
    setActivePanel,
    sheetSnap,
    setSheetSnap,
    closeSheet
  } = useEditorStore();

  const { isPhone, isTablet, isDesktop, isLandscape, isTouch, height: viewH } = useLayoutMode();
  // a phone held sideways is reported as 'tablet' by width; the editor wants its phone-landscape layout there
  const phoneLandscape = isLandscape && isTouch && viewH < 520;
  const phonePortrait = isPhone && !isLandscape;
  const navigate = useNavigate();
  const leaveTo = (path) => {
    if (useEditorStore.getState().hasUnsavedChanges && !window.confirm('Leave the editor with unsaved changes?')) return;
    navigate(path);
  };
  const videoRef = useRef(null);
  const [rendering, setRendering] = useState(false);
  const [showSafeAreas, setShowSafeAreas] = useState(false);
  const [fullTimelineOpen, setFullTimelineOpen] = useState(false);

  // Effective profanity settings: global/template config from the server + per-clip override.
  const censorCfg = edl?._censor_cfg ? { ...edl._censor_cfg, ...(edl?.censor || {}) } : null;

  useEffect(() => {
    if (clipId) {
      initClip(clipId);
    }
  }, [clipId, initClip]);

  const handleRender = async () => {
    try {
      setRendering(true);
      await saveEDL();
      const res = await fetch(`/api/clips/${clipId}/render-edl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edl),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start render');

      if (data.status === 'completed') {
        alert('Render completed successfully!');
        setRendering(false);
        return;
      }

      // Poll background status every 2 seconds
      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/clips/${clipId}/render-status`);
          const pollData = await pollRes.json();
          if (pollData.status === 'completed') {
            clearInterval(pollInterval);
            setRendering(false);
            alert('Render completed successfully!');
          } else if (pollData.status === 'failed') {
            clearInterval(pollInterval);
            setRendering(false);
            alert('Render failed: ' + (pollData.error || 'Unknown error'));
          }
        } catch (pollErr) {
          console.warn('Poll error:', pollErr);
        }
      }, 2000);
    } catch (err) {
      alert(`Render error: ${err.message}`);
      setRendering(false);
    }
  };

  const updateCaptionPos = (x, y) => {
    updateEDL((prev) => ({
      ...prev,
      captions: {
        ...(prev.captions || {}),
        position: {
          x: Math.round(x * 1000) / 1000,
          y: Math.round(y * 1000) / 1000,
          max_width: prev.captions?.position?.max_width ?? 0.85,
        },
      },
    }));
  };

  // Synchronize master video playback clock with store
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleTimeUpdate = () => {
      const now = v.currentTime;
      setCurrentTime(now);

      if (edl?.words) {
        for (const w of edl.words) {
          if (w.deleted && now >= w.start && now < w.end) {
            v.currentTime = w.end;
            break;
          }
        }
      }
    };

    v.addEventListener('timeupdate', handleTimeUpdate);
    return () => v.removeEventListener('timeupdate', handleTimeUpdate);
  }, [edl, setCurrentTime]);

  // Keyboard Shortcuts (desktop)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }
      const v = videoRef.current;

      if (e.key === 'Escape') {
        clearSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveEDL();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (v) {
          if (v.paused) v.play();
          else v.pause();
        }
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        splitSegmentAtPlayhead();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, saveEDL, splitSegmentAtPlayhead, clearSelection]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-canvas flex flex-col items-center justify-center gap-4 text-muted">
        <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono tracking-wider text-accent">
          LOADING CLIP EDL &amp; SOURCE MEDIA...
        </span>
      </div>
    );
  }

  // =========================================================================
  // 1. PHONE PORTRAIT LAYOUT: Height 100dvh, TopBar / Stage (Resizes) / Timeline / ToolBar
  // =========================================================================
  const fullTimelineOverlay = (
    <>
        {fullTimelineOpen && (
          <div className="fixed inset-x-0 bottom-0 top-12 bg-surface/98 backdrop-blur-2xl border-t border-white/10 z-50 flex flex-col p-3 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="font-extrabold text-xs text-white">Full Timeline &amp; Word Cuts</span>
              <button
                onClick={() => setFullTimelineOpen(false)}
                className="text-slate-200 hover:text-white min-h-[44px] px-4 rounded-xl bg-white/5 text-xs font-bold"
              >
                Done
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pt-3">
              <Timeline videoRef={videoRef} />
            </div>
          </div>
        )}
    </>
  );

  if (phonePortrait) {
    return (
      <div 
        className="h-[100dvh] w-screen bg-canvas text-ink flex flex-col overflow-clip select-none"
        style={{ overscrollBehavior: 'none' }}
        data-editor-root
      >
        {/* 1. Mobile Top Bar (48dp) - overflow-clip on the root: nothing can scroll it out of view */}
        <MobileTopBar 
          onRender={handleRender}
          rendering={rendering}
          showSafeAreas={showSafeAreas}
          onToggleSafeAreas={() => setShowSafeAreas(!showSafeAreas)}
        />

        {/* 2. Responsive Stage (Resizes gracefully when bottom sheet opens so you always see live video) */}
        <div className="flex-1 min-h-0 overflow-clip flex flex-col relative">
          <MobileStage 
            layout={edl?.layout}
            onChange={(nextLayout) => {
              updateEDL((prev) => ({ ...prev, layout: nextLayout }));
            }}
            sourceMediaUrl={clipId ? `/api/clips/${clipId}/source` : null}
            videoRef={videoRef}
            captionsConfig={{
              ...(edl?.captions || {}),
              censor: censorCfg,
              onChangePos: updateCaptionPos,
            }}
            words={edl?.words || []}
            currentTime={currentTime}
            selectedLayerId={selection?.type === 'layer' ? selection.id : null}
            onSelectLayer={(id) => {
              setSelection(id ? { type: 'layer', id } : { type: 'none', id: null });
              if (id) setActivePanel('layout');
            }}
            onSelectCaption={() => {
              setSelection({ type: 'caption', id: 'main' });
              setActivePanel('captions');
            }}
            showSafeArea={showSafeAreas}
            isPhone={true}
          />
        </div>

        {/* 3. Layer Chip Quick Selector Strip (hidden while a tool sheet is open: the stage needs that room) */}
        {(!activePanel || sheetSnap === 'closed') && <LayerChipStrip />}

        {/* 4. Transport & Fixed-Center Scrub Strip */}
        <MobileTimelineStrip 
          videoRef={videoRef} 
          onExpandTimeline={() => setFullTimelineOpen(!fullTimelineOpen)}
        />

        {/* 5. Mobile Bottom Sheet for Active Tool Settings (Resizes viewport) */}
        <PanelHost 
          mode="phone"
          activePanel={activePanel}
          onClose={() => setActivePanel(null)}
          sheetSnap={sheetSnap}
          onSetSnap={setSheetSnap}
        />

        {/* 6. Mobile Bottom Tool Bar (56dp + Safe Area) */}
        <MobileToolBar />

        {fullTimelineOverlay}
      </div>
    );
  }

  // =========================================================================
  // 2. PHONE LANDSCAPE LAYOUT: Side-by-Side Dual Canvases + Side Drawer
  // =========================================================================
  if (phoneLandscape) {
    return (
      <div 
        className="h-[100dvh] w-screen bg-canvas text-ink flex flex-col overflow-clip select-none"
        style={{ overscrollBehavior: 'none' }}
        data-editor-root
      >
        {/* Slim Top Bar */}
        <MobileTopBar 
          onRender={handleRender}
          rendering={rendering}
          showSafeAreas={showSafeAreas}
          onToggleSafeAreas={() => setShowSafeAreas(!showSafeAreas)}
        />

        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          {/* Main Dual Stage Row */}
          <div className="flex-1 flex items-center justify-center gap-2 p-1 overflow-hidden">
            <MobileStage 
              layout={edl?.layout}
              onChange={(nextLayout) => {
                updateEDL((prev) => ({ ...prev, layout: nextLayout }));
              }}
              sourceMediaUrl={clipId ? `/api/clips/${clipId}/source` : null}
              videoRef={videoRef}
              captionsConfig={{
                ...(edl?.captions || {}),
                censor: censorCfg,
                onChangePos: updateCaptionPos,
              }}
              words={edl?.words || []}
              currentTime={currentTime}
              selectedLayerId={selection?.type === 'layer' ? selection.id : null}
              onSelectLayer={(id) => {
                setSelection(id ? { type: 'layer', id } : { type: 'none', id: null });
                if (id) setActivePanel('layout');
              }}
              onSelectCaption={() => {
                setSelection({ type: 'caption', id: 'main' });
                setActivePanel('captions');
              }}
              showSafeArea={showSafeAreas}
              isPhone={true}
            />
          </div>

          {/* Side Drawer for Tool Panel */}
          {activePanel && (
            <div className="w-[min(320px,45vw)] h-full border-l border-white/10 bg-surface shrink-0 z-40">
              <PanelHost 
                mode="landscape"
                activePanel={activePanel}
                onClose={() => setActivePanel(null)}
              />
            </div>
          )}
        </div>

        {/* Bottom: compact transport + scrub (left) and the tool buttons (right) */}
        <div className="shrink-0 flex items-stretch border-t border-white/[0.06] bg-canvas">
          <div className="min-w-0 flex-1">
            <MobileTimelineStrip videoRef={videoRef} compact onExpandTimeline={() => setFullTimelineOpen(true)} />
          </div>
          <div className="flex shrink-0 items-center pr-1">
            <MobileToolBar compact />
          </div>
        </div>
        {fullTimelineOverlay}
      </div>
    );
  }

  // =========================================================================
  // 3. DESKTOP & TABLET LAYOUT: 3 Columns with shared panels
  // =========================================================================
  return (
    <div className="h-screen w-screen bg-canvas text-ink flex flex-col md:flex-row overflow-hidden" data-editor-root>
      {/* Slim 48px Far-Left Icon Rail */}
      <aside className="hidden md:flex w-12 bg-canvas border-r border-white/[0.06] flex-col items-center justify-between py-4 select-none shrink-0 z-40">
        <div className="flex flex-col items-center gap-5">
          <button type="button" onClick={() => leaveTo('/')} title="AutoClip home" aria-label="AutoClip home"
            className="w-8 h-8 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 rounded-xl bg-gradient-to-tr from-accent to-accent flex items-center justify-center text-canvas font-black text-sm shadow-md shadow-accent/20">
            M
          </button>
          <nav className="flex flex-col items-center gap-3" aria-label="Go to">
            <button type="button" onClick={() => leaveTo('/')} title="Clips (Review)" aria-label="Clips (Review)" className="p-2 rounded-xl text-accent bg-white/[0.06]">
              <FolderKanban size={15} />
            </button>
            <button type="button" onClick={() => leaveTo('/templates')} title="Templates" aria-label="Templates" className="p-2 rounded-xl text-muted hover:text-white transition-all">
              <Palette size={15} />
            </button>
          </nav>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button type="button" onClick={() => leaveTo('/settings')} title="Settings" aria-label="Settings" className="p-2 rounded-xl text-muted hover:text-white transition-all">
            <Settings size={15} />
          </button>
        </div>
      </aside>

      {/* Main Studio Viewport */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Slim Top Bar */}
        <TopBar />

        {/* 2-Column Studio: Center Dual Canvases | Right Unified Inspector & Tool Host */}
        <div className="flex-1 px-3 py-2 grid grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px] gap-3 min-h-0 overflow-hidden">
          {/* Center Stage Row: Dual Canvases */}
          <div className="h-full min-h-0 flex flex-col">
            <PreviewStage videoRef={videoRef} />
          </div>

          {/* Right Unified Inspector & Tool Host */}
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            <PanelHost mode="desktop" />
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
