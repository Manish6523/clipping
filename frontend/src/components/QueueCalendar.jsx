import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, Send, AlertTriangle, Loader2, MonitorPlay, Camera, Scissors } from 'lucide-react';
import { getQueue, postClipNow } from '../api';

const STATUS_STYLE = {
  uploaded: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  pending: 'bg-white/[0.05] text-slate-300 border-white/10',
};

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

function StatusChip({ icon: Icon, label, status }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}>
      <Icon size={12} /> {label} · {status || 'pending'}
    </span>
  );
}

export default function QueueCalendar() {
  const [queue, setQueue] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [posting, setPosting] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const fetchQueue = async () => {
    try {
      setQueue(await getQueue());
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoaded(true);
      setNow(new Date());
    }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 15000);
    return () => clearInterval(interval);
  }, []);

  const handlePublishNow = async (clipId) => {
    if (!window.confirm(`Upload clip #${clipId} right now instead of waiting for its slot?`)) return;
    setPosting(clipId);
    try {
      await postClipNow(clipId);
      fetchQueue();
    } catch (err) {
      alert('Publish failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setPosting(null);
    }
  };

  const groups = useMemo(() => {
    const out = [];
    for (const item of queue) {
      const when = new Date(item.scheduled_for);
      const label = Number.isNaN(when.getTime()) ? 'Unscheduled' : dayLabel(when, now);
      let g = out.find((x) => x.label === label);
      if (!g) { g = { label, items: [] }; out.push(g); }
      g.items.push({ ...item, when });
    }
    return out;
  }, [queue, now]);

  const next = queue.length ? new Date(queue[0].scheduled_for) : null;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Calendar className="text-amber-500" size={20} />
            <span className="sm:hidden">Drip Queue</span>
            <span className="hidden sm:inline">Drip-Feed Queue</span>
          </h2>
          <p className="hidden sm:block text-xs text-slate-400 mt-1">Approved clips upload automatically at their slot.</p>
        </div>
        {next && !Number.isNaN(next.getTime()) && (
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase font-bold text-slate-500">Next post</div>
            <div className="text-sm font-black text-amber-300">{relTime(next, now)}</div>
          </div>
        )}
      </div>

      {!loaded && (
        <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
      )}

      {loaded && queue.length === 0 && (
        <div className="py-14 px-6 text-center rounded-2xl border border-dashed border-white/10 text-slate-400 text-sm">
          Nothing scheduled. Swipe right on a clip in Review to add it here.
          <div className="mt-4">
            <Link to="/" className="inline-block px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Go to Review</Link>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2 px-1">{g.label}</h3>
            <div className="space-y-2">
              {g.items.map((item) => {
                const failed = item.yt_status === 'failed' || item.ig_status === 'failed';
                const validTime = !Number.isNaN(item.when.getTime());
                return (
                  <div key={item.id} className={`rounded-2xl border p-3 bg-slate-900/60 ${failed ? 'border-rose-500/30' : 'border-white/[0.08]'}`}>
                    <div className="flex items-start gap-3">
                      <div className="w-16 shrink-0 text-center">
                        <div className="text-base font-black text-white leading-tight">
                          {validTime ? item.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </div>
                        <div className={`text-[10px] font-bold ${item.when < now ? 'text-rose-300' : 'text-amber-300'}`}>
                          {validTime ? relTime(item.when, now) : ''}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white line-clamp-2">{item.title || 'Untitled clip'}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                          #{item.clip_id} · @{item.channel_id || 'unknown'} · {item.template_name}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <StatusChip icon={MonitorPlay} label="YT" status={item.yt_status} />
                          <StatusChip icon={Camera} label="IG" status={item.ig_status} />
                        </div>
                        {item.last_error && (
                          <p className="mt-2 text-[11px] text-rose-300 flex items-start gap-1.5 break-words">
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {item.last_error}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Link
                        to={`/clips/${item.clip_id}/editor`}
                        className="flex-1 h-10 rounded-xl bg-white/[0.05] border border-white/10 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5"
                      >
                        <Scissors size={14} /> Edit
                      </Link>
                      <button
                        onClick={() => handlePublishNow(item.clip_id)}
                        disabled={posting !== null}
                        className="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {posting === item.clip_id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post now
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {queue.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-slate-500 flex items-center justify-center gap-1">
          <Clock size={11} /> Times shown in your local timezone
        </p>
      )}
    </div>
  );
}
