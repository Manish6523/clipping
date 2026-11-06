import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  Trash2, 
  ZoomIn, 
  ZoomOut, 
  HelpCircle
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export default function Timeline({ videoRef }) {
  const { 
    clipId, 
    clip,
    edl, 
    currentTime, 
    setCurrentTime, 
    isPlaying, 
    setIsPlaying, 
    splitSegmentAtPlayhead, 
    deleteSegment, 
    toggleWordDeleted,
    undo,
    redo
  } = useEditorStore();

  const [pixelsPerSecond, setPixelsPerSecond] = useState(60);
  const [waveformPeaks, setWaveformPeaks] = useState([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const containerRef = useRef(null);
  const waveformCanvasRef = useRef(null);

  const duration = edl?.source?.end ? (edl.source.end - edl.source.start) : 30;
  const startOffset = edl?.source?.start || 0;

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
    const width = duration * pixelsPerSecond;
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

  // Scrubbing & click-to-seek
  const handleSeekFromEvent = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const newRelTime = Math.max(0, Math.min(duration, clickX / pixelsPerSecond));
    const targetTime = startOffset + newRelTime;

    setCurrentTime(targetTime);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
  }, [duration, pixelsPerSecond, startOffset, setCurrentTime, videoRef]);

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

  // Determine thumbnail poster image to tile across video track
  const thumbUrl = clip?.thumbnail_url || (clip?.rendered_video_path ? `/renders/clip_${clipId}_v1_thumb.jpg` : null);

  return (
    <div className="w-full bg-[#13151A] border border-white/[0.06] rounded-2xl flex flex-col shadow-2xl select-none overflow-hidden">
      {/* Header Toolbar Row */}
      <div className="h-10 px-4 bg-[#0A0B0E] border-b border-white/[0.04] flex items-center justify-between text-xs text-[#8B90A0]">
        {/* Left Playback & Split Tools */}
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="w-7 h-7 rounded-lg bg-[#8FD3FF] hover:bg-[#A9B8FF] text-[#0A0B0E] flex items-center justify-center transition-all shadow-md shadow-[#8FD3FF]/20"
            title="Play / Pause (Space)"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>

          <button
            onClick={splitSegmentAtPlayhead}
            className="px-2.5 py-1 rounded-lg bg-[#1A1D24] hover:bg-white/10 text-white font-bold text-xs flex items-center gap-1.5 transition-all border border-white/5"
            title="Split Clip at Playhead (C)"
          >
            <Scissors size={13} className="text-[#8FD3FF]" />
            <span>Split</span>
          </button>

          {/* Speed Presets */}
          <div className="flex items-center gap-1 ml-2 bg-[#1A1D24] p-0.5 rounded-lg border border-white/5">
            {[1, 1.5, 2].map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  playbackRate === s ? 'bg-[#8FD3FF] text-[#0A0B0E]' : 'text-[#8B90A0] hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Time Counters & Zoom Controls */}
        <div className="flex items-center gap-3 font-mono">
          <span className="text-white font-bold">
            {(currentTime - startOffset).toFixed(1)}s
          </span>
          <span>/</span>
          <span>{duration.toFixed(1)}s</span>

          <div className="h-4 w-px bg-white/10 mx-1" />

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPixelsPerSecond((p) => Math.max(25, p - 15))}
              className="p-1 rounded hover:bg-white/5 text-[#8B90A0] hover:text-white"
            >
              <ZoomOut size={13} />
            </button>
            <input
              type="range"
              min="25"
              max="200"
              value={pixelsPerSecond}
              onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
              className="w-16 h-1 accent-[#8FD3FF] cursor-pointer"
            />
            <button
              onClick={() => setPixelsPerSecond((p) => Math.min(200, p + 15))}
              className="p-1 rounded hover:bg-white/5 text-[#8B90A0] hover:text-white"
            >
              <ZoomIn size={13} />
            </button>
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              className="p-1 rounded hover:bg-white/5 text-[#8B90A0] hover:text-white ml-2"
              title="Keyboard Shortcuts"
            >
              <HelpCircle size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Track Viewport */}
      <div
        ref={containerRef}
        onClick={handleSeekFromEvent}
        className="w-full h-[155px] overflow-x-auto overflow-y-hidden relative bg-[#0D0F14] cursor-crosshair select-none"
      >
        <div style={{ width: `${timelineWidth}px` }} className="h-full relative">
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

          {/* Video Segment Strip Track with Real Filmstrip Thumbnails */}
          <div className="h-11 my-1 mx-1 rounded-lg bg-[#1A1D24] border border-white/[0.08] relative overflow-hidden flex items-center">
            {edl?.segments?.map((seg) => {
              const segStart = (seg.src_in - startOffset) * pixelsPerSecond;
              const segW = (seg.src_out - seg.src_in) * pixelsPerSecond;
              const thumbCount = Math.max(1, Math.floor(segW / 55));

              return (
                <div
                  key={seg.id}
                  style={{
                    position: 'absolute',
                    left: `${segStart}px`,
                    width: `${segW}px`,
                  }}
                  className="h-full border border-indigo-500/40 rounded overflow-hidden relative flex items-center justify-between text-[10px] font-mono text-white group"
                >
                  {/* Filmstrip Tiling */}
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

          {/* Audio Waveform Canvas Track */}
          <div className="h-8 mx-1 rounded bg-[#13151A] overflow-hidden relative">
            <canvas
              ref={waveformCanvasRef}
              width={timelineWidth}
              height={32}
              className="w-full h-full pointer-events-none"
            />
          </div>

          {/* Word Tokens / Jump Cut Track with Overflow Text Suppression */}
          <div className="h-6 mx-1 my-1 relative">
            {edl?.words?.map((w, idx) => {
              const wStart = (w.start - startOffset) * pixelsPerSecond;
              const wWidth = Math.max(10, (w.end - w.start) * pixelsPerSecond);
              const isCurrent = currentTime >= w.start && currentTime <= w.end;
              const textContent = w.word || w.text || '';
              // Suppress garbled text if width < 30px
              const canFitText = wWidth >= 28;

              return (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#13151A] border border-white/10 rounded-2xl p-5 max-w-sm w-full text-xs text-[#E8EAF0] shadow-2xl">
            <h4 className="font-bold text-sm mb-3 text-[#8FD3FF]">Timeline Keyboard Shortcuts</h4>
            <div className="space-y-1.5 font-mono">
              <div className="flex justify-between"><span>Space</span><span className="text-slate-400">Play / Pause</span></div>
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
