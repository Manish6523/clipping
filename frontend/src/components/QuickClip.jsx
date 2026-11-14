import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Zap, Link as LinkIcon, Sparkles, CheckCircle2, AlertTriangle, Info, Scissors, ClipboardPaste, Layers, Wand2 } from 'lucide-react';
import { clipManual } from '../api';
import YouTubeRangePicker, { youtubeId, youtubeStartParam } from './YouTubeRangePicker';
import AutoEditOptions, { loadAutoEdit, autoEditPayload } from './AutoEditOptions';
import CombinedStyleStudio from './CombinedStyleStudio';
import { Page, Panel, Button, Input, Select, Field, Segmented, Notice, Progress, Spinner } from './ui';
import { loadHookStyle, saveHookStyle } from '../lib/hookStyles';
import { loadCaptionStyle, saveCaptionStyle } from '../lib/captionStyles';

// Shared text from other apps often looks like "Check this out https://youtu.be/xyz"
const firstUrl = (...vals) => {
  for (const v of vals) {
    const m = String(v || '').match(/https?:\/\/\S+/);
    if (m) return m[0].replace(/[).,]+$/, '');
  }
  return '';
};

// Accepts "90", "1:30", "01:02:03" -> seconds (or null if empty / invalid)
function parseTime(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const parts = t.split(':').map((p) => p.trim());
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p)) || parts.length > 3) return NaN;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

