import React, { useMemo, useState } from 'react';
import { Check, Search, Share2, Radio } from 'lucide-react';
import { Panel, Input, EmptyState } from '../ui';
import { Avatar, PLATFORM } from './parts';
import { routeKey } from './model';

function Cell({ on, busy, onClick, label }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} title={label} onClick={onClick} disabled={busy}
      className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors disabled:opacity-50 ${
        on ? 'bg-accent-strong border-accent-strong text-white' : 'border-line-strong text-transparent hover:border-accent/60 hover:text-accent/50'}`}>
      <Check size={16} strokeWidth={3} />
    </button>
  );
}

/** Who posts where: one row per streamer, one column per destination. Phone: a chip row per streamer. */
export default function RoutingBoard({ channels, destinations, routes, pending, onToggle }) {
  const [q, setQ] = useState('');
  const [onlyUnrouted, setOnlyUnrouted] = useState(false);

  const countFor = (h) => destinations.filter((d) => routes.has(routeKey(d, h))).length;
  const unrouted = channels.filter((c) => countFor(c.channel_id_or_handle) === 0).length;

  const rows = useMemo(() => channels
    .filter((c) => !q || `${c.display_name} ${c.channel_id_or_handle}`.toLowerCase().includes(q.toLowerCase()))
    .filter((c) => !onlyUnrouted || countFor(c.channel_id_or_handle) === 0)
    .sort((a, b) => (a.display_name || a.channel_id_or_handle).localeCompare(b.display_name || b.channel_id_or_handle)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [channels, q, onlyUnrouted, routes, destinations]);

  const toolbar = (
    <div className="flex items-center gap-2">
      {unrouted > 0 && (
        <button type="button" onClick={() => setOnlyUnrouted((v) => !v)} aria-pressed={onlyUnrouted}
          className={`h-8 px-2.5 rounded-lg text-[11.5px] font-semibold border whitespace-nowrap ${onlyUnrouted ? 'bg-warn/15 border-warn/40 text-warn' : 'border-line-strong text-warn'}`}>
          {unrouted} not posting
        </button>
      )}
      <div className="relative hidden sm:block">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find streamer" aria-label="Find streamer" className="!h-8 !w-44 !pl-8 !text-xs" />
      </div>
    </div>
  );

  if (!channels.length) {
    return <Panel title="Who posts where" icon={Share2}><EmptyState icon={Radio} title="No streamers yet" text="Add streamers in the Streamers tab, then route their clips here." className="!py-6" /></Panel>;
  }
  if (!destinations.length) {
    return <Panel title="Who posts where" icon={Share2}><EmptyState icon={Share2} title="Nowhere to post yet" text="Connect a YouTube channel, Instagram or TikTok account first." className="!py-6" /></Panel>;
  }

  return (
    <Panel title="Who posts where" icon={Share2} right={toolbar} data-testid="routing-board">
      <p className="text-[11.5px] text-muted -mt-1.5 mb-3">Tick where each streamer's approved clips go. Several destinations = one scheduled copy each.</p>

      {/* Desktop / tablet: grid */}
      <div className="hidden md:block overflow-x-auto -mx-1 px-1">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted pb-2 pr-3">Streamer</th>
              {destinations.map((d) => (
                <th key={d.id} className="pb-2 px-1 align-bottom">
                  <div className="flex flex-col items-center gap-1 w-[76px] mx-auto" title={`${d.title} (${PLATFORM[d.platform].label})`}>
                    <Avatar src={d.avatar} name={d.title} platform={d.platform} size={28} dim={!d.ok} />
                    <span className="text-[10.5px] font-medium text-slate-300 truncate max-w-full">{d.title}</span>
                  </div>
                </th>
              ))}
              <th className="pb-2 pl-2 text-right text-[10.5px] font-semibold uppercase tracking-wide text-muted">Posts to</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const h = c.channel_id_or_handle;
              const n = countFor(h);
              return (
                <tr key={h} className="group" data-testid={`route-row-${h}`}>
                  <td className="sticky left-0 z-10 bg-surface group-hover:bg-raised/70 border-t border-line py-2 pr-3 rounded-l-xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={c.avatar_url} name={c.display_name || h} platform={c.platform} size={30} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ink truncate max-w-[220px]">{c.display_name || h}</div>
                        {c.group_tag && <div className="text-[10.5px] text-muted truncate max-w-[220px]">{c.group_tag}</div>}
                      </div>
                    </div>
                  </td>
                  {destinations.map((d) => {
                    const k = routeKey(d, h);
                    return (
                      <td key={d.id} className="border-t border-line group-hover:bg-raised/70 py-2 px-1 text-center">
                        <div className="flex justify-center">
                          <Cell on={routes.has(k)} busy={pending.has(k)} onClick={() => onToggle(d, h)}
                            label={`${c.display_name || h} → ${d.title}`} />
                        </div>
                      </td>
                    );
                  })}
                  <td className="border-t border-line group-hover:bg-raised/70 py-2 pl-2 text-right rounded-r-xl whitespace-nowrap">
                    {n ? <span className="text-[12px] text-slate-300 tabular-nums">{n}</span>
                      : <span className="text-[11.5px] font-semibold text-warn">Nowhere</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per streamer, destination chips */}
      <div className="md:hidden flex flex-col gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find streamer" aria-label="Find streamer (phone)" className="!pl-8" />
        </div>
        {rows.map((c) => {
          const h = c.channel_id_or_handle;
          const n = countFor(h);
          return (
            <div key={h} className="rounded-xl border border-line bg-canvas p-3" data-testid={`route-card-${h}`}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <Avatar src={c.avatar_url} name={c.display_name || h} platform={c.platform} size={30} />
                <span className="text-[13.5px] font-semibold text-ink truncate flex-1">{c.display_name || h}</span>
                {!n && <span className="text-[11px] font-semibold text-warn">Not posting</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {destinations.map((d) => {
                  const k = routeKey(d, h);
                  const on = routes.has(k);
                  return (
                    <button key={d.id} type="button" aria-pressed={on} disabled={pending.has(k)} onClick={() => onToggle(d, h)}
                      className={`h-10 pl-1.5 pr-3 rounded-full border inline-flex items-center gap-2 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                        on ? 'bg-accent-strong border-accent-strong text-white' : 'border-line-strong text-slate-300'}`}>
                      <Avatar src={d.avatar} name={d.title} platform={d.platform} size={26} />
                      <span className="truncate max-w-[130px]">{d.title}</span>
                      {on && <Check size={13} strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {!rows.length && <p className="text-[12px] text-muted py-4 text-center">No streamers match.</p>}
    </Panel>
  );
}
