import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  Undo2, 
  Redo2, 
  Play, 
  MoreHorizontal, 
  Check, 
  AlertTriangle,
  Loader2,
  Copy,
  Upload,
  Download,
  Trash2,
  HelpCircle,
  Sparkles,
  Layers,
  Sliders,
  Smartphone
} from 'lucide-react';
import { useTemplateEditorStore } from '../store/templateEditorStore';
import { getTemplates, saveTemplate, deleteTemplate, getChannels, testTemplateSample } from '../api';
import LayerStackPanel from './editor/LayerStackPanel';
import ContextualInspector from './editor/ContextualInspector';
import LayoutBuilder from './LayoutBuilder';
import MobileStage from './editor/MobileStage';
import { useLayoutMode } from '../hooks/useLayoutMode';

export default function TemplateStudioEditor() {
  const { name: routeName } = useParams();
  const navigate = useNavigate();
  const { isPhone, isLandscape } = useLayoutMode();

  const {
    templateName,
    setTemplateName,
    description,
    layout,
    subtitles,
    watermark,
    defaultCaptionStyle,
    defaultHookStyle,
    selection,
    setSelection,
    loadTemplate,
    isDirty,
    undo,
    redo,
    history,
    redoStack,
    previewMediaUrl,
    setPreviewMediaUrl,
    selectedChannel,
    setSelectedChannel,
    testRenderOpen,
    setTestRenderOpen
  } = useTemplateEditorStore();

  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState([]);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = localStorage.getItem('template_studio_split_ratio');
    return saved ? parseFloat(saved) : 0.58;
  });
  const [stageFocus, setStageFocus] = useState('both'); // 'both' | 'source' | 'output'
  const isDraggingSplitter = useRef(false);
  const splitContainerRef = useRef(null);
  const [activeMobileTab, setActiveMobileTab] = useState('layers'); // 'layers' | 'inspector'

  // Test Render State
  const [testingSample, setTestingSample] = useState(false);
  const [sampleVideoUrl, setSampleVideoUrl] = useState(null);
  const [testRenderError, setTestRenderError] = useState(null);

  // Load Template on mount
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      try {
        const [allTemplates, allChannels] = await Promise.all([
          getTemplates(),
          getChannels().catch(() => [])
        ]);

        if (!mounted) return;
        setChannels(Array.isArray(allChannels) ? allChannels : []);

        const target = (allTemplates || []).find((t) => t.name === routeName);
        if (target) {
          // Check for recoverable draft
          try {
            const rawDraft = localStorage.getItem(`template_draft_${target.name}`);
            if (rawDraft) {
              const draftObj = JSON.parse(rawDraft);
              if (draftObj && draftObj.data && (Date.now() - draftObj.timestamp < 24 * 3600 * 1000)) {
                if (window.confirm(`Unsaved draft found for "${target.name}". Restore it?`)) {
                  loadTemplate(draftObj.data);
                  useTemplateEditorStore.setState({ isDirty: true });
                } else {
                  localStorage.removeItem(`template_draft_${target.name}`);
                  loadTemplate(target);
                }
              } else {
                loadTemplate(target);
              }
            } else {
              loadTemplate(target);
            }
          } catch (e) {
            loadTemplate(target);
          }
          if (allChannels.length > 0) {
            const assigned = allChannels.find((c) => c.template_name === target.name);
            const targetChannel = assigned ? assigned.channel_id_or_handle : allChannels[0].channel_id_or_handle;
            setSelectedChannel(targetChannel);
            setPreviewMediaUrl(`/api/channels/${targetChannel}/frame?t=${Date.now()}`);
          } else {
            setPreviewMediaUrl('/placeholders/streamer_reference_16_9.jpg');
          }
        } else {
          // If template doesn't exist, redirect back to gallery
          navigate('/templates', { replace: true });
        }
      } catch (err) {
        console.error('Failed to load template:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [routeName]);

  // Build Payload
  const getPayload = () => {
    const state = useTemplateEditorStore.getState();
    return {
      name: state.templateName.trim(),
      description: state.description.trim(),
      min_virality_score: state.minScore || 65,
      chat_spike_multiplier: 2.5,
      hype_keywords: ['CLIP IT', 'WTF', 'LMAO', 'OMG', 'W', 'L'],
      layout: {
        ...state.layout,
        schema: 2,
        canvas: { w: 1080, h: 1920 }
      },
      subtitles: {
        ...state.subtitles,
        font_size: Number(state.subtitles.font_size),
        outline: Number(state.subtitles.outline),
        shadow: Number(state.subtitles.shadow),
      },
      caption_style: state.defaultCaptionStyle !== 'template' ? state.defaultCaptionStyle : undefined,
      hook_style: state.defaultHookStyle,
      watermark: state.watermark.enabled && state.watermark.path ? {
        watermark_path: state.watermark.path,
        watermark_position: state.watermark.position,
        watermark_x: state.watermark.x,
        watermark_y: state.watermark.y,
        watermark_opacity: Number(state.watermark.opacity),
        watermark_width: Number(state.watermark.width),
      } : undefined,
    };
  };

  // Save Template Action
  const handleSave = async () => {
    const payload = getPayload();
    if (!payload.name) {
      alert('Template name is required');
      return;
    }
    if ((payload.layout.layers || []).length === 0) {
      alert('Layout must contain at least 1 layer.');
      return;
    }

    try {
      await saveTemplate(payload);
      useTemplateEditorStore.setState({ isDirty: false });
      localStorage.removeItem(`template_draft_${templateName}`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      alert('Failed to save template: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  // Autosave dirty state to localStorage draft
  useEffect(() => {
    if (!templateName || !isDirty) return;
    const timer = setTimeout(() => {
      try {
        const payload = getPayload();
        localStorage.setItem(`template_draft_${templateName}`, JSON.stringify({
          timestamp: Date.now(),
          data: payload
        }));
      } catch (e) {}
    }, 1000);
    return () => clearTimeout(timer);
  }, [templateName, isDirty, layout, subtitles, watermark, defaultCaptionStyle, defaultHookStyle]);

  // Test Render Execution
  const handleTestRender = async () => {
    setTestingSample(true);
    setSampleVideoUrl(null);
    setTestRenderError(null);
    setTestRenderOpen(true);

    try {
      const payload = {
        template: getPayload(),
        channel_id: selectedChannel || channels[0]?.channel_id_or_handle || 'general'
      };
      const res = await testTemplateSample(payload);
      if (res && res.video_url) {
        setSampleVideoUrl(res.video_url);
      } else {
        throw new Error('Test render completed without a video stream URL');
      }
    } catch (err) {
      setTestRenderError(err.response?.data?.error?.message || err.message);
    } finally {
      setTestingSample(false);
    }
  };

  // Draggable Split Divider Logic
  const handleSplitPointerDown = (e) => {
    e.preventDefault();
    isDraggingSplitter.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onPointerMove = (moveEvent) => {
      if (!isDraggingSplitter.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const rawRatio = (moveEvent.clientX - rect.left) / rect.width;
      const clamped = Math.max(0.25, Math.min(0.75, rawRatio));
      setSplitRatio(clamped);
      localStorage.setItem('template_studio_split_ratio', clamped.toFixed(3));
    };

    const onPointerUp = () => {
      isDraggingSplitter.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Keyboard Navigation & Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept if user is typing in an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'Escape') {
        setSelection({ type: 'template', id: null });
      } else if (e.key === '?') {
        setShowShortcuts(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  if (loading) {
    return (
      <div className="w-full h-[calc(100dvh-57px)] flex items-center justify-center bg-canvas">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full h-[calc(100dvh-57px-64px-env(safe-area-inset-bottom))] md:h-[calc(100dvh-57px)] flex flex-col bg-canvas select-none overflow-hidden">
      {/* 1. SLIM TOP BAR */}
      <div className="h-12 border-b border-white/[0.08] px-3 sm:px-4 flex items-center justify-between shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/templates')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Back to Templates Gallery"
          >
            <ArrowLeft size={16} />
          </button>

          {/* Inline Editable Template Title */}
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="bg-transparent text-sm font-extrabold text-white font-mono focus:outline-none focus:bg-raised/80 rounded px-1.5 py-0.5 truncate border border-transparent focus:border-white/20"
              title="Click to rename template"
            />
            {isDirty ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full shrink-0">
                <AlertTriangle size={9} /> Unsaved
              </span>
            ) : saveSuccess ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full shrink-0">
                <Check size={9} /> Saved
              </span>
            ) : null}
          </div>
        </div>

        {/* Center/Right Control Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Undo / Redo */}
          <div className="flex items-center bg-raised border border-white/10 rounded-xl p-0.5">
            <button
              onClick={undo}
              disabled={history.length === 0}
              title="Undo (Ctrl+Z)"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Undo2 size={13} />
            </button>
            <button
              onClick={redo}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Shift+Z)"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Redo2 size={13} />
            </button>
          </div>

          {/* Test Render Button */}
          <button
            onClick={handleTestRender}
            disabled={testingSample}
            title="Render 3-second real sample via FFmpeg"
            className="flex items-center gap-1 bg-raised hover:bg-white/10 text-amber-300 font-bold px-2.5 py-1.5 rounded-xl text-xs border border-amber-500/30 shadow-sm"
          >
            {testingSample ? <Loader2 size={12} className="animate-spin text-amber-400" /> : <Play size={12} className="text-amber-400" />}
            <span className="hidden sm:inline">Test Render</span>
          </button>

          {/* Primary Save Button */}
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 bg-accent hover:bg-accent/90 text-black font-extrabold px-3.5 py-1.5 rounded-xl text-xs shadow-md shadow-accent/20 transition-all cursor-pointer"
          >
            <Save size={13} />
            <span>Save</span>
          </button>

          {/* Overflow Menu */}
          <div className="relative">
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              className="p-1.5 rounded-xl bg-raised border border-white/10 text-slate-300 hover:text-white hover:bg-white/10"
              title="More Actions"
            >
              <MoreHorizontal size={14} />
            </button>

            {showOverflow && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-raised border border-white/10 rounded-xl shadow-2xl p-1 z-50 flex flex-col gap-0.5 text-xs">
                <button
                  onClick={() => {
                    setShowOverflow(false);
                    setShowShortcuts(true);
                  }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-slate-300 hover:text-white hover:bg-white/10"
                >
                  <HelpCircle size={13} /> Keyboard Shortcuts (?)
                </button>
                <button
                  onClick={() => {
                    setShowOverflow(false);
                    const tpl = getPayload();
                    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(tpl, null, 2));
                    const a = document.createElement('a');
                    a.href = dataStr;
                    a.download = `${templateName}.autoclip.json`;
                    a.click();
                  }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-slate-300 hover:text-white hover:bg-white/10"
                >
                  <Download size={13} /> Export (.autoclip.json)
                </button>
                <div className="h-px bg-white/10 my-0.5" />
                <button
                  onClick={async () => {
                    setShowOverflow(false);
                    if (!confirm(`Delete template "${templateName}"?`)) return;
                    await deleteTemplate(templateName);
                    navigate('/templates');
                  }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 size={13} /> Delete Template
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. MAIN WORKSPACE (Desktop Split vs Phone Viewport) */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* DESKTOP LAYOUT (3-Column: Layers | Center Stages | Contextual Inspector) */}
        {!isPhone ? (
          <>
            {/* Left Column: Layers Stack Panel (260px) */}
            <div className="w-64 border-r border-white/[0.08] flex flex-col shrink-0 bg-surface">
              <LayerStackPanel />
            </div>

            {/* Center Area: Dual Stages (16:9 Left Source, 9:16 Right Composite) */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-canvas p-3">
              <LayoutBuilder
                layout={layout}
                sourceMediaUrl={previewMediaUrl}
                captionsConfig={{
                  ...subtitles,
                  onChangePos: (newPos) => {
                    if (newPos && typeof newPos.y === 'number') {
                      useTemplateEditorStore.getState().updateSubtitles({ position: newPos });
                    }
                  }
                }}
                watermarkConfig={{
                  enabled: watermark.enabled,
                  path: watermark.path,
                  url: watermark.url,
                  position: watermark.position,
                  x: watermark.x,
                  y: watermark.y,
                  opacity: watermark.opacity,
                  width: watermark.width,
                  onChangePos: (newX, newY) => {
                    useTemplateEditorStore.getState().updateWatermark({ x: newX, y: newY, position: 'custom' });
                  },
                  onChangeWidth: (newW) => {
                    useTemplateEditorStore.getState().updateWatermark({ width: newW });
                  }
                }}
                selectedLayerId={selection.type === 'layer' ? selection.id : null}
                onSelectLayer={(id) => setSelection({ type: 'layer', id })}
                onChange={(nextLayout) => {
                  useTemplateEditorStore.setState({ layout: nextLayout, isDirty: true });
                }}
                mode="template"
                showToolbar={false}
                showBottomPanel={false}
              />
            </div>

            {/* Right Column: Contextual Inspector (300px) */}
            <div className="w-72 border-l border-white/[0.08] flex flex-col shrink-0 bg-surface">
              <ContextualInspector channels={channels} />
            </div>
          </>
        ) : (
          /* PHONE VIEWPORT (Adaptive MobileStage with Bottom Sheets) */
          <div className="w-full h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <MobileStage
                layout={layout}
                onPointerActionStart={() => useTemplateEditorStore.getState().pushHistory()}
                onChange={(next) => useTemplateEditorStore.setState({ layout: next, isDirty: true })}
                sourceMediaUrl={previewMediaUrl}
                captionsConfig={subtitles}
                selectedLayerId={selection.type === 'layer' ? selection.id : null}
                onSelectLayer={(id) => setSelection({ type: 'layer', id })}
                isPhone={true}
                mode="template"
              />

              {/* Mobile Drawer / Bottom Sheet for Layers or Properties */}
              {activeMobileTab && (
                <div className="absolute inset-x-0 bottom-0 max-h-[60%] bg-surface border-t border-white/10 rounded-t-2xl shadow-2xl z-40 flex flex-col overflow-hidden transition-all duration-200">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-raised/40">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5 capitalize">
                      {activeMobileTab === 'layers' ? <Layers size={13} className="text-accent" /> : <Sliders size={13} className="text-accent" />}
                      {activeMobileTab}
                    </span>
                    <button
                      onClick={() => setActiveMobileTab(null)}
                      className="text-xs font-bold text-slate-400 hover:text-white px-2 py-0.5 rounded"
                    >
                      Done
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {activeMobileTab === 'layers' ? (
                      <LayerStackPanel />
                    ) : (
                      <ContextualInspector channels={channels} />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Phone Bottom Switcher Bar */}
            <div className="h-12 bg-surface border-t border-white/10 px-3 flex items-center justify-around shrink-0 z-50">
              <button
                onClick={() => setActiveMobileTab(activeMobileTab === 'layers' ? null : 'layers')}
                className={`flex items-center gap-1.5 py-1 px-3 rounded-lg text-xs font-bold ${
                  activeMobileTab === 'layers' ? 'bg-accent/15 text-accent border border-accent/30' : 'text-slate-400'
                }`}
              >
                <Layers size={14} /> Layers
              </button>
              <button
                onClick={() => setActiveMobileTab(activeMobileTab === 'inspector' ? null : 'inspector')}
                className={`flex items-center gap-1.5 py-1 px-3 rounded-lg text-xs font-bold ${
                  activeMobileTab === 'inspector' ? 'bg-accent/15 text-accent border border-accent/30' : 'text-slate-400'
                }`}
              >
                <Sliders size={14} /> Properties
              </button>
            </div>
          </div>
        )}

        {/* Test Render Non-Blocking Slide-out Drawer */}
        {testRenderOpen && (
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-surface border-l border-white/10 shadow-2xl z-50 flex flex-col p-4 gap-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Play size={16} className="text-amber-400" />
                <h3 className="font-extrabold text-sm text-white">Test Render Sample</h3>
              </div>
              <button
                onClick={() => setTestRenderOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 flex flex-col justify-center items-center bg-black/40 rounded-xl border border-white/5 p-2 overflow-hidden">
              {testingSample ? (
                <div className="flex flex-col items-center gap-2 text-center p-4">
                  <Loader2 size={24} className="animate-spin text-amber-400" />
                  <span className="text-xs font-bold text-white">Executing FFmpeg Pipeline...</span>
                  <span className="text-[10px] text-muted">Compositing layers, subtitles & watermark</span>
                </div>
              ) : testRenderError ? (
                <div className="text-xs text-rose-300 p-3 text-center">{testRenderError}</div>
              ) : sampleVideoUrl ? (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <video
                    src={sampleVideoUrl}
                    controls
                    autoPlay
                    loop
                    className="max-h-full max-w-full rounded-lg shadow-lg aspect-[9/16]"
                  />
                </div>
              ) : null}
            </div>

            <div className="text-[11px] text-muted text-center">
              Rendered on-demand from channel source footage.
            </div>
          </div>
        )}

        {/* Keyboard Shortcuts Dialog */}
        {showShortcuts && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-sm p-5 shadow-2xl flex flex-col gap-3 text-xs">
              <h3 className="font-bold text-white text-sm">Keyboard Shortcuts</h3>
              <div className="flex flex-col gap-1.5 font-mono text-slate-300">
                <div className="flex justify-between py-1 border-b border-white/5"><span>Save Template</span><kbd className="bg-raised px-1.5 py-0.5 rounded text-white">Ctrl + S</kbd></div>
                <div className="flex justify-between py-1 border-b border-white/5"><span>Undo</span><kbd className="bg-raised px-1.5 py-0.5 rounded text-white">Ctrl + Z</kbd></div>
                <div className="flex justify-between py-1 border-b border-white/5"><span>Redo</span><kbd className="bg-raised px-1.5 py-0.5 rounded text-white">Ctrl + Shift + Z</kbd></div>
                <div className="flex justify-between py-1 border-b border-white/5"><span>Deselect Layer</span><kbd className="bg-raised px-1.5 py-0.5 rounded text-white">Esc</kbd></div>
              </div>
              <button
                onClick={() => setShowShortcuts(false)}
                className="mt-2 w-full py-2 bg-accent text-black font-bold rounded-xl text-xs"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
