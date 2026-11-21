import React from 'react';
import { Check, X, SkipForward, Send, Scissors, Download, Palette, Info, Trash2, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Which actions a clip offers, in order. Same list for the grid, the details sheet and the reels rail. */
export function clipActions(clip, { onSkip, onDetails, onPublish, onStyle, onEdits, actions, navigate, rail = false }) {
  const reviewable = ['pending_approval', 'approved'].includes(clip.status);
  const list = [];
  if (reviewable) list.push({ id: 'approve', label: 'Approve', key: 'A', icon: Check, tone: 'good', run: () => actions.approve(clip) });
  list.push({ id: 'reject', label: reviewable ? 'Reject' : 'Delete', key: 'R', icon: reviewable ? X : Trash2, tone: 'bad', run: () => actions.reject(clip) });
  if (onSkip) list.push({ id: 'skip', label: 'Skip', key: 'S', icon: SkipForward, run: onSkip });
  if (clip.status !== 'published') list.push({ id: 'publish', label: 'Publish', key: 'P', icon: Send, tone: 'accent', run: () => onPublish(clip) });
  list.push({ id: 'edit', label: 'Edit', key: 'E', icon: Scissors, run: () => navigate(`/clips/${clip.id}/editor`) });
  list.push({ id: 'style', label: 'Style', icon: Palette, run: () => onStyle(clip) });
  if (onEdits) list.push({ id: 'edits', label: 'Edits', icon: Wand2, run: () => onEdits(clip) });
  list.push({ id: 'download', label: 'Save', icon: Download, disabled: !clip.download_url, run: () => actions.download(clip) });
  if (rail && onDetails) list.push({ id: 'details', label: 'Details', key: 'D', icon: Info, run: () => onDetails(clip) });
  return list;
}

const TONE = {
  good: 'bg-good/15 text-good hover:bg-good/25',
  bad: 'bg-bad/15 text-bad hover:bg-bad/25',
  accent: 'bg-accent/15 text-accent hover:bg-accent/25',
  undefined: 'bg-white/[0.06] text-ink hover:bg-white/10',
};

/** Horizontal action grid (details panel / sheet). */
export default function ClipActionBar({ clip, busy, ...opts }) {
  const navigate = useNavigate();
  if (!clip) return null;
  const list = clipActions(clip, { ...opts, navigate });
  return (
    <div className="grid grid-cols-4 gap-1.5" data-testid="clip-actions">
      {list.map((a) => (
        <button key={a.id} type="button" onClick={a.run} disabled={a.disabled || (busy && a.id === 'style')}
          title={a.key ? `${a.label} (${a.key})` : a.label} data-action={a.id}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-xl text-[11px] font-semibold transition-colors disabled:opacity-40 ${TONE[a.tone]}`}>
          <a.icon size={17} />{a.label}
        </button>
      ))}
    </div>
  );
}
