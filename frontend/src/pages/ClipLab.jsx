import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlaskConical, Upload, Trash2, Play, Mic, Volume2, MessagesSquare, Brain, Eye, ScanFace, Clapperboard,
  ChevronDown, CheckCircle2, XCircle, Loader2, Info, Crosshair, Film, Clock, Wand2, Save, ExternalLink,
} from 'lucide-react';
import {
  Page, Panel, Button, Field, Select, Input, Textarea, Notice, Progress, Pill, Badge, Toggle, Segmented, EmptyState, Spinner,
} from '../components/ui';
import {
  labStartUpload, labUploadChunk, labFinishUpload, labSessions, labSession, labDelete, labRun, labJob, labTemplates, withToken, saveTemplate,
} from '../api';
import { Link } from 'react-router-dom';

/* ------------------------------------------------------------------ helpers */

const fmt = (s) => {
  if (s == null || Number.isNaN(Number(s))) return '–';
  const v = Math.max(0, Number(s));
  const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(1).padStart(4, '0')}`;
};
const mb = (b) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)} MB`;
const errText = (e) => e?.response?.data?.error || e?.message || String(e);

const SAMPLE_CHAT = `0:10 ok what is he doing
0:12 KEKW
0:12 KEKW KEKW KEKW
0:12 LMAOOOO
0:13 💀💀💀
0:13 ICANT
0:13 KEKW
0:13 bro fell off
0:14 OMEGALUL
0:14 KEKW KEKW
0:14 LUL
0:14 😂😂
0:15 dead
0:15 KEKW`;

/** Run one lab step as a background job and poll it. */
function useJob(labId, step, initial) {
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(initial ?? null);
  const timer = useRef(0);
  useEffect(() => { setResult(initial ?? null); setJob(null); }, [labId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);
  const poll = useCallback((id) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const j = await labJob(id);
        setJob(j);
        if (j.status === 'done') setResult(j.result);
        else if (j.status !== 'failed') poll(id);
      } catch { poll(id); }
    }, 1200);
  }, []);
  const run = async (params) => {
    try {
      const r = await labRun(labId, step, params);
      setJob(r.job); poll(r.job.id);
    } catch (e) {
      const j = e?.response?.data?.job;
      if (j) { setJob(j); poll(j.id); } else setJob({ status: 'failed', error: errText(e), log: [] });
    }
  };
  const busy = job && (job.status === 'queued' || job.status === 'running');
  return { job, result, run, busy };
}

/* ------------------------------------------------------------------ building blocks */

function Explain({ what, how }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-canvas border border-line px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
      <p><span className="font-semibold text-slate-200">What it does: </span>{what}</p>
      <button type="button" onClick={() => setOpen(!open)} className="mt-1 flex min-h-[32px] items-center gap-1 text-[12px] font-semibold text-accent" aria-expanded={open}>
        <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />How it works
      </button>
      {open && <div className="mt-1 space-y-1.5">{how}</div>}
    </div>
  );
}

function JobStatus({ job }) {
  if (!job) return null;
  const tone = job.status === 'failed' ? 'bad' : job.status === 'done' ? 'good' : 'accent';
  const Icon = job.status === 'failed' ? XCircle : job.status === 'done' ? CheckCircle2 : Loader2;
  return (
    <div className="space-y-1.5" data-testid="job-status" data-status={job.status}>
      <div className="flex items-center gap-2 text-[12.5px]">
        <Icon size={15} className={job.status === 'running' || job.status === 'queued' ? 'animate-spin text-accent' : tone === 'bad' ? 'text-bad' : 'text-good'} />
        <span className="text-ink font-medium">{job.status === 'failed' ? 'Failed' : job.status === 'done' ? 'Finished' : job.progress || 'Starting…'}</span>
        {job.finished && job.started && <span className="text-muted">· {(job.finished - job.started).toFixed(1)} s</span>}
      </div>
      {job.error && <Notice tone="bad" icon={XCircle}>{job.error}</Notice>}
    </div>
  );
}

function Card({ n, icon: Icon, title, badge, explain, controls, onRun, runLabel = 'Run test', disabled, disabledReason, job, busy, children, testid }) {
  return (
    <Panel className="!p-4 space-y-3" data-testid={testid}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-muted">{n}</span>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {badge}
          </div>
        </div>
      </div>
      {explain}
      {controls && <div className="space-y-3">{controls}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Play} loading={busy} disabled={disabled || busy} onClick={onRun} data-testid={`${testid}-run`}>{runLabel}</Button>
        {disabled && disabledReason && <span className="text-[12px] text-warn">{disabledReason}</span>}
      </div>
      <JobStatus job={job} />
      {children}
    </Panel>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-raised px-3 py-2 min-w-[96px]">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[14px] font-semibold text-ink">{value}</div>
    </div>
  );
}

function Video({ src, vertical, testid }) {
  if (!src) return null;
  return (
    <video key={src} src={withToken(src)} controls playsInline preload="metadata" data-testid={testid}
      className={`w-full rounded-xl bg-black ${vertical ? 'max-h-[70vh] object-contain' : ''}`} />
  );
}

/* ------------------------------------------------------------------ crop picker (drag to move, corner to resize) */

function CropPicker({ frameUrl, crop, onChange }) {
  const box = useRef(null);
  const drag = useRef(null);
  const start = (e, mode) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, crop: { ...crop } };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const dx = (e.clientX - d.x) / r.width;
    const dy = (e.clientY - d.y) / r.height;
    const c = { ...d.crop };
    if (d.mode === 'move') {
      c.x = Math.min(1 - c.w, Math.max(0, d.crop.x + dx));
      c.y = Math.min(1 - c.h, Math.max(0, d.crop.y + dy));
    } else {
      c.w = Math.min(1 - c.x, Math.max(0.04, d.crop.w + dx));
      c.h = Math.min(1 - c.y, Math.max(0.05, d.crop.h + dy));
    }
    onChange(c);
  };
  const end = () => { drag.current = null; };
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-xl bg-black select-none" style={{ aspectRatio: '16 / 9', touchAction: 'none' }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end} data-testid="crop-picker">
      {frameUrl && <img src={withToken(frameUrl)} alt="Frame from your video" className="absolute inset-0 h-full w-full object-contain pointer-events-none" draggable={false} />}
      <div className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] cursor-move"
        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
        onPointerDown={(e) => start(e, 'move')} data-testid="crop-box">
        <span className="absolute -left-px -top-6 rounded bg-white px-1.5 text-[11px] font-semibold text-black">Your box</span>
        <span className="absolute -bottom-3 -right-3 h-7 w-7 rounded-full border-2 border-white bg-accent-strong cursor-nwse-resize"
          onPointerDown={(e) => start(e, 'resize')} aria-label="Resize box" role="slider" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ small charts */

