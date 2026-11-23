import React from 'react';
import { Pause, Play, Settings, Tv, Send, Plus, ExternalLink, Tag } from 'lucide-react';
import { Pill, Button, IconButton } from '../ui';
import { Avatar } from '../distribution/parts';

const MAX_CHIPS = 4;

export const streamUrl = (c) => ((c.platform || 'twitch').toLowerCase() === 'twitch'
  ? `https://twitch.tv/${c.channel_id_or_handle}` : `https://youtube.com/@${c.channel_id_or_handle}`);

/** One streamer: who it is, whether it's live, and where its clips post - one tap to change any of it. */
export default function StreamerCard({ c, info = {}, posts, onOpen, onPosting, onPauseToggle, onWatch }) {
  const enabled = c.enabled === 1;
  const isLive = enabled && info.is_live;
  const name = c.display_name || c.channel_id_or_handle;
  const shown = posts.slice(0, MAX_CHIPS);
  const extra = posts.length - shown.length;
  return (
    <article data-testid="streamer-card" data-handle={c.channel_id_or_handle}
      className={`rounded-2xl border bg-surface p-3.5 flex flex-col gap-3 min-w-0 transition-colors ${
        isLive ? 'border-bad/40' : !enabled ? 'border-warn/30 opacity-80' : 'border-line hover:border-line-strong'}`}>
      <button type="button" onClick={onOpen} className="flex items-center gap-3 min-w-0 text-left" aria-label={`Open ${name} settings`}>
        <Avatar src={c.avatar_url} name={name} platform={(c.platform || 'twitch').toLowerCase()} size={46} dim={!enabled} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[14px] text-ink truncate">{name}</span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted min-w-0">
            <span className="font-mono truncate">@{c.channel_id_or_handle}</span>
            <span className="inline-flex items-center gap-0.5 shrink-0 text-accent"><Tag size={10} />{c.group_tag || 'General'}</span>
          </span>
        </span>
        <span className="shrink-0">
          {!enabled ? <Pill tone="warn">Paused</Pill> : isLive ? <Pill tone="bad"><span className="font-bold">LIVE</span></Pill> : <Pill tone="idle">Offline</Pill>}
        </span>
      </button>

      {isLive && info.title && <p className="text-[12px] text-slate-300 line-clamp-1 bg-white/[0.03] rounded-lg px-2.5 py-1.5">{info.title}</p>}

      <dl className="grid grid-cols-3 gap-1.5 text-[11px]">
        {[
          ['Layout', c.template_name || '-', 'text-accent'],
          ['Chat', isLive && info.current_mps ? `${info.current_mps.toFixed(1)}/s` : '-', 'text-ink'],
          ['Clips today', c.clips_today || 0, 'text-good'],
        ].map(([k, v, cls]) => (
          <div key={k} className="rounded-lg bg-canvas px-2 py-1.5 min-w-0">
            <dt className="text-[10px] text-faint">{k}</dt>
            <dd className={`font-semibold tabular-nums truncate ${cls}`} title={String(v)}>{v}</dd>
          </div>
        ))}
      </dl>

      {/* Where its clips go */}
      {posts.length ? (
        <button type="button" onClick={onPosting} data-testid="posts-to"
          className="flex items-center gap-2 min-h-[44px] rounded-xl bg-canvas hover:bg-raised px-2.5 text-left">
          <Send size={13} className="text-muted shrink-0" />
          <span className="text-[11.5px] text-muted shrink-0">Posts to</span>
          <span className="flex items-center -space-x-1.5 min-w-0">
            {shown.map((d) => <span key={d.id} title={`${d.title} (${d.platform})`}><Avatar src={d.avatar} name={d.title} platform={d.platform} size={26} /></span>)}
          </span>
          {extra > 0 && <span className="text-[11px] text-muted">+{extra}</span>}
          <span className="ml-auto text-[11px] text-accent font-semibold shrink-0">Change</span>
        </button>
      ) : (
        <button type="button" onClick={onPosting} data-testid="posts-to"
          className="flex items-center gap-2 min-h-[44px] rounded-xl bg-warn/10 hover:bg-warn/15 border border-warn/25 px-2.5 text-left">
          <Send size={13} className="text-warn shrink-0" />
          <span className="text-[12px] text-warn font-semibold">Not posting anywhere</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-warn font-semibold"><Plus size={13} />Choose</span>
        </button>
      )}

      <div className="flex items-center gap-1.5 pt-0.5">
        {isLive && <Button size="sm" variant="danger" icon={Tv} onClick={onWatch}>Watch</Button>}
        <a href={streamUrl(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 min-h-[36px] px-1.5 text-[11.5px] text-muted hover:text-ink">
          Stream <ExternalLink size={11} />
        </a>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={enabled ? 'ghost' : 'good'} icon={enabled ? Pause : Play} onClick={onPauseToggle}>{enabled ? 'Pause' : 'Resume'}</Button>
          <IconButton icon={Settings} label={`${name} settings`} size="sm" variant="secondary" onClick={onOpen} />
        </div>
      </div>
    </article>
  );
}
