import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Clock, 
  Flame, 
  Trash2, 
  Send, 
  Calendar, 
  Save, 
  Sparkles,
  Scissors,
  CheckCircle2,
  Maximize2,
  Volume2,
  Share2,
  ExternalLink,
  ChevronRight,
  Filter,
  Check
} from 'lucide-react';
import { 
  getClips, 
  getClip, 
  trimClip, 
  toggleTeaser, 
  updateClip, 
  postClipNow, 
  queueClip, 
  discardClip 
} from '../api';

export default function ReviewStation({ onStatusChange }) {
  const queryClient = useQueryClient();
  const [activeClipId, setActiveClipId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending_approval');
  const [channelFilter, setChannelFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingTags, setEditingTags] = useState('');
  const [transcriptWords, setTranscriptWords] = useState([]);
  const [editingWordIdx, setEditingWordIdx] = useState(null);
  const [wordInput, setWordInput] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState(null);

  const videoRef = useRef(null);
  const parentRef = useRef(null);

  // TanStack Query for lightweight clip list
  const { data: clipsResp, isLoading: isClipsLoading } = useQuery({
    queryKey: ['clips', statusFilter],
    queryFn: async () => {
      const res = await getClips(statusFilter);
      return res;
    },
    staleTime: 5000,
  });

  const rawClips = useMemo(() => clipsResp?.clips || (Array.isArray(clipsResp) ? clipsResp : []), [clipsResp]);

  // Extract unique channel IDs for quick streamer filtering
  const channelsList = useMemo(() => {
    const set = new Set();
    rawClips.forEach(c => { if (c.channel_id) set.add(c.channel_id); });
    return Array.from(set);
  }, [rawClips]);

  // Filter clips by selected channel if not 'all'
  const clips = useMemo(() => {
    if (channelFilter === 'all') return rawClips;
    return rawClips.filter(c => c.channel_id === channelFilter);
  }, [rawClips, channelFilter]);

  // Set default active clip when list loads or filters change
  useEffect(() => {
    if (clips.length > 0 && (!activeClipId || !clips.some(c => c.id === activeClipId))) {
      setActiveClipId(clips[0].id);
    } else if (clips.length === 0) {
      setActiveClipId(null);
    }
  }, [clips, activeClipId]);

  // Detailed clip query for the selected clip
  const { data: clipData } = useQuery({
    queryKey: ['clip_detail', activeClipId],
    queryFn: async () => {
      if (!activeClipId) return null;
      return await getClip(activeClipId);
    },
    enabled: !!activeClipId,
    staleTime: 10000,
  });

  // Sync title and tags when clip detail arrives
  useEffect(() => {
    if (clipData) {
      setEditingTitle(clipData.title || '');
      setEditingTags(clipData.hashtags || '');
      setTranscriptWords(clipData.transcript_words || []);
    }
  }, [clipData]);

  // Virtualizer for smooth 60fps scrolling
  const rowVirtualizer = useVirtualizer({
    count: clips.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 5,
  });

  const activeClipSummary = useMemo(() => {
    return clips.find(c => c.id === activeClipId) || clipData;
  }, [clips, activeClipId, clipData]);

  const videoSrc = clipData?.video_url || (activeClipSummary?.rendered_video_path ? `/api/clips/${activeClipId}/video` : null);
  const posterUrl = clipData?.thumbnail_url || activeClipSummary?.thumbnail_url;

  const showFeedback = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleTrim = async (deltaStart, deltaEnd) => {
    if (!activeClipId) return;
    setLoading(true);
    try {
      await trimClip(activeClipId, deltaStart, deltaEnd);
      queryClient.invalidateQueries({ queryKey: ['clip_detail', activeClipId] });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback('Boundary trimmed & re-rendered!');
    } catch (err) {
      alert('Trim failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTeaser = async () => {
    if (!activeClipId) return;
    setLoading(true);
    try {
      await toggleTeaser(activeClipId);
      queryClient.invalidateQueries({ queryKey: ['clip_detail', activeClipId] });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback('Teaser toggled & re-rendered!');
    } catch (err) {
      alert('Teaser toggle failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeek = (seconds) => {
    if (videoRef.current && seconds !== undefined) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
    }
  };

  const handleWordDoubleClick = (idx, currentWord) => {
    setEditingWordIdx(idx);
    setWordInput(currentWord);
  };

  const handleWordSave = (idx) => {
    if (editingWordIdx === null) return;
    const updated = [...transcriptWords];
    updated[idx] = { ...updated[idx], word: wordInput };
    setTranscriptWords(updated);
    setEditingWordIdx(null);
  };

  const handleSaveMetadata = async () => {
    if (!activeClipId) return;
    try {
      await updateClip(activeClipId, {
        title: editingTitle,
        hashtags: editingTags,
      });
      queryClient.invalidateQueries({ queryKey: ['clip_detail', activeClipId] });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      showFeedback('Metadata saved successfully!');
    } catch (err) {
      alert('Failed to save metadata: ' + err.message);
    }
  };

  const handlePostNow = async () => {
    if (!activeClipId) return;
    setLoading(true);
    try {
      await postClipNow(activeClipId);
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback(`Clip #${activeClipId} dispatched for immediate publishing!`);
    } catch (err) {
      alert('Failed to post clip: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQueue = async () => {
    if (!activeClipId) return;
    try {
      const res = await queueClip(activeClipId);
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback(`Clip #${activeClipId} scheduled to Drip Queue slot: ${res.scheduled_for}`);
    } catch (err) {
      alert('Failed to queue clip: ' + err.message);
    }
  };

  const handleDiscard = async () => {
    if (!activeClipId) return;
    if (!window.confirm(`Discard and delete Clip #${activeClipId}?`)) return;
    try {
      await discardClip(activeClipId);
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback(`Clip #${activeClipId} discarded.`);
    } catch (err) {
      alert('Failed to discard clip: ' + err.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-5 select-none">
      {/* Header Filters & Channel Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        {/* Status Pills */}
        <div className="flex items-center gap-1.5 bg-[#0D1017] p-1 rounded-xl border border-white/[0.06] overflow-x-auto">
          {[
            { id: 'pending_approval', label: 'Pending Approval' },
            { id: 'approved', label: 'Approved' },
            { id: 'queued', label: 'Queued' },
            { id: 'published', label: 'Published' },
            { id: 'rejected', label: 'Rejected' },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                statusFilter === s.id
                  ? 'bg-[#1A1D26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-sm'
                  : 'text-[#8B90A0] hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Streamer Filter Dropdown + Count */}
        <div className="flex items-center gap-3 self-end md:self-auto">
          {channelsList.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-[#8B90A0]">Streamer:</span>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="bg-[#0D1017] border border-white/[0.08] text-white rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-[#8FD3FF]"
              >
                <option value="all">All Channels ({rawClips.length})</option>
                {channelsList.map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </div>
          )}

          <div className="text-xs text-[#8FD3FF] font-mono px-2.5 py-1 rounded-lg bg-[#8FD3FF]/10 border border-[#8FD3FF]/20">
            {clips.length} clip{clips.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Main 3-Column Studio Layout */}
      <div className="grid grid-cols-12 gap-5 items-start">
        {/* Left Column: Virtualized Clips Sidebar Feed */}
        <div className="col-span-12 lg:col-span-4 xl:col-span-3 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-3 flex flex-col gap-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.04]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0]">
              Review Queue
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              Sorted by Virality
            </span>
          </div>

          {isClipsLoading && clips.length === 0 ? (
            <div className="flex flex-col gap-2 py-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-20 bg-[#13151A] rounded-xl animate-pulse border border-white/5" />
              ))}
            </div>
          ) : clips.length === 0 ? (
            <div className="text-center py-16 text-[#8B90A0] text-xs">
              No clips found in this status.
            </div>
          ) : (
            <div
              ref={parentRef}
              className="max-h-[720px] overflow-y-auto relative w-full pr-1 scrollbar-thin"
            >
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const clip = clips[virtualRow.index];
                  const isActive = clip.id === activeClipId;
                  const dur = ((clip.adjusted_end || 30) - (clip.adjusted_start || 0)).toFixed(1);

                  return (
                    <div
                      key={clip.id}
                      onClick={() => setActiveClipId(clip.id)}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="p-1"
                    >
                      <div
                        className={`p-3 h-full rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                          isActive
                            ? 'border-[#8FD3FF] bg-[#1A1D26] shadow-lg shadow-[#8FD3FF]/10'
                            : 'border-white/[0.04] bg-[#13151A]/60 hover:bg-[#13151A] hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-white truncate max-w-[140px]">
                            #{clip.id} • {clip.channel_id}
                          </span>
                          <span className="flex items-center gap-1 font-extrabold text-amber-400 font-mono text-[11px] bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                            🔥 {clip.virality_score}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-slate-200 line-clamp-1 leading-snug">
                          {clip.title || 'Untitled Clip'}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[#8B90A0] font-mono">
                          <span className="truncate max-w-[120px]">{clip.template_name}</span>
                          <span>⏱️ {dur}s</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Center Column: 9:16 Video Player with Live Range Stream & Poster */}
        <div className="col-span-12 lg:col-span-4 xl:col-span-4 flex flex-col items-center">
          <div className="w-full max-w-[340px] aspect-[9/16] bg-black rounded-2xl overflow-hidden border-2 border-white/[0.12] relative shadow-2xl flex items-center justify-center">
            {videoSrc ? (
              <div key={videoSrc} className="w-full h-full">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  poster={posterUrl || undefined}
                  controls
                  loop
                  preload="metadata"
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className="text-[#8B90A0] text-xs font-medium flex flex-col items-center gap-2">
                <Scissors className="animate-pulse text-[#8FD3FF]" size={28} />
                <span>Select a clip or rendering...</span>
              </div>
            )}

            {loading && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-20">
                <div className="w-8 h-8 border-2 border-[#8FD3FF] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-semibold text-[#8FD3FF] tracking-wider font-mono">
                  RE-RENDERING 9:16 CLIP...
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Interactive Subtitle Editor & Trim Controls */}
        <div className="col-span-12 lg:col-span-4 xl:col-span-5 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-4 shadow-xl">
          {activeClipSummary ? (
            <>
              {/* Meta Chips */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-[#13151A] border border-white/[0.08] font-bold text-white">
                  Clip #{activeClipSummary.id}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#13151A] border border-white/[0.08] text-slate-300">
                  Channel: <b className="text-white">{activeClipSummary.channel_id}</b>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 font-bold text-amber-400 flex items-center gap-1 font-mono">
                  🔥 Score: {activeClipSummary.virality_score}/100
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#13151A] border border-white/[0.08] font-mono text-[#8FD3FF]">
                  ⏱️ {((activeClipSummary.adjusted_end || 30) - (activeClipSummary.adjusted_start || 0)).toFixed(1)}s
                </span>
              </div>

              {feedbackMsg && (
                <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 size={14} /> {feedbackMsg}
                </div>
              )}

              {/* Title & Proposed Hook */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] block mb-1">
                  Title &amp; Proposed Viral Hook
                </label>
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  className="w-full bg-[#13151A] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8FD3FF]"
                />
              </div>

              {/* Hashtags & Keywords */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] block mb-1">
                  Hashtags &amp; Keywords
                </label>
                <input
                  type="text"
                  value={editingTags}
                  onChange={(e) => setEditingTags(e.target.value)}
                  className="w-full bg-[#13151A] border border-white/[0.08] rounded-xl px-3 py-2 text-xs font-mono text-[#8FD3FF] focus:outline-none focus:border-[#8FD3FF]"
                />
              </div>

              {/* Click-to-Jump Transcript Word Tokens */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] flex items-center gap-1">
                    <Sparkles size={11} className="text-[#8FD3FF]" /> Click-to-Jump Transcript
                  </label>
                  <span className="text-[10px] text-slate-500">Double click word to edit</span>
                </div>
                <div className="bg-[#13151A] border border-white/[0.08] rounded-xl p-3 min-h-[80px] max-h-[130px] overflow-y-auto flex flex-wrap gap-1.5 items-center">
                  {transcriptWords.length === 0 ? (
                    <span className="text-xs text-[#8B90A0] italic">
                      No word level tokens cached for this clip. Full clip audio transcribed cleanly.
                    </span>
                  ) : (
                    transcriptWords.map((item, idx) => (
                      <span
                        key={idx}
                        onClick={() => handleSeek(item.start)}
                        onDoubleClick={() => handleWordDoubleClick(idx, item.word)}
                        className={`inline-block px-2 py-0.5 rounded-lg text-xs cursor-pointer transition-all ${
                          editingWordIdx === idx
                            ? 'bg-[#8FD3FF] text-[#0A0B0E] font-bold'
                            : 'bg-white/[0.04] hover:bg-[#8FD3FF]/20 text-slate-300 hover:text-white border border-white/[0.04]'
                        }`}
                        title={`Click to seek to ${item.start?.toFixed(1)}s`}
                      >
                        {editingWordIdx === idx ? (
                          <input
                            type="text"
                            autoFocus
                            value={wordInput}
                            onChange={(e) => setWordInput(e.target.value)}
                            onBlur={() => handleWordSave(idx)}
                            onKeyDown={(e) => e.key === 'Enter' && handleWordSave(idx)}
                            className="bg-black text-[#8FD3FF] border border-[#8FD3FF] rounded px-1 outline-none w-20 text-xs"
                          />
                        ) : (
                          item.word
                        )}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Boundary Trimmer Buttons */}
              <div className="bg-[#13151A] border border-white/[0.08] rounded-xl p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] block mb-2 flex items-center gap-1.5">
                  <Scissors size={12} className="text-[#8FD3FF]" /> Boundary Fine-Tuning (-3s / +3s Re-render)
                </span>
                <div className="grid grid-cols-5 gap-1.5">
                  <button
                    onClick={() => handleTrim(-3, 0)}
                    disabled={loading}
                    className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white rounded-lg py-1.5 text-[11px] font-semibold"
                  >
                    ⏪ -3s Start
                  </button>
                  <button
                    onClick={() => handleTrim(3, 0)}
                    disabled={loading}
                    className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white rounded-lg py-1.5 text-[11px] font-semibold"
                  >
                    ⏩ +3s Start
                  </button>
                  <button
                    onClick={() => handleTrim(0, -3)}
                    disabled={loading}
                    className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white rounded-lg py-1.5 text-[11px] font-semibold"
                  >
                    ⏪ -3s End
                  </button>
                  <button
                    onClick={() => handleTrim(0, 3)}
                    disabled={loading}
                    className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white rounded-lg py-1.5 text-[11px] font-semibold"
                  >
                    ⏩ +3s End
                  </button>
                  <button
                    onClick={handleToggleTeaser}
                    disabled={loading}
                    className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[#8FD3FF] rounded-lg py-1.5 text-[11px] font-semibold"
                  >
                    🎬 Teaser: {activeClipSummary.has_teaser ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-5 gap-2 pt-2 border-t border-white/[0.06]">
                <a
                  href={`/clips/${activeClipSummary.id}/editor`}
                  className="flex items-center justify-center gap-1.5 bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] hover:from-[#A9B8FF] hover:to-[#8FD3FF] text-[#0A0B0E] font-extrabold py-2 px-2 rounded-xl text-xs transition-all shadow-md shadow-[#8FD3FF]/20"
                >
                  <Maximize2 size={13} /> Full Editor
                </a>
                <button
                  onClick={handlePostNow}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-2 rounded-xl text-xs transition-all shadow-md shadow-emerald-600/20"
                >
                  <Send size={13} /> Post Now
                </button>
                <button
                  onClick={handleQueue}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-2 rounded-xl text-xs transition-all shadow-md shadow-amber-600/20"
                >
                  <Calendar size={13} /> Queue
                </button>
                <button
                  onClick={handleSaveMetadata}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 bg-[#13151A] hover:bg-white/10 text-white font-bold py-2 px-2 rounded-xl text-xs transition-all border border-white/[0.08]"
                >
                  <Save size={13} /> Save
                </button>
                <button
                  onClick={handleDiscard}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 font-bold py-2 px-2 rounded-xl text-xs transition-all"
                >
                  <Trash2 size={13} /> Discard
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-[#8B90A0] text-sm">
              Select a clip from the queue to review and edit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
