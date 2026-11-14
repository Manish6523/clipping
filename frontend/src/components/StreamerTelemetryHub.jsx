import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  Activity, Radio, Eye, Clock, Gamepad2, ExternalLink, MessageSquare, Users, Volume2, Zap, Flame,
  CheckCircle2, XCircle, AlertTriangle, Hourglass, Scissors, Mic, Brain, Film, Cpu, MemoryStick, HardDrive,
  Wifi, WifiOff, ChevronDown, ChevronUp, Database, CircleDot, Timer, ListOrdered,
} from 'lucide-react';
import TimeChart from './telemetry/TimeChart';
import { Page, Panel, Pill as UiPill, Meter, EmptyState, Skeleton } from './ui';

// ---- palette (dark surface; categorical slots from the validated reference palette) ----
const C = {
  chat: '#3987e5',      // series 1 - chat speed
  audio: '#d95926',     // series 2 - audio level
  ref: '#8b8a83',       // reference lines (normal pace / thresholds)
  event: '#9085e9',     // hype trigger markers
};
const STATUS = { good: '#34d399', warn: '#fbbf24', bad: '#f87171', idle: '#94a3b8' };

const fmtDur = (s) => {
  if (s == null || Number.isNaN(s)) return '—';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const ago = (t, now) => (t ? `${fmtDur(now - t)} ago` : 'never');
const clock = (t) => (t ? new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const gb = (b) => (b == null ? '—' : `${(b / 1024 ** 3).toFixed(1)} GB`);
const num = (n) => (n == null ? '—' : Intl.NumberFormat(undefined, { notation: n > 99999 ? 'compact' : 'standard' }).format(n));

const STAGES = [
  { key: 'triggered', label: 'Triggered', icon: Zap },
  { key: 'buffering', label: 'Buffering', icon: Hourglass },
  { key: 'sliced', label: 'Cut', icon: Scissors },
  { key: 'queued', label: 'Queued', icon: ListOrdered },
  { key: 'transcribing', label: 'Transcribe', icon: Mic },
  { key: 'judging', label: 'AI judge', icon: Brain },
  { key: 'rendering', label: 'Render', icon: Film },
];
const FINAL = {
  clip: { label: 'Clip made', color: STATUS.good, icon: CheckCircle2 },
  rejected: { label: 'Rejected by AI', color: STATUS.idle, icon: XCircle },
  dropped: { label: 'Dropped (too old)', color: STATUS.warn, icon: Clock },
  replaced: { label: 'Replaced by newer', color: STATUS.idle, icon: ChevronUp },
  error: { label: 'Error', color: STATUS.bad, icon: AlertTriangle },
};

function useTelemetry(minutes) {
  return useQuery({
    queryKey: ['telemetry', minutes],
    queryFn: async () => (await axios.get(`/api/telemetry?minutes=${minutes}`)).data,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

// --------------------------------------------------------------------------------------
/** Status pill with the older ok/warn/idle flags used throughout this page. */
function Pill({ ok, warn, idle, children }) {
  return <UiPill tone={idle ? 'idle' : ok ? 'good' : warn ? 'warn' : 'bad'}>{children}</UiPill>;
}

// --------------------------------------------------------------------------------------
function SystemStrip({ system, queue }) {
  if (!system) return null;
  const w = system.whisper || {};
  const disk = system.disk || {};
  const diskFreePct = disk.total ? (disk.free / disk.total) * 100 : null;
  const items = [
    { icon: Cpu, label: 'CPU load', value: `${system.load_pct}%`, sub: `${system.load?.[0]} on ${system.cpus} core${system.cpus > 1 ? 's' : ''}`,
      tone: system.load_pct > 90 ? 'bad' : system.load_pct > 70 ? 'warn' : 'good' },
    { icon: MemoryStick, label: 'Memory', value: system.mem_used_pct != null ? `${system.mem_used_pct}%` : '—',
      sub: `${gb(system.mem_available)} free${system.swap_used > 50 * 1024 ** 2 ? ` · swap ${gb(system.swap_used)}` : ''}`,
      tone: system.mem_used_pct > 90 ? 'bad' : system.mem_used_pct > 75 ? 'warn' : 'good' },
    { icon: HardDrive, label: 'Disk', value: gb(disk.free), sub: diskFreePct != null ? `${diskFreePct.toFixed(0)}% free` : '',
      tone: diskFreePct != null && diskFreePct < 10 ? 'bad' : diskFreePct < 20 ? 'warn' : 'good' },
    { icon: Mic, label: 'Whisper', value: w.busy ? 'Busy' : 'Idle', sub: `live: ${w.live_model || '—'} · clips: ${w.model || '—'}`,
      tone: w.busy ? 'warn' : 'good' },
    { icon: ListOrdered, label: 'Live queue', value: queue?.busy ? 'Processing' : 'Idle',
      sub: queue?.current
        ? `${queue.current.channel_id} · ${fmtDur(queue.current.running_seconds)}${queue.waiting?.length ? ` · ${queue.waiting.length} waiting` : ''}`
        : `${queue?.waiting?.length || 0} waiting`,
      tone: queue?.waiting?.length > 1 ? 'warn' : 'good' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-white/[0.07] bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <it.icon size={13} /> {it.label}
            <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: STATUS[it.tone] }} title={it.tone} />
          </div>
          <div className="text-[15px] font-semibold text-ink tabular-nums mt-0.5">{it.value}</div>
          <div className="text-[10.5px] text-muted truncate">{it.sub}</div>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------------------
function StreamerTabs({ streamers, selected, onSelect }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Streamers">
      {streamers.map((s) => {
        const on = s.channel_id === selected;
        const name = s.stream?.display_name || s.channel_id;
        return (
          <button key={s.channel_id} type="button" role="tab" aria-selected={on} onClick={() => onSelect(s.channel_id)}
            className={`shrink-0 flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition ${
              on ? 'border-accent bg-accent/10' : 'border-white/[0.08] bg-surface hover:bg-white/[0.04]'}`}>
            <div className="relative">
              {s.stream?.avatar
                ? <img src={s.stream.avatar} alt="" className="w-7 h-7 rounded-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                : <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-bold text-white">{name[0]?.toUpperCase()}</div>}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-canvas"
                style={{ background: s.is_live ? STATUS.bad : STATUS.idle }} />
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-ink max-w-[120px] truncate">{name}</div>
              <div className="text-[10.5px] text-muted">
                {s.is_live ? `LIVE · ${num(s.stream?.viewers)} watching` : 'Offline'}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------------------
function StreamCard({ s, now }) {
  const st = s.stream || {};
  const rec = s.recording || {};
  const chat = s.chat || {};
  const [bust, setBust] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { const t = setInterval(() => { setBust((b) => b + 1); setImgFailed(false); }, 60000); return () => clearInterval(t); }, []);
  const started = st.started_at ? Date.parse(st.started_at) / 1000 : s.live_since;
  return (
    <Panel className="overflow-hidden !p-0">
      <div className="relative aspect-video bg-black/60">
        {s.is_live && st.preview && !imgFailed
          ? <img src={`${st.preview}${st.preview.includes('?') ? '&' : '?'}b=${bust}`} alt="" onError={() => setImgFailed(true)} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted">
              <Radio size={26} />
              <span className="text-xs">{s.is_live ? 'Live - no preview for this platform' : 'Not live right now'}</span>
              {s.last_live_check && <span className="text-[10.5px]">checked {ago(s.last_live_check, now)}</span>}
            </div>
          )}
        <div className="absolute top-2 left-2 flex gap-1.5">
          {s.is_live && <span className="rounded-md bg-red-600 text-white text-[10.5px] font-bold px-1.5 py-0.5 tracking-wide">LIVE</span>}
          {s.is_live && started && (
            <span className="rounded-md bg-black/70 text-white text-[10.5px] px-1.5 py-0.5 tabular-nums">{fmtDur(now - started)}</span>
          )}
        </div>
        {s.is_live && st.viewers != null && (
          <span className="absolute top-2 right-2 rounded-md bg-black/70 text-white text-[10.5px] px-1.5 py-0.5 flex items-center gap-1">
            <Eye size={11} /> {num(st.viewers)}
          </span>
        )}
      </div>
      <div className="p-3.5 space-y-3">
        <div className="flex gap-3">
          {st.category_art && <img src={st.category_art} alt="" className="w-9 h-12 rounded object-cover shrink-0" />}
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink leading-snug line-clamp-2">{st.title || (s.is_live ? 'Untitled stream' : `${s.channel_id} is offline`)}</p>
            <p className="text-[11.5px] text-muted flex items-center gap-1 mt-0.5">
              <Gamepad2 size={12} /> {st.category || '—'} · <span className="capitalize">{s.platform}</span>
              <a href={s.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-accent">open <ExternalLink size={11} /></a>
            </p>
            {started && <p className="text-[11px] text-muted mt-0.5">Started {new Date(started * 1000).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill ok={rec.stream_process} idle={!s.is_live}>{rec.stream_process ? 'Recording' : s.is_live ? 'Not recording' : 'Recording paused (offline)'}</Pill>
          <Pill ok={rec.newest_chunk_age != null && rec.newest_chunk_age < 30} warn={rec.newest_chunk_age == null} idle={!s.is_live}>
            Buffer {rec.buffer_seconds || 0}s / {rec.buffer_capacity_seconds}s{rec.newest_chunk_age != null ? ` · ${Math.round(rec.newest_chunk_age)}s old` : ''}
          </Pill>
          {chat.supported
            ? <Pill ok={chat.connected}>{chat.connected ? 'Chat connected' : 'Chat disconnected'}</Pill>
            : <Pill warn>Chat not supported on {s.platform}</Pill>}
        </div>
      </div>
    </Panel>
  );
}

// --------------------------------------------------------------------------------------
function HypeEngine({ s, now }) {
  const e = s.engine || {};
  let state = { label: 'Watching chat', tone: STATUS.good, icon: Activity };
  if (!s.is_live) state = { label: 'Offline - waiting for stream', tone: STATUS.idle, icon: Radio };
  else if (!e.warmed_up) state = { label: 'Learning normal chat pace…', tone: STATUS.idle, icon: Hourglass };
  else if (e.cooldown_left > 0) state = { label: `Cooldown ${fmtDur(e.cooldown_left)}`, tone: STATUS.warn, icon: Timer };
  const velNeeded = e.spike_multiplier || 2.5;
  const lt = e.last_trigger || {};
  return (
    <Panel title="Hype detector" icon={Flame}
      right={<span className="flex items-center gap-1.5 text-[11.5px] text-ink"><state.icon size={13} style={{ color: state.tone }} />{state.label}</span>}>
      <div className="grid grid-cols-3 gap-2 mb-3.5">
        {[
          ['Chat now', `${e.mps ?? 0}`, 'msg/s'],
          ['Normal pace', `${e.baseline ?? 0}`, 'msg/s'],
          ['Ratio', `${e.ratio ?? 0}×`, 'vs normal'],
        ].map(([k, v, u]) => (
          <div key={k} className="rounded-xl bg-white/[0.03] px-2.5 py-2">
            <div className="text-[10.5px] text-muted">{k}</div>
            <div className="text-[17px] font-semibold text-ink tabular-nums leading-tight">{v}</div>
            <div className="text-[10px] text-muted">{u}</div>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Meter label="Chat-speed trigger" value={e.ratio} max={Math.max(velNeeded * 1.4, e.ratio || 0)} mark={velNeeded}
          display={`${e.ratio ?? 0}× / ${velNeeded}×`} hint={`Fires when chat runs ${velNeeded}× its normal pace (10+ msgs in 5 s).`} />
        <Meter label="Keyword burst" value={e.keyword_hits_5s} max={Math.max((e.keyword_min_hits || 3) * 2, e.keyword_hits_5s || 0)}
          mark={e.keyword_min_hits} display={`${e.keyword_hits_5s ?? 0} / ${e.keyword_min_hits} msgs`}
          hint={`Fires on ${e.keyword_min_hits}+ hype-word messages in 5 s while chat is ${e.keyword_min_ratio}× faster than normal.`} />
        <Meter label="Audio peak" value={e.audio_db != null ? e.audio_db + 60 : 0} max={60}
          mark={e.audio_threshold_db != null ? e.audio_threshold_db + 60 : null}
          display={`${e.audio_db != null ? e.audio_db.toFixed(1) : '—'} / ${e.audio_threshold_db} dB`} hint="Loud screams or explosions in the latest 10 s chunk." />
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2 text-[11.5px]">
        <div className="rounded-xl bg-white/[0.03] px-2.5 py-2">
          <div className="text-muted">Triggers this session</div>
          <div className="text-ink font-semibold text-[15px]">{e.triggers_this_session ?? 0}</div>
        </div>
        <div className="rounded-xl bg-white/[0.03] px-2.5 py-2">
          <div className="text-muted">Last trigger</div>
          <div className="text-ink font-semibold">{ago(e.last_trigger_at, now)}</div>
          {lt.type && <div className="text-muted truncate">{lt.type.replace('_', ' ')}{lt.ratio ? ` · ${lt.ratio}×` : ''}{lt.peak_db ? ` · ${lt.peak_db} dB` : ''}</div>}
        </div>
      </div>
      {e.keywords?.length > 0 && (
        <p className="mt-3 text-[10.5px] text-muted leading-relaxed">
          Hype words: {e.keywords.join(' · ')}
        </p>
      )}
    </Panel>
  );
}

// --------------------------------------------------------------------------------------
function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted mb-1.5">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.kind === 'event'
            ? <span className="w-2.5 h-2.5 rounded-full" style={{ background: it.color }} />
            : <span className="w-4" style={{ borderTop: `2px ${it.dash ? 'dashed' : 'solid'} ${it.color}` }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Charts({ s, moments, minutes, setMinutes }) {
  const data = s.series || [];
  const markers = moments.map((m) => ({ t: m.created_at, label: m.trigger?.type || 'hype' }));
  const mult = s.engine?.spike_multiplier || 2.5;
  return (
    <Panel title="Activity" icon={Activity}
      right={(
        <div className="flex rounded-lg bg-white/[0.05] p-0.5" role="group" aria-label="Time range">
          {[5, 15, 30].map((m) => (
            <button key={m} type="button" onClick={() => setMinutes(m)} aria-pressed={minutes === m}
              className={`px-2 py-0.5 rounded-md text-[11px] ${minutes === m ? 'bg-white/[0.12] text-white' : 'text-muted'}`}>{m}m</button>
          ))}
        </div>
      )}>
      <h3 className="text-[12px] font-medium text-ink mb-1">Chat speed (messages / second)</h3>
      <Legend items={[
        { label: 'Chat speed', color: C.chat },
        { label: 'Normal pace', color: C.ref, dash: true },
        { label: `Trigger level (${mult}×)`, color: '#c3c2b7', dash: true },
        { label: 'Hype trigger', color: C.event, kind: 'event' },
      ]} />
      <TimeChart data={data} height={160} yMin={0}
        series={[{ key: 'mps', label: 'Chat speed', color: C.chat }]}
        refLines={[
          { value: (p) => p.baseline, label: 'Normal pace', color: C.ref, dash: '5 4' },
          { value: (p) => (p.baseline != null ? +(p.baseline * mult).toFixed(2) : null), label: 'Trigger level', color: '#c3c2b7', dash: '2 4' },
        ]}
        markers={markers} formatY={(v) => (v >= 10 ? Math.round(v) : +v.toFixed(1))} unit=" msg/s"
        emptyText={s.is_live ? 'Collecting samples (every 2 s)…' : 'No chat data - streamer is offline'} />

      <h3 className="text-[12px] font-medium text-ink mt-4 mb-1">Audio peak (dB)</h3>
      <Legend items={[
        { label: 'Loudest moment per 10 s', color: C.audio },
        { label: `Scream threshold (${s.engine?.audio_threshold_db} dB)`, color: C.ref, dash: true },
      ]} />
      <TimeChart data={data.filter((p) => p.db != null)} height={110}
        series={[{ key: 'db', label: 'Audio peak', color: C.audio }]}
        refLines={[{ value: s.engine?.audio_threshold_db, label: 'Threshold', color: C.ref }]}
        markers={markers} yMax={0} formatY={(v) => Math.round(v)} unit=" dB"
        emptyText="No audio samples yet" />
    </Panel>
  );
}

// --------------------------------------------------------------------------------------
function MomentCard({ m, now, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const reached = new Set(m.stages.map((x) => x.stage));
  const fin = m.final ? FINAL[m.stage] : null;
  const live = !m.final;
  const stageTime = (k) => m.stages.find((x) => x.stage === k)?.t;
  const trig = m.trigger || {};
  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left p-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0">
            {fin ? <fin.icon size={17} style={{ color: fin.color }} />
              : <CircleDot size={17} className="animate-pulse" style={{ color: STATUS.warn }} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-semibold text-ink">
                {fin ? fin.label : `${STAGES.find((x) => x.key === m.stage)?.label || m.stage}…`}
              </span>
              {m.score != null && (
                <span className="text-[11px] rounded bg-white/[0.07] px-1.5 py-0.5 text-ink tabular-nums">
                  score {m.score}{m.min_score != null ? ` / ${m.min_score}` : ''}
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted tabular-nums">{clock(m.created_at)}</span>
            </div>
            <p className="text-[11.5px] text-muted mt-0.5 truncate">
              {m.title ? `“${m.title}” · ` : ''}{trig.type ? trig.type.replace('_', ' ') : 'hype'}
              {trig.ratio ? ` ${trig.ratio}×` : ''}{trig.peak_db ? ` ${trig.peak_db} dB` : ''}
              {live ? ` · ${fmtDur(now - m.created_at)} so far` : ` · took ${fmtDur((m.updated_at || m.created_at) - m.created_at)}`}
            </p>
            {/* stepper */}
            <ol className="flex items-center gap-1 mt-2" aria-label="Pipeline stages">
              {STAGES.map((st) => {
                const done = reached.has(st.key);
                const current = live && m.stage === st.key;
                return (
                  <li key={st.key} title={`${st.label}${stageTime(st.key) ? ` - ${clock(stageTime(st.key))}` : ''}`}
                    className="flex-1 h-1.5 rounded-full"
                    style={{ background: current ? STATUS.warn : done ? (fin?.color === STATUS.bad ? STATUS.bad : C.chat) : 'rgba(255,255,255,.08)' }} />
                );
              })}
            </ol>
          </div>
          {open ? <ChevronUp size={15} className="text-muted shrink-0" /> : <ChevronDown size={15} className="text-muted shrink-0" />}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          <ol className="space-y-1.5 border-l border-white/10 ml-2 pl-3">
            {m.stages.map((x, i) => {
              const meta = STAGES.find((st) => st.key === x.stage) || FINAL[x.stage];
              const Icon = meta?.icon || CircleDot;
              const next = m.stages[i + 1];
              return (
                <li key={i} className="relative text-[11.5px]">
                  <span className="absolute -left-[19px] top-0.5 w-3 h-3 rounded-full bg-surface border border-white/20 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: FINAL[x.stage]?.color || C.chat }} />
                  </span>
                  <div className="flex items-center gap-1.5 text-ink">
                    <Icon size={12} className="text-muted" />
                    <b className="font-medium">{meta?.label || x.stage}</b>
                    <span className="text-muted tabular-nums">{clock(x.t)}</span>
                    {next && <span className="ml-auto text-muted tabular-nums">{fmtDur(next.t - x.t)}</span>}
                    {!next && live && <span className="ml-auto text-muted tabular-nums">{fmtDur(now - x.t)}…</span>}
                  </div>
                  {x.note && <p className="text-muted ml-[18px] break-words">{x.note}</p>}
                </li>
              );
            })}
          </ol>
          {trig && Object.keys(trig).length > 0 && (
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              {[
                ['Chat', trig.mps_recent != null ? `${trig.mps_recent}/s` : '—'],
                ['Normal', trig.mps_baseline != null ? `${trig.mps_baseline}/s` : '—'],
                ['Hype words', trig.keyword_hits_5s ?? (trig.keyword ? 'yes' : '—')],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                  <div className="text-muted">{k}</div><div className="text-ink tabular-nums">{v}</div>
                </div>
              ))}
            </div>
          )}
          {m.transcribe_seconds != null && (
            <p className="text-[11px] text-muted">Transcription took <b className="text-ink">{fmtDur(m.transcribe_seconds)}</b></p>
          )}
          {m.transcript && (
            <blockquote className="text-[11.5px] text-ink bg-white/[0.03] rounded-lg px-2.5 py-2 leading-relaxed">
              “{m.transcript}”
            </blockquote>
          )}
          {m.clip_id && (
            <Link to={`/clips/${m.clip_id}/editor`} className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent">
              Open clip #{m.clip_id} <ExternalLink size={12} />
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function Moments({ moments, now }) {
  const counts = useMemo(() => {
    const c = { total: moments.length, clip: 0, rejected: 0, other: 0, active: 0 };
    moments.forEach((m) => {
      if (!m.final) c.active += 1;
      else if (m.stage === 'clip') c.clip += 1;
      else if (m.stage === 'rejected') c.rejected += 1;
      else c.other += 1;
    });
    return c;
  }, [moments]);
  return (
    <Panel title="Hype moments" icon={Zap}
      right={<span className="text-[11px] text-muted">{counts.total} since restart · {counts.clip} clips · {counts.rejected} rejected · {counts.other} dropped/errors</span>}>
      {moments.length === 0
        ? <p className="text-[12px] text-muted py-6 text-center">No hype moments yet. When chat explodes, each moment shows up here and you can follow it from trigger to finished clip.</p>
        : (
          <ul className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {moments.map((m, i) => <MomentCard key={m.id} m={m} now={now} defaultOpen={i === 0 && !m.final} />)}
          </ul>
        )}
    </Panel>
  );
}

// --------------------------------------------------------------------------------------
function ChatFeed({ s }) {
  const chat = s.chat || {};
  const ref = useRef(null);
  const [stick, setStick] = useState(true);
  const feed = chat.feed || [];
  useEffect(() => {
    const el = ref.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [feed.length, feed[feed.length - 1]?.t, stick]);
  return (
    <Panel title="Live chat" icon={MessageSquare}
      right={<span className="text-[11px] text-muted flex items-center gap-2">
        <span className="flex items-center gap-1"><Users size={12} /> {num(chat.active_chatters_5m)} active</span>
        <span>{num(chat.total_messages)} msgs</span>
      </span>}>
      {!chat.supported ? (
        <p className="text-[12px] text-muted py-6 text-center">Chat reading is only supported for Twitch streams.</p>
      ) : (
        <>
          <div ref={ref} onScroll={(e) => { const el = e.currentTarget; setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}
            className="h-[300px] overflow-y-auto space-y-1 pr-1 text-[12px] leading-snug">
            {feed.length === 0 && <p className="text-muted text-center pt-10">{chat.connected ? 'Waiting for messages…' : 'Not connected to chat'}</p>}
            {feed.map((m, i) => (
              <div key={`${m.t}-${i}`} className={`rounded-md px-1.5 py-0.5 ${m.keyword ? 'bg-amber-400/10' : ''}`}>
                <span className="text-muted tabular-nums text-[10.5px] mr-1.5">{clock(m.t).slice(0, 5)}</span>
                <b className="font-semibold text-ink mr-1">{m.user || 'viewer'}:</b>
                <span className="text-ink/90 break-words">{m.text}</span>
                {m.keyword && <Flame size={11} className="inline ml-1 text-amber-300" aria-label="hype word" />}
              </div>
            ))}
          </div>
          {chat.top_tokens?.length > 0 && (
            <div className="mt-2.5">
              <p className="text-[10.5px] text-muted mb-1">Most used words (last 90 s)</p>
              <div className="flex flex-wrap gap-1">
                {chat.top_tokens.map((t, i) => {
                  const [word, n] = Array.isArray(t) ? t : [t.token ?? t, t.count];
                  return <span key={i} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-ink">{word}{n ? <span className="text-muted"> ×{n}</span> : null}</span>;
                })}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// --------------------------------------------------------------------------------------
function History({ history, today }) {
  const [open, setOpen] = useState(false);
  const rows = history || [];
  return (
    <Panel title="History (saved)" icon={Database}
      right={<button type="button" onClick={() => setOpen((o) => !o)} className="text-[11px] text-accent">{open ? 'Hide' : `Show ${rows.length}`}</button>}>
      <div className="flex flex-wrap gap-2 text-[11.5px]">
        {Object.keys(today || {}).length === 0 && <span className="text-muted">Nothing judged today yet.</span>}
        {Object.entries(today || {}).map(([ch, d]) => (
          <span key={ch} className="rounded-lg bg-white/[0.04] px-2 py-1 text-ink">
            <b>{ch}</b> today: {d.passed || 0} clip{d.passed === 1 ? '' : 's'} · {d.rejected || 0} rejected{d.avg_score != null ? ` (avg score ${d.avg_score})` : ''}
          </span>
        ))}
      </div>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead className="text-muted text-left">
              <tr><th className="py-1 pr-2 font-medium">When</th><th className="pr-2 font-medium">Streamer</th><th className="pr-2 font-medium">Result</th><th className="pr-2 font-medium">Score</th><th className="font-medium">Why</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.05] text-ink align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{r.created_at ? new Date(`${r.created_at.replace(' ', 'T')}Z`).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '—'}</td>
                  <td className="pr-2">{r.channel_id}</td>
                  <td className="pr-2 whitespace-nowrap">
                    {r.status === 'passed'
                      ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} style={{ color: STATUS.good }} />{r.clip_id ? <Link className="text-accent" to={`/clips/${r.clip_id}/editor`}>clip #{r.clip_id}</Link> : 'clip'}</span>
                      : <span className="inline-flex items-center gap-1"><XCircle size={12} style={{ color: STATUS.idle }} />rejected</span>}
                  </td>
                  <td className="pr-2 tabular-nums">{r.virality_score ?? '—'}{r.threshold_value ? ` / ${Math.round(r.threshold_value)}` : ''}</td>
                  <td className="text-muted max-w-[260px]">{r.rejection_reason || r.transcript || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// --------------------------------------------------------------------------------------
export default function StreamerTelemetryHub() {
  const [minutes, setMinutes] = useState(15);
  const { data, isLoading, isError, error, dataUpdatedAt } = useTelemetry(minutes);
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem('autoclip_pulse_streamer'); } catch { return null; }
  });
  const streamers = useMemo(() => {
    const list = data?.streamers || [];
    return [...list].sort((a, b) => (b.is_live - a.is_live) || (b.stream?.viewers || 0) - (a.stream?.viewers || 0));
  }, [data]);
  const current = streamers.find((s) => s.channel_id === selected) || streamers[0];
  const pick = (id) => { setSelected(id); try { localStorage.setItem('autoclip_pulse_streamer', id); } catch { /* ignore */ } };
  const now = data?.server_time || Date.now() / 1000;
  const moments = useMemo(
    () => (data?.moments || []).filter((m) => current && (m.channel_id || '').toLowerCase() === current.channel_id.toLowerCase()),
    [data, current],
  );
  const stale = dataUpdatedAt && Date.now() - dataUpdatedAt > 8000;

  return (
    <Page title="Live Pulse" icon={Activity} subtitle="Everything the live clipper sees, updated every 2 seconds."
      actions={(
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          {isError || stale ? <WifiOff size={13} style={{ color: STATUS.bad }} /> : <Wifi size={13} style={{ color: STATUS.good }} />}
          {isError ? 'Connection lost' : stale ? 'Reconnecting…' : 'Live'}
        </span>
      )}>

      {isError && !data && <Panel><p className="text-[12px] text-muted">Could not load telemetry: {error?.message}</p></Panel>}
      {isLoading && !data && <Skeleton className="h-40" />}

      {data && (
        <>
          <SystemStrip system={data.system} queue={data.queue} />

          {streamers.length === 0 ? (
            <Panel>
              <div className="py-10 text-center space-y-2">
                <Radio size={28} className="mx-auto text-muted" />
                <p className="text-[13px] text-ink">No streamers are being watched.</p>
                <p className="text-[12px] text-muted">Add a live streamer in <Link to="/channels" className="text-accent">Channels</Link> and it will show up here.</p>
              </div>
            </Panel>
          ) : (
            <>
              <StreamerTabs streamers={streamers} selected={current?.channel_id} onSelect={pick} />
              {current && (
                <div className="grid gap-3 lg:grid-cols-[minmax(300px,1fr)_minmax(0,1.6fr)_minmax(280px,1fr)] items-start">
                  <div className="space-y-3">
                    <StreamCard s={current} now={now} />
                    <HypeEngine s={current} now={now} />
                  </div>
                  <div className="space-y-3 min-w-0">
                    <Charts s={current} moments={moments} minutes={minutes} setMinutes={setMinutes} />
                    <Moments moments={moments} now={now} />
                  </div>
                  <div className="space-y-3">
                    <ChatFeed s={current} />
                    <History history={data.history} today={data.today} />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Page>
  );
}
