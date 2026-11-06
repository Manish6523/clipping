import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  Sparkles, 
  Trash2, 
  Type, 
  Layers, 
  Download, 
  Check, 
  Sliders,
  Maximize2,
  Volume2,
  CheckCircle2
} from 'lucide-react';
import { trimClip, updateClip } from '../api';

export default function ClipEditorModal({ clip, isOpen, onClose, onSave }) {
  if (!isOpen || !clip) return null;

  // Timeline & Boundary State
  const [inPoint, setInPoint] = useState(clip.adjusted_start || 0);
  const [outPoint, setOutPoint] = useState(clip.adjusted_end || 30);
  const [currentTime, setCurrentTime] = useState(clip.adjusted_start || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [jumpCuts, setJumpCuts] = useState([]); // [{ start, end }]
  
  // Transcript-based word deletion & editing
  const [words, setWords] = useState(clip.transcript_words || []);
  const [editingWordIdx, setEditingWordIdx] = useState(null);
  const [wordInput, setWordInput] = useState('');

  // Subtitle Styling Overrides
  const [fontSize, setFontSize] = useState(72);
  const [primaryColor, setPrimaryColor] = useState('#FFFFFF');
  const [highlightColor, setHighlightColor] = useState('#FACC15');
  const [animationPreset, setAnimationPreset] = useState('pop');

  // Layout Override
  const [layoutMode, setLayoutMode] = useState(clip.template_name || 'ishowspeed_gaming');

  const [rendering, setRendering] = useState(false);
  const videoRef = useRef(null);

  const videoFilename = clip.rendered_video_path ? clip.rendered_video_path.split(/[\\/]/).pop() : null;
  const videoSrc = videoFilename ? `/renders/${videoFilename}` : null;

  // Video time tracking & jump-cut skipping
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleTimeUpdate = () => {
      const now = v.currentTime;
      setCurrentTime(now);

      // Enforce loop within in/out points
      if (now >= outPoint) {
        v.currentTime = inPoint;
      }

      // Check if current playhead enters a jump cut
      for (const cut of jumpCuts) {
        if (now >= cut.start && now < cut.end) {
          v.currentTime = cut.end; // Instant skip
          break;
        }
      }
    };

    v.addEventListener('timeupdate', handleTimeUpdate);
    return () => v.removeEventListener('timeupdate', handleTimeUpdate);
  }, [inPoint, outPoint, jumpCuts]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime < inPoint || videoRef.current.currentTime >= outPoint) {
        videoRef.current.currentTime = inPoint;
      }
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (timeSec) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(inPoint, Math.min(outPoint, timeSec));
    }
  };

  // Transcript-driven editing: delete word -> add jump cut
  const handleToggleWordDelete = (idx) => {
    const updated = [...words];
    const wordObj = updated[idx];
    const isNowDeleted = !wordObj.deleted;
    wordObj.deleted = isNowDeleted;
    setWords(updated);

    if (isNowDeleted) {
      // Add jump cut slice
      setJumpCuts((prev) => [...prev, { start: wordObj.start, end: wordObj.end, wordIdx: idx }]);
    } else {
      // Remove jump cut slice
      setJumpCuts((prev) => prev.filter((c) => c.wordIdx !== idx));
    }
  };

  const handleWordDoubleClick = (idx, text) => {
    setEditingWordIdx(idx);
    setWordInput(text);
  };

  const handleWordEditSave = (idx) => {
    const updated = [...words];
    updated[idx].word = wordInput;
    setWords(updated);
    setEditingWordIdx(null);
  };

  const handleExecuteRender = async () => {
    setRendering(true);
    try {
      // Delta calculate from original start/end
      const deltaStart = inPoint - clip.adjusted_start;
      const deltaEnd = outPoint - clip.adjusted_end;

      await trimClip(clip.id, deltaStart, deltaEnd);
      await updateClip(clip.id, {
        words: words,
        jump_cuts: jumpCuts,
      });

      alert('🎉 9:16 Video re-rendered from EDL with kinetic subtitles burned!');
      if (onSave) onSave();
      onClose();
    } catch (err) {
      alert('Render failed: ' + err.message);
    } finally {
      setRendering(false);
    }
  };

  // Find currently active spoken word based on playback time
  const currentActiveWord = words.find((w) => currentTime >= w.start && currentTime <= w.end);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex flex-col select-none animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="h-14 border-b border-white/10 px-6 flex items-center justify-between bg-slate-950/80">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-2">
            <span className="bg-indigo-600 text-white text-[11px] font-black px-2 py-0.5 rounded">
              EDITOR
            </span>
            <span className="font-bold text-sm text-white">
              Candidate #{clip.id}: {clip.title || 'Untitled Highlight'}
            </span>
            <span className="text-xs text-amber-400 font-mono font-bold">
              🔥 {clip.virality_score}/100
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExecuteRender}
            disabled={rendering}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-5 rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
          >
            <Scissors size={15} />
            {rendering ? 'Rendering with FFmpeg...' : 'Render Final 9:16 MP4'}
          </button>
        </div>
      </div>

      {/* Main Studio Body: 3-Column CapCut Layout */}
      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        {/* Column 1: Live 9:16 Video Player with Subtitle Overlays */}
        <div className="col-span-12 lg:col-span-4 bg-black/80 flex flex-col items-center justify-center p-6 border-r border-white/10 relative">
          <div className="w-full max-w-[280px] aspect-[9/16] bg-black rounded-2xl border-2 border-white/20 overflow-hidden relative shadow-2xl flex items-center justify-center">
            {videoSrc ? (
              <video
                ref={videoRef}
                src={videoSrc}
                className="w-full h-full object-contain"
                playsInline
              />
            ) : (
              <div className="text-xs text-slate-500 font-mono">Loading Video Source...</div>
            )}

            {/* Kinetic Caption Simulation Overlay */}
            <div className="absolute bottom-12 left-0 right-0 px-4 text-center pointer-events-none z-20">
              <span
                style={{
                  fontSize: `${fontSize * 0.22}px`,
                  color: primaryColor,
                  textShadow: `0 0 4px #000, 0 2px 6px rgba(0,0,0,0.9)`,
                }}
                className="font-black uppercase tracking-wide inline-block leading-tight"
              >
                {currentActiveWord ? (
                  <span>
                    THAT WAS{' '}
                    <span style={{ color: highlightColor }} className="animate-pulse">
                      {currentActiveWord.word}
                    </span>
                  </span>
                ) : (
                  <span>HIGHLIGHT MOMENT</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={togglePlay}
              className="p-3 bg-indigo-600 hover:bg-indigo-500 rounded-full text-white shadow-lg transition-transform hover:scale-105"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <span className="font-mono text-xs text-slate-300">
              {currentTime.toFixed(1)}s / {(outPoint - inPoint).toFixed(1)}s
            </span>
          </div>
        </div>

        {/* Column 2: Descript-Style Interactive Transcript */}
        <div className="col-span-12 lg:col-span-5 bg-slate-900/40 p-6 flex flex-col border-r border-white/10 overflow-hidden">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Sparkles size={15} className="text-indigo-400" />
                Descript-Style Transcript Editor
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Click a word to seek • Double-click to fix typos • Right-click or toggle to jump-cut delete.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded font-bold">
              {words.length} Tokens
            </span>
          </div>

          {/* Word Pills Container */}
          <div className="flex-1 overflow-y-auto pr-2 flex flex-wrap content-start gap-1.5 text-xs leading-relaxed">
            {words.length === 0 ? (
              <div className="text-slate-500 italic py-12 text-center w-full">
                No word timestamps cached for this clip. Full clip audio transcribed cleanly.
              </div>
            ) : (
              words.map((item, idx) => {
                const isCurrent = currentTime >= item.start && currentTime <= item.end;
                const isDeleted = item.deleted;

                return (
                  <span
                    key={idx}
                    onClick={() => handleSeek(item.start)}
                    onDoubleClick={() => handleWordDoubleClick(idx, item.word)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      handleToggleWordDelete(idx);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer transition-all border ${
                      isDeleted
                        ? 'bg-rose-950/40 border-rose-500/30 text-rose-400 line-through opacity-50'
                        : isCurrent
                        ? 'bg-amber-400 text-black font-black border-amber-400 scale-105 shadow-md shadow-amber-400/20'
                        : 'bg-white/5 border-white/5 text-slate-200 hover:bg-white/10 hover:border-white/20'
                    }`}
                    title={`${item.start?.toFixed(2)}s - ${item.end?.toFixed(2)}s | Right-click to cut`}
                  >
                    {editingWordIdx === idx ? (
                      <input
                        type="text"
                        value={wordInput}
                        autoFocus
                        onChange={(e) => setWordInput(e.target.value)}
                        onBlur={() => handleWordEditSave(idx)}
                        onKeyDown={(e) => e.key === 'Enter' && handleWordEditSave(idx)}
                        className="bg-black text-amber-300 border border-amber-500 rounded px-1 outline-none w-20 text-xs"
                      />
                    ) : (
                      item.word
                    )}
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* Column 3: Subtitle Typography & Layout Controls */}
        <div className="col-span-12 lg:col-span-3 bg-slate-900/60 p-6 flex flex-col gap-5 overflow-y-auto">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2 pb-2 border-b border-white/10">
            <Type size={15} className="text-indigo-400" />
            Subtitle &amp; Motion Controls
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Typography Font
            </label>
            <select
              value="Montserrat ExtraBold"
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-2 text-xs text-white"
            >
              <option value="Montserrat ExtraBold">Montserrat ExtraBold</option>
              <option value="TheBoldFont">TheBoldFont</option>
              <option value="Impact">Impact</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Primary Color
              </label>
              <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-white/10">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-none bg-transparent"
                />
                <span className="text-xs font-mono text-slate-300">{primaryColor}</span>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Highlight
              </label>
              <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-white/10">
                <input
                  type="color"
                  value={highlightColor}
                  onChange={(e) => setHighlightColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-none bg-transparent"
                />
                <span className="text-xs font-mono text-amber-400">{highlightColor}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Animation Style
            </label>
            <select
              value={animationPreset}
              onChange={(e) => setAnimationPreset(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-2 text-xs text-white"
            >
              <option value="pop">Pop (Punchy TikTok)</option>
              <option value="bounce">Bounce (Elastic)</option>
              <option value="typewriter">Typewriter (Karaoke)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Active Jump Cuts ({jumpCuts.length})
            </label>
            <div className="bg-slate-950 p-3 rounded-lg border border-white/5 text-[11px] text-slate-400 flex flex-col gap-1 max-h-28 overflow-y-auto font-mono">
              {jumpCuts.length === 0 ? (
                <span className="text-slate-600 italic">No deleted words. Right-click any word to cut.</span>
              ) : (
                jumpCuts.map((cut, idx) => (
                  <div key={idx} className="flex justify-between items-center text-rose-400">
                    <span>Cut: {cut.start.toFixed(1)}s - {cut.end.toFixed(1)}s</span>
                    <button
                      onClick={() => handleToggleWordDelete(cut.wordIdx)}
                      className="text-slate-500 hover:text-white"
                    >
                      Undo
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Timeline & In/Out Boundary Scrubber */}
      <div className="h-28 border-t border-white/10 bg-slate-950 px-6 py-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>In-Point: <b>{inPoint.toFixed(1)}s</b></span>
          <span className="text-white font-bold">Total Duration: <b>{(outPoint - inPoint).toFixed(1)}s</b></span>
          <span>Out-Point: <b>{outPoint.toFixed(1)}s</b></span>
        </div>

        {/* Timeline Track */}
        <div className="relative h-10 bg-slate-900 rounded-lg border border-white/10 flex items-center px-2">
          {/* Active Duration Region */}
          <div
            style={{
              left: `${Math.max(0, (inPoint / 60) * 100)}%`,
              width: `${Math.max(10, ((outPoint - inPoint) / 60) * 100)}%`,
            }}
            className="absolute top-1 bottom-1 bg-indigo-600/30 border-t-2 border-b-2 border-indigo-500 rounded"
          />

          {/* Playhead */}
          <div
            style={{ left: `${Math.min(100, (currentTime / 60) * 100)}%` }}
            className="absolute top-0 bottom-0 w-1 bg-amber-400 z-30 shadow-lg shadow-amber-400/50 pointer-events-none"
          />

          {/* Jump-cut slices representation */}
          {jumpCuts.map((cut, i) => (
            <div
              key={i}
              style={{
                left: `${(cut.start / 60) * 100}%`,
                width: `${((cut.end - cut.start) / 60) * 100}%`,
              }}
              className="absolute top-1 bottom-1 bg-rose-600/60 border border-rose-500 z-20"
            />
          ))}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Drag in/out points or right-click words in the transcript above to eliminate awkward silences.</span>
          <div className="flex gap-2">
            <button
              onClick={() => { setInPoint(Math.max(0, inPoint - 1)); }}
              className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded font-semibold text-slate-300"
            >
              -1s In
            </button>
            <button
              onClick={() => { setInPoint(inPoint + 1); }}
              className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded font-semibold text-slate-300"
            >
              +1s In
            </button>
            <button
              onClick={() => { setOutPoint(outPoint - 1); }}
              className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded font-semibold text-slate-300"
            >
              -1s Out
            </button>
            <button
              onClick={() => { setOutPoint(outPoint + 1); }}
              className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded font-semibold text-slate-300"
            >
              +1s Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

