import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Zap, Link as LinkIcon, Sparkles, Loader2, CheckCircle2, AlertTriangle, Info, Scissors, ClipboardPaste } from 'lucide-react';
import { clipManual } from '../api';
import YouTubeRangePicker, { youtubeId, youtubeStartParam } from './YouTubeRangePicker';
import AutoEditOptions, { loadAutoEdit, autoEditPayload } from './AutoEditOptions';
import CaptionStylePicker from './CaptionStylePicker';
import HookStylePicker from './HookStylePicker';
import CombinedStyleStudio from './CombinedStyleStudio';
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

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
      {/* Page Title & Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 bg-slate-900/40 border border-white/5 rounded-2xl p-4 lg:p-6 backdrop-blur-sm">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-2xl text-amber-400 shadow-inner">
            <Zap size={24} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Quick Clip Studio</h1>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                AI Pipeline v3
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Turn YouTube or Twitch stream VODs into viral, auto-formatted 9:16 Shorts in seconds.
            </p>
          </div>
        </div>

        {/* Global Action Trigger / Submit Button on Desktop Header */}
        <div className="hidden lg:flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || running || !!rangeError || !url.trim() || !template}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-black py-2.5 px-6 rounded-xl text-xs sm:text-sm transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-95"
          >
            {running || submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {submitting ? 'Starting…' : running ? 'Processing…' : hasRange ? 'Generate Short' : `Generate (${maxClips} Clips)`}
          </button>
        </div>
      </div>

      {/* Main Two-Column Responsive Grid: Left Input & Scrubber / Right Customization & Preset Config */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start">
        {/* Left Column: Media Source, Video Preview & Trimming (7 cols on desktop) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* 1. URL Ingestion Card */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm">
            <label htmlFor="qc-url" className="text-xs font-bold text-slate-200 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <LinkIcon size={14} className="text-indigo-400" /> Source Video URL
              </span>
              <span className="text-[11px] text-slate-400 font-normal">YouTube / Twitch VOD</span>
            </label>
            <div className="flex gap-2">
              <input
                id="qc-url"
                type="url"
                inputMode="url"
                required
                placeholder="https://youtube.com/watch?v=… or https://twitch.tv/videos/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 min-w-0 bg-slate-950/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
              />
              <button
                type="button"
                onClick={pasteUrl}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 border border-white/5 active:scale-95 shrink-0"
                title="Paste from clipboard"
              >
                <ClipboardPaste size={14} />
                <span className="hidden sm:inline">Paste</span>
              </button>
            </div>

            {sharedNotice && (
              <p className="mt-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl flex items-center gap-2">
                <CheckCircle2 size={14} /> Link loaded from share — scrub below to pick your moment.
              </p>
            )}
          </div>

          {/* 2. Interactive Video Scrubbing & Manual Time Bounds */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scissors size={15} className="text-amber-400" />
                <h2 className="text-sm font-bold text-white">Clip Extraction Bounds</h2>
              </div>
              <span className="text-[11px] text-slate-400">Optional (Auto AI if empty)</span>
            </div>

            {ytId && (
              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-inner">
                <YouTubeRangePicker
                  videoId={ytId}
                  initialTime={urlStart || 0}
                  start={start != null && !Number.isNaN(start) ? start : null}
                  end={end != null && !Number.isNaN(end) ? end : null}
                  onSetStart={(t) => setStartTime(fmtInput(t))}
                  onSetEnd={(t) => setEndTime(fmtInput(t))}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label htmlFor="qc-start" className="block text-slate-300 font-bold text-[11px] uppercase tracking-wider mb-1.5">
                  Start Timestamp
                </label>
                <input
                  id="qc-start"
                  inputMode="decimal"
                  placeholder="e.g. 1:30"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-600"
                />
              </div>
              <div>
                <label htmlFor="qc-end" className="block text-slate-300 font-bold text-[11px] uppercase tracking-wider mb-1.5">
                  End Timestamp
                </label>
                <input
                  id="qc-end"
                  inputMode="decimal"
                  placeholder="e.g. 2:15"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-600"
                />
              </div>
            </div>

            {rangeError ? (
              <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-xl flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" /> {rangeError}
              </p>
            ) : (
              <p className="text-xs text-slate-400 bg-white/[0.02] border border-white/5 px-3 py-2 rounded-xl flex items-start gap-2">
                <Info size={14} className="shrink-0 text-slate-400 mt-0.5" />
                <span>
                  {hasRange && start !== null && end !== null
                    ? `Manual Cut: ${fmt(start)} → ${fmt(end)} (${Math.round(end - start)} seconds length).`
                    : 'Left empty: Gemini AI scans the full video transcript and generates ranked viral clips automatically.'}
                </span>
              </p>
            )}
          </div>

          {/* 3. AI Scan Parameters (Shown when no manual range is specified) */}
          {!hasRange && (
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-white/5">
                <Sparkles size={15} className="text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">AI Viral Discovery Settings</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="block text-slate-300 font-bold text-[11px] uppercase tracking-wider mb-2">Max Clips Count</span>
                  <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Number of clips">
                    {CLIP_COUNTS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={maxClips === n}
                        onClick={() => setMaxClips(n)}
                        className={`h-9 rounded-xl text-xs font-bold border transition-all ${
                          maxClips === n
                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/30'
                            : 'bg-slate-950/60 border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-slate-300 font-bold text-[11px] uppercase tracking-wider mb-2">Target Duration</span>
                  <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Clip length">
                    {LENGTHS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={lengthId === l.id}
                        onClick={() => setLengthId(l.id)}
                        className={`h-9 rounded-xl text-[11px] font-bold border transition-all ${
                          lengthId === l.id
                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/30'
                            : 'bg-slate-950/60 border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="qc-focus" className="block text-slate-300 font-bold text-[11px] uppercase tracking-wider mb-1.5">
                  Focus Keyword / Context (Optional)
                </label>
                <input
                  id="qc-focus"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. funny rage moments, ace rounds, storytelling, sudden shock reaction"
                  className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-xs sm:text-sm focus:outline-none focus:border-indigo-500 placeholder:text-slate-600 transition-all"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Template, Styling & Production Configuration (5 cols on desktop) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* 1. Layout Template Card */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="qc-template" className="text-xs font-bold text-slate-200">
                Visual Layout Template
              </label>
              <Link to="/templates" className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
                Design in Studio →
              </Link>
            </div>
            <select
              id="qc-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 transition-all cursor-pointer"
            >
              {templates.length === 0 && <option value="">Loading templates…</option>}
              {templates.map((t) => (
                <option key={t} value={t} className="bg-slate-900 text-white">
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Unified Style & Auto-Edit Studio (Single 9:16 Phone Preview for Captions, Hook Card & Edits) */}
          <CombinedStyleStudio
            captionStyle={captionStyle}
            onCaptionChange={pickCaptionStyle}
            hookStyle={hookStyle}
            onHookChange={pickHookStyle}
            autoEdit={autoEdit}
            onAutoEditChange={setAutoEdit}
            templateDefaultCaption={templateDefaults[template]?.caption_style}
            templateDefaultHook={templateDefaults[template]?.hook_style || 'classic'}
          />

          {/* 5. Mobile & Bottom Action Submit Trigger */}
          <button
            type="submit"
            disabled={submitting || running || !!rangeError || !template || !url.trim()}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-black py-3.5 px-6 rounded-2xl text-sm transition-all shadow-xl shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-95"
          >
            {running || submitting ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {submitting ? 'Starting pipeline…' : running ? 'Clip rendering in background…' : hasRange ? 'Generate Manual Short' : `Generate (${maxClips} Clips)`}
          </button>

          {/* Status & Progress Feedback Banner */}
          {job && (
            <div
              role="status"
              className={`p-4 rounded-2xl border text-sm transition-all shadow-xl ${
                job.state === 'done'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : job.state === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  : job.state === 'empty'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-100'
              }`}
            >
              {job.state === 'running' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 font-semibold text-white">
                    <Loader2 size={16} className="animate-spin text-indigo-400 shrink-0" />
                    <span className="min-w-0 break-words">{job.stepName || 'Processing video…'}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, ((job.step || 1) / 5) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-indigo-200/70">
                    Background job active. You can browse other tabs — your finished clip will appear in Review Station and Telegram.
                  </p>
                </div>
              )}
              {job.state === 'done' && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                    <span className="font-bold text-white">
                      {/clip\(s\) ready/i.test(job.message || '') ? job.message : `Clip #${job.clipId} is complete.`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to="/"
                      className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all"
                    >
                      Review
                    </Link>
                    <Link
                      to={`/clips/${job.clipId}/editor`}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black flex items-center gap-1 transition-all"
                    >
                      <Scissors size={13} /> Edit
                    </Link>
                  </div>
                </div>
              )}
              {(job.state === 'error' || job.state === 'empty') && (
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5 text-rose-400" />
                  <span className="min-w-0 break-words text-xs leading-relaxed">
                    {job.state === 'empty'
                      ? 'No moment scored above your minimum virality score. Try specifying start/end timestamps, or adjust the minimum score threshold in Settings.'
                      : job.message}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