function LineChart({ points, height = 120, yMin, yMax, lines = [], markers = [], onPick, xMax, colors = ['#60a5fa'], testid }) {
  const series = Array.isArray(points[0]?.[0]) ? points : [points];
  const all = series.flat();
  if (!all.length) return null;
  const W = 600;
  const x1 = xMax || Math.max(...all.map((p) => p[0]), 1);
  const lo = yMin ?? Math.min(...all.map((p) => p[1]));
  const hi = yMax ?? Math.max(...all.map((p) => p[1]));
  const sx = (x) => (x / x1) * W;
  const sy = (y) => height - ((y - lo) / Math.max(1e-6, hi - lo)) * (height - 8) - 4;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full rounded-xl bg-canvas border border-line" preserveAspectRatio="none" data-testid={testid}
      onClick={(e) => { if (!onPick) return; const r = e.currentTarget.getBoundingClientRect(); onPick(((e.clientX - r.left) / r.width) * x1); }}>
      {lines.map((l) => <line key={l.y} x1={0} x2={W} y1={sy(l.y)} y2={sy(l.y)} stroke={l.color} strokeDasharray="4 4" strokeWidth={1} />)}
      {series.map((s, i) => (
        <polyline key={i} fill="none" stroke={colors[i % colors.length]} strokeWidth={1.6} vectorEffect="non-scaling-stroke"
          points={s.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} />
      ))}
      {markers.map((m) => <circle key={m.x} cx={sx(m.x)} cy={sy(m.y)} r={4} fill={m.color || '#f59e0b'} />)}
    </svg>
  );
}

/* ------------------------------------------------------------------ page */

