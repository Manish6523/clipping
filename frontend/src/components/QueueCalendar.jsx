import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, Send, AlertTriangle, MonitorPlay, Camera, Scissors, Film } from 'lucide-react';
import { getQueue, postClipNow } from '../api';
import { Page, Panel, Pill, Button, EmptyState, Skeleton, Stat, Confirm, Notice } from './ui';

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

  const publishNow = async (clipId) => {
    setConfirm(null);
    setPosting(clipId);
    setError('');
    try {
      await postClipNow(clipId);
      fetchQueue();
    } catch (err) {
      setError(`Publish failed: ${err.response?.data?.error || err.message}`);
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
  const failedCount = queue.filter((q) => q.yt_status === 'failed' || q.ig_status === 'failed').length;
  const channels = new Set(queue.map((q) => q.account_key || q.account_title).filter(Boolean)).size;

  return (
    <Page title="Drip queue" icon={Calendar} subtitle="Approved clips upload on their own at each channel's next free slot." narrow>
      {loaded && queue.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Scheduled" value={queue.length} icon={Calendar} />
          <Stat label="Next post" value={next && !Number.isNaN(next.getTime()) ? relTime(next, now) : '—'} icon={Clock} />
          <Stat label="Failed" value={failedCount} tone={failedCount ? 'bad' : 'good'} sub={`${channels} channel${channels === 1 ? '' : 's'}`} />
        </div>
      )}

      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}

      {!loaded && <div className="space-y-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}

      {loaded && queue.length === 0 && (
        <Panel>
          <EmptyState icon={Calendar} title="Nothing scheduled"
            text="Swipe right on a clip in Review (or tap Queue) and it will appear here with its upload time."
            action={<Link to="/"><Button variant="primary" icon={Film}>Go to Review</Button></Link>} />
        </Panel>
      )}

      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h2 className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-2 px-1">{g.label}</h2>
            <div className="space-y-2">
              {g.items.map((item) => {
                const failed = item.yt_status === 'failed' || item.ig_status === 'failed';
                const validTime = !Number.isNaN(item.when.getTime());
                const overdue = item.when < now;
                return (
                  <Panel key={item.id} tone={failed ? 'bad' : undefined} className="!p-3">
                    <div className="flex items-start gap-3">
                      <div className="w-[58px] shrink-0 text-center rounded-xl bg-white/[0.04] py-1.5">
                        <div className="text-[15px] font-semibold text-ink tabular-nums leading-tight">
                          {validTime ? item.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </div>
                        <div className={`text-[10px] font-semibold ${overdue ? 'text-bad' : 'text-warn'}`}>{validTime ? relTime(item.when, now) : ''}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-semibold text-ink line-clamp-2 leading-snug">{item.title || 'Untitled clip'}</p>
                        <p className="text-[11px] text-muted mt-0.5 truncate">#{item.clip_id} · @{item.channel_id || 'unknown'} · {item.template_name}</p>
                        <p className="text-[11px] mt-0.5 font-medium text-accent truncate">
                          → {item.account_title || item.account_key || 'Mapped channels'}
                          {item.attempts > 0 && item.yt_status === 'pending' ? <span className="text-warn"> · retry {item.attempts}</span> : null}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <Target icon={MonitorPlay} label="YouTube" status={item.yt_status} />
                          <Target icon={Camera} label="Instagram" status={item.ig_status} />
                        </div>
                        {item.last_error && (
                          <p className="mt-2 text-[11px] text-bad flex items-start gap-1.5 break-words">
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {item.last_error}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Link to={`/clips/${item.clip_id}/editor`} className="flex-1">
                        <Button block size="sm" icon={Scissors}>Edit</Button>
                      </Link>
                      <Button block size="sm" variant="primary" icon={Send} loading={posting === item.clip_id}
                        disabled={posting !== null} onClick={() => setConfirm(item.clip_id)}>Post now</Button>
                    </div>
                  </Panel>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {queue.length > 0 && <p className="text-center text-[11px] text-faint flex items-center justify-center gap-1"><Clock size={11} /> Times are shown in your local timezone</p>}

      <Confirm open={confirm != null} title={`Post clip #${confirm} now?`}
        text="It uploads immediately instead of waiting for its slot, and counts against that channel's daily YouTube quota."
        confirmLabel="Post now" onCancel={() => setConfirm(null)} onConfirm={() => publishNow(confirm)} />
    </Page>
  );
}
