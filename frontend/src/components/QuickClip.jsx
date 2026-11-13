import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Zap, Link as LinkIcon, Sparkles, Loader2, CheckCircle2, AlertTriangle, Info, Scissors, ClipboardPaste } from 'lucide-react';
import { clipManual } from '../api';
import YouTubeRangePicker, { youtubeId, youtubeStartParam } from './YouTubeRangePicker';
import AutoEditOptions, { loadAutoEdit, autoEditPayload } from './AutoEditOptions';
import CaptionStylePicker from './CaptionStylePicker';
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
        const list = (Array.isArray(res.data) ? res.data : []).map((t) => t.name).filter(Boolean);
        setTemplates(list);
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
        setJob({ state: 'error', message: 'Still running after 20 minutes — check Live Logs.' });
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-12">
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 sm:p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
            <Zap size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-black text-white">Quick Clip</h2>
            <p className="text-xs text-slate-400">Turn any YouTube or Twitch video into ranked 9:16 Shorts.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
          <div>
            <label htmlFor="qc-url" className="block text-slate-300 font-bold mb-1.5 flex items-center gap-1.5">
              <LinkIcon size={14} /> Video URL
            </label>
            <div className="flex gap-2">
              <input
                id="qc-url"
                type="url"
                inputMode="url"
                required
                placeholder="https://youtube.com/watch?v=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 min-w-0 bg-slate-950 border border-white/10 rounded-lg p-3 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
              />
              <button type="button" onClick={pasteUrl} className="px-3 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 shrink-0" aria-label="Paste URL">
                <ClipboardPaste size={16} />
              </button>
            </div>
          </div>

          {sharedNotice && (
            <p className="-mt-2 text-[11px] text-emerald-300">Link received from share — scrub below to pick the moment.</p>
          )}

          {ytId && (
            <YouTubeRangePicker
              videoId={ytId}
              initialTime={urlStart || 0}
              start={start != null && !Number.isNaN(start) ? start : null}
              end={end != null && !Number.isNaN(end) ? end : null}
              onSetStart={(t) => setStartTime(fmtInput(t))}
              onSetEnd={(t) => setEndTime(fmtInput(t))}
            />
          )}

          <div>
            <label htmlFor="qc-template" className="block text-slate-300 font-bold mb-1.5">Layout template</label>
            <select
              id="qc-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-3 text-white text-base sm:text-sm"
            >
              {templates.length === 0 && <option value="">Loading templates…</option>}
              {templates.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="qc-start" className="block text-slate-300 font-bold mb-1">Start (optional)</label>
                <input
                  id="qc-start"
                  inputMode="decimal"
                  placeholder="1:30"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-lg p-3 text-white text-base sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="qc-end" className="block text-slate-300 font-bold mb-1">End (optional)</label>
                <input
                  id="qc-end"
                  inputMode="decimal"
                  placeholder="2:15"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-lg p-3 text-white text-base sm:text-sm"
                />
              </div>
            </div>
            {rangeError ? (
              <p className="mt-1.5 text-rose-300">{rangeError}</p>
            ) : (
              <p className="mt-1.5 text-slate-500 flex items-start gap-1.5">
                <Info size={13} className="shrink-0 mt-px" />
                {hasRange && start !== null && end !== null
                  ? `Clips exactly ${fmt(start)} → ${fmt(end)} (${Math.round(end - start)}s).`
                  : 'Leave empty and the AI scans the whole video and makes several ranked clips (needs a Gemini key).'}
              </p>
            )}
          </div>

          {!hasRange && (
            <div className="space-y-3 p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <div>
                <span className="block text-slate-300 font-bold mb-1.5">Up to how many clips</span>
                <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Number of clips">
                  {CLIP_COUNTS.map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={maxClips === n} onClick={() => setMaxClips(n)}
                      className={`h-10 rounded-lg text-sm font-bold border ${maxClips === n ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-transparent border-white/10 text-slate-300'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="block text-slate-300 font-bold mb-1.5">Clip length</span>
                <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Clip length">
                  {LENGTHS.map((l) => (
                    <button key={l.id} type="button" role="radio" aria-checked={lengthId === l.id} onClick={() => setLengthId(l.id)}
                      className={`h-10 rounded-lg text-[11px] font-bold border ${lengthId === l.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-transparent border-white/10 text-slate-300'}`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="qc-focus" className="block text-slate-300 font-bold mb-1">Focus on (optional)</label>
                <input
                  id="qc-focus"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. funny reactions, clutch plays, celebrity encounter"
                  className="w-full bg-slate-950 border border-white/10 rounded-lg p-3 text-white text-base sm:text-sm"
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="text-xs font-bold text-slate-200 mb-2">Caption style</p>
            <CaptionStylePicker value={captionStyle} onChange={pickCaptionStyle} />
          </div>

          <AutoEditOptions value={autoEdit} onChange={setAutoEdit} />

          <button
            type="submit"
            disabled={submitting || running || !!rangeError || !template}
            className="mt-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-6 rounded-xl text-sm transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            {running || submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {submitting ? 'Starting…' : running ? 'Working…' : hasRange ? 'Generate Short' : `Find up to ${maxClips} clip${maxClips > 1 ? 's' : ''}`}
          </button>
        </form>

        {job && (
          <div
            role="status"
            className={`mt-5 p-3.5 rounded-xl border text-sm ${
              job.state === 'done' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : job.state === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : job.state === 'empty' ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-100'
            }`}
          >
            {job.state === 'running' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <span className="min-w-0 break-words">{job.stepName || 'Working…'}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-indigo-400 transition-all duration-500" style={{ width: `${Math.min(100, ((job.step || 1) / 5) * 100)}%` }} />
                </div>
                <p className="text-[11px] text-indigo-200/70">You can leave this page — the clip will appear in Review and on Telegram.</p>
              </div>
            )}
            {job.state === 'done' && (
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 size={18} className="shrink-0" />
                <span className="font-semibold">{/clip\(s\) ready/i.test(job.message || '') ? job.message : `Clip #${job.clipId} is ready.`}</span>
                <span className="flex gap-2 ml-auto">
                  <Link to="/" className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold">Review</Link>
                  <Link to={`/clips/${job.clipId}/editor`} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-xs font-bold flex items-center gap-1">
                    <Scissors size={13} /> Edit
                  </Link>
                </span>
              </div>
            )}
            {(job.state === 'error' || job.state === 'empty') && (
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <span className="min-w-0 break-words">
                  {job.state === 'empty'
                    ? 'No moment scored above your minimum virality score. Try giving a start/end time, or lower the score in Settings.'
                    : job.message}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
