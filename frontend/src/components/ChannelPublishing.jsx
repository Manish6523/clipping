import React, { useEffect, useState } from 'react';
import { Zap, Clock, Plus, X, Gauge, FlaskConical, ShieldCheck } from 'lucide-react';

const TIMEZONES = [
  'Asia/Kolkata', 'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

const MODES = [
  { id: 'off', label: 'Manual', hint: 'You approve every clip' },
  { id: 'trial', label: 'Trial', hint: 'AI decides, you still approve — compare' },
  { id: 'on', label: 'Auto', hint: 'Clips ≥ score are queued automatically' },
];

function fmtSlot(iso, tz) {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return iso;
  }
}

/**
 * Per-YouTube-channel publishing rules: auto mode (manual / trial / auto), score threshold,
 * posting slots, daily cap, timezone, privacy and today's API quota.
 * `onUpdate(changes)` sends a PARTIAL update — only the edited fields.
 */
export default function ChannelPublishing({ acc, onUpdate }) {
  const [score, setScore] = useState(acc.min_score_threshold || 75);
  const [newSlot, setNewSlot] = useState('');
  useEffect(() => { setScore(acc.min_score_threshold || 75); }, [acc.min_score_threshold]);

  const mode = acc.auto_mode || (acc.auto_upload ? 'on' : 'off');
  const slots = acc.publish_slots || [];
  const tz = acc.timezone || 'Asia/Kolkata';
  const quota = acc.quota || { used: 0, limit: 10000, uploads_left_today: 6 };
  const pct = Math.min(100, Math.round((quota.used / Math.max(1, quota.limit)) * 100));
  const trial = acc.trial;

  const addSlot = () => {
    if (!/^\d{1,2}:\d{2}$/.test(newSlot)) return;
    onUpdate({ publish_slots: Array.from(new Set([...slots, newSlot.padStart(5, '0')])).sort() });
    setNewSlot('');
  };

  return (
    <div className="mt-3.5 pt-3 border-t border-white/[0.06] space-y-3">
      {/* Auto mode */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Zap size={13} className={mode === 'on' ? 'text-amber-400' : 'text-slate-500'} />
          <span className="text-[11px] font-bold text-white">Approval</span>
        </div>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Approval mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => onUpdate({ auto_mode: m.id })}
              title={m.hint}
              className={`py-1.5 rounded-lg text-[11px] font-bold border ${
                mode === m.id ? 'bg-amber-500/20 border-amber-500/50 text-amber-200' : 'border-white/10 text-slate-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-1">{MODES.find((m) => m.id === mode)?.hint}</p>

        {mode !== 'off' && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Min score to approve</span>
              <span className="font-bold font-mono text-amber-400">{score}<span className="text-slate-500">/100</span></span>
            </div>
            <input
              type="range"
              min={50}
              max={98}
              step={1}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              onPointerUp={() => score !== acc.min_score_threshold && onUpdate({ min_score_threshold: score })}
              onKeyUp={() => score !== acc.min_score_threshold && onUpdate({ min_score_threshold: score })}
              className="w-full accent-amber-500"
              aria-label="Minimum score"
            />
          </div>
        )}

        {mode === 'trial' && (
          <div className="mt-2 rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-[11px] text-slate-300 flex items-start gap-2">
            <FlaskConical size={13} className="text-fuchsia-300 shrink-0 mt-0.5" />
            {trial && trial.decided > 0 ? (
              <span>
                Agreed with you on <b className="text-white">{trial.agreement_pct}%</b> of {trial.decided} clips
                {trial.false_approvals ? <> · would have posted <b className="text-rose-300">{trial.false_approvals}</b> you rejected</> : null}
                {trial.missed ? <> · skipped <b className="text-amber-300">{trial.missed}</b> you approved</> : null}.
                {trial.agreement_pct >= 85 && trial.decided >= 20 ? <span className="text-emerald-300"> Ready for Auto.</span> : null}
              </span>
            ) : (
              <span>Approve or reject clips as usual — the agreement score appears here.</span>
            )}
          </div>
        )}
      </div>

      {/* Posting slots */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-white"><Clock size={13} className="text-sky-300" /> Posting slots</span>
          <select
            value={tz}
            onChange={(e) => onUpdate({ timezone: e.target.value })}
            className="bg-[#141824] border border-white/10 rounded px-1.5 py-0.5 text-white text-[10px]"
            aria-label="Timezone"
          >
            {(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <span key={s} className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs font-mono">
              {s}
              <button
                type="button"
                onClick={() => slots.length > 1 && onUpdate({ publish_slots: slots.filter((x) => x !== s) })}
                disabled={slots.length <= 1}
                className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30"
                aria-label={`Remove ${s}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <input
              type="time"
              value={newSlot}
              onChange={(e) => setNewSlot(e.target.value)}
              className="bg-[#141824] border border-white/10 rounded px-1.5 py-1 text-white text-xs"
              aria-label="New posting time"
            />
            <button type="button" onClick={addSlot} disabled={!newSlot} className="p-1.5 rounded-lg bg-white/[0.06] text-slate-200 disabled:opacity-30" aria-label="Add posting time">
              <Plus size={12} />
            </button>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
          <label className="text-slate-400">
            Max posts / day
            <select
              value={acc.daily_cap || 3}
              onChange={(e) => onUpdate({ daily_cap: Number(e.target.value) })}
              className="mt-0.5 w-full bg-[#141824] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
            >
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-slate-400">
            Privacy
            <select
              value={acc.privacy_status || 'public'}
              onChange={(e) => onUpdate({ privacy_status: e.target.value })}
              className="mt-0.5 w-full bg-[#141824] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
        </div>
        <p className="text-[10px] text-slate-500 mt-1.5">
          {acc.upcoming_posts || 0} scheduled · next free slot {acc.next_free_slot ? fmtSlot(acc.next_free_slot, tz) : '—'}
        </p>
      </div>

      {acc.performance?.tracked_shorts > 0 && (
        <p className="text-[11px] text-slate-300">
          📈 <b className="text-white">{Number(acc.performance.total_views).toLocaleString()}</b> views across {acc.performance.tracked_shorts} tracked Shorts
        </p>
      )}

      {/* Quota */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="flex items-center gap-1.5 font-bold text-white"><Gauge size={13} className="text-emerald-300" /> API quota today</span>
          <span className="font-mono text-slate-300">{quota.used.toLocaleString()} / {quota.limit.toLocaleString()}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className={`h-full ${pct >= 85 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-slate-500 mt-1 flex items-start gap-1">
          <ShieldCheck size={11} className="shrink-0 mt-px" />
          {quota.uploads_left_today} upload(s) left on this Google project today (resets midnight Pacific). Channels sharing one project share this.
        </p>
      </div>
    </div>
  );
}
