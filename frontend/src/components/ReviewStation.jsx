import React, { useState, useEffect, useRef, useMemo } from 'react';
import { censorFlagInfo } from '../utils/profanity';
import ScoreBreakdown from './ScoreBreakdown';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Send, Calendar, Save, Sparkles, Scissors, CheckCircle2, Maximize2, CheckSquare, Square, MinusSquare, Flame, Eye, Clock, Trash2,
  VolumeX, AlertTriangle, Info, Star, Film, Tag, SkipBack, SkipForward, Clapperboard,
} from 'lucide-react';
import {
  getClips, getClip, getClipExplain, trimClip, toggleTeaser, updateClip, postClipNow, queueClip, discardClip, batchDiscardClips, sendClipFeedback,
} from '../api';
import { Panel, Segmented, Button, IconButton, Input, Select, Field, Badge, Pill, Notice, Sheet, Confirm, EmptyState, Skeleton, Spinner } from './ui';

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
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmBatch, setConfirmBatch] = useState(false);

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
    setErrorMsg('');
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
    setConfirmBatch(false);
    setBatchLoading(true);
    try {
      const res = await batchDiscardClips(ids);
      setSelectedClipIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      if (onStatusChange) onStatusChange();
      showFeedback(`Discarded ${res.deleted_count || ids.length} clips.`);
    } catch (err) {
      setErrorMsg('Batch discard failed: ' + err.message);
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
      setErrorMsg('Trim failed: ' + err.message);
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
      setErrorMsg('Teaser toggle failed: ' + err.message);
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
      setErrorMsg('Save failed: ' + err.message);
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
      setErrorMsg('Failed to post clip: ' + err.message);
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
      setErrorMsg('Failed to queue clip: ' + err.message);
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
      setErrorMsg('Failed to mark great: ' + err.message);
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
      setErrorMsg('Failed to discard clip: ' + err.message);
    }
  };

  const handleTagRejectedClip = async (clipId, reasonCode) => {
    try {
      await sendClipFeedback(clipId, 'reason_tagged', { reason: reasonCode, source: 'retro_tagging_ui' });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      showFeedback(`Clip #${clipId} tagged: ${reasonCode}`);
    } catch (err) {
      setErrorMsg('Tagging failed: ' + err.message);
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
  const unscored = (c) => !c.virality_score || c.virality_score === 0 || (c.flags && c.flags.includes('unscored'));
  const STATUSES = [
    { value: 'pending_approval', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'queued', label: 'Queued' },
    { value: 'published', label: 'Published' },
    { value: 'rejected', label: 'Rejected' },
  ];
  const clipLen = (c) => ((c.adjusted_end || 30) - (c.adjusted_start || 0)).toFixed(1);
  const censorBadge = (c) => {
    const info = censorFlagInfo(c.flags);
    if (!info) return null;
    return (
      <Badge tone={info.slur ? 'bad' : 'warn'} className="gap-1" >
        {info.slur ? <AlertTriangle size={10} /> : <VolumeX size={10} />}{info.slur ? 'slur' : info.count}
      </Badge>
    );
  };

  return (
    <div className="w-full min-h-[calc(100dvh-56px)] lg:h-[calc(100dvh-56px)] flex flex-col px-3 sm:px-5 pt-3 pb-3 gap-3 overflow-y-auto lg:overflow-hidden bg-canvas select-none">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Segmented value={statusFilter} onChange={setStatusFilter} options={STATUSES} ariaLabel="Clip status" />
        {statusFilter === 'rejected' && (
          <Segmented size="sm" value={rejectFilter} onChange={setRejectFilter} ariaLabel="Rejected filter"
            options={[{ value: 'all', label: 'All rejected' }, { value: 'untagged', label: 'Untagged', count: rawClips.filter((c) => !c.rejection_reason).length }]} />
        )}
        {selectedClipIds.size > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-bad/10 border border-bad/30 pl-3 pr-1.5 h-9">
            <span className="text-xs font-semibold text-bad tabular-nums">{selectedClipIds.size} selected</span>
            <Button size="sm" variant="danger" icon={Trash2} loading={batchLoading} onClick={() => setConfirmBatch(true)}>Discard</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedClipIds(new Set())}>Cancel</Button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {channelsList.length > 0 && (
            <Select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Streamer" className="!h-9 !w-auto !text-xs">
              <option value="all">All streamers ({rawClips.length})</option>
              {channelsList.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
            </Select>
          )}
          <Pill dot={false}>{clips.length} clip{clips.length === 1 ? '' : 's'}</Pill>
        </div>
      </div>

      {/* Phone tabs (the swipe view is the default on phones; this is the classic fallback) */}
      <Segmented className="lg:hidden w-full shrink-0 [&>button]:flex-1 [&>button]:justify-center" value={mobileTab} onChange={setMobileTab} ariaLabel="Panel"
        options={[{ value: 'queue', label: `Queue (${clips.length})` }, { value: 'player', label: 'Player' }, { value: 'details', label: 'Details' }]} />

      <div className="flex-1 grid grid-cols-12 gap-3 min-h-0 lg:overflow-hidden">
        {/* Queue */}
        <Panel pad={false} className={`col-span-12 lg:col-span-3 flex flex-col min-h-[320px] lg:min-h-0 overflow-hidden ${mobileTab !== 'queue' ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-line shrink-0">
            <button type="button" onClick={handleSelectAll} className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
              {isAllSelected ? <CheckSquare size={15} className="text-accent" /> : isSomeSelected ? <MinusSquare size={15} className="text-accent" /> : <Square size={15} />}
              Select all
            </button>
            <span className="text-[11px] text-faint">Best first</span>
          </div>
          {isClipsLoading && clips.length === 0 ? (
            <div className="p-2 space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[74px]" />)}</div>
          ) : clips.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="All caught up" text={`Nothing in "${statusFilter.replace('_', ' ')}".`} />
          ) : (
            <div ref={parentRef} className="flex-1 overflow-y-auto min-h-0 p-1.5">
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((vr) => {
                  const clip = clips[vr.index];
                  const isActive = clip.id === activeClipId;
                  const isChecked = selectedClipIds.has(clip.id);
                  return (
                    <div key={clip.id} onClick={() => setActiveClipId(clip.id)} className="p-1"
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${vr.size}px`, transform: `translateY(${vr.start}px)` }}>
                      <div onClick={() => setMobileTab('player')} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') { setActiveClipId(clip.id); setMobileTab('player'); } }}
                        className={`h-full rounded-xl border px-2.5 py-2 cursor-pointer transition-colors flex flex-col justify-between ${isActive ? 'border-accent/60 bg-accent/10' : 'border-line bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <button type="button" onClick={(e) => handleToggleSelectClip(e, clip.id)} aria-label={isChecked ? 'Deselect' : 'Select'} className="shrink-0 text-faint hover:text-ink">
                              {isChecked ? <CheckSquare size={15} className="text-accent" /> : <Square size={15} />}
                            </button>
                            <span className="font-semibold text-ink truncate">#{clip.id} · {clip.channel_id}</span>
                          </div>
                          <Badge tone={unscored(clip) ? 'idle' : 'warn'} className="shrink-0 gap-1">{unscored(clip) ? 'unscored' : <><Flame size={10} />{clip.virality_score}</>}</Badge>
                        </div>
                        <div className="text-[11.5px] text-slate-200 line-clamp-1 pl-[23px]">{clip.title || 'Untitled clip'}</div>
                        <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted pl-[23px]">
                          <span className="truncate max-w-[110px]">{clip.template_name}</span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {censorBadge(clip)}
                            {clip.latest_views != null && <span className="flex items-center gap-0.5 text-good"><Eye size={10} />{Number(clip.latest_views).toLocaleString()}</span>}
                            <span className="flex items-center gap-0.5 tabular-nums"><Clock size={10} />{clipLen(clip)}s</span>
                          </span>
                        </div>
                        {clip.status === 'rejected' && (
                          <div className="pl-[23px] -mb-0.5">
                            {clip.rejection_reason ? <Badge tone="bad">{clip.rejection_reason.replace('_', ' ')}</Badge> : <Badge tone="warn">untagged reject</Badge>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>

        {/* Player */}
        <Panel pad={false} className={`col-span-12 lg:col-span-4 relative flex flex-col items-center justify-center p-3 min-h-[420px] lg:min-h-0 overflow-hidden ${mobileTab !== 'player' ? 'hidden lg:flex' : 'flex'}`}>
          <div className="h-full max-h-[78dvh] aspect-[9/16] bg-black rounded-2xl overflow-hidden border border-line-strong relative shadow-2xl flex items-center justify-center max-w-full">
            {videoSrc ? (
              <div key={videoSrc} className="w-full h-full">
                <video ref={videoRef} src={videoSrc} poster={posterUrl || undefined} controls loop playsInline preload="metadata" className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="text-muted text-xs flex flex-col items-center gap-2"><Film size={28} className="text-faint" /><span>Select a clip</span></div>
            )}
          </div>
          {loading && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30">
              <Spinner size={28} className="!text-accent" />
              <span className="text-xs font-semibold text-accent">Re-rendering the clip…</span>
            </div>
          )}
        </Panel>

        {/* Inspector */}
        <Panel pad={false} className={`col-span-12 lg:col-span-5 p-3.5 flex flex-col gap-3 min-h-0 overflow-hidden ${mobileTab !== 'details' ? 'hidden lg:flex' : 'flex'}`}>
          {activeClipSummary ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0 pb-2.5 border-b border-line">
                <Badge tone="accent">Clip #{activeClipSummary.id}</Badge>
                <Pill dot={false}>@{activeClipSummary.channel_id}</Pill>
                <Badge tone={unscored(activeClipSummary) ? 'idle' : 'warn'} className="gap-1">{unscored(activeClipSummary) ? 'unscored' : <><Flame size={10} />{activeClipSummary.virality_score}/100</>}</Badge>
                {censorBadge(activeClipSummary)}
                <Pill dot={false}><Clock size={11} className="text-muted" />{clipLen(activeClipSummary)}s</Pill>
                {activeClipSummary.status === 'rejected' && (
                  <Badge tone={activeClipSummary.rejection_reason ? 'bad' : 'warn'}>{activeClipSummary.rejection_reason ? activeClipSummary.rejection_reason.replace('_', ' ') : 'untagged'}</Badge>
                )}
                <Button size="sm" icon={Info} onClick={handleOpenExplain} className="ml-auto">Why this score?</Button>
              </div>

              {feedbackMsg && <Notice tone="good" icon={CheckCircle2} className="shrink-0">{feedbackMsg}</Notice>}
              {errorMsg && <Notice tone="bad" icon={AlertTriangle} className="shrink-0">{errorMsg}</Notice>}

              <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1 min-h-0">
                <Field label="Title / hook"><Input value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} /></Field>
                <Field label="Hashtags"><Input mono value={editingTags} onChange={(e) => setEditingTags(e.target.value)} className="!text-accent" /></Field>

                <div className="flex-1 flex flex-col min-h-[110px]">
                  <div className="flex items-center justify-between mb-1.5 shrink-0">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"><Sparkles size={12} className="text-accent" /> Transcript</span>
                    <span className="text-[10.5px] text-faint">Click a word to jump · double-click to edit</span>
                  </div>
                  <div className="flex-1 bg-canvas border border-line rounded-xl p-2.5 overflow-y-auto flex flex-wrap gap-1 items-start content-start">
                    {transcriptWords.length === 0 ? (
                      <span className="text-xs text-muted italic">No word-level transcript is cached for this clip.</span>
                    ) : transcriptWords.map((item, idx) => (
                      <span key={idx} onClick={() => handleSeek(item.start)} onDoubleClick={() => handleWordDoubleClick(idx, item.word)}
                        title={`Jump to ${item.start?.toFixed(1)}s`}
                        className={`inline-block px-1.5 py-0.5 rounded-md text-xs cursor-pointer transition-colors ${editingWordIdx === idx ? 'bg-accent-strong text-white' : 'bg-white/[0.05] hover:bg-accent/20 text-slate-300 hover:text-ink'}`}>
                        {editingWordIdx === idx ? (
                          <input type="text" autoFocus value={wordInput} onChange={(e) => setWordInput(e.target.value)} onBlur={() => handleWordSave(idx)}
                            onKeyDown={(e) => e.key === 'Enter' && handleWordSave(idx)} className="bg-black text-accent border border-accent rounded px-1 outline-none w-20 !text-xs" />
                        ) : item.word}
                      </span>
                    ))}
                  </div>
                </div>

                {activeClipSummary.status === 'rejected' && (
                  <div className="bg-canvas border border-line rounded-xl p-3 shrink-0">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <span className="text-xs font-semibold text-bad flex items-center gap-1.5"><Tag size={12} />{activeClipSummary.rejection_reason ? 'Change the rejection reason' : 'Tag the rejection (teaches the AI)'}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {REJECTION_REASONS.map((r) => (
                        <button key={r.code} type="button" onClick={() => handleTagRejectedClip(activeClipSummary.id, r.code)}
                          className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${activeClipSummary.rejection_reason === r.code ? 'bg-bad text-canvas' : 'bg-white/[0.06] text-slate-300 hover:bg-bad/20 hover:text-ink'}`}>{r.label}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-canvas border border-line rounded-xl p-3 shrink-0">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2"><Scissors size={12} className="text-accent" /> Trim &amp; re-render (±3 s)</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <Button size="sm" icon={SkipBack} disabled={loading} onClick={() => handleTrim(-3, 0)}>Start −3s</Button>
                    <Button size="sm" icon={SkipForward} disabled={loading} onClick={() => handleTrim(3, 0)}>Start +3s</Button>
                    <Button size="sm" icon={SkipBack} disabled={loading} onClick={() => handleTrim(0, -3)}>End −3s</Button>
                    <Button size="sm" icon={SkipForward} disabled={loading} onClick={() => handleTrim(0, 3)}>End +3s</Button>
                  </div>
                  <Button size="sm" block icon={Clapperboard} disabled={loading} onClick={handleToggleTeaser} className="mt-1.5">Teaser intro: {activeClipSummary.has_teaser ? 'ON' : 'OFF'}</Button>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-2.5 border-t border-line shrink-0">
                {Boolean(clipData?.has_raw_video ?? activeClipSummary?.has_raw_video) && (
                  <a href={`/clips/${activeClipSummary.id}/editor`} className="col-span-3 sm:col-span-1">
                    <Button block size="sm" variant="secondary" icon={Maximize2}>Editor</Button>
                  </a>
                )}
                <Button size="sm" variant="warn" icon={Star} disabled={loading} onClick={handleMarkGreat}>Great</Button>
                <Button size="sm" variant="good" icon={Send} disabled={loading} onClick={handlePostNow}>Post</Button>
                <Button size="sm" variant="primary" icon={Calendar} disabled={loading} onClick={handleQueue}>Queue</Button>
                <Button size="sm" icon={Save} disabled={loading} onClick={handleSaveMetadata}>Save</Button>
                <Button size="sm" variant="danger" icon={Trash2} disabled={loading} onClick={() => setShowRejectModal(true)}>Reject</Button>
              </div>
            </>
          ) : (
            <EmptyState icon={Film} title="Pick a clip" text="Select a clip from the queue to review and edit it." className="my-auto" />
          )}
        </Panel>
      </div>

      <Sheet open={showRejectModal} onClose={() => setShowRejectModal(false)} title="Why reject this clip?">
        <p className="text-xs text-muted mb-3">Your answer teaches the AI judge to avoid similar moments for this streamer.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {REJECTION_REASONS.map((r) => (
            <button key={r.code} type="button" onClick={() => handleDiscardWithReason(r.code)}
              className="h-11 rounded-xl bg-white/[0.05] hover:bg-bad/20 text-[13px] font-semibold text-slate-200 hover:text-ink transition-colors">{r.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => handleDiscardWithReason(null)} className="mt-3 w-full text-center text-xs text-muted hover:text-ink underline py-2">Skip the reason</button>
      </Sheet>

      <Sheet open={showExplainModal} onClose={() => setShowExplainModal(false)} wide title={`AI score breakdown · clip #${activeClipSummary?.id ?? ''}`}>
        {explainLoading ? (
          <div className="flex justify-center py-12"><Spinner size={26} /></div>
        ) : explainData ? (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-2">
              {[['Virality score', `${explainData.virality_score || 0}/100`], ['Formula', explainData.formula_version || 'legacy'], ['Judge model', explainData.model || 'gemini-flash-lite']].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-canvas border border-line px-3 py-2 min-w-0"><div className="text-[10.5px] text-muted">{k}</div><div className="text-[14px] font-semibold text-ink truncate tabular-nums">{v}</div></div>
              ))}
            </div>
            <ScoreBreakdown raw={explainData.score_breakdown} />
            {explainData.trigger && Object.keys(explainData.trigger).length > 0 && (
              <div>
                <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-1.5">Detection trigger</h4>
                <div className="bg-canvas border border-line rounded-xl p-3 text-[11.5px] text-slate-300 space-y-0.5">
                  <div>Type: <b className="text-ink">{explainData.trigger.type || 'stream moment'}</b></div>
                  {explainData.trigger.ratio && <div>Chat spike: <b className="text-good">{explainData.trigger.ratio}×</b> normal</div>}
                  {explainData.trigger.peak_db && <div>Audio peak: <b className="text-warn">{explainData.trigger.peak_db} dB</b></div>}
                </div>
              </div>
            )}
            {explainData.flags && explainData.flags.length > 0 && (
              <div>
                <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-1.5">Content flags</h4>
                <div className="flex flex-wrap gap-1.5">{explainData.flags.map((f, i) => <Badge key={i} tone="bad">{f.type || f.note || JSON.stringify(f)}</Badge>)}</div>
              </div>
            )}
          </div>
        ) : <EmptyState title="No explanation recorded" text="This clip has no score breakdown stored." />}
      </Sheet>

      <Confirm open={confirmBatch} danger title={`Discard ${selectedClipIds.size} clip${selectedClipIds.size === 1 ? '' : 's'}?`} confirmLabel="Discard"
        text="They are permanently deleted, including their files." onCancel={() => setConfirmBatch(false)} onConfirm={handleBatchDiscard} />
    </div>
  );
}
