import React, { useRef, useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Maximize2, 
  RotateCcw, 
  Smartphone, 
  Monitor, 
  Layers,
  AlertCircle,
  RefreshCw,
  Scissors,
  CheckCircle2,
  Bug
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import SourceRegionPicker from './SourceRegionPicker';
import LivePreviewCanvas from './LivePreviewCanvas';

export default function PreviewStage({ videoRef }) {
  const { 
    clipId, 
    edl, 
    currentTime, 
    setCurrentTime, 
    isPlaying, 
    setIsPlaying, 
    saveEDL 
  } = useEditorStore();

  const [showDebug, setShowDebug] = useState(false);
  const [videoError, setVideoError] = useState(null);

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

  return (
    <div className="flex-1 bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-2 shadow-xl relative overflow-hidden select-none min-h-0">
      {/* Top Header Label */}
      <div className="w-full flex items-center justify-between pb-2 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[#8FD3FF] flex items-center gap-1.5">
            <Monitor size={14} /> 16:9 Source Picker &amp; 9:16 Live Canvas
          </span>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-all ${
              showDebug 
                ? 'bg-[#8FD3FF]/20 border-[#8FD3FF] text-[#8FD3FF]' 
                : 'bg-white/5 border-white/10 text-[#8B90A0] hover:text-white'
            }`}
          >
            <Bug size={11} /> Match Check
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-[#8B90A0]">
          <span className="px-2 py-0.5 rounded-lg bg-[#1A1D24] border border-white/[0.06]">
            {currentTime.toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Main Dual Stage Row: Source 16:9 + Live 9:16 Preview Side-by-Side */}
      <div className="flex-1 flex items-center justify-center gap-4 min-h-0 overflow-hidden w-full p-1">
        {/* Left Side: 16:9 Source Video with Overlay Boxes */}
        <div className="flex-1 h-full min-h-0 flex items-center justify-center">
          <SourceRegionPicker videoRef={videoRef} />
        </div>

        {/* Right Side: 9:16 Live Canvas Composite Preview */}
        <div className="h-full min-h-0 flex items-center justify-center shrink-0">
          <LivePreviewCanvas videoRef={videoRef} isDebug={showDebug} />
        </div>
      </div>
    </div>
  );
}
