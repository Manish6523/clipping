import { Clock, Check, Send, XCircle, Film } from 'lucide-react';

export const STATUS_TABS = [
  { value: 'pending_approval', label: 'To review' },
  { value: 'approved', label: 'Approved' },
  { value: 'queued', label: 'Queued' },
  { value: 'published', label: 'Published' },
  { value: 'all', label: 'All' },
];

const STATUS_META = {
  pending_approval: { label: 'To review', tone: 'warn', icon: Clock },
  approved: { label: 'Approved', tone: 'good', icon: Check },
  queued: { label: 'Queued', tone: 'accent', icon: Send },
  published: { label: 'Published', tone: 'good', icon: Send },
  rejected: { label: 'Rejected', tone: 'bad', icon: XCircle },
};
export const statusMeta = (s) => STATUS_META[s] || { label: s || 'unknown', tone: 'idle', icon: Film };

export const REASONS = [
  { code: 'boring', label: 'Boring' },
  { code: 'no_context', label: 'No context' },
  { code: 'bad_start', label: 'Bad start' },
  { code: 'bad_end', label: 'Bad end' },
  { code: 'bad_crop', label: 'Bad crop' },
  { code: 'audio', label: 'Audio' },
  { code: 'duplicate', label: 'Duplicate' },
  { code: 'unsafe', label: 'Unsafe' },
];

export const SORTS = [
  { value: 'new', label: 'Newest' },
  { value: 'score', label: 'Top score' },
  { value: 'old', label: 'Oldest' },
];

export const scoreOf = (c) => Math.round(Number(c?.final_score ?? c?.virality_score ?? 0));
export const scoreTone = (s) => (s >= 85 ? 'good' : s >= 70 ? 'warn' : 'bad');

export function parseFlags(raw) {
  try {
    const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(f) ? f.filter((x) => x && typeof x === 'object') : [];
  } catch {
    return [];
  }
}

/** "#a #b" from anything typed: words, commas, missing '#', duplicates - same rules as the server. */
export function normalizeHashtags(text) {
  const out = [];
  const seen = new Set();
  for (const w of String(text || '').split(/[\s,;]+/)) {
    const tag = w.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(`#${tag}`);
  }
  return out.slice(0, 30).join(' ');
}

export const clipLength = (c) => {
  const s = Number(c?.raw_start ?? 0);
  const e = Number(c?.raw_end ?? 0);
  return e > s ? Math.round(e - s) : null;
};

export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const sourceLabel = (c) => {
  if (c?.source_type === 'live') return 'Live';
  if (String(c?.source_id || '').startsWith('manual_') || c?.channel_id === 'manual') return 'Quick Clip';
  if (c?.source_type === 'vod') return 'VOD';
  return c?.source_type || '';
};
