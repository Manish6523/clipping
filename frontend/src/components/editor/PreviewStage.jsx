import React, { useRef, useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Smartphone, 
  Monitor, 
  Sparkles
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import LayoutBuilder from '../LayoutBuilder';
import axios from 'axios';

export default function PreviewStage({ videoRef }) {
  const { 
    clipId, 
    edl, 
    updateEDL,
    currentTime, 
    setCurrentTime,
    selection,
    setSelection,
    updateCaptionPos,
  } = useEditorStore();

  const [testRenderUrl, setTestRenderUrl] = useState(null);
  const [testing, setTesting] = useState(false);

  // Jump-cut auto-skipping during preview
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleTimeUpdate = () => {
      const now = v.currentTime;
      setCurrentTime(now);

      // Skip deleted words
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
  }, [edl, videoRef, setCurrentTime]);

  // Handler to test render a real single frame via FFmpeg to verify exact match
  const handleTestRenderFrame = async () => {
    if (!clipId || !edl?.layout) return;
    setTesting(true);
    setTestRenderUrl(null);
    try {
      const res = await axios.post(
        '/api/layout/preview-frame',
        {
          clip_id: clipId,
          time: currentTime,
          layout: edl.layout
        },
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(res.data);
      setTestRenderUrl(url);
    } catch (e) {
      alert('Test render frame failed: ' + (e.response?.data?.error?.message || e.message));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex-1 bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-2 shadow-xl relative overflow-hidden select-none min-h-0">
      {/* Top Header Label */}
      <div className="w-full flex items-center justify-between pb-1.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[#8FD3FF] flex items-center gap-1.5">
            <Monitor size={14} /> Multi-Frame Layout Studio &amp; Realtime Canvas
          </span>
          {testing && (
            <span className="text-[11px] text-amber-400 font-mono animate-pulse">
              FFmpeg rendering frame...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-[#8B90A0]">
          <span className="px-2 py-0.5 rounded-lg bg-[#1A1D24] border border-white/[0.06]">
            {currentTime.toFixed(2)}s
          </span>
        </div>
      </div>

      {/* Embedded Shared LayoutBuilder Component */}
      <LayoutBuilder
        layout={edl?.layout}
        onChange={(nextLayout) => {
          updateEDL((prev) => ({
            ...prev,
            layout: nextLayout
          }));
        }}
        sourceMediaUrl={clipId ? `/api/clips/${clipId}/source` : null}
        videoRef={videoRef}
        captionsConfig={{
          ...(edl?.captions || {}),
          censor: edl?._censor_cfg ? { ...edl._censor_cfg, ...(edl?.censor || {}) } : null,
          onChangePos: updateCaptionPos,
        }}
        words={edl?.words || []}
        currentTime={currentTime}
        mode="clip"
        selectedLayerId={selection?.type === 'layer' ? selection.id : null}
        onSelectLayer={(layerId) => {
          setSelection(layerId ? { type: 'layer', id: layerId } : { type: 'none', id: null });
          if (layerId) {
            setActivePanel('layout');
          }
        }}
        onSelectCaption={() => {
          setSelection({ type: 'caption', id: 'main' });
          setActivePanel('captions');
        }}
        onTestRenderFrame={handleTestRenderFrame}
        showToolbar={false}
        showBottomPanel={false}
      />

      {/* Side-by-Side Test Render Comparison Modal */}
      {testRenderUrl && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[80] flex items-center justify-center p-6">
          <div className="bg-[#0D1017] border border-white/20 rounded-2xl p-5 max-w-lg w-full flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-[#8FD3FF] flex items-center gap-1.5">
                <Sparkles size={14} /> Real FFmpeg Output Comparison
              </span>
              <button
                onClick={() => setTestRenderUrl(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 bg-white/5 rounded"
              >
                Close
              </button>
            </div>
            <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10 flex items-center justify-center">
              <img src={testRenderUrl} alt="FFmpeg Render" className="w-full h-full object-contain" />
            </div>
            <span className="text-[11px] text-slate-400 text-center font-mono">
              Rendered via exact FFmpeg filter_complex graph at {currentTime.toFixed(1)}s.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
