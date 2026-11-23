import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, Clock, Send, AlertTriangle, MonitorPlay, Camera, Scissors, Film,
  Play, Trash2, CalendarX, Eye, X, Check, ArrowRight, Video, Sparkles, Tag
} from 'lucide-react';
import { getQueue, postClipNow, rescheduleQueueItem, removeQueueItem, withToken, getPerformance } from '../api';
import { Page, Panel, Pill, Button, IconButton, EmptyState, Skeleton, Stat, Confirm, Notice, Segmented } from './ui';
import QueueWeek from './QueueWeek';

const VIEW_KEY = 'autoclip_queue_view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'list'; } catch { return 'list'; } };

function relTime(date, now) {
  const diff = Math.round((date - now) / 60000);
  if (Math.abs(diff) < 1) return 'now';
  const abs = Math.abs(diff);
  const txt = abs < 60 ? `${abs}m` : abs < 1440 ? `${Math.floor(abs / 60)}h ${abs % 60 ? `${abs % 60}m` : ''}`.trim() : `${Math.floor(abs / 1440)}d`;
  return diff > 0 ? `in ${txt}` : `${txt} overdue`;
}

function dayLabel(date, now) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((d1 - d0) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

const TONE = { uploaded: 'good', failed: 'bad', pending: 'warn', skipped: 'idle' };

function Target({ icon: Icon, label, status }) {
  if (status === 'skipped') return null;
  return (
    <Pill tone={TONE[status] || 'warn'}>
      <Icon size={11} className="text-muted" /> {label} · {status || 'pending'}
    </Pill>
  );
}

export default function QueueCalendar() {
  const [queue, setQueue] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [posting, setPosting] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  // Modal states: Preview & Reschedule & Remove
  const [previewClip, setPreviewClip] = useState(null);
  const [rescheduleItem, setRescheduleItem] = useState(null);
  const [newScheduleTime, setNewScheduleTime] = useState('');
  const [removeItem, setRemoveItem] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [view, setViewState] = useState(readView);
  const [bestHours, setBestHours] = useState([]);
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
  useEffect(() => {
    if (view !== 'week') return;
    getPerformance(30).then((p) => setBestHours(p?.learning?.best_hours || [])).catch(() => {});
  }, [view]);

  const moveItem = async (item, when) => {
    const iso = when.toISOString();
    setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, scheduled_for: iso } : x)));     // instant
    try {
      await rescheduleQueueItem(item.id, iso);
    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Reschedule failed');
    }
    fetchQueue();
  };

  const fetchQueue = async () => {
    try {
      setQueue(await getQueue());
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    fetchQueue();
    const t = setInterval(() => {
      setNow(new Date());
      fetchQueue();
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const publishNow = async (clipId) => {
    setPosting(clipId);
    setError('');
    try {
      await postClipNow(clipId);
      await fetchQueue();
    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Publishing failed');
    } finally {
      setPosting(null);
      setConfirm(null);
    }
  };

  const handleRescheduleSubmit = async () => {
    if (!rescheduleItem || !newScheduleTime) return;
    setActionLoading(true);
    try {
      const dt = new Date(newScheduleTime);
      await rescheduleQueueItem(rescheduleItem.id, dt.toISOString());
      setRescheduleItem(null);
      await fetchQueue();
    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Reschedule failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveSubmit = async (returnToReview) => {
    if (!removeItem) return;
    setActionLoading(true);
    try {
      await removeQueueItem(removeItem.id, returnToReview);
      setRemoveItem(null);
      await fetchQueue();
    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Remove failed');
    } finally {
      setActionLoading(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of queue) {
      const d = new Date(item.scheduled_for);
      const k = Number.isNaN(d.getTime()) ? 'Unscheduled' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const label = Number.isNaN(d.getTime()) ? 'Unscheduled' : dayLabel(d, now);
      if (!map.has(k)) map.set(k, { label, items: [] });
      map.get(k).items.push({ ...item, when: d });
    }
    return Array.from(map.values());
  }, [queue, now]);

  const nextItem = useMemo(() => {
    const pending = queue
      .map((q) => ({ ...q, when: new Date(q.scheduled_for) }))
      .filter((q) => !Number.isNaN(q.when.getTime()) && q.when > now)
      .sort((a, b) => a.when - b.when);
    return pending[0] || null;
  }, [queue, now]);

  const failedCount = queue.filter((q) => q.yt_status === 'failed' || q.ig_status === 'failed').length;

  return (
    <Page title="Scheduled Queue" icon={Calendar}
      subtitle="Upcoming drip-feed publishing slots across all linked YouTube and Instagram channels."
      actions={<Segmented size="sm" pill value={view} onChange={setView} ariaLabel="Queue view"
        options={[{ value: 'list', label: 'List' }, { value: 'week', label: 'Week' }]} />}>
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Panel className="!p-3.5"><Stat label="Scheduled" value={queue.length} icon={Calendar} /></Panel>
        <Panel className="!p-3.5">
          <Stat label="Next post" value={nextItem ? relTime(nextItem.when, now) : 'None'}
            hint={nextItem ? nextItem.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Queue is empty'} icon={Clock} />
        </Panel>
        <Panel className="!p-3.5 col-span-2 md:col-span-1">
          <Stat label="Failed" value={failedCount} tone={failedCount > 0 ? 'bad' : 'good'}
            hint={failedCount > 0 ? 'Needs attention' : 'All clear'} icon={AlertTriangle} />
        </Panel>
      </div>

      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}

      {!loaded && <div className="space-y-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}

      {loaded && queue.length === 0 && (
        <Panel>
          <EmptyState icon={Calendar} title="Nothing scheduled"
            text="Swipe right on a clip in Review (or tap Queue) and it will appear here with its upload time."
            action={<Link to="/"><Button variant="primary" icon={Film}>Go to Review</Button></Link>} />
        </Panel>
      )}

      {loaded && queue.length > 0 && view === 'week' && (
        <QueueWeek items={queue} now={now} bestHours={bestHours} onMove={moveItem}
          onOpen={(item) => setPreviewClip({
            ...item,
            videoUrl: item.rendered_video_path ? withToken(`/api/clips/${item.clip_id}/video`) : null,
            thumbUrl: item.thumbnail_path ? withToken(`/api/clips/${item.clip_id}/thumbnail`) : null,
          })} />
      )}

      <div className={`space-y-6 max-w-4xl mx-auto ${view === 'week' ? 'hidden' : ''}`}>
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h2 className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-2.5 px-1">{g.label}</h2>
            <div className="space-y-3">
              {g.items.map((item) => {
                const failed = item.yt_status === 'failed' || item.ig_status === 'failed';
                const validTime = !Number.isNaN(item.when.getTime());
                const overdue = item.when < now;
                // Finished clips live in output/clips; the clip API serves them (Range + auth token).
                const thumbUrl = item.thumbnail_path ? withToken(`/api/clips/${item.clip_id}/thumbnail`) : null;
                const videoUrl = item.rendered_video_path ? withToken(`/api/clips/${item.clip_id}/video`) : null;

                return (
                  <Panel key={item.id} tone={failed ? 'bad' : undefined} className="!p-4 transition hover:border-line-strong">
                    <div className="flex items-start gap-4">
                      
                      {/* Left: Prominent 9:16 Video Thumbnail */}
                      <button
                        type="button"
                        onClick={() => setPreviewClip({ ...item, videoUrl, thumbUrl })}
                        className="group relative w-20 sm:w-24 aspect-[9/16] shrink-0 rounded-xl bg-black border border-white/10 overflow-hidden shadow-lg flex items-center justify-center cursor-pointer hover:border-accent transition"
                        title="Click to preview video clip"
                      >
                        {thumbUrl ? (
                          <img src={thumbUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                        ) : (
                          <Film size={24} className="text-muted" />
                        )}
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 flex items-center justify-center transition">
                          <span className="w-8 h-8 rounded-full bg-accent text-black flex items-center justify-center shadow-lg group-hover:scale-110 transition">
                            <Play size={14} className="fill-current ml-0.5" />
                          </span>
                        </div>
                        {item.virality_score != null && (
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/85 font-mono text-[10px] font-bold text-good border border-white/10">
                            {item.virality_score}
                          </span>
                        )}
                      </button>

                      {/* Right: Content & Metadata */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                        <div className="space-y-1.5">
                          {/* Top Row: Time Badge + Delete button */}
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const d = new Date(item.scheduled_for);
                                const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                                setRescheduleItem(item);
                                setNewScheduleTime(localIso);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-ink text-xs font-semibold transition cursor-pointer"
                              title="Click to reschedule posting time"
                            >
                              <Clock size={12} className="text-accent" />
                              <span className="tabular-nums font-bold">
                                {validTime ? item.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                              </span>
                              <span className={`text-[10.5px] ${overdue ? 'text-bad font-bold' : 'text-muted'}`}>
                                ({validTime ? relTime(item.when, now) : ''})
                              </span>
                              <span className="text-[10.5px] text-accent ml-1 font-normal underline decoration-dotted">Change</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setRemoveItem(item)}
                              className="p-1.5 rounded-lg text-muted hover:text-bad hover:bg-bad/10 transition"
                              title="Remove from queue"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>

                          <h3
                            onClick={() => setPreviewClip({ ...item, videoUrl, thumbUrl })}
                            className="text-[15px] font-bold text-ink hover:text-accent cursor-pointer line-clamp-2 leading-snug transition"
                          >
                            {item.title || 'Untitled clip'}
                          </h3>

                          <p className="text-[11.5px] text-muted truncate">
                            #{item.clip_id} · @{item.channel_id || 'unknown'} · <span className="font-mono text-slate-300">{item.template_name}</span>
                          </p>

                          <p className="text-[11.5px] font-medium text-accent truncate">
                            → {item.account_title || item.account_key || 'Mapped channels'}
                            {item.attempts > 0 && item.yt_status === 'pending' ? <span className="text-warn"> · retry {item.attempts}</span> : null}
                          </p>

                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <Target icon={MonitorPlay} label="YouTube" status={item.yt_status} />
                            <Target icon={Camera} label="Instagram" status={item.ig_status} />
                          </div>

                          {item.last_error && (
                            <p className="mt-2 text-[11px] text-bad flex items-start gap-1.5 break-words bg-bad/10 p-2 rounded-lg">
                              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {item.last_error}
                            </p>
                          )}
                        </div>

                        {/* Bottom Action Buttons (aligned neatly) */}
                        <div className="flex items-center gap-2 pt-3 mt-3 border-t border-line">
                          <Link to={`/clips/${item.clip_id}/editor`}>
                            <Button size="sm" icon={Scissors}>Edit</Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="primary"
                            icon={Send}
                            loading={posting === item.clip_id}
                            disabled={posting !== null}
                            onClick={() => setConfirm(item.clip_id)}
                          >
                            Post now
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {queue.length > 0 && view === 'list' && (
        <p className="text-center text-[11px] text-faint flex items-center justify-center gap-1 mt-6">
          <Clock size={11} /> Times are shown in your local timezone · Tap any time to reschedule
        </p>
      )}

      {/* 1. Modal: Video Preview Clip Inspection */}
      {previewClip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl bg-surface border border-line-strong rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line bg-canvas">
              <div className="min-w-0 pr-3">
                <h3 className="font-semibold text-sm text-ink truncate">{previewClip.title || 'Clip Preview'}</h3>
                <p className="text-xs text-muted">#{previewClip.clip_id} · @{previewClip.channel_id}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewClip(null)}
                className="p-1 rounded-lg text-muted hover:text-white hover:bg-raised transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex flex-col md:flex-row gap-4 items-center md:items-start">
              <div className="w-56 aspect-[9/16] bg-black rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-lg">
                {previewClip.videoUrl ? (
                  <video
                    src={previewClip.videoUrl}
                    poster={previewClip.thumbUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted">No video file</div>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-3 text-xs w-full">
                <div>
                  <label className="text-[10.5px] uppercase font-bold text-muted block mb-0.5">Title</label>
                  <p className="font-semibold text-ink text-[13px]">{previewClip.title}</p>
                </div>

                {previewClip.description && (
                  <div>
                    <label className="text-[10.5px] uppercase font-bold text-muted block mb-0.5">Description</label>
                    <p className="text-slate-300 leading-relaxed bg-canvas p-2.5 rounded-lg border border-line">
                      {previewClip.description}
                    </p>
                  </div>
                )}

                {previewClip.hashtags && (
                  <div>
                    <label className="text-[10.5px] uppercase font-bold text-muted block mb-0.5">Hashtags</label>
                    <p className="text-accent font-mono">{previewClip.hashtags}</p>
                  </div>
                )}

                <div className="pt-2 flex items-center gap-2">
                  <Link to={`/clips/${previewClip.clip_id}/editor`} className="flex-1">
                    <Button block size="sm" icon={Scissors} onClick={() => setPreviewClip(null)}>
                      Open in Studio Editor
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Modal: Reschedule Date & Time Picker */}
      {rescheduleItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-surface border border-line-strong rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-semibold text-sm text-ink flex items-center gap-2">
                <Clock size={16} className="text-accent" /> Reschedule Post Time
              </h3>
              <button
                type="button"
                onClick={() => setRescheduleItem(null)}
                className="text-muted hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted">
              Choose when <span className="text-ink font-semibold">&ldquo;{rescheduleItem.title}&rdquo;</span> should be published to YouTube & Instagram:
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">Date & Time</label>
              <input
                type="datetime-local"
                value={newScheduleTime}
                onChange={(e) => setNewScheduleTime(e.target.value)}
                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-accent"
              />
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                { label: '+2 Hours', mins: 120 },
                { label: '+6 Hours', mins: 360 },
                { label: 'Tomorrow 12:30 PM', custom: 'tomorrow_1230' },
                { label: 'Tomorrow 9:30 PM', custom: 'tomorrow_2130' },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const target = new Date();
                    if (p.mins) {
                      target.setMinutes(target.getMinutes() + p.mins);
                    } else if (p.custom === 'tomorrow_1230') {
                      target.setDate(target.getDate() + 1);
                      target.setHours(12, 30, 0, 0);
                    } else if (p.custom === 'tomorrow_2130') {
                      target.setDate(target.getDate() + 1);
                      target.setHours(21, 30, 0, 0);
                    }
                    const iso = new Date(target.getTime() - target.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    setNewScheduleTime(iso);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-raised hover:bg-white/10 text-[11px] font-semibold text-slate-300 border border-white/5 transition"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-line">
              <Button block onClick={() => setRescheduleItem(null)}>Cancel</Button>
              <Button block variant="primary" loading={actionLoading} onClick={handleRescheduleSubmit}>
                Save new time
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: Remove from Queue Confirmation */}
      {removeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-surface border border-line-strong rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-semibold text-sm text-ink flex items-center gap-2 text-warn">
                <CalendarX size={17} /> Remove from Publishing Schedule
              </h3>
              <button
                type="button"
                onClick={() => setRemoveItem(null)}
                className="text-muted hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              What would you like to do with <span className="text-ink font-semibold">&ldquo;{removeItem.title}&rdquo;</span>?
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleRemoveSubmit(true)}
                className="w-full p-3 rounded-xl bg-raised hover:bg-white/[0.08] border border-white/10 text-left transition flex items-center justify-between group"
              >
                <div>
                  <div className="text-xs font-bold text-white group-hover:text-accent">Return to Review</div>
                  <div className="text-[11px] text-muted">Cancels scheduled posting. Clip is kept safe in your approved clips list.</div>
                </div>
                <ArrowRight size={14} className="text-muted group-hover:text-accent shrink-0 ml-2" />
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleRemoveSubmit(false)}
                className="w-full p-3 rounded-xl bg-bad/10 hover:bg-bad/20 border border-bad/30 text-left transition flex items-center justify-between group"
              >
                <div>
                  <div className="text-xs font-bold text-bad">Cancel &amp; Delete Post Entry</div>
                  <div className="text-[11px] text-slate-400">Completely drops this upload task without putting it back in Review.</div>
                </div>
                <Trash2 size={14} className="text-bad shrink-0 ml-2" />
              </button>
            </div>

            <div className="pt-2">
              <Button block onClick={() => setRemoveItem(null)}>Never mind</Button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Modal: Post Now Confirmation */}
      <Confirm
        open={confirm != null}
        title={`Post clip #${confirm} now?`}
        text="It uploads immediately instead of waiting for its slot, and counts against that channel's daily YouTube quota."
        confirmLabel="Post now"
        onCancel={() => setConfirm(null)}
        onConfirm={() => publishNow(confirm)}
      />
    </Page>
  );
}