const fmt = (s) => {
  if (s == null || Number.isNaN(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const POLL_MS = 2000;

// Opus-style output settings for "scan the whole video" mode
const CLIP_COUNTS = [1, 3, 5, 10, 20];
const LENGTHS = [
  { id: 'auto', label: 'Auto', min: 25, max: 60 },
  { id: 'short', label: '<30s', min: 12, max: 30 },
  { id: 'mid', label: '30–60s', min: 30, max: 60 },
  { id: 'long', label: '60–90s', min: 60, max: 90 },
  { id: 'xl', label: '90s–3m', min: 90, max: 180 },
];
const TIMEOUT_MS = 20 * 60 * 1000;

export default function QuickClip() {
  const [url, setUrl] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateDefaults, setTemplateDefaults] = useState({}); // name -> {caption_style, hook_style}
  const [template, setTemplate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState(null); // { state: 'running'|'done'|'error'|'empty', step, stepName, clipId, message }
  const pollRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sharedNotice, setSharedNotice] = useState(false);
  const [maxClips, setMaxClips] = useState(5);
  const [lengthId, setLengthId] = useState('auto');
  const [focus, setFocus] = useState('');
  const [autoEdit, setAutoEdit] = useState(loadAutoEdit);
  const [captionStyle, setCaptionStyle] = useState(loadCaptionStyle);
  const pickCaptionStyle = (id) => { setCaptionStyle(id); saveCaptionStyle(id); };
  const [hookStyle, setHookStyle] = useState(loadHookStyle);
  const pickHookStyle = (id) => { setHookStyle(id); saveHookStyle(id); };

  // Android share sheet / PWA share_target: /quickclip?url=…&text=…&title=…
  useEffect(() => {
    const shared = firstUrl(searchParams.get('url'), searchParams.get('text'), searchParams.get('title'));
    if (shared) {
      setUrl(shared);
      setSharedNotice(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    axios.get('/api/templates')
      .then((res) => {
        const raw = Array.isArray(res.data) ? res.data : [];
        const list = raw.map((t) => t.name).filter(Boolean);
        setTemplates(list);
        setTemplateDefaults(Object.fromEntries(raw.filter((t) => t.name).map((t) => [t.name, { caption_style: t.caption_style, hook_style: t.hook_style }])));
        setTemplate((cur) => cur || list[0] || '');
      })
      .catch(() => setTemplates([]));
    return () => clearInterval(pollRef.current);
  }, []);

  const ytId = youtubeId(url);
  const urlStart = youtubeStartParam(url);
  const fmtInput = (sec) => {
    const m = Math.floor(sec / 60);
    const rest = Math.round((sec % 60) * 10) / 10;
    return `${m}:${String(rest).padStart(rest < 10 ? (Number.isInteger(rest) ? 2 : 4) : 1, '0')}`;
  };

  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const hasRange = start !== null || end !== null;
  let rangeError = '';
  if (hasRange) {
    if (start === null || end === null) rangeError = 'Fill both start and end, or leave both empty.';
    else if (Number.isNaN(start) || Number.isNaN(end)) rangeError = 'Use seconds (90) or minutes:seconds (1:30).';
    else if (end <= start) rangeError = 'End must be after start.';
    else if (end - start > 180) rangeError = 'Keep manual clips under 3 minutes.';
  }

  const startPolling = (submittedAt) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (Date.now() - submittedAt > TIMEOUT_MS) {
        clearInterval(pollRef.current);
        setJob({ state: 'error', message: 'Still running after 20 minutes - check the Logs page.' });
        return;
      }
      try {
        const { data: p } = await axios.get('/api/pipeline/status');
        if (!p || (p.channel_id && p.channel_id !== 'manual')) return;
        if (p.status === 'error') {
          clearInterval(pollRef.current);
          setJob({ state: 'error', message: p.error_message || p.step_name || 'Pipeline failed' });
        } else if (p.status === 'completed' && p.clip_id) {
          clearInterval(pollRef.current);
          setJob({ state: 'done', clipId: p.clip_id, message: p.step_name });
        } else if (p.status === 'idle' && /no clips/i.test(p.step_name || '')) {
          clearInterval(pollRef.current);
          setJob({ state: 'empty', message: p.step_name });
        } else if (p.status !== 'idle') {
          setJob((j) => ({ ...(j || {}), state: 'running', step: p.current_step, stepName: p.step_name }));
        }
      } catch {
        // transient network error: keep polling
      }
    }, POLL_MS);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim() || rangeError || submitting) return;
    setSubmitting(true);
    try {
      await clipManual({
        url: url.trim(),
        template,
        time_range: hasRange ? `${start}-${end}` : null,
        auto_edit: autoEditPayload(autoEdit),
        caption_style: captionStyle === 'template' ? undefined : captionStyle,
        hook_style: autoEdit.enabled && hookStyle !== 'template' ? hookStyle : undefined,
        ...(!hasRange ? (() => {
          const len = LENGTHS.find((l) => l.id === lengthId) || LENGTHS[0];
          return { max_clips: maxClips, min_len: len.min, max_len: len.max, focus: focus.trim() || undefined };
        })() : {}),
      });
      const now = Date.now();
      setJob({ state: 'running', step: 1, stepName: 'Starting…' });
      startPolling(now);
    } catch (err) {
      const msg = err.response?.data?.error;
      setJob({ state: 'error', message: typeof msg === 'string' ? msg : msg?.message || err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // clipboard permission denied - ignore
    }
  };

  const running = job?.state === 'running';

  const canSubmit = !(submitting || running || !!rangeError || !template || !url.trim());
  const submitLabel = submitting ? 'Starting…' : running ? 'Processing in the background…' : hasRange ? 'Generate Short' : `Find up to ${maxClips} clips`;
  const lenOptions = LENGTHS.map((l) => ({ value: l.id, label: l.label }));
  const step = Math.min(5, Math.max(1, job?.step || 1));

  return (
    <Page title="Quick Clip" icon={Zap} subtitle="Paste a YouTube or Twitch video. AI finds the best moments and renders them as 9:16 Shorts."
      className="pb-40 md:pb-8"
      actions={<div className="hidden md:block"><Button variant="primary" icon={Sparkles} loading={submitting || running} disabled={!canSubmit} onClick={handleSubmit}>{submitLabel}</Button></div>}>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        <div className="lg:col-span-7 flex flex-col gap-3 min-w-0">
          <Panel title="Source video" icon={LinkIcon} right={<span className="text-[11px] text-muted">YouTube · Twitch VOD</span>}>
            <div className="flex gap-2">
              <Input id="qc-url" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…" aria-label="Source video URL" className="flex-1 min-w-0" />
              <Button icon={ClipboardPaste} onClick={pasteUrl} title="Paste from clipboard"><span className="hidden sm:inline">Paste</span></Button>
            </div>
            {sharedNotice && <Notice tone="good" icon={CheckCircle2} className="mt-2.5">Link loaded from share - scrub below to pick your moment.</Notice>}
          </Panel>

          <Panel title="Clip bounds" icon={Scissors} right={<span className="text-[11px] text-muted">Optional · empty = AI picks</span>} className="space-y-3">
            {ytId && (
              <div className="overflow-hidden rounded-xl border border-line bg-black">
                <YouTubeRangePicker videoId={ytId} initialTime={urlStart || 0}
                  start={start != null && !Number.isNaN(start) ? start : null} end={end != null && !Number.isNaN(end) ? end : null}
                  onSetStart={(t) => setStartTime(fmtInput(t))} onSetEnd={(t) => setEndTime(fmtInput(t))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start"><Input id="qc-start" mono inputMode="decimal" placeholder="e.g. 1:30" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
              <Field label="End"><Input id="qc-end" mono inputMode="decimal" placeholder="e.g. 2:15" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
            </div>
            {rangeError ? <Notice tone="bad" icon={AlertTriangle}>{rangeError}</Notice> : (
              <Notice tone="idle" icon={Info}>
                {hasRange && start !== null && end !== null
                  ? `Manual cut ${fmt(start)} → ${fmt(end)} (${Math.round(end - start)} s).`
                  : 'Left empty, Gemini reads the whole transcript and returns ranked viral clips.'}
              </Notice>
            )}
          </Panel>

          {!hasRange && (
            <Panel title="AI discovery" icon={Layers} className="space-y-3.5">
              <div className="grid sm:grid-cols-2 gap-3.5">
                <Field label="How many clips">
                  <Segmented value={maxClips} onChange={setMaxClips} options={CLIP_COUNTS.map((n) => ({ value: n, label: String(n) }))} ariaLabel="Number of clips" className="w-full [&>button]:flex-1 [&>button]:justify-center" />
                </Field>
                <Field label="Target length">
                  <Segmented value={lengthId} onChange={setLengthId} options={lenOptions} ariaLabel="Clip length" size="sm" className="w-full [&>button]:flex-1 [&>button]:justify-center" />
                </Field>
              </div>
              <Field label="Focus (optional)" hint="Tell the AI what to hunt for.">
                <Input id="qc-focus" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="e.g. funny rage moments, ace rounds, shocked reactions" />
              </Field>
            </Panel>
          )}
        </div>

        <div className="lg:col-span-5 flex flex-col gap-3 min-w-0">
          <Panel title="Layout template" icon={Wand2} right={<Link to="/templates" className="text-[11.5px] text-accent font-medium">Design in Studio →</Link>}>
            <Select id="qc-template" value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Layout template">
              {templates.length === 0 && <option value="">Loading templates…</option>}
              {templates.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Panel>

          <CombinedStyleStudio captionStyle={captionStyle} onCaptionChange={pickCaptionStyle} hookStyle={hookStyle} onHookChange={pickHookStyle}
            autoEdit={autoEdit} onAutoEditChange={setAutoEdit}
            templateDefaultCaption={templateDefaults[template]?.caption_style} templateDefaultHook={templateDefaults[template]?.hook_style || 'classic'} />

          {job && (
            <Panel role="status" tone={job.state === 'done' ? undefined : job.state === 'error' ? 'bad' : job.state === 'empty' ? 'warn' : 'accent'} className="space-y-3">
              {job.state === 'running' && (
                <>
                  <div className="flex items-center gap-2.5 text-[13px] font-semibold text-ink"><Spinner size={16} className="!text-accent shrink-0" /><span className="min-w-0 break-words">{job.stepName || 'Processing video…'}</span></div>
                  <Progress value={(step / 5) * 100} />
                  <p className="text-[11px] text-muted">Step {step} of 5. You can leave this page - finished clips show up in Review and on Telegram.</p>
                </>
              )}
              {job.state === 'done' && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><CheckCircle2 size={18} className="text-good shrink-0" />
                    {/clip\(s\) ready/i.test(job.message || '') ? job.message : `Clip #${job.clipId} is ready.`}</div>
                  <div className="flex gap-2">
                    <Link to="/"><Button size="sm">Review</Button></Link>
                    <Link to={`/clips/${job.clipId}/editor`}><Button size="sm" variant="good" icon={Scissors}>Edit</Button></Link>
                  </div>
                </div>
              )}
              {(job.state === 'error' || job.state === 'empty') && (
                <div className="flex items-start gap-2.5 text-xs leading-relaxed">
                  <AlertTriangle size={17} className={`shrink-0 mt-0.5 ${job.state === 'error' ? 'text-bad' : 'text-warn'}`} />
                  <span className="min-w-0 break-words text-slate-300">
                    {job.state === 'empty' ? 'No moment scored above your minimum virality score. Set start/end times, or lower the minimum score in Settings.' : job.message}
                  </span>
                </div>
              )}
            </Panel>
          )}
        </div>
      </form>

      {/* Phone: generate button floats above the tab bar */}
      <div className="md:hidden fixed inset-x-3 z-40" style={{ bottom: 'calc(68px + var(--safe-bottom))' }}>
        <Button block size="lg" variant="primary" icon={Sparkles} loading={submitting || running} disabled={!canSubmit} onClick={handleSubmit} className="shadow-xl shadow-black/50">{submitLabel}</Button>
      </div>
    </Page>
  );
}
