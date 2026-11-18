import React, { useState } from 'react';
import { AudioLines, ChevronRight, Clock, Users, AlertTriangle } from 'lucide-react';
import { Progress } from '../ui';
import { MODE_LABEL } from './model';

export const YoutubeIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export const PLATFORM = {
  youtube: { label: 'YouTube', icon: YoutubeIcon, color: '#ff3b3b' },
  tiktok: { label: 'TikTok', icon: AudioLines, color: '#25f4ee' },
  twitch: { label: 'Twitch', color: '#a970ff' },
  kick: { label: 'Kick', color: '#53fc18' },
};

const initials = (s) => String(s || '?').replace(/^@/, '').slice(0, 2).toUpperCase();

/** Round avatar with an image fallback to initials, and an optional platform badge in the corner. */
export function Avatar({ src, name, size = 40, platform, dim = false }) {
  const [broken, setBroken] = useState(false);
  const p = PLATFORM[platform];
  const Icon = p?.icon;
  return (
    <span className={`relative inline-flex shrink-0 ${dim ? 'opacity-45 grayscale' : ''}`} style={{ width: size, height: size }}>
      {src && !broken ? (
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)}
          className="w-full h-full rounded-full object-cover border border-line-strong" />
      ) : (
        <span className="w-full h-full rounded-full bg-raised border border-line-strong flex items-center justify-center font-bold text-muted"
          style={{ fontSize: Math.max(9, size * 0.32) }}>{initials(name)}</span>
      )}
      {Icon && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-canvas flex items-center justify-center border border-line"
          style={{ width: Math.max(14, size * 0.42), height: Math.max(14, size * 0.42), color: p.color }}>
          <Icon size={Math.max(8, size * 0.24)} />
        </span>
      )}
    </span>
  );
}

function ModeTag({ dest }) {
  const raw = dest.raw;
  const tone = dest.mode === 'on' || dest.mode === 'direct' ? 'text-good bg-good/12' : dest.mode === 'trial' ? 'text-accent bg-accent/12' : 'text-muted bg-white/[0.05]';
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded-md text-[11px] font-semibold ${tone}`}>
      {MODE_LABEL[dest.mode] || dest.mode}
      {dest.platform === 'youtube' && dest.mode !== 'off' && <span className="ml-1 opacity-80 tabular-nums">≥{raw.min_score_threshold || 75}</span>}
    </span>
  );
}

/** One connected YouTube channel / TikTok account. The whole card opens its settings. */
export function DestinationCard({ dest, streamers, onOpen }) {
  const raw = dest.raw;
  const quota = raw.quota;
  const pct = quota ? Math.round((quota.used / Math.max(1, quota.limit)) * 100) : 0;
  return (
    <button type="button" onClick={onOpen} data-testid={`dest-${dest.id}`}
      className="group text-left w-full rounded-2xl border border-line bg-surface hover:border-line-strong hover:bg-raised/60 transition-colors p-3.5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar src={dest.avatar} name={dest.title} platform={dest.platform} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink truncate">{dest.title}</div>
          <div className="text-[11.5px] text-muted truncate">{dest.handle}</div>
        </div>
        <ChevronRight size={16} className="text-faint group-hover:text-ink shrink-0" />
      </div>

      {!dest.ok && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-bad"><AlertTriangle size={13} /> Login expired - reconnect</div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <ModeTag dest={dest} />
        {dest.platform === 'youtube' && (
          <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-white/[0.05] text-[11px] text-slate-300 tabular-nums">
            <Clock size={11} /> {(raw.publish_slots || []).length} slots · {raw.daily_cap || 3}/day
          </span>
        )}
        <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] tabular-nums ${streamers ? 'bg-white/[0.05] text-slate-300' : 'bg-warn/12 text-warn'}`}>
          <Users size={11} /> {streamers ? `${streamers} streamer${streamers === 1 ? '' : 's'}` : 'No streamers'}
        </span>
      </div>

      {dest.platform === 'youtube' && (
        <div className="mt-auto">
          <div className="flex justify-between text-[10.5px] text-muted mb-1">
            <span>{raw.upcoming_posts || 0} queued</span>
            {quota && <span className="tabular-nums">{quota.uploads_left_today} uploads left today</span>}
          </div>
          <Progress value={pct} tone={pct >= 85 ? 'bad' : pct >= 60 ? 'warn' : 'good'} />
        </div>
      )}
    </button>
  );
}