export default function ClipLab() {
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [upload, setUpload] = useState(null);   // {name, sent, size}
  const [win, setWin] = useState({ start: 0, end: 30 });
  const videoRef = useRef(null);

  const refreshList = () => labSessions().then((r) => setSessions(r.sessions || [])).catch(() => {});
  useEffect(() => { refreshList(); }, []);

  const open = async (id) => {
    setLoadErr('');
    try {
      const s = await labSession(id);
      setSession(s);
      const d = s.info?.duration || 30;
      setWin({ start: 0, end: Math.min(d, 30) });
    } catch (e) { setLoadErr(errText(e)); }
  };

  const onFile = async (file) => {
    if (!file) return;
    setLoadErr('');
    setUpload({ name: file.name, sent: 0, size: file.size });
    try {
      const { id, chunk_size: cs } = await labStartUpload(file.name, file.size);
      let off = 0;
      while (off < file.size) {
        const r = await labUploadChunk(id, off, file.slice(off, off + cs));
        off = r.received;
        setUpload({ name: file.name, sent: off, size: file.size });
      }
      setUpload({ name: file.name, sent: file.size, size: file.size, finishing: true });
      const s = await labFinishUpload(id);
      setSession(s);
      setWin({ start: 0, end: Math.min(s.info?.duration || 30, 30) });
      refreshList();
    } catch (e) { setLoadErr(errText(e)); }
    setUpload(null);
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this test video and all its results?')) return;
    await labDelete(id).catch(() => {});
    if (session?.id === id) setSession(null);
    refreshList();
  };

  const setFromPlayer = (key) => {
    const t = videoRef.current?.currentTime ?? 0;
    setWin((w) => {
      const nw = { ...w, [key]: Math.round(t * 10) / 10 };
      if (nw.end <= nw.start) nw.end = Math.min(session?.info?.duration || nw.start + 30, nw.start + 15);
      return nw;
    });
  };
  const seek = (t) => { if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.play?.().catch(() => {}); } };
  const applyWindow = (s, e) => { setWin({ start: Math.max(0, Math.round(s * 10) / 10), end: Math.round(e * 10) / 10 }); seek(s); };

  return (
    <Page title="Clip Lab" icon={FlaskConical}
      subtitle="Upload a raw video and test each part of clip generation on its own. Nothing here creates clips, posts anything or changes your templates.">
      {loadErr && <Notice tone="bad" icon={XCircle}>{loadErr}</Notice>}

      {/* ---- upload + sessions */}
      <Panel title="Test video" icon={Upload}>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <label className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong px-4 py-5 text-center ${upload ? 'pointer-events-none opacity-70' : 'hover:bg-white/[0.03]'}`}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}>
            <Upload size={22} className="text-accent" />
            <span className="text-[14px] font-semibold text-ink">Upload a raw stream video</span>
            <span className="text-[12px] text-muted">mp4, mov, mkv or webm · up to 4 GB · 1–10 minutes works best</span>
            <input type="file" accept="video/*,.mkv,.ts" className="hidden" data-testid="lab-file" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <div className="min-w-0">
            {upload ? (
              <div className="space-y-2 py-2">
                <div className="flex justify-between text-[12.5px]"><span className="truncate text-ink">{upload.name}</span><span className="text-muted">{mb(upload.sent)} / {mb(upload.size)}</span></div>
                <Progress value={upload.sent / Math.max(1, upload.size)} />
                <p className="text-[12px] text-muted">{upload.finishing ? 'Checking the video…' : 'Uploading in 16 MB pieces (works through Cloudflare)…'}</p>
              </div>
            ) : sessions.length === 0 ? (
              <p className="py-3 text-[12.5px] text-muted">No test videos yet.</p>
            ) : (
              <ul className="space-y-1.5 max-h-[180px] overflow-y-auto" data-testid="lab-sessions">
                {sessions.map((s) => (
                  <li key={s.id} className={`flex items-center gap-2 rounded-xl border px-2 ${session?.id === s.id ? 'border-accent/60 bg-accent/10' : 'border-line bg-raised'}`}>
                    <button type="button" onClick={() => open(s.id)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left">
                      <Film size={15} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name}</span>
                      <span className="text-[11px] text-muted">{fmt(s.duration)}</span>
                    </button>
                    <button type="button" aria-label="Delete test video" onClick={() => remove(s.id)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-bad"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      {!session ? (
        <Panel><EmptyState icon={FlaskConical} title="Upload or pick a video to start" text="Then run any test below: transcription, loudness, chat, AI judges, face tracking and a full template render." /></Panel>
      ) : (
        <LabSession key={session.id} session={session} win={win} setWin={setWin} videoRef={videoRef}
          setFromPlayer={setFromPlayer} seek={seek} applyWindow={applyWindow} />
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------ one loaded video */

function LabSession({ session, win, setWin, videoRef, setFromPlayer, seek, applyWindow }) {
  const R = session.results || {};
  const id = session.id;
  const info = session.info || {};
  const dur = info.duration || 0;
  const transcribe = useJob(id, 'transcribe', R.transcribe);
  const audio = useJob(id, 'audio', R.audio);
  const chat = useJob(id, 'chat', R.chat);
  const judge = useJob(id, 'judge', R.judge);
  const vjudge = useJob(id, 'video_judge', R.video_judge);
  const face = useJob(id, 'face', R.face);
  const render = useJob(id, 'render', R.render);
  const auto = useJob(id, 'auto_template', R.auto_template);
  const [templates, setTemplates] = useState([]);
  const loadTemplates = () => labTemplates().then((r) => setTemplates(r.templates || [])).catch(() => {});
  useEffect(() => { loadTemplates(); }, []);
  const winLen = Math.max(0, win.end - win.start);
  const hasTranscript = !!transcribe.result;

  return (
    <>
      {/* ---- source + window */}
      <Panel className="!p-4 space-y-3" data-testid="lab-source">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <video ref={videoRef} src={withToken(session.source_url)} controls playsInline preload="metadata" className="w-full rounded-xl bg-black" data-testid="lab-video" />
          <div className="space-y-3 min-w-0">
            <div>
              <h2 className="text-[15px] font-semibold text-ink truncate">{session.name}</h2>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Pill dot={false}>{info.width}×{info.height}</Pill><Pill dot={false}>{info.fps} fps</Pill>
                <Pill dot={false}>{fmt(dur)}</Pill><Pill dot={false} tone={info.has_audio ? 'good' : 'bad'}>{info.has_audio ? `audio ${info.audio_codec}` : 'no audio'}</Pill>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-canvas p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Clock size={15} className="text-accent" />Test window <span className="font-normal text-muted">· {winLen.toFixed(1)} s</span></div>
              <p className="text-[12px] text-muted">Most tests run on this part of the video. Pause the player where you want and tap "from player", or type the seconds.</p>
              <div className="grid grid-cols-2 gap-2">
                {['start', 'end'].map((k) => (
                  <div key={k} className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase text-muted">{k}</label>
                    <Input type="number" step="0.1" min="0" max={dur} value={win[k]} aria-label={`Window ${k} seconds`}
                      onChange={(e) => setWin((w) => ({ ...w, [k]: Math.max(0, Math.min(dur, Number(e.target.value) || 0)) }))} />
                    <Button size="sm" block icon={Crosshair} onClick={() => setFromPlayer(k)}>{k} from player</Button>
                  </div>
                ))}
              </div>
              <div className="relative h-2 rounded-full bg-white/10" aria-hidden>
                <div className="absolute h-2 rounded-full bg-accent" style={{ left: `${(win.start / Math.max(1, dur)) * 100}%`, width: `${(winLen / Math.max(1, dur)) * 100}%` }} />
              </div>
              <Button size="sm" icon={Play} onClick={() => seek(win.start)}>Play the window</Button>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2 items-start">
        <TranscribeCard job={transcribe} seek={seek} />
        <AudioCard job={audio} seek={seek} applyWindow={applyWindow} dur={dur} />
        <ChatCard job={chat} />
        <JudgeCard job={judge} win={win} hasTranscript={hasTranscript} hasChat={!!chat.result} applyWindow={applyWindow} />
        <VideoJudgeCard job={vjudge} win={win} />
      </div>
      <FaceCard job={face} win={win} session={session} templates={templates} />
      <AutoTemplateCard job={auto} render={render} win={win} templates={templates} onSaved={loadTemplates} />
      <RenderCard job={render} win={win} templates={templates} hasTranscript={hasTranscript} />
    </>
  );
}

/* ------------------------------------------------------------------ 1. transcription */

function TranscribeCard({ job, seek }) {
  const [model, setModel] = useState('');
  const r = job.result;
  return (
    <Card n="1" icon={Mic} title="Transcription + profanity filter" testid="card-transcribe" job={job.job} busy={job.busy}
      onRun={() => job.run({ model: model || undefined })}
      explain={<Explain
        what="Turns speech into text with a timestamp for every word. Captions, the AI judges, auto-edit cuts and the swear-word bleeps all come from this."
        how={<>
          <p>Runs <b>faster-whisper</b> on this server. Each word gets a start and end time, then words are grouped into sentences so the AI can pick clean start and end points.</p>
          <p>Every word is then checked against the profanity list (Settings › Censor). Words marked "censored" get bleeped and masked in captions when a clip renders.</p>
          <p><b>Speed</b> is shown as "× real time": 0.2 means 1 minute of video takes 12 seconds.</p>
        </>} />}
      controls={(
        <Field label="Whisper model" hint="Bigger = more accurate but slower. Default follows Settings › Live model.">
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Default (live model)</option>
            <option value="tiny">tiny – fastest</option><option value="base">base</option><option value="small">small</option>
            <option value="medium">medium</option><option value="large-v3">large-v3 – best, slow</option>
          </Select>
        </Field>
      )}>
      {r && (
        <div className="space-y-3" data-testid="transcribe-result">
          <div className="flex flex-wrap gap-2">
            <Stat label="Model" value={r.model} /><Stat label="Words" value={r.words.length} />
            <Stat label="Took" value={`${r.seconds}s`} /><Stat label="Speed" value={`${r.rtf}× real time`} />
            <Stat label="Flagged words" value={r.profanity.flagged.length} />
          </div>
          {r.profanity.flagged.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {r.profanity.flagged.slice(0, 30).map((w, i) => (
                <button key={i} type="button" onClick={() => seek(w.start)} className={`min-h-[32px] rounded-lg px-2 text-[12px] font-semibold ${w.censored ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn'}`}>
                  {w.word} · {fmt(w.start)}{w.censored ? ' · bleeped' : ''}
                </button>
              ))}
            </div>
          )}
          <div className="max-h-[260px] overflow-y-auto rounded-xl border border-line bg-canvas p-2 space-y-0.5">
            {r.sentences.map((s) => (
              <button key={s.id} type="button" onClick={() => seek(s.start)} className="flex w-full gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] hover:bg-white/[0.04]">
                <span className="w-12 shrink-0 font-mono text-muted">{fmt(s.start)}</span><span className="text-ink">{s.text}</span>
              </button>
            ))}
            {!r.sentences.length && <p className="p-2 text-[12px] text-muted">No speech found.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ 2. audio */

function AudioCard({ job, seek, applyWindow, dur }) {
  const [threshold, setThreshold] = useState(-6);
  const r = job.result;
  return (
    <Card n="2" icon={Volume2} title="Loudness & scream detector" testid="card-audio" job={job.job} busy={job.busy}
      onRun={() => job.run({ threshold })}
      explain={<Explain
        what="Finds the loudest moments (screams, explosions, hype) - the live watcher's second trigger, next to chat spikes."
        how={<>
          <p>Measures the audio level (RMS, dBFS) every half second. 0 dB is the loudest possible; normal talking is often −30 to −20.</p>
          <p>A moment counts as loud when it is above the trigger threshold <b>or</b> 18 dB louder than the video's typical level. Moments closer than 8 s are merged.</p>
          <p>Live, a loud moment starts the same pipeline as a chat spike: transcribe → AI judge → render.</p>
        </>} />}
      controls={(
        <Field label={`Trigger threshold: ${threshold} dBFS`} hint="Live default is −6. Lower it to catch quieter moments.">
          <input type="range" min="-30" max="0" step="1" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="h-8 w-full accent-[var(--color-accent)]" aria-label="Threshold" />
        </Field>
      )}>
      {r && (
        <div className="space-y-2" data-testid="audio-result">
          <LineChart points={r.series} yMin={-60} yMax={0} xMax={dur} onPick={seek}
            lines={[{ y: r.threshold, color: '#f59e0b' }, { y: r.median, color: '#64748b' }]}
            markers={r.peaks.map((p) => ({ x: p.time, y: p.db }))} />
          <p className="text-[11.5px] text-muted">Blue = loudness · orange dashed = trigger · grey dashed = typical level ({r.median} dB). Tap the chart to jump there.</p>
          {r.peaks.length === 0 ? <p className="text-[12.5px] text-muted">No moment crossed the trigger.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {r.peaks.map((p) => (
                <Button key={p.time} size="sm" onClick={() => applyWindow(Math.max(0, p.time - 15), p.time + 15)}>{fmt(p.time)} · {p.db} dB</Button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ 3. chat */

function ChatCard({ job }) {
  const [text, setText] = useState('');
  const [chatters, setChatters] = useState(20);
  const [ratio, setRatio] = useState(3);
  const r = job.result;
  const MOOD_COLORS = { laugh: '#facc15', hype: '#22c55e', shock: '#a78bfa', sad: '#60a5fa', rage: '#ef4444' };
  return (
    <Card n="3" icon={MessagesSquare} title="Chat signals" testid="card-chat" job={job.job} busy={job.busy}
      disabled={!text.trim()} disabledReason="Paste chat or load the sample"
      onRun={() => job.run({ chat: text, chatters, ratio })}
      explain={<Explain
        what="Reads chat the way the live watcher does: what kind of moment is it (laugh, hype, shock, sad, rage), is it an emote wall, and how strong is the signal."
        how={<>
          <p><b>Mood</b>: each message is matched against emote/word lists (KEKW, LUL, 💀 = laugh; POG, W, 🔥 = hype; WTF, monkaS = shock…). The mood is the one most messages share.</p>
          <p><b>Emote wall</b>: the share of messages that are mostly one repeated token. Live, a wall from 5+ different chatters triggers a clip even when chat isn't faster than usual.</p>
          <p><b>Signal score</b> (40–100) = 55 % chat speed vs normal + 25 % how unanimous + 20 % how many people. It is 30 % of the final clip score.</p>
          <p><b>Spikes</b>: with timestamps ("1:23 message") it finds bursts like it does for YouTube chat replays.</p>
        </>} />}
      controls={(
        <>
          <Field label="Chat messages" hint="One per line. Optional time first: 12:34 KEKW" right={<button type="button" className="text-[12px] font-semibold text-accent min-h-[32px]" onClick={() => setText(SAMPLE_CHAT)}>Load sample</button>}>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className="font-mono !text-[12px]" placeholder={'0:12 KEKW\n0:12 LMAOOO\n0:13 💀💀'} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Different chatters"><Input type="number" min="1" value={chatters} onChange={(e) => setChatters(Number(e.target.value) || 1)} /></Field>
            <Field label="Speed vs normal (×)"><Input type="number" min="1" step="0.5" value={ratio} onChange={(e) => setRatio(Number(e.target.value) || 1)} /></Field>
          </div>
        </>
      )}>
      {r && (
        <div className="space-y-3" data-testid="chat-result">
          <Notice tone="accent" icon={Info}>{r.description}</Notice>
          <div className="flex flex-wrap gap-2">
            <Stat label="Signal score" value={`${r.signal_score} / 100`} /><Stat label="Mood" value={r.reaction.mood} />
            <Stat label="Emote wall" value={r.wall.token ? `${r.wall.token} · ${Math.round(r.wall.share * 100)}%` : 'none'} />
            <Stat label="Messages" value={r.messages} />
          </div>
          <div className="space-y-1">
            {Object.entries(r.reaction.shares || {}).map(([m, v]) => (
              <div key={m} className="flex items-center gap-2 text-[12px]">
                <span className="w-12 text-muted">{m}</span>
                <div className="h-2 flex-1 rounded-full bg-white/10"><div className="h-2 rounded-full" style={{ width: `${v * 100}%`, background: MOOD_COLORS[m] }} /></div>
                <span className="w-10 text-right text-ink">{Math.round(v * 100)}%</span>
              </div>
            ))}
          </div>
          {r.timed > 0 && (r.spikes.length ? (
            <div className="text-[12.5px] text-ink">Spikes: {r.spikes.map((s) => `${fmt(s.time)} (${s.count} msgs, ${s.ratio}×, ${s.mood})`).join(' · ')}</div>
          ) : <p className="text-[12px] text-muted">No spike: needs 8+ messages inside 5 seconds at 2.5× the usual rate.</p>)}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ 4. AI judge */

function JudgeCard({ job, win, hasTranscript, hasChat, applyWindow }) {
  const [whole, setWhole] = useState(true);
  const [useChat, setUseChat] = useState(false);
  const r = job.result;
  return (
    <Card n="4" icon={Brain} title="AI judge (transcript)" testid="card-judge" job={job.job} busy={job.busy}
      disabled={!hasTranscript} disabledReason="Run Transcription first"
      onRun={() => job.run(whole ? { use_chat: useChat } : { start: win.start, end: win.end, use_chat: useChat })}
      explain={<Explain
        what="The main judge. Gemini reads the numbered transcript and picks the best clip: where it starts and ends, a title, a hook, hashtags and a score."
        how={<>
          <p>It scores 7 things from 1–5: hook in the first 2 s, stands alone, payoff, emotion, shareability, pacing, clarity. Those become a 0–100 predicted score.</p>
          <p>Final score = 70 % AI + 30 % signal (chat or loudness). Live, a clip is only made when it beats the channel's minimum score and the AI says it would post it.</p>
          <p>Here you also see candidates it would <b>reject</b>, with the reason.</p>
        </>} />}
      controls={(
        <div className="space-y-2">
          <Toggle checked={whole} onChange={setWhole} label="Whole video" hint={whole ? 'Judges up to the first 15 minutes' : `Only the test window ${fmt(win.start)}–${fmt(win.end)}`} />
          <Toggle checked={useChat} onChange={setUseChat} disabled={!hasChat} label="Pretend the chat test happened here" hint={hasChat ? 'Uses the chat card result as the live trigger' : 'Run Chat signals first'} />
        </div>
      )}>
      {r && (
        <div className="space-y-2" data-testid="judge-result">
          <p className="text-[12px] text-muted">Model {r.model} · {r.candidates.length} candidate{r.candidates.length === 1 ? '' : 's'}</p>
          {r.candidates.length === 0 && <p className="text-[12.5px] text-muted">Gemini found nothing worth clipping here.</p>}
          {r.candidates.map((c, i) => (
            <div key={i} className="rounded-xl border border-line bg-raised p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink">{c.title}</div>
                  <div className="text-[12px] text-muted">{fmt(c.start_time)} – {fmt(c.end_time)} · {(c.end_time - c.start_time).toFixed(0)} s</div>
                </div>
                <Badge tone={c.would_post ? 'good' : 'bad'}>{c.virality_score}</Badge>
              </div>
              {!c.would_post && <Pill tone="bad">Would reject: {c.reject_reason || 'low score'}</Pill>}
              {c.hook_text && <p className="text-[12.5px] text-ink">Hook: “{c.hook_text}”</p>}
              {c.editorial_reason && <p className="text-[12px] text-muted">{c.editorial_reason}</p>}
              {c.scores && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                  {Object.entries(c.scores).map(([k, v]) => (
                    <div key={k} className="text-[11.5px]"><span className="text-muted">{k.replace('_', ' ')}</span> <span className="font-semibold text-ink">{v}/5</span></div>
                  ))}
                </div>
              )}
              <Button size="sm" icon={Crosshair} onClick={() => applyWindow(c.start_time, c.end_time)}>Use as test window</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ 5. video judge */

function VideoJudgeCard({ job, win }) {
  const [score, setScore] = useState(70);
  const r = job.result;
  const len = win.end - win.start;
  return (
    <Card n="5" icon={Eye} title="Video AI judge" testid="card-vjudge" job={job.job} busy={job.busy}
      onRun={() => job.run({ start: win.start, end: win.end, score })}
      explain={<Explain
        what="Gemini actually watches the test window (picture + sound) and scores what happens on screen - a jumpscare or clutch play with no words still counts."
        how={<>
          <p>The window is turned into a tiny preview (360p, 2 frames a second, mono sound, ~1–2 MB) and sent to Gemini.</p>
          <p>It returns a visual score and a reaction score (1–10 each), the events it saw, and boost / neutral / weak.</p>
          <p>New score = 75 % text score + 25 % video score. In the real pipeline the top 3 candidates are watched and re-ranked (Settings › Video AI judge).</p>
        </>} />}
      controls={(
        <Field label={`Text-judge score to blend with: ${score}`} hint={`Window ${fmt(win.start)}–${fmt(win.end)}${len > 75 ? ' (only the first 75 s are watched)' : ''}`}>
          <input type="range" min="0" max="100" value={score} onChange={(e) => setScore(Number(e.target.value))} className="h-8 w-full accent-[var(--color-accent)]" aria-label="Text score" />
        </Field>
      )}>
      {r && (
        <div className="space-y-2" data-testid="vjudge-result">
          <div className="flex flex-wrap gap-2">
            <Stat label="Verdict" value={r.verdict.verdict} /><Stat label="Visual" value={`${r.verdict.visual_score}/10`} />
            <Stat label="Reaction" value={`${r.verdict.reaction_score}/10`} /><Stat label="Score" value={`${r.text_score} → ${r.blended}`} />
          </div>
          <p className="text-[12.5px] text-ink">{r.verdict.reason}</p>
          <ul className="list-disc pl-5 text-[12.5px] text-muted">{r.verdict.visible_events.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ 6. face tracking */

function FaceCard({ job, win, session, templates }) {
  const [mode, setMode] = useState('crop');
  const [crop, setCrop] = useState({ x: 0.0, y: 0.12, w: 0.22, h: 0.32 });
  const [range, setRange] = useState(0.35);
  const [smooth, setSmooth] = useState(0.8);
  const [aspect, setAspect] = useState(null);
  const [from, setFrom] = useState('');
  const r = job.result;
  const layerOptions = useMemo(() => templates.flatMap((t) => t.layers.filter((l) => l.src).map((l) => ({ key: `${t.name}::${l.id}`, label: `${t.name} › ${l.name}`, l }))), [templates]);
  const copyFrom = (key) => {
    setFrom(key);
    const o = layerOptions.find((x) => x.key === key);
    if (!o) { setAspect(null); return; }
    const { src, dst, fit } = o.l;
    setCrop({ x: src.x, y: src.y, w: src.w, h: src.h });
    setAspect(fit === 'cover' && dst ? (dst.w * 1080) / (dst.h * 1920) : null);
  };
  const len = win.end - win.start;
  const chart = r?.keyframes?.length ? [r.keyframes.map((k) => [k[0], k[1]]), r.keyframes.map((k) => [k[0], k[2]])] : null;
  return (
    <Card n="6" icon={ScanFace} title="Face tracking (follow face)" testid="card-face" job={job.job} busy={job.busy}
      badge={<Badge tone="accent">New</Badge>}
      onRun={() => job.run({ start: win.start, end: win.end, mode, crop, range, smooth, view_aspect: aspect })}
      explain={<Explain
        what="Makes a crop follow the streamer's face. Draw a box around the face/webcam; when they lean or move, the box moves with them instead of cutting their head off."
        how={<>
          <p><b>1. Find faces</b> – the window is decoded at 5 frames a second and the <b>YuNet</b> face detector looks for faces only inside the yellow <i>search area</i> (your box grown by the "how far" amount), so it never jumps to a face in the gameplay.</p>
          <p><b>2. Stay on one face</b> – if there are several, it keeps the one closest to where the face was, preferring bigger faces.</p>
          <p><b>3. Calm camera</b> – a median filter removes one-frame glitches, a <i>dead zone</i> ignores small wobbles (under 8 % of the box), and smoothing eases the box over ~1 s instead of snapping.</p>
          <p><b>4. Render</b> – the result is a list of keyframes (every 0.5 s). ffmpeg moves the crop between them, frame by frame. If no face is found often enough, the box simply stays where you drew it.</p>
          <p>In templates this is the <b>Follow face</b> switch on a layer (Template Studio).</p>
        </>} />}
      controls={(
        <>
          <Segmented value={mode} onChange={setMode} ariaLabel="Tracking mode"
            options={[{ value: 'crop', label: 'Follow inside a box' }, { value: 'full', label: 'Full-frame 9:16' }]} />
          {mode === 'crop' ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <CropPicker frameUrl={session.frame_url} crop={crop} onChange={(c) => { setCrop(c); setFrom(''); setAspect(null); }} />
                <p className="text-[11.5px] text-muted">Drag the box onto the face or webcam; drag the blue corner to resize.</p>
              </div>
              <div className="space-y-3">
                <Field label="Or copy a box from a template" hint="Uses that layer's crop and output shape">
                  <Select value={from} onChange={(e) => copyFrom(e.target.value)}>
                    <option value="">-</option>
                    {layerOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </Select>
                </Field>
                <Field label={`How far it may move: ${Math.round(range * 100)}% of the box`} hint="Bigger = follows bigger moves, but may show the room around the webcam">
                  <input type="range" min="0.1" max="0.8" step="0.05" value={range} onChange={(e) => setRange(Number(e.target.value))} className="h-8 w-full accent-[var(--color-accent)]" aria-label="Range" />
                </Field>
                <Field label={`Smoothness: ${smooth >= 0.7 ? 'calm' : smooth >= 0.35 ? 'normal' : 'snappy'}`}>
                  <input type="range" min="0" max="1" step="0.05" value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} className="h-8 w-full accent-[var(--color-accent)]" aria-label="Smoothness" />
                </Field>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">A 9:16 window over the whole frame slides left/right to keep the face in it - for full-screen vertical clips of IRL or just-chatting streams.</p>
          )}
          <p className="text-[12px] text-muted">Window {fmt(win.start)}–{fmt(win.end)}{len > 120 ? ' (first 120 s)' : ''}. ~6 s of analysis per 30 s of video, plus the preview renders.</p>
        </>
      )}>
      {r && (
        <div className="space-y-3" data-testid="face-result">
          {!r.followed && <Notice tone="warn" icon={Info}>No face was found often enough inside the search area, so the box stays still. Move the box over the face/webcam or allow it to move further.</Notice>}
          <div className="flex flex-wrap gap-2">
            <Stat label="Detector" value={r.detector} /><Stat label="Keyframes" value={r.keyframes.length} />
            <Stat label="Max move" value={`${r.max_shift[0]} / ${r.max_shift[1]} px`} /><Stat label="Analysis" value={`${r.seconds}s`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
              <div className="text-[12.5px] font-semibold text-ink">What the tracker sees</div>
              <Video src={r.debug_url} testid="face-debug" />
              <p className="text-[11.5px] text-muted"><span className="text-[#facc15]">Yellow</span> = search area · <span className="text-white">white</span> = your box · <span className="text-good">green</span> = followed box</p>
            </div>
            <div className="space-y-1">
              <div className="text-[12.5px] font-semibold text-ink">Before → after</div>
              <Video src={r.compare_url} testid="face-compare" />
              <p className="text-[11.5px] text-muted">Left: your box, fixed. Right: the same box following the face.</p>
            </div>
          </div>
          {chart && (
            <div className="space-y-1">
              <LineChart points={chart} colors={['#22c55e', '#60a5fa']} height={110} lines={[{ y: 0, color: '#475569' }]} testid="face-chart" />
              <p className="text-[11.5px] text-muted"><span className="text-good">Green</span> = left/right move, <span className="text-[#60a5fa]">blue</span> = up/down move (pixels in a 1920×1080 frame) over time.</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ 7. render */

function RenderCard({ job, win, templates, hasTranscript }) {
  const [name, setName] = useState('');
  const [follow, setFollow] = useState({});
  const [smooth, setSmooth] = useState(0.8);
  const [captions, setCaptions] = useState(true);
  const [auto, setAuto] = useState(false);
  const [style, setStyle] = useState('punchy');
  const [hook, setHook] = useState('');
  const t = templates.find((x) => x.name === name) || templates[0];
  useEffect(() => {
    if (!t) return;
    setFollow(Object.fromEntries(t.layers.map((l) => [l.id, l.tracking === 'face' || /face|cam/i.test(`${l.name} ${l.id}`)])));
  }, [t?.name]);   // eslint-disable-line react-hooks/exhaustive-deps
  const r = job.result;
  const len = win.end - win.start;
  return (
    <Card n="8" icon={Clapperboard} title="Full render with a template" testid="card-render" job={job.job} busy={job.busy}
      disabled={!t} disabledReason="No templates"
      onRun={() => job.run({ start: win.start, end: win.end, template: t.name, follow_face: Object.keys(follow).filter((k) => follow[k]),
        smooth, captions: captions && hasTranscript, auto_edit: auto, auto_edit_style: style, hook_text: hook })}
      explain={<Explain
        what="Renders the test window as a finished 9:16 Short exactly like the real pipeline: template layout, follow-face layers, burned-in captions, bleeps, and optionally auto-edit."
        how={<>
          <p><b>Layout</b>: each template layer crops part of the 16:9 video and places it on the 1080×1920 canvas. Layers you tick "Follow face" on get face tracking first.</p>
          <p><b>Captions</b>: the transcript words in the window become animated subtitles in the template's caption style. Censored words are bleeped and masked.</p>
          <p><b>Auto-edit</b>: cuts silent gaps and filler words, adds punch-in zooms on loud words, a hook title card and sound effects. Punchy = fast and loud, Clean = subtle, Minimal = only trims dead air.</p>
          <p>Also applied: a tiny speed-up and colour grade (anti-reupload detection), like real clips. The template file is never changed.</p>
        </>} />}
      controls={(
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Template">
              <Select value={t?.name || ''} onChange={(e) => setName(e.target.value)}>
                {templates.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
              </Select>
            </Field>
            {t && (
              <div className="rounded-xl border border-line bg-canvas p-2.5 space-y-1.5">
                <div className="text-[12px] font-semibold text-ink flex items-center gap-1.5"><ScanFace size={14} className="text-accent" />Follow face on</div>
                {t.layers.map((l) => (
                  <Toggle key={l.id} checked={!!follow[l.id]} onChange={(v) => setFollow((f) => ({ ...f, [l.id]: v }))} label={l.name} />
                ))}
                <Field label={`Smoothness: ${smooth >= 0.7 ? 'calm' : smooth >= 0.35 ? 'normal' : 'snappy'}`}>
                  <input type="range" min="0" max="1" step="0.05" value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} className="h-8 w-full accent-[var(--color-accent)]" aria-label="Follow smoothness" />
                </Field>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <Toggle checked={captions && hasTranscript} onChange={setCaptions} disabled={!hasTranscript} label="Captions" hint={hasTranscript ? 'From the transcription test' : 'Run Transcription first'} />
            <Toggle checked={auto} onChange={setAuto} label="Auto-edit" hint="Jump cuts, zooms, hook card, SFX" />
            {auto && (
              <>
                <Segmented value={style} onChange={setStyle} ariaLabel="Auto-edit style" options={[{ value: 'punchy', label: 'Punchy' }, { value: 'clean', label: 'Clean' }, { value: 'minimal', label: 'Minimal' }]} />
                <Field label="Hook title card (optional)"><Input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="He did NOT expect this" /></Field>
              </>
            )}
            <p className="text-[12px] text-muted">Window {fmt(win.start)}–{fmt(win.end)} ({len.toFixed(0)} s{len > 180 ? ', max 180' : ''}). Rendering takes about 1–2× the clip length.</p>
          </div>
        </div>
      )}>
      {r && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_1fr] items-start" data-testid="render-result">
          <Video src={r.url} vertical testid="render-video" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Stat label="Template" value={r.template} /><Stat label="Size" value={`${r.info.width}×${r.info.height}`} />
              <Stat label="Length" value={`${r.info.duration}s`} /><Stat label="Render time" value={`${r.seconds}s`} />
            </div>
            <p className="text-[12.5px] text-ink">Follow face: {r.followed_layers.length ? r.followed_layers.join(', ') : 'off'} · Captions: {r.captions ? 'on' : 'off'} · Auto-edit: {r.auto_edit || 'off'}</p>
            {r.auto_edit_summary && (
              <p className="text-[12px] text-muted">Auto-edit: {r.auto_edit_summary.cuts} cuts, −{r.auto_edit_summary.removed_seconds}s dead air, {r.auto_edit_summary.zooms} zooms{r.auto_edit_summary.hook_card ? ', hook card' : ''}{r.auto_edit_summary.sfx ? ', SFX' : ''}</p>
            )}
            <a href={withToken(r.url)} download="lab_render.mp4" className="inline-flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold text-accent">Download MP4</a>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ 7. auto template */

function AutoTemplateCard({ job, render, win, templates, onSaved }) {
  const [gemini, setGemini] = useState(true);
  const [base, setBase] = useState('');
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [lastRender, setLastRender] = useState(null);
  const r = job.result;
  useEffect(() => {
    if (!r?.variants?.length) return;
    setPicked(r.variants[0].id);
    setName(r.variants[0].template.name);
    setSaved(''); setSaveErr('');
  }, [r]);
  const v = r?.variants?.find((x) => x.id === picked);
  const KIND = {
    facecam: 'Gaming with a webcam overlay',
    camera: 'The camera is the whole video (IRL / just chatting)',
    gameplay_only: 'No streamer face found (gameplay only)',
  };
  const exists = templates.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const save = async () => {
    if (!v || !name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      await saveTemplate({ ...v.template, name: name.trim() });
      setSaved(name.trim()); onSaved?.();
    } catch (e) { setSaveErr(errText(e)); }
    setSaving(false);
  };
  const testRender = () => {
    if (!v) return;
    setLastRender(v.template.name);
    render.run({ start: win.start, end: win.end, template_json: v.template, captions: true,
      follow_face: v.template.layout.layers.filter((l) => l.tracking?.mode === 'face').map((l) => l.id) });
  };
  const rr = render.result && lastRender && render.result.template === lastRender ? render.result : null;
  return (
    <Card n="7" icon={Wand2} title="Auto template" testid="card-auto" job={job.job} busy={job.busy}
      badge={<Badge tone="accent">New</Badge>}
      onRun={() => job.run({ use_gemini: gemini, base: base || undefined })} runLabel="Detect layout"
      explain={<Explain
        what="Looks at the video, finds where the streamer's webcam is, and builds ready-to-use 9:16 templates from it - no manual box drawing."
        how={<>
          <p><b>1. Sample</b> – 24 frames spread over the whole video.</p>
          <p><b>2. Find the streamer</b> – the face detector runs on every frame. The face that sits in the <i>same place</i> in most frames is the webcam (faces in the game move around, so they are ignored). A very big face means the camera is the whole video; no steady face means gameplay only.</p>
          <p><b>3. Find the webcam edges</b> – a box is guessed from the face size, then each side snaps to the strongest straight edge nearby. Edges are averaged over all frames: the webcam border never moves, so it stands out, while game edges blur away.</p>
          <p><b>4. Second opinion</b> – optionally Gemini looks at one frame and marks the webcam, game and chat. Its box is used only if the detected face is inside it.</p>
          <p><b>5. Build layouts</b> – stacked (cam 38 % / game 62 %), 50/50 split, full game with a cam bubble, full-screen camera that follows the face, or the whole video on a blurred background. The facecam layers have Follow face on. Captions and pacing are copied from the base template.</p>
        </>} />}
      controls={(
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle checked={gemini} onChange={setGemini} label="Ask Gemini to double-check" hint="One image to Gemini (uses a little quota)" />
          <Field label="Copy captions & pacing from">
            <Select value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="">Bottom Left (default)</option>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
      )}>
      {r && (
        <div className="space-y-3" data-testid="auto-result">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-1">
              {r.debug_url && <img src={withToken(r.debug_url)} alt="What was detected" className="w-full rounded-xl" />}
              <p className="text-[11.5px] text-muted"><span className="text-good">Green</span> = webcam box used · <span className="text-[#facc15]">yellow</span> = streamer's face · <span className="text-[#e879f9]">pink</span> = Gemini's box · grey = first guess from face size</p>
            </div>
            <div className="space-y-2">
              <Notice tone={r.confidence === 'low' ? 'warn' : 'accent'} icon={Info}>
                {KIND[r.kind] || r.kind}{r.confidence ? ` · ${r.confidence} confidence` : ''}
                {r.confidence === 'low' && <span className="block mt-1">Not sure about this one - check the green box and the previews, or turn on the Gemini check.</span>}
              </Notice>
              <div className="flex flex-wrap gap-2">
                <Stat label="Face in" value={r.face ? `${r.face.frames_with_face}/${r.frames} frames` : 'none'} />
                <Stat label="Webcam from" value={r.source || '–'} />
                {r.cam_box && <Stat label="Webcam box" value={`${r.cam_box[2]}×${r.cam_box[3]} at ${r.cam_box[0]},${r.cam_box[1]}`} />}
              </div>
              {r.gemini?.notes && <p className="text-[12px] text-muted">Gemini: {r.gemini.notes}</p>}
            </div>
          </div>
          <div className="text-[12.5px] font-semibold text-ink">Pick a layout</div>
          <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Layouts">
            {r.variants.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={picked === x.id} data-testid={`variant-${x.id}`}
                onClick={() => { setPicked(x.id); setName(x.template.name); setSaved(''); }}
                className={`w-[132px] shrink-0 rounded-xl border p-1.5 text-left ${picked === x.id ? 'border-accent bg-accent/10' : 'border-line bg-raised'}`}>
                {x.preview_url ? <img src={withToken(x.preview_url)} alt="" className="aspect-[9/16] w-full rounded-lg object-cover bg-black" />
                  : <div className="aspect-[9/16] w-full rounded-lg bg-black" />}
                <div className="mt-1 text-[12px] font-semibold leading-tight text-ink">{x.title}</div>
                <div className="text-[11px] leading-tight text-muted">{x.hint}</div>
              </button>
            ))}
          </div>
          {v && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Button icon={Play} onClick={testRender} loading={render.busy} disabled={render.busy}>Render the test window with it</Button>
                {lastRender && <JobStatus job={render.job} />}
                {rr && <Video src={rr.url} vertical testid="auto-render-video" />}
              </div>
              <div className="space-y-2">
                <Field label="Save as template" hint={exists ? 'A template with this name exists - pick another name' : 'Then fine-tune it in Template Studio'}>
                  <Input value={name} onChange={(e) => { setName(e.target.value.replace(/[\\/:*?"<>|]/g, '')); setSaved(''); }} aria-label="Template name" />
                </Field>
                <Button variant="primary" icon={Save} loading={saving} disabled={!name.trim() || exists} onClick={save} data-testid="auto-save">Save template</Button>
                {saveErr && <Notice tone="bad" icon={XCircle}>{saveErr}</Notice>}
                {saved && (
                  <Notice tone="good" icon={CheckCircle2}>
                    Saved “{saved}”. <Link to={`/templates/${encodeURIComponent(saved)}`} className="font-semibold text-accent inline-flex items-center gap-1">Open in Studio <ExternalLink size={12} /></Link>
                  </Notice>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
