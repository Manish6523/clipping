import React, { useEffect, useState } from 'react';
import { Zap, Clock, Plus, X, Gauge, FlaskConical, ShieldCheck, TrendingUp } from 'lucide-react';
import { Segmented, Select, Input, Field, Meter, Notice, IconButton, Divider } from './ui';

const TIMEZONES = [
  'Asia/Kolkata', 'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

const MODES = [
  { value: 'off', label: 'Manual', hint: 'You approve every clip' },
  { value: 'trial', label: 'Trial', hint: 'The AI decides in the background, you still approve - compare results' },
  { value: 'on', label: 'Auto', hint: 'Clips at or above the score are queued automatically' },
];

function fmtSlot(iso, tz) {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return iso;
  }
}

function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-ink"><Icon size={13} className="text-muted" />{children}</h4>
      {right}
    </div>
  );
}

/**
 * Per-YouTube-channel publishing rules: approval mode, score threshold, posting slots,
 * daily cap, timezone, privacy and today's API quota.
 * `onUpdate(changes)` sends a PARTIAL update - only the edited fields.
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
  const commitScore = () => score !== acc.min_score_threshold && onUpdate({ min_score_threshold: score });

  return (
    <div className="mt-3.5 pt-3.5 border-t border-line space-y-4">
      <div>
        <SectionTitle icon={Zap}>Approval</SectionTitle>
        <Segmented value={mode} onChange={(v) => onUpdate({ auto_mode: v })} options={MODES} size="sm" className="w-full [&>button]:flex-1 [&>button]:justify-center" ariaLabel="Approval mode" />
        <p className="text-[11px] text-muted mt-1.5">{MODES.find((m) => m.value === mode)?.hint}</p>

        {mode !== 'off' && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted">Minimum score to approve</span>
              <span className="font-semibold text-ink tabular-nums">{score}<span className="text-faint">/100</span></span>
            </div>
            <input type="range" min={50} max={98} step={1} value={score} aria-label="Minimum score"
              onChange={(e) => setScore(Number(e.target.value))} onPointerUp={commitScore} onKeyUp={commitScore} onBlur={commitScore}
              className="w-full accent-[#3987e5] h-6" />
          </div>
        )}

        {mode === 'trial' && (
          <Notice tone="accent" icon={FlaskConical} className="mt-2.5">
            {trial && trial.decided > 0 ? (
              <>
                Agreed with you on <b>{trial.agreement_pct}%</b> of {trial.decided} clips
                {trial.false_approvals ? <> · would have posted <b className="text-bad">{trial.false_approvals}</b> you rejected</> : null}
                {trial.missed ? <> · skipped <b className="text-warn">{trial.missed}</b> you approved</> : null}.
                {trial.agreement_pct >= 85 && trial.decided >= 20 ? <b className="text-good"> Ready for Auto.</b> : null}
              </>
            ) : 'Approve or reject clips as usual - the agreement score appears here.'}
          </Notice>
        )}
      </div>

      <Divider />

      <div>
        <SectionTitle icon={Clock} right={(
          <Select value={tz} onChange={(e) => onUpdate({ timezone: e.target.value })} aria-label="Timezone" className="!h-7 !w-auto !text-[11px] !rounded-lg !pr-7">
            {(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        )}>Posting slots</SectionTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {slots.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 pl-2.5 pr-1 h-8 rounded-lg bg-accent/10 text-accent text-xs font-mono tabular-nums">
              {s}
              <button type="button" onClick={() => slots.length > 1 && onUpdate({ publish_slots: slots.filter((x) => x !== s) })}
                disabled={slots.length <= 1} aria-label={`Remove ${s}`} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/10 disabled:opacity-30">
                <X size={12} />
              </button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <Input type="time" value={newSlot} onChange={(e) => setNewSlot(e.target.value)} aria-label="New posting time" className="!h-8 !w-[108px] !px-2 !text-xs" />
            <IconButton icon={Plus} label="Add posting time" variant="secondary" size="sm" disabled={!newSlot} onClick={addSlot} />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Field label="Max posts / day">
            <Select value={acc.daily_cap || 3} onChange={(e) => onUpdate({ daily_cap: Number(e.target.value) })} className="!h-9 !text-xs">
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Privacy">
            <Select value={acc.privacy_status || 'public'} onChange={(e) => onUpdate({ privacy_status: e.target.value })} className="!h-9 !text-xs">
              <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option>
            </Select>
          </Field>
        </div>
        <p className="text-[11px] text-muted mt-2">{acc.upcoming_posts || 0} scheduled · next free slot {acc.next_free_slot ? fmtSlot(acc.next_free_slot, tz) : '—'}</p>
      </div>

      {acc.performance?.tracked_shorts > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-slate-300"><TrendingUp size={13} className="text-good" />
          <b className="text-ink tabular-nums">{Number(acc.performance.total_views).toLocaleString()}</b> views across {acc.performance.tracked_shorts} tracked Shorts</p>
      )}

      <Divider />

      <div>
        <SectionTitle icon={Gauge}>YouTube API quota today</SectionTitle>
        <Meter label="Used" value={quota.used} max={quota.limit} display={`${quota.used.toLocaleString()} / ${quota.limit.toLocaleString()}`}
          tone={pct >= 85 ? 'bad' : pct >= 60 ? 'warn' : 'good'} />
        <p className="text-[11px] text-muted mt-1.5 flex items-start gap-1.5">
          <ShieldCheck size={12} className="shrink-0 mt-px" />
          {quota.uploads_left_today} upload(s) left on this Google project today (resets at midnight Pacific). Channels that share a project share this.
        </p>
      </div>
    </div>
  );
}
