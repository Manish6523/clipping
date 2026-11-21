import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Pencil, Hash, Clock, Radio, Film, CalendarClock, AlertTriangle, Copy } from 'lucide-react';
import { Badge } from '../ui';
import ScoreBreakdown from '../ScoreBreakdown';
import { statusMeta, scoreOf, scoreTone, parseFlags, normalizeHashtags, clipLength, timeAgo, sourceLabel } from './model';

const FLAG_TONE = { high: 'bad', medium: 'warn', low: 'idle' };

/** A text field that edits in place and saves on blur / Enter (Esc cancels). */
function EditableText({ label, value, onSave, multiline = false, placeholder, transform, testid, maxLength }) {
  const [draft, setDraft] = useState(value || '');
  const [state, setState] = useState('idle');     // idle | saving | saved
  useEffect(() => { setDraft(value || ''); }, [value]);

  const commit = async () => {
    const next = transform ? transform(draft) : draft.trim();
    if (transform) setDraft(next);
    if (next === (value || '')) return;
    setState('saving');
    const ok = await onSave(next);
    setState(ok ? 'saved' : 'idle');
    if (ok) setTimeout(() => setState('idle'), 1500);
  };
  const common = {
    value: draft,
    placeholder,
    maxLength,
    'data-testid': testid,
    'aria-label': label,
    onChange: (e) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e) => {
      e.stopPropagation();                                   // typing never triggers page shortcuts
      if (e.key === 'Escape') { setDraft(value || ''); e.currentTarget.blur(); }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
    },
    className: 'w-full rounded-lg bg-white/[0.03] border border-transparent hover:border-line focus:border-accent focus:bg-canvas px-2 py-1.5 text-ink outline-none transition-colors',
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">{label}</span>
        <span className="text-[10.5px] text-muted h-4 flex items-center gap-1">
          {state === 'saving' && <><Loader2 size={11} className="animate-spin" />Saving</>}
          {state === 'saved' && <><Check size={11} className="text-good" />Saved</>}
          {state === 'idle' && <Pencil size={10} className="opacity-50" />}
        </span>
      </div>
      {multiline
        ? <textarea rows={3} {...common} className={`${common.className} text-[12.5px] leading-relaxed resize-y min-h-[72px]`} />
        : <input type="text" {...common} className={`${common.className} text-[14px] font-semibold`} />}
    </div>
  );
}

function Meta({ icon: Icon, children }) {
  return <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Icon size={12} className="shrink-0" />{children}</span>;
}

/** Everything about a clip, with title / description / hashtags editable in place. */
export default function ClipDetails({ clip, actions, compact = false }) {
  const [copied, setCopied] = useState(false);
  if (!clip) return null;
  const score = scoreOf(clip);
  const m = statusMeta(clip.status);
  const flags = parseFlags(clip.flags);
  const len = clipLength(clip);
  const tags = String(clip.hashtags || '').split(/\s+/).filter(Boolean);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText([clip.title, clip.description, clip.hashtags].filter(Boolean).join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div className="space-y-3" data-testid="clip-details">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={m.tone}>{m.label}</Badge>
        <Badge tone={scoreTone(score)}>Score {score}</Badge>
        <span className="text-[11.5px] text-muted">#{clip.id}</span>
        <button type="button" onClick={copyAll} className="ml-auto inline-flex items-center gap-1 h-8 px-2 rounded-lg text-[11.5px] text-muted hover:text-ink hover:bg-white/5"
          aria-label="Copy title, description and hashtags">
          {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy text'}
        </button>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Meta icon={Radio}>@{clip.channel_id || 'unknown'}</Meta>
        {sourceLabel(clip) && <Meta icon={Film}>{sourceLabel(clip)}</Meta>}
        {len && <Meta icon={Clock}>{len}s</Meta>}
        <Meta icon={Clock}>{timeAgo(clip.created_at)}</Meta>
        {clip.scheduled_for && <Meta icon={CalendarClock}>Posts {new Date(clip.scheduled_for).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Meta>}
        {clip.published_at && <Meta icon={CalendarClock}>Published {timeAgo(clip.published_at)}</Meta>}
      </div>

      <EditableText label="Title" value={clip.title} maxLength={100} testid="edit-title"
        onSave={(v) => actions.save(clip, { title: v })} placeholder="Clip title" />
      <EditableText label="Description" value={clip.description} multiline testid="edit-description"
        onSave={(v) => actions.save(clip, { description: v })} placeholder="What happens in this clip" />
      <EditableText label="Hashtags" value={clip.hashtags} testid="edit-hashtags" transform={normalizeHashtags}
        onSave={(v) => actions.save(clip, { hashtags: v })} placeholder="#shorts #funny - '#' is added for you" />
      {tags.length > 0 && !compact && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => <span key={t} className="inline-flex items-center gap-0.5 rounded-md bg-accent/10 text-accent text-[11px] px-1.5 py-0.5"><Hash size={10} />{t.replace(/^#/, '')}</span>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
        <div className="rounded-lg bg-white/[0.03] px-2 py-1.5"><span className="block text-muted">Template</span><span className="text-ink truncate block">{clip.template_name || '-'}</span></div>
        <div className="rounded-lg bg-white/[0.03] px-2 py-1.5"><span className="block text-muted">Captions · Hook</span>
          <span className="text-ink truncate block">{clip.caption_style || 'template'} · {clip.hook_style || 'template'}</span></div>
      </div>

      {flags.length > 0 && (
        <div className="space-y-1">
          {flags.map((f, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11.5px]">
              <AlertTriangle size={12} className={`mt-0.5 shrink-0 text-${FLAG_TONE[f.severity] || 'idle'}`} />
              <span className="text-slate-300">{f.note || f.type}</span>
            </div>
          ))}
        </div>
      )}
      {clip.last_render_error && <p className="text-[11.5px] text-bad">Last render failed: {clip.last_render_error}</p>}
      {clip.rejection_reason && <p className="text-[11.5px] text-muted">Rejected as: {clip.rejection_reason}</p>}

      {clip.score_breakdown && (
        <details className="rounded-lg bg-white/[0.03] px-2 py-1.5" open={!compact}>
          <summary className="cursor-pointer text-[11.5px] text-muted select-none">Why this score</summary>
          <div className="mt-1.5"><ScoreBreakdown raw={clip.score_breakdown} compact /></div>
        </details>
      )}
      <Link to={`/clips/${clip.id}/editor`} className="block text-[11.5px] text-accent">Fix captions, trim or re-crop in the editor →</Link>
    </div>
  );
}
