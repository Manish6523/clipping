import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  Trash2, 
  ZoomIn, 
  ZoomOut, 
  HelpCircle,
  MoveHorizontal
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export default function Timeline({ videoRef }) {
  const { 
    clipId, 
    clip,
    edl, 
    sourceInfo,
    currentTime, 
    setCurrentTime, 
    isPlaying, 
    setIsPlaying, 
    splitSegmentAtPlayhead, 
    deleteSegment, 
    toggleWordDeleted,
    changeClipBounds,
    setSelection,
    undo,
    redo
  } = useEditorStore();

  const [pixelsPerSecond, setPixelsPerSecond] = useState(60);
  const [waveformPeaks, setWaveformPeaks] = useState([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [draggingEdge, setDraggingEdge] = useState(null); // 'in' | 'out'
  const [isScrubbing, setIsScrubbing] = useState(false);

  const containerRef = useRef(null);
  const waveformCanvasRef = useRef(null);

  const duration = edl?.source?.end ? (edl.source.end - edl.source.start) : (clip?.adjusted_end - clip?.adjusted_start) || 30;
  const startOffset = edl?.source?.start ?? clip?.adjusted_start ?? 0;
  const maxAvailableEnd = sourceInfo?.available_end || Math.max(60, startOffset + duration + 30);

  // Load real waveform peaks
  useEffect(() => {
    fetch(`/api/clips/${clipId}/waveform`)
      .then((r) => r.json())
      .then((d) => setWaveformPeaks(d.peaks || []))
      .catch(() => {});
  }, [clipId]);

  // Draw real waveform on canvas
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveformPeaks.length) return;
    const ctx = canvas.getContext('2d');
    const width = Math.max(600, duration * pixelsPerSecond);
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1A1D24';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#8FD3FF';
    const totalPeaks = waveformPeaks.length;
    const step = width / totalPeaks;

    waveformPeaks.forEach((p, idx) => {
      const barH = Math.max(4, p * (height * 0.7));
      const x = idx * step;
      const y = (height - barH) / 2;
      ctx.fillRect(x, y, Math.max(1, step - 1), barH);
    });
  }, [waveformPeaks, duration, pixelsPerSecond]);

  // Auto-scroll timeline to keep playhead in view during playback or frame-stepping
  useEffect(() => {
    if (!containerRef.current || isScrubbing || draggingEdge) return;
    const scrollContainer = containerRef.current;
    const playheadPx = (currentTime - startOffset) * pixelsPerSecond;
    const viewLeft = scrollContainer.scrollLeft;
    const viewRight = viewLeft + scrollContainer.clientWidth;

    if (playheadPx < viewLeft + 60) {
      scrollContainer.scrollLeft = Math.max(0, playheadPx - 80);
    } else if (playheadPx > viewRight - 80) {
      scrollContainer.scrollLeft = playheadPx - scrollContainer.clientWidth + 100;
    }
  }, [currentTime, startOffset, pixelsPerSecond, isScrubbing, draggingEdge]);

  // Scrubbing & click-to-seek
  const performSeek = useCallback((clientX) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const clickX = clientX - rect.left + scrollLeft;
    const newRelTime = Math.max(0, Math.min(duration, clickX / pixelsPerSecond));
    const targetTime = startOffset + newRelTime;

    setCurrentTime(targetTime);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
  }, [duration, pixelsPerSecond, startOffset, setCurrentTime, videoRef]);

  const handlePointerDownTimeline = (e) => {
    if (draggingEdge) return;
    setIsScrubbing(true);
    performSeek(e.clientX);
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (isScrubbing) {
        performSeek(e.clientX);
      }
    };
    const handlePointerUp = () => {
      if (isScrubbing) setIsScrubbing(false);
    };

    if (isScrubbing) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isScrubbing, performSeek]);

  // Drag edge handles to extend or shorten clip length
  const handleStartEdgeDrag = (e, edge) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingEdge({
      edge,
      startX: e.clientX,
      origStart: startOffset,
      origEnd: startOffset + duration,
      currStart: startOffset,
      currEnd: startOffset + duration,
    });
  };

  useEffect(() => {
    const handleEdgeMove = (e) => {
      if (!draggingEdge) return;
      const deltaX = e.clientX - draggingEdge.startX;
      const deltaSec = deltaX / pixelsPerSecond;

      if (draggingEdge.edge === 'in') {
        const candidate = Math.max(0, Math.min(draggingEdge.origEnd - 3.0, draggingEdge.origStart + deltaSec));
        setDraggingEdge((prev) => ({ ...prev, currStart: candidate }));
      } else if (draggingEdge.edge === 'out') {
        const candidate = Math.max(draggingEdge.origStart + 3.0, Math.min(maxAvailableEnd, draggingEdge.origEnd + deltaSec));
        setDraggingEdge((prev) => ({ ...prev, currEnd: candidate }));
      }
    };

    const handleEdgeUp = () => {
      if (draggingEdge) {
        const finalStart = Math.round(draggingEdge.currStart * 10) / 10;
        const finalEnd = Math.round(draggingEdge.currEnd * 10) / 10;
        setDraggingEdge(null);
        if (finalStart !== startOffset || finalEnd !== (startOffset + duration)) {
          changeClipBounds(finalStart, finalEnd);
        }
      }
    };

    if (draggingEdge) {
      window.addEventListener('pointermove', handleEdgeMove);
      window.addEventListener('pointerup', handleEdgeUp);
    }
    return () => {
      window.removeEventListener('pointermove', handleEdgeMove);
      window.removeEventListener('pointerup', handleEdgeUp);
    };
  }, [draggingEdge, pixelsPerSecond, maxAvailableEnd, changeClipBounds, startOffset, duration]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play();
      setIsPlaying(true);
    }
  };

  const handleSpeedChange = (rate) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  const timelineWidth = Math.max(600, duration * pixelsPerSecond);
  const playheadX = Math.max(0, Math.min(timelineWidth, (currentTime - startOffset) * pixelsPerSecond));
  const thumbUrl = clip?.thumbnail_url || (clip?.thumbnail_path ? `/api/clips/${clipId}/thumbnail` : null);

  // Live drag positions for instant visual animation feedback
  const inHandleX = draggingEdge?.edge === 'in' 
    ? (draggingEdge.currStart - startOffset) * pixelsPerSecond 
    : 0;
  const outHandleX = draggingEdge?.edge === 'out' 
    ? (draggingEdge.currEnd - startOffset) * pixelsPerSecond 
    : timelineWidth;

  return (
    <div className="w-full bg-[#13151A] border border-white/[0.06] rounded-2xl flex flex-col shadow-2xl select-none overflow-hidden">
      {/* Header Toolbar Row */}
      <div className="h-9 px-2 sm:px-3 bg-[#0A0B0E] border-b border-white/[0.04] flex items-center justify-between text-xs text-[#8B90A0] overflow-x-auto custom-scrollbar">
        {/* Left Playback & Split Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={togglePlay}
            className="w-6 h-6 rounded-lg bg-[#8FD3FF] hover:bg-[#A9B8FF] text-[#0A0B0E] flex items-center justify-center transition-all shadow-md shadow-[#8FD3FF]/20"
            title="Play / Pause (Space)"
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
          </button>

          <button
            onClick={splitSegmentAtPlayhead}
            className="px-2 py-0.5 rounded-lg bg-[#1A1D24] hover:bg-white/10 text-white font-bold text-[11px] flex items-center gap-1 transition-all border border-white/5"
            title="Split Clip at Playhead (C)"
          >
            <Scissors size={12} className="text-[#8FD3FF]" />
            <span>Split</span>
          </button>

          {/* Speed Presets */}
          <div className="hidden xs:flex items-center gap-0.5 ml-1 sm:ml-2 bg-[#1A1D24] p-0.5 rounded-lg border border-white/5">
            {[1, 1.5, 2].map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  playbackRate === s ? 'bg-[#8FD3FF] text-[#0A0B0E]' : 'text-[#8B90A0] hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Time Counters & Zoom Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 font-mono text-[11px] sm:text-xs shrink-0">
          <span className="text-white font-bold">
            {(currentTime - startOffset).toFixed(1)}s
          </span>
          <span>/</span>
          <span>{duration.toFixed(1)}s</span>

          <div className="h-3.5 w-px bg-white/10 mx-0.5" />

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPixelsPerSecond((p) => Math.max(25, p - 15))}
              className="p-1 rounded hover:bg-white/5 text-[#8B90A0] hover:text-white"
            >
              <ZoomOut size={12} />
            </button>
            <input
              type="range"
              min="25"
              max="200"
              value={pixelsPerSecond}
              onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
              className="w-10 sm:w-14 h-1 accent-[#8FD3FF] cursor-pointer"
            />
            <button
              onClick={() => setPixelsPerSecond((p) => Math.min(200, p + 15))}
              className="p-1 rounded hover:bg-white/5 text-[#8B90A0] hover:text-white"
            >
              <ZoomIn size={12} />
            </button>
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              className="hidden sm:inline-block p-1 rounded hover:bg-white/5 text-[#8B90A0] hover:text-white ml-0.5"
              title="Keyboard Shortcuts"
            >
              <HelpCircle size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Track Viewport */}
      <div
        ref={containerRef}
        tabIndex={-1}
        onPointerDown={handlePointerDownTimeline}
        className="w-full h-[145px] overflow-x-auto overflow-y-hidden relative bg-[#0D0F14] cursor-crosshair select-none focus:outline-none"
      >
        <div style={{ width: `${timelineWidth}px` }} className="h-full relative pointer-events-auto">
          {/* Ticks and Ruler */}
          <div className="h-5 border-b border-white/[0.06] bg-[#0A0B0E] relative pointer-events-none">
            {Array.from({ length: Math.ceil(duration) + 1 }).map((_, sec) => (
              <div
                key={sec}
                style={{ left: `${sec * pixelsPerSecond}px` }}
                className="absolute top-0 bottom-0 border-l border-white/10 pl-1 text-[9px] font-mono text-[#8B90A0]"
              >
                {sec}s
              </div>
            ))}
          </div>

          {/* Left In-Point Resize Extension Handle */}
          <div
            onPointerDown={(e) => handleStartEdgeDrag(e, 'in')}
            style={{
              transform: `translateX(${inHandleX}px)`,
              transition: draggingEdge?.edge === 'in' ? 'none' : 'transform 0.15s ease-out',
            }}
            className={`absolute left-0 top-0 bottom-0 w-4 z-40 cursor-ew-resize flex flex-col items-center justify-center rounded-l shadow-xl transition-colors group ${
              draggingEdge?.edge === 'in' 
                ? 'bg-[#8FD3FF] ring-2 ring-[#8FD3FF]/50 scale-105' 
                : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
            title="Drag outward to extend clip start, inward to shorten"
          >
            <div className="w-0.5 h-7 bg-white rounded-full group-hover:scale-110 transition-transform" />
            {draggingEdge?.edge === 'in' && (
              <div className="absolute -top-6 left-0 bg-[#8FD3FF] text-[#0A0B0E] font-mono text-[9px] font-black px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap animate-in fade-in">
                {draggingEdge.currStart.toFixed(1)}s
              </div>
            )}
          </div>

          {/* Video Segment Strip Track with Real Filmstrip Thumbnails */}
          <div className="h-10 my-1 mx-3 rounded-lg bg-[#1A1D24] border border-white/[0.08] relative overflow-hidden flex items-center pointer-events-auto">
            {edl?.segments?.map((seg) => {
              const segStart = (seg.src_in - startOffset) * pixelsPerSecond;
              const segW = (seg.src_out - seg.src_in) * pixelsPerSecond;
              const thumbCount = Math.max(1, Math.floor(segW / 55));

              return (
                <div
                  key={seg.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelection({ type: 'segment', id: seg.id });
                  }}
                  style={{
                    position: 'absolute',
                    left: `${segStart}px`,
                    width: `${segW}px`,
                  }}
                  className="h-full border border-indigo-500/40 rounded overflow-hidden relative flex items-center justify-between text-[10px] font-mono text-white group cursor-pointer"
                >
                  <div className="absolute inset-0 flex pointer-events-none opacity-40">
                    {Array.from({ length: thumbCount }).map((_, i) => (
                      <div
                        key={i}
                        className="h-full w-[55px] shrink-0 border-r border-black/30 bg-cover bg-center"
                        style={{
                          backgroundImage: thumbUrl ? `url(${thumbUrl})` : 'none',
                          backgroundColor: '#1E1B4B',
                        }}
                      />
                    ))}
                  </div>

                  <span className="truncate pl-2 z-10 drop-shadow-md font-bold">
                    Segment ({(seg.src_out - seg.src_in).toFixed(1)}s)
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSegment(seg.id); }}
                    className="p-1 hover:text-rose-400 z-10 pr-2 transition-colors"
                    title="Ripple Delete Section"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right Out-Point Resize Extension Handle */}
          <div
            onPointerDown={(e) => handleStartEdgeDrag(e, 'out')}
            style={{
              transform: `translateX(${outHandleX - timelineWidth}px)`,
              transition: draggingEdge?.edge === 'out' ? 'none' : 'transform 0.15s ease-out',
            }}
            className={`absolute right-0 top-0 bottom-0 w-4 z-40 cursor-ew-resize flex flex-col items-center justify-center rounded-r shadow-xl transition-colors group ${
              draggingEdge?.edge === 'out' 
                ? 'bg-[#8FD3FF] ring-2 ring-[#8FD3FF]/50 scale-105' 
                : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
            title="Drag outward to extend clip end, inward to shorten"
          >
            <div className="w-0.5 h-7 bg-white rounded-full group-hover:scale-110 transition-transform" />
            {draggingEdge?.edge === 'out' && (
              <div className="absolute -top-6 right-0 bg-[#8FD3FF] text-[#0A0B0E] font-mono text-[9px] font-black px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap animate-in fade-in">
                {draggingEdge.currEnd.toFixed(1)}s
              </div>
            )}
          </div>

          {/* Audio Waveform Canvas Track */}
          <div className="h-7 mx-3 rounded bg-[#13151A] overflow-hidden relative pointer-events-none">
            <canvas
              ref={waveformCanvasRef}
              width={timelineWidth}
              height={28}
              className="w-full h-full"
            />
          </div>

          {/* Word Tokens / Jump Cut Track with Overflow Text Suppression */}
          <div className="h-6 mx-3 my-1 relative pointer-events-auto">
            {edl?.words?.map((w, idx) => {
              const wStart = (w.start - startOffset) * pixelsPerSecond;
              const wWidth = Math.max(10, (w.end - w.start) * pixelsPerSecond);
              const isCurrent = currentTime >= w.start && currentTime <= w.end;
              const textContent = w.word || w.text || '';
              const canFitText = wWidth >= 28;

              return (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelection({ type: 'word', id: idx, data: w });
                    if (videoRef.current) {
                      videoRef.current.currentTime = w.start;
                      setCurrentTime(w.start);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleWordDeleted(w.id || w.start);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${wStart}px`,
                    width: `${wWidth}px`,
                  }}
                  className={`h-full rounded text-[9px] font-mono flex items-center justify-center px-0.5 border transition-all cursor-pointer ${
                    w.deleted
                      ? 'bg-rose-950/40 border-rose-500/40 text-rose-500 line-through opacity-50'
                      : isCurrent
                      ? 'bg-[#8FD3FF] text-[#0A0B0E] font-bold border-white'
                      : 'bg-white/5 border-white/5 text-[#8B90A0] hover:text-white hover:bg-white/10'
                  }`}
                  title={`${textContent} (${w.start.toFixed(1)}s - ${w.end.toFixed(1)}s) • Right-click to toggle jump-cut delete`}
                >
                  {canFitText ? (
                    <span className="truncate">{textContent}</span>
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Glowing Playhead Line */}
          <div
            style={{
              transform: `translateX(${playheadX}px)`,
            }}
            className="absolute top-0 bottom-0 w-0.5 bg-[#8FD3FF] z-40 pointer-events-none shadow-[0_0_10px_#8FD3FF]"
          >
            <div className="w-2.5 h-2.5 bg-[#8FD3FF] rounded-full -ml-1 -top-1 absolute shadow-md" />
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Overlay Modal */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
          <div className="bg-[#13151A] border border-white/10 rounded-2xl p-5 max-w-sm w-full text-xs text-[#E8EAF0] shadow-2xl">
            <h4 className="font-bold text-sm mb-3 text-[#8FD3FF]">Keyboard Shortcuts Guide</h4>
            <div className="space-y-1.5 font-mono">
              <div className="flex justify-between"><span>Space</span><span className="text-slate-400">Play / Pause</span></div>
              <div className="flex justify-between"><span>← / →</span><span className="text-slate-400">Step 1 Frame (1/30s)</span></div>
              <div className="flex justify-between"><span>Shift + ← / →</span><span className="text-slate-400">Step 1 Second</span></div>
              <div className="flex justify-between"><span>Ctrl + ← / →</span><span className="text-slate-400">Prev / Next Word</span></div>
              <div className="flex justify-between"><span>Home / End</span><span className="text-slate-400">Start / End of Clip</span></div>
              <div className="flex justify-between"><span>I / O</span><span className="text-slate-400">Set In / Out Point</span></div>
              <div className="flex justify-between"><span>C</span><span className="text-slate-400">Split at Playhead</span></div>
              <div className="flex justify-between"><span>Right Click Word</span><span className="text-slate-400">Jump Cut Delete</span></div>
              <div className="flex justify-between"><span>Ctrl+Z</span><span className="text-slate-400">Undo</span></div>
              <div className="flex justify-between"><span>Ctrl+Shift+Z</span><span className="text-slate-400">Redo</span></div>
              <div className="flex justify-between"><span>Ctrl+S</span><span className="text-slate-400">Save EDL</span></div>
            </div>
            <button
              onClick={() => setShowShortcuts(false)}
              className="mt-4 w-full py-2 bg-[#8FD3FF] text-black font-bold rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
