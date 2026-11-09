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
  Check,
  CheckSquare,
  Square,
  MinusSquare,
  Columns2,
  Maximize,
  Film,
  Eye,
  SlidersHorizontal,
  X,
  Info,
  HelpCircle
} from 'lucide-react';
import { 
  getClips, 
  getClip, 
  getClipExplain,
  trimClip, 
  toggleTeaser, 
  updateClip, 
  postClipNow, 
  queueClip, 
  discardClip,
  batchDiscardClips,
  sendClipFeedback
} from '../api';

const REJECTION_REASONS = [
  { code: 'boring', label: 'Boring' },
  { code: 'no_context', label: 'No context' },
  { code: 'bad_start', label: 'Bad start' },
  { code: 'bad_end', label: 'Bad end' },
  { code: 'off_topic', label: 'Off-topic' },
  { code: 'unsafe', label: 'Unsafe' },
  { code: 'duplicate', label: 'Duplicate' },
  { code: 'bad_crop', label: 'Bad crop' },
  { code: 'bad_captions', label: 'Bad captions' },
  { code: 'audio', label: 'Audio' },
  { code: 'other', label: 'Other' },
];

export default function ReviewStation({ onStatusChange }) {
  const queryClient = useQueryClient();
  const [activeClipId, setActiveClipId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending_approval');
  const [channelFilter, setChannelFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState('player'); // 'queue' | 'player' | 'details'

  // Active clip editor fields
  const [editingTitle, setEditingTitle] = useState('');
  const [editingTags, setEditingTags] = useState('');
  const [transcriptWords, setTranscriptWords] = useState([]);
  const [editingWordIdx, setEditingWordIdx] = useState(null);
  const [wordInput, setWordInput] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState(null);

  // Multi-select state
  const [selectedClipIds, setSelectedClipIds] = useState(new Set());
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showExplainModal, setShowExplainModal] = useState(false);
  const [explainData, setExplainData] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [rejectFilter, setRejectFilter] = useState('all'); // 'all' | 'untagged'
  const [retroTagClip, setRetroTagClip] = useState(null);

  // Single video player ref
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

  // Filter clips by selected channel if not 'all' and by reject filter if rejected tab
  const clips = useMemo(() => {
    let list = rawClips;
    if (channelFilter !== 'all') {
      list = list.filter(c => c.channel_id === channelFilter);
    }
    if (statusFilter === 'rejected' && rejectFilter === 'untagged') {
      list = list.filter(c => !c.rejection_reason);
    }
    return list;
  }, [rawClips, channelFilter, statusFilter, rejectFilter]);

  // Set default active clip when list loads or filters change
  useEffect(() => {
    if (clips.length > 0 && (!activeClipId || !clips.some(c => c.id === activeClipId))) {
      setActiveClipId(clips[0].id);
    } else if (clips.length === 0) {
      setActiveClipId(null);
    }
  }, [clips, activeClipId]);

  // Clean selectedClipIds if clips change
  useEffect(() => {
    setSelectedClipIds(prev => {
      const next = new Set();
      const currentIds = new Set(clips.map(c => c.id));
      for (const id of prev) {
        if (currentIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [clips]);

  // Detailed query for the primary active clip
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
    estimateSize: () => 82,
    overscan: 6,
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

  // Multi-select helpers
  const handleToggleSelectClip = (e, clipId) => {
    e.stopPropagation();
    setSelectedClipIds(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedClipIds.size === clips.length && clips.length > 0) {
      setSelectedClipIds(new Set());
    } else {
      setSelectedClipIds(new Set(clips.map(c => c.id)));
    }
  };

  const handleBatchDiscard = async () => {
    const ids = Array.from(selectedClipIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Permanently discard and delete ${ids.length} selected clip${ids.length === 1 ? '' : 's'}?`)) return;

    setBatchLoading(true);
    try {
      const res = await batchDiscardClips(ids);
      setSelectedClipIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback(`Discarded ${res.deleted_count || ids.length} clips.`);
    } catch (err) {
      alert('Batch discard failed: ' + err.message);
    } finally {
      setBatchLoading(false);
    }
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
        transcript_words: transcriptWords,
      });
      queryClient.invalidateQueries({ queryKey: ['clip_detail', activeClipId] });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      showFeedback('Metadata & transcript saved!');
    } catch (err) {
      alert('Save failed: ' + err.message);
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

  const handleMarkGreat = async () => {
    if (!activeClipId) return;
    try {
      await sendClipFeedback(activeClipId, 'marked_great', { source: 'web_button' });
      await queueClip(activeClipId);
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback(`Clip #${activeClipId} marked ⭐ GREAT and Queued!`);
    } catch (err) {
      alert('Failed to mark great: ' + err.message);
    }
  };

  const handleDiscardWithReason = async (reasonCode = null) => {
    if (!activeClipId) return;
    try {
      await discardClip(activeClipId, reasonCode);
      setShowRejectModal(false);
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback(`Clip #${activeClipId} rejected${reasonCode ? ` (${reasonCode})` : ''}.`);
    } catch (err) {
      alert('Failed to discard clip: ' + err.message);
    }
  };

  const handleTagRejectedClip = async (clipId, reasonCode) => {
    try {
      await sendClipFeedback(clipId, 'reason_tagged', { reason: reasonCode, source: 'retro_tagging_ui' });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      showFeedback(`Clip #${clipId} tagged: ${reasonCode}`);
    } catch (err) {
      alert('Tagging failed: ' + err.message);
    }
  };

  const handleOpenExplain = async () => {
    if (!activeClipId) return;
    setExplainLoading(true);
    setShowExplainModal(true);
    try {
      const res = await getClipExplain(activeClipId);
      setExplainData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setExplainLoading(false);
    }
  };

  const isAllSelected = clips.length > 0 && selectedClipIds.size === clips.length;
  const isSomeSelected = selectedClipIds.size > 0 && selectedClipIds.size < clips.length;

  return (
    <div className="w-full min-h-[calc(100vh-61px)] lg:h-[calc(100vh-61px)] flex flex-col px-2 sm:px-4 py-2 select-none overflow-y-auto lg:overflow-hidden bg-[#07090E]">
      {/* Top Universal Control Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-white/[0.06] shrink-0">
        {/* Status Filter Pills (Horizontal scroll on mobile) */}
        <div className="flex items-center gap-1 bg-[#0E1118] p-1 rounded-xl border border-white/[0.06] overflow-x-auto custom-scrollbar max-w-full">
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
              className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                statusFilter === s.id
                  ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-sm'
                  : 'text-[#8B90A0] hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Sub-filter for Rejected: All vs Untagged Rejects */}
        {statusFilter === 'rejected' && (
          <div className="flex items-center gap-1 bg-[#0E1118] p-1 rounded-xl border border-white/[0.06] shrink-0">
            <button
              onClick={() => setRejectFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                rejectFilter === 'all'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All Rejected
            </button>
            <button
              onClick={() => setRejectFilter('untagged')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                rejectFilter === 'untagged'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>Untagged Only</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/30 rounded-full font-mono">
                {rawClips.filter(c => !c.rejection_reason).length}
              </span>
            </button>
          </div>
        )}

        {/* Center: Multi-Select Discard Action Bar */}
        {selectedClipIds.size > 0 && (
          <div className="flex items-center gap-2 bg-rose-500/15 border border-rose-500/40 px-3 py-1 rounded-xl animate-in fade-in zoom-in-95 duration-150">
            <span className="text-xs font-bold text-rose-300">
              {selectedClipIds.size} selected
            </span>
            <button
              onClick={handleBatchDiscard}
              disabled={batchLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-extrabold transition-all shadow-md shadow-rose-600/30"
            >
              <Trash2 size={13} />
              {batchLoading ? 'Deleting...' : 'Discard'}
            </button>
            <button
              onClick={() => setSelectedClipIds(new Set())}
              className="text-xs text-slate-400 hover:text-white px-1.5 py-0.5"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Right: Streamer Filter & Stats */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto">
          {channelsList.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-[#8B90A0]">Streamer:</span>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="bg-[#0E1118] border border-white/[0.08] text-white rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-[#8FD3FF]"
              >
                <option value="all">All Channels ({rawClips.length})</option>
                {channelsList.map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </div>
          )}

          <div className="text-xs text-[#8FD3FF] font-mono px-2.5 py-1 rounded-lg bg-[#8FD3FF]/10 border border-[#8FD3FF]/20 font-bold shrink-0">
            {clips.length} clip{clips.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Mobile Mode Tab Switcher (Visible on < lg screens) */}
      <div className="lg:hidden flex items-center justify-center gap-1 bg-[#0E1118] p-1 rounded-xl border border-white/[0.08] my-2 shrink-0">
        <button
          onClick={() => setMobileTab('queue')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all text-center ${
            mobileTab === 'queue'
              ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Queue ({clips.length})
        </button>
        <button
          onClick={() => setMobileTab('player')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all text-center ${
            mobileTab === 'player'
              ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Player
        </button>
        <button
          onClick={() => setMobileTab('details')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all text-center ${
            mobileTab === 'details'
              ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Details & Actions
        </button>
      </div>

      {/* Main Studio Grid: Responsive 3-Column on Desktop (lg:), Tabs/Stacked on Mobile */}
      <div className="flex-1 grid grid-cols-12 gap-3 min-h-0 pt-1 lg:pt-2 lg:overflow-hidden">
        {/* Left Column: Virtualized Review Queue Feed */}
        <div className={`col-span-12 lg:col-span-3 xl:col-span-3 bg-[#0E1118] border border-white/[0.08] rounded-2xl p-2.5 flex flex-col gap-2 shadow-xl min-h-[300px] lg:min-h-0 overflow-hidden ${
          mobileTab !== 'queue' ? 'hidden lg:flex' : 'flex'
        }`}>
          {/* Header Row with Select All */}
          <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.04] shrink-0">
            <button
              onClick={handleSelectAll}
              className="flex items-center gap-1.5 text-[11px] font-bold text-[#8FD3FF] hover:text-white transition-colors"
              title={isAllSelected ? "Deselect All" : "Select All"}
            >
              {isAllSelected ? (
                <CheckSquare size={14} className="text-[#8FD3FF]" />
              ) : isSomeSelected ? (
                <MinusSquare size={14} className="text-[#8FD3FF]" />
              ) : (
                <Square size={14} className="text-slate-500" />
              )}
              <span>Select All</span>
            </button>
            <span className="text-[10px] font-mono text-slate-500">
              Sorted by Virality
            </span>
          </div>

          {/* Virtualized Clips List */}
          {isClipsLoading && clips.length === 0 ? (
            <div className="flex flex-col gap-2 py-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-[#13151A] rounded-xl animate-pulse border border-white/5" />
              ))}
            </div>
          ) : clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-xs text-center px-4">
              <CheckCircle2 size={32} className="text-slate-600 mb-2" />
              <span>No clips in "{statusFilter.replace('_', ' ')}".</span>
            </div>
          ) : (
            <div ref={parentRef} className="flex-1 overflow-y-auto pr-1 min-h-0 custom-scrollbar">
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
                  const isChecked = selectedClipIds.has(clip.id);
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
                        onClick={() => setMobileTab('player')}
                        className={`p-2.5 h-full rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                          isActive
                            ? 'border-[#8FD3FF] bg-[#181C26] shadow-lg shadow-[#8FD3FF]/15 ring-1 ring-[#8FD3FF]/30'
                            : 'border-white/[0.04] bg-[#12151D]/80 hover:bg-[#161A24] hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 truncate max-w-[170px]">
                            {/* Checkbox for Multi-Select */}
                            <button
                              onClick={(e) => handleToggleSelectClip(e, clip.id)}
                              className="text-slate-400 hover:text-white transition-colors shrink-0"
                            >
                              {isChecked ? (
                                <CheckSquare size={14} className="text-[#8FD3FF]" />
                              ) : (
                                <Square size={14} className="text-slate-600 hover:text-slate-400" />
                              )}
                            </button>
                            <span className="font-bold text-white truncate">
                              #{clip.id} • {clip.channel_id}
                            </span>
                          </div>
                          <span className="flex items-center gap-1 font-extrabold text-amber-400 font-mono text-[11px] bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                            {(!clip.virality_score || clip.virality_score === 0 || (clip.flags && clip.flags.includes('unscored')))
                              ? '⚪ unscored'
                              : `🔥 ${clip.virality_score}`}
                          </span>
                        </div>

                        <div className="text-[11px] font-semibold text-slate-200 line-clamp-1 leading-snug pl-5">
                          {clip.title || 'Untitled Clip'}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-[#8B90A0] font-mono pl-5">
                          <span className="truncate max-w-[130px]">{clip.template_name}</span>
                          <span>⏱️ {dur}s</span>
                        </div>

                        {/* Rejection Reason Badge if rejected */}
                        {clip.status === 'rejected' && (
                          <div className="mt-1 pl-5 flex items-center justify-between">
                            {clip.rejection_reason ? (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 font-medium">
                                🏷️ {clip.rejection_reason.replace('_', ' ')}
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium">
                                ⚠️ Untagged Reject
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Center Column: SINGLE 9:16 VIDEO PLAYER */}
        <div className={`col-span-12 lg:col-span-4 xl:col-span-4 bg-[#0E1118] border border-white/[0.08] rounded-2xl p-3 flex flex-col items-center justify-center shadow-xl min-h-[420px] lg:min-h-0 overflow-hidden ${
          mobileTab !== 'player' ? 'hidden lg:flex' : 'flex'
        }`}>
          <div className="h-full aspect-[9/16] bg-black rounded-xl overflow-hidden border-2 border-white/[0.12] relative shadow-2xl flex items-center justify-center max-w-full">
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
          </div>

          {loading && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30">
              <div className="w-8 h-8 border-2 border-[#8FD3FF] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-semibold text-[#8FD3FF] tracking-wider font-mono">
                RE-RENDERING 9:16 CLIP...
              </span>
            </div>
          )}
        </div>

        {/* Right Column: Full Inspector & Production Controls */}
        <div className={`col-span-12 lg:col-span-5 xl:col-span-5 bg-[#0E1118] border border-white/[0.08] rounded-2xl p-3.5 flex flex-col gap-3 shadow-xl min-h-0 overflow-hidden ${
          mobileTab !== 'details' ? 'hidden lg:flex' : 'flex'
        }`}>
          {activeClipSummary ? (
            <>
              {/* Meta Chips */}
              <div className="flex flex-wrap items-center gap-2 text-xs shrink-0 pb-1 border-b border-white/[0.06]">
                <span className="px-2.5 py-1 rounded-lg bg-[#141722] border border-white/[0.08] font-bold text-white">
                  Clip #{activeClipSummary.id}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#141722] border border-white/[0.08] text-slate-300">
                  Channel: <b className="text-white">@{activeClipSummary.channel_id}</b>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 font-bold text-amber-400 flex items-center gap-1 font-mono">
                  {(!activeClipSummary.virality_score || activeClipSummary.virality_score === 0 || (activeClipSummary.flags && activeClipSummary.flags.includes('unscored')))
                    ? '⚪ Score: unscored'
                    : `🔥 Score: ${activeClipSummary.virality_score}/100`}
                </span>
                <button
                  type="button"
                  onClick={handleOpenExplain}
                  className="px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 font-bold text-xs flex items-center gap-1 transition-colors"
                  title="Explain AI Virality Score & Rubric Breakdown"
                >
                  <Info size={12} />
                  <span>Explain</span>
                </button>
                <span className="px-2.5 py-1 rounded-lg bg-[#141722] border border-white/[0.08] font-mono text-[#8FD3FF]">
                  ⏱️ {((activeClipSummary.adjusted_end || 30) - (activeClipSummary.adjusted_start || 0)).toFixed(1)}s
                </span>
                {activeClipSummary.status === 'rejected' && (
                  <span className={`px-2.5 py-1 rounded-lg border font-bold text-xs ${
                    activeClipSummary.rejection_reason 
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' 
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  }`}>
                    {activeClipSummary.rejection_reason ? `🏷️ Reason: ${activeClipSummary.rejection_reason.replace('_', ' ')}` : '⚠️ Untagged Reject'}
                  </span>
                )}
              </div>

              {feedbackMsg && (
                <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 shrink-0 animate-in fade-in">
                  <CheckCircle2 size={14} /> {feedbackMsg}
                </div>
              )}

              {/* Scrollable Center Controls */}
              <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1 min-h-0 custom-scrollbar">
                {/* Title & Proposed Hook */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] block mb-1">
                    Title &amp; Proposed Viral Hook
                  </label>
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    className="w-full bg-[#141722] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8FD3FF]"
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
                    className="w-full bg-[#141722] border border-white/[0.08] rounded-xl px-3 py-2 text-xs font-mono text-[#8FD3FF] focus:outline-none focus:border-[#8FD3FF]"
                  />
                </div>

                {/* Click-to-Jump Transcript Word Tokens */}
                <div className="flex-1 flex flex-col min-h-[90px]">
                  <div className="flex items-center justify-between mb-1 shrink-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] flex items-center gap-1">
                      <Sparkles size={11} className="text-[#8FD3FF]" /> Click-to-Jump Transcript
                    </label>
                    <span className="text-[10px] text-slate-500">Double click word to edit</span>
                  </div>
                  <div className="flex-1 bg-[#141722] border border-white/[0.08] rounded-xl p-2.5 overflow-y-auto flex flex-wrap gap-1.5 items-start content-start">
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

                {/* Retro-Tagging Chips if clip is rejected */}
                {activeClipSummary.status === 'rejected' && (
                  <div className="bg-[#141722] border border-white/[0.08] rounded-xl p-3 shrink-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                        <Trash2 size={12} className="text-rose-400" />
                        {activeClipSummary.rejection_reason ? 'Update Rejection Reason' : 'Tag Rejection Reason (AI Training)'}
                      </span>
                      {activeClipSummary.rejection_reason && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          Current: <b className="text-white">{activeClipSummary.rejection_reason}</b>
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                      {REJECTION_REASONS.map((r) => (
                        <button
                          key={r.code}
                          onClick={() => handleTagRejectedClip(activeClipSummary.id, r.code)}
                          className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                            activeClipSummary.rejection_reason === r.code
                              ? 'bg-rose-500 text-white border-rose-400 shadow-sm'
                              : 'bg-white/[0.04] hover:bg-rose-500/20 text-slate-300 hover:text-white border-white/[0.06]'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Boundary Trimmer Buttons */}
                <div className="bg-[#141722] border border-white/[0.08] rounded-xl p-2.5 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] block mb-1.5 flex items-center gap-1.5">
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
              </div>

              {/* Bottom Action Buttons (Fixed Footer) */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-2 border-t border-white/[0.06] shrink-0">
                <a
                  href={`/clips/${activeClipSummary.id}/editor`}
                  className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] hover:from-[#A9B8FF] hover:to-[#8FD3FF] text-[#0A0B0E] font-extrabold py-2 px-2 rounded-xl text-xs transition-all shadow-md shadow-[#8FD3FF]/20"
                >
                  <Maximize2 size={13} /> Full Editor
                </a>
                <button
                  onClick={handleMarkGreat}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-[#0A0B0E] font-extrabold py-2 px-2 rounded-xl text-xs transition-all shadow-md shadow-amber-500/20"
                >
                  ⭐ Great
                </button>
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
                  className="flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-2 rounded-xl text-xs transition-all shadow-md shadow-cyan-600/20"
                >
                  <Calendar size={13} /> Queue
                </button>
                <button
                  onClick={handleSaveMetadata}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 bg-[#141722] hover:bg-white/10 text-white font-bold py-2 px-2 rounded-xl text-xs transition-all border border-white/[0.08]"
                >
                  <Save size={13} /> Save
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 font-bold py-2 px-2 rounded-xl text-xs transition-all"
                >
                  <Trash2 size={13} /> Reject
                </button>
              </div>

              {/* One-Tap Rejection Reason Modal */}
              {showRejectModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <div className="bg-[#0E1118] border border-white/[0.1] rounded-2xl p-5 max-w-md w-full shadow-2xl flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                      <div className="flex items-center gap-2">
                        <Trash2 size={16} className="text-rose-400" />
                        <h3 className="font-extrabold text-sm text-white">Why did you reject this clip?</h3>
                      </div>
                      <button onClick={() => setShowRejectModal(false)} className="text-slate-400 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>

                    <p className="text-xs text-[#8B90A0]">
                      Your feedback trains the AI scoring judge to avoid similar moments for this streamer.
                    </p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2">
                      {REJECTION_REASONS.map((r) => (
                        <button
                          key={r.code}
                          onClick={() => handleDiscardWithReason(r.code)}
                          className="px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.06] hover:border-rose-500/40 text-xs font-semibold text-slate-200 hover:text-white transition-all text-center"
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                      <button
                        onClick={() => handleDiscardWithReason(null)}
                        className="text-xs text-slate-400 hover:text-slate-200 underline"
                      >
                        Skip reason
                      </button>
                      <button
                        onClick={() => setShowRejectModal(false)}
                        className="px-4 py-1.5 rounded-lg bg-white/10 text-xs font-bold text-white hover:bg-white/20"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Explainability Score Breakdown Modal */}
              {showExplainModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <div className="bg-[#0E1118] border border-white/[0.1] rounded-2xl p-5 max-w-lg w-full shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto custom-scrollbar">
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                      <div className="flex items-center gap-2">
                        <Info size={18} className="text-indigo-400" />
                        <h3 className="font-extrabold text-sm text-white">
                          AI Virality Breakdown • Clip #{activeClipSummary.id}
                        </h3>
                      </div>
                      <button onClick={() => setShowExplainModal(false)} className="text-slate-400 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>

                    {explainLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : explainData ? (
                      <div className="space-y-4 text-xs">
                        {/* Overall Scores Grid */}
                        <div className="grid grid-cols-3 gap-2 bg-[#12151E] p-3 rounded-xl border border-white/[0.04]">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-bold">Virality Score</span>
                            <span className="text-base font-extrabold text-amber-400 font-mono">
                              {explainData.virality_score || 0}/100
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-bold">Formula Mode</span>
                            <span className="text-xs font-mono font-bold text-indigo-300">
                              {explainData.formula_version || 'legacy'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-bold">Judge Model</span>
                            <span className="text-xs font-mono font-bold text-white truncate block">
                              {explainData.model || 'gemini-flash-lite'}
                            </span>
                          </div>
                        </div>

                        {/* 1-5 Rubric Subscores */}
                        {explainData.score_breakdown && Object.keys(explainData.score_breakdown).length > 0 && (
                          <div className="space-y-2">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                              1-5 Calibrated Rubric Sub-Scores
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                              {Object.entries(explainData.score_breakdown).map(([dim, val]) => (
                                <div key={dim} className="bg-white/[0.03] p-2 rounded-lg border border-white/[0.04] flex items-center justify-between">
                                  <span className="text-slate-300 font-mono capitalize">{dim.replace('_', ' ')}</span>
                                  <span className="font-extrabold text-white font-mono bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                                    {val}/5
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Trigger Signal Telemetry */}
                        {explainData.trigger && Object.keys(explainData.trigger).length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                              Moment Detection Trigger
                            </span>
                            <div className="bg-[#12151E] p-2.5 rounded-xl border border-white/[0.04] font-mono text-[11px] text-slate-300">
                              <div>Type: <b className="text-white">{explainData.trigger.type || 'stream_moment'}</b></div>
                              {explainData.trigger.ratio && (
                                <div>Velocity Spike: <b className="text-emerald-400">{explainData.trigger.ratio}x</b> baseline</div>
                              )}
                              {explainData.trigger.peak_db && (
                                <div>Audio Peak: <b className="text-amber-400">{explainData.trigger.peak_db} dB</b></div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Flags */}
                        {explainData.flags && explainData.flags.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                              Content Flags
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {explainData.flags.map((f, i) => (
                                <span key={i} className="px-2 py-0.5 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded font-mono text-[10px]">
                                  {f.type || f.note || JSON.stringify(f)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-slate-500 text-xs">
                        No telemetry or rubric explanation recorded for this clip.
                      </div>
                    )}

                    <div className="flex justify-end pt-2 border-t border-white/[0.06]">
                      <button
                        onClick={() => setShowExplainModal(false)}
                        className="px-4 py-1.5 rounded-lg bg-white/10 text-xs font-bold text-white hover:bg-white/20"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
