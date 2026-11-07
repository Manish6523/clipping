import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  Maximize2,
  Minimize2,
  Trash2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Layers
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export default function MobileTimelineStrip({ videoRef }) {
  const { 
    clipId, 
    clip, 
    edl, 
    currentTime, 
    setCurrentTime, 
    isPlaying, 
    setIsPlaying, 
    splitSegmentAtPlayhead,
    activeSegmentId,
    setActiveSegmentId,
    removeSegment,
    undo,
    redo,
    history
  } = useEditorStore();

  const [waveformPeaks, setWaveformPeaks] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // 1 to 3
  const canvasRef = useRef(null);
  const touchStartClientX = useRef(0);
  const touchStartTime = useRef(0);

  const duration = edl?.source?.end ? (edl.source.end - edl.source.start) : (clip?.adjusted_end - clip?.adjusted_start) || 30;
  const startOffset = edl?.source?.start ?? clip?.adjusted_start ?? 0;
  const segments = edl?.timeline?.segments || [{ id: 'seg_default', start: startOffset, end: startOffset + duration }];
  const words = clip?.transcript_words || clip?.words || [];

  // Waveform peaks
  useEffect(() => {
    fetch(`/api/clips/${clipId}/waveform`)
      .then((r) => r.json())
      .then((d) => setWaveformPeaks(d.peaks || []))
      .catch(() => {});
  }, [clipId]);

  // Center playhead waveform render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformPeaks.length) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0E1118';
    ctx.fillRect(0, 0, w, h);

    // Waveform density
    const pxPerSec = 45 * zoomLevel;
    const centerOffset = w / 2;
    const playheadTimeRel = Math.max(0, Math.min(duration, currentTime - startOffset));
    const scrollX = centerOffset - (playheadTimeRel * pxPerSec);

    const step = (duration * pxPerSec) / waveformPeaks.length;
    ctx.fillStyle = '#8FD3FF';

    waveformPeaks.forEach((p, idx) => {
      const x = scrollX + (idx * step);
      if (x >= -4 && x <= w + 4) {
        const barH = Math.max(3, p * (h * 0.72));
        const y = (h - barH) / 2;
        ctx.fillRect(x, y, Math.max(1, step - 1), barH);
      }
    });

    // Center Fixed Playhead Line
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerOffset, 0);
    ctx.lineTo(centerOffset, h);
    ctx.stroke();

    // Center Diamond Indicator
    ctx.fillStyle = '#8FD3FF';
    ctx.beginPath();
    ctx.moveTo(centerOffset, 0);
    ctx.lineTo(centerOffset - 5, 8);
    ctx.lineTo(centerOffset + 5, 8);
    ctx.closePath();
    ctx.fill();
  }, [waveformPeaks, currentTime, startOffset, duration, zoomLevel]);

  // Swipe horizontally to scrub (content moves under fixed center playhead)
  const handleTouchStart = (e) => {
    touchStartClientX.current = e.touches[0].clientX;
    touchStartTime.current = currentTime;
    if (videoRef?.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  };

  const handleTouchMove = (e) => {
    const clientX = e.touches[0].clientX;
    const deltaX = clientX - touchStartClientX.current;
    const pxPerSec = 45 * zoomLevel;
    const deltaSec = -deltaX / pxPerSec; // Swiping left moves forward
    const newTime = Math.max(startOffset, Math.min(startOffset + duration, touchStartTime.current + deltaSec));

    setCurrentTime(newTime);
    if (videoRef?.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  const togglePlay = () => {
    const v = videoRef?.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const relTime = Math.max(0, currentTime - startOffset);

  return (
    <div className={`w-full bg-[#0A0B0E] border-t border-white/[0.06] flex flex-col select-none shrink-0 z-20 transition-all ${isExpanded ? 'h-52' : 'h-24'}`}>
      {/* 1. Transport Bar: Play / Pause, Time, Split, Expand */}
      <div className="h-10 px-3 flex items-center justify-between gap-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          {/* Large 36x36 Play / Pause */}
          <button
            onClick={togglePlay}
            className="w-8 h-8 rounded-xl bg-[#8FD3FF] text-[#0A0B0E] font-black flex items-center justify-center active:scale-95 shadow-md shadow-[#8FD3FF]/20"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>

          {/* Time Counter */}
          <div className="font-mono text-xs text-white font-extrabold flex items-center gap-1">
            <span>{relTime.toFixed(1)}s</span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-400">{duration.toFixed(1)}s</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={splitSegmentAtPlayhead}
            className="h-7 px-2.5 rounded-lg bg-white/[0.04] active:bg-white/10 text-white font-bold text-[11px] flex items-center gap-1 border border-white/[0.06]"
          >
            <Scissors size={12} className="text-[#8FD3FF]" />
            <span>Split</span>
          </button>

          {isExpanded && activeSegmentId && (
            <button
              onClick={() => removeSegment(activeSegmentId)}
              className="h-7 px-2 rounded-lg bg-rose-500/15 active:bg-rose-500/25 text-rose-400 font-bold text-[11px] flex items-center gap-1 border border-rose-500/20"
            >
              <Trash2 size={12} />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-7 px-2 rounded-lg bg-white/[0.04] active:bg-white/10 text-[#8FD3FF] font-bold text-[11px] flex items-center gap-1 border border-white/[0.06]"
            title={isExpanded ? 'Collapse Timeline' : 'Expand Timeline'}
          >
            {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {/* 2. Waveform Scrub Track with Center Playhead */}
      <div 
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className="w-full flex-1 relative overflow-hidden cursor-ew-resize touch-none"
      >
        <canvas
          ref={canvasRef}
          width={600}
          height={isExpanded ? 64 : 48}
          className="w-full h-full object-cover pointer-events-none"
        />

        {/* Word Density or Chip Strip (Zoom dependent) */}
        {isExpanded && words.length > 0 && (
          <div className="absolute bottom-1 left-0 right-0 h-6 px-2 flex items-center gap-1 overflow-x-hidden pointer-events-none opacity-80">
            {words.slice(0, 30).map((w, i) => (
              <span
                key={i}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded truncate max-w-[65px] ${
                  currentTime >= w.start && currentTime <= w.end 
                    ? 'bg-[#8FD3FF] text-black font-bold' 
                    : 'bg-white/10 text-white/70'
                }`}
              >
                {w.text || w.word}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. Expanded Drawer Controls (Segments list & Trim zoom) */}
      {isExpanded && (
        <div className="h-12 px-3 bg-[#0A0B0E]/95 border-t border-white/[0.04] flex items-center justify-between gap-2 overflow-x-auto">
          {/* Segment Badges */}
          <div className="flex items-center gap-1.5 overflow-x-auto flex-1 py-1">
            {segments.map((seg, idx) => (
              <button
                key={seg.id || idx}
                onClick={() => {
                  setActiveSegmentId(seg.id);
                  setCurrentTime(seg.start);
                  if (videoRef?.current) videoRef.current.currentTime = seg.start;
                }}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1.5 border transition-all ${
                  activeSegmentId === seg.id 
                    ? 'bg-[#8FD3FF]/20 border-[#8FD3FF] text-[#8FD3FF]' 
                    : 'bg-white/[0.04] border-white/10 text-slate-400'
                }`}
              >
                <span>Seg {idx + 1}</span>
                <span className="text-[9px] font-mono opacity-70">
                  {((seg.end - seg.start) || 0).toFixed(1)}s
                </span>
              </button>
            ))}
          </div>

          {/* Zoom In/Out Stepper */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setZoomLevel(Math.max(1, zoomLevel - 0.5))}
              className="w-7 h-7 rounded-lg bg-white/[0.04] text-slate-300 flex items-center justify-center text-xs"
            >
              <ZoomOut size={12} />
            </button>
            <span className="text-[10px] font-mono text-slate-400 w-6 text-center">{zoomLevel}x</span>
            <button
              onClick={() => setZoomLevel(Math.min(3, zoomLevel + 0.5))}
              className="w-7 h-7 rounded-lg bg-white/[0.04] text-slate-300 flex items-center justify-center text-xs"
            >
              <ZoomIn size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
