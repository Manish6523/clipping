import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Radio, Plus, Search, Send, Key, ChevronRight, AlertTriangle, CheckCircle2, X, Activity, Users, Gauge } from 'lucide-react';
import { Page, Panel, Button, Input, Select, Notice, Skeleton, Dot, Sheet, Field, Checkbox, EmptyState } from '../ui';
import { DestinationCard, PLATFORM, YoutubeIcon } from '../distribution/parts';
import RoutingBoard from '../distribution/RoutingBoard';
import { ConnectSheet, DestinationSheet, AppSetupSheet } from '../distribution/sheets';
import { routeKey } from '../distribution/model';
import { useHub } from './useHub';
import StreamerCard from './StreamerCard';
import StreamerSheet from './StreamerSheet';
import AddStreamerSheet from './AddStreamerSheet';

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'unrouted', label: 'Not posting' },
  { value: 'paused', label: 'Paused' },
];

function SummaryStrip({ hub, tab, setTab }) {
  const s = hub.summary;
  const item = (icon, label, value, tone, onClick, testid) => {
    const Icon = icon;
    return (
      <button type="button" onClick={onClick} data-testid={testid}
        className="flex items-center gap-2 min-w-0 rounded-xl bg-surface border border-line hover:border-line-strong px-3 py-2 text-left">
        <Icon size={15} className={tone ? `text-${tone}` : 'text-muted'} />
        <span className="min-w-0">
          <span className={`block text-[15px] font-bold tabular-nums leading-tight ${tone ? `text-${tone}` : 'text-ink'}`}>{value}</span>
          <span className="block text-[10.5px] text-muted truncate">{label}</span>
        </span>
      </button>
    );
  };
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-testid="hub-summary">
      {item(Radio, `watching · ${s.paused} paused`, `${s.live} live / ${s.watching}`, s.live ? 'bad' : null, () => setTab('streamers', 'live'), 'sum-live')}
      {item(Users, s.unrouted ? `${s.unrouted} not posting anywhere` : 'every streamer posts', `${s.routed}/${hub.channels.length} posting`, s.unrouted ? 'warn' : null,
        () => setTab('streamers', s.unrouted ? 'unrouted' : 'all'), 'sum-routed')}
      {item(Send, s.broken.length ? `${s.broken.length} need reconnecting` : 'posting accounts', `${hub.destinations.length} accounts`, s.broken.length ? 'bad' : null,
        () => setTab('accounts'), 'sum-accounts')}
      {item(Gauge, 'YouTube uploads left today', s.uploadsLeft ?? '–', s.uploadsLeft === 0 ? 'warn' : null, () => setTab('accounts'), 'sum-quota')}
    </div>
  );
}

/**
 * Streamers: who the clipper watches and where each one's clips post - one page, two tabs.
 *   Streamers - cards with live status + "Posts to"; one sheet per streamer (posting, rules, AI, profile)
 *   Accounts  - YouTube / Instagram / TikTok accounts, the who-posts-where grid, platform apps
 * /channels and /accounts both land here (the tab comes from the URL), so old links keep working.
 */
export default function StreamersHub() {
  const hub = useHub();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (location.pathname.startsWith('/accounts') ? 'accounts' : 'streamers');
  const [view, setView] = useState('all');
  const [group, setGroup] = useState('all');
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [destId, setDestId] = useState(null);
  const [setup, setSetup] = useState(null);
  const [pauseFor, setPauseFor] = useState(null);
  const [pauseReason, setPauseReason] = useState('Manual pause');
  const [pauseNow, setPauseNow] = useState(false);
  const [watch, setWatch] = useState(null);

  const openHandle = params.get('streamer');
  const sheetTab = params.get('s') || 'posting';
  const openStreamer = hub.channels.find((c) => c.channel_id_or_handle === openHandle) || null;

  const setTab = (t, v) => {
    navigate(t === 'accounts' ? '/channels?tab=accounts' : '/channels', { replace: true });
    if (v) setView(v);
  };
  const openSheet = (handle, s = 'posting') => {
    const p = new URLSearchParams(params);
    p.set('streamer', handle);
    p.set('s', s);
    setParams(p, { replace: !!openHandle });
  };
  const closeSheet = () => {
    const p = new URLSearchParams(params);
    p.delete('streamer'); p.delete('s');
    setParams(p, { replace: true });
  };

  // Back from Google sign-in: /accounts?connected=<key>
  useEffect(() => {
    const connected = params.get('connected');
    if (connected) {
      hub.say(`YouTube channel "${connected}" connected - switch it on for the streamers that should post to it.`);
      const p = new URLSearchParams(params);
      p.delete('connected');
      setParams(p, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map();
    hub.channels.forEach((c) => { const g = c.group_tag || 'General'; m.set(g, (m.get(g) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [hub.channels]);

  const isLive = (c) => c.enabled === 1 && (hub.live[c.channel_id_or_handle] || {}).is_live;
  const counts = {
    all: hub.channels.length,
    live: hub.channels.filter(isLive).length,
    unrouted: hub.summary.unrouted,
    paused: hub.summary.paused,
  };
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@/, '');
    return hub.channels
      .filter((c) => group === 'all' || (c.group_tag || 'General') === group)
      .filter((c) => !needle || `${c.display_name || ''} ${c.channel_id_or_handle}`.toLowerCase().includes(needle))
      .filter((c) => view === 'all'
        || (view === 'live' && isLive(c))
        || (view === 'paused' && c.enabled !== 1)
        || (view === 'unrouted' && hub.postsTo(c.channel_id_or_handle).length === 0))
      .sort((a, b) => {
        const rank = (c) => (isLive(c) ? 0 : c.enabled === 1 ? 1 : 2);
        return rank(a) - rank(b) || (a.display_name || a.channel_id_or_handle).localeCompare(b.display_name || b.channel_id_or_handle);
      });
  }, [hub.channels, hub.live, hub.routes, group, q, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDest = hub.destinations.find((d) => d.id === destId) || null;
  const streamersOf = (d) => hub.channels.filter((c) => hub.routes.has(routeKey(d, c.channel_id_or_handle))).length;
  const connect = () => { closeSheet(); setAddOpen(false); setConnectOpen(true); };

  return (
    <Page title="Streamers" icon={Radio}
      subtitle="Who the clipper watches, and where each streamer's clips get posted."
      actions={(
        <>
          <Link to="/telemetry" className="hidden sm:block"><Button icon={Activity}>Live Pulse</Button></Link>
          {tab === 'accounts'
            ? <Button variant="primary" icon={Plus} onClick={() => setConnectOpen(true)} data-testid="connect-open">Connect account</Button>
            : <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)} data-testid="add-open">Add streamer</Button>}
        </>
      )}>

      {hub.toast && (
        <Notice tone={hub.toast.tone} icon={hub.toast.tone === 'good' ? CheckCircle2 : AlertTriangle}>
          <span className="flex items-center gap-3">{hub.toast.text}
            <button type="button" aria-label="Dismiss" className="ml-auto text-muted hover:text-ink" onClick={() => hub.setToast(null)}><X size={14} /></button>
          </span>
        </Notice>
      )}
      {hub.summary.broken.length > 0 && (
        <Notice tone="bad" icon={AlertTriangle}>
          <span>{hub.summary.broken.map((d) => d.title).join(', ')} {hub.summary.broken.length === 1 ? 'needs' : 'need'} reconnecting - clips queued for {hub.summary.broken.length === 1 ? 'it' : 'them'} won't upload.</span>
          {tab !== 'accounts' && <button type="button" className="ml-2 underline" onClick={() => setTab('accounts')}>Open Accounts</button>}
        </Notice>
      )}

      {hub.loaded ? <SummaryStrip hub={hub} tab={tab} setTab={setTab} /> : <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[54px] rounded-xl" />)}</div>}

      <div role="tablist" aria-label="Section" className="flex gap-1 border-b border-line">
        {[['streamers', `Streamers`, hub.channels.length], ['accounts', 'Posting accounts', hub.destinations.length]].map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`}
            className={`relative h-11 px-3 text-[13px] font-semibold ${tab === id ? 'text-ink' : 'text-muted hover:text-ink'}`}>
            {label} <span className="text-muted font-normal tabular-nums">{hub.loaded ? n : ''}</span>
            {tab === id && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {tab === 'streamers' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label="Show">
              {VIEWS.map((v) => (
                <button key={v.value} type="button" role="tab" aria-selected={view === v.value} onClick={() => setView(v.value)}
                  className={`h-9 px-3 rounded-full text-[12px] font-semibold whitespace-nowrap border ${
                    view === v.value ? 'bg-white/[0.12] border-white/15 text-ink' : 'border-line text-muted hover:text-ink'} ${
                    v.value === 'unrouted' && counts.unrouted ? '!text-warn' : ''}`}>
                  {v.label} <span className="tabular-nums opacity-80">{hub.loaded ? counts[v.value] : ''}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 sm:ml-auto">
              {groups.length > 1 && (
                <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group" className="!h-9 !w-auto !text-[12px]">
                  <option value="all">All groups</option>
                  {groups.map(([g, n]) => <option key={g} value={g}>{g} ({n})</option>)}
                </Select>
              )}
              <div className="relative flex-1 sm:w-56">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find streamer" aria-label="Find streamer" className="!h-9 !pl-8 !text-[13px]" />
              </div>
            </div>
          </div>

          {!hub.loaded ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}</div>
          ) : list.length === 0 ? (
            <Panel>
              <EmptyState icon={Radio} title={hub.channels.length ? 'Nobody matches' : 'No streamers yet'}
                text={hub.channels.length ? 'Try another filter or search.' : 'Add a streamer to start watching for live moments.'}
                action={hub.channels.length
                  ? <Button onClick={() => { setView('all'); setGroup('all'); setQ(''); }}>Show everyone</Button>
                  : <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>Add streamer</Button>} />
            </Panel>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="streamer-grid">
              {list.map((c) => (
                <StreamerCard key={c.channel_id_or_handle} c={c} info={hub.live[c.channel_id_or_handle]}
                  posts={hub.postsTo(c.channel_id_or_handle)}
                  onOpen={() => openSheet(c.channel_id_or_handle, 'rules')}
                  onPosting={() => openSheet(c.channel_id_or_handle, 'posting')}
                  onPauseToggle={() => (c.enabled === 1 ? (setPauseFor(c), setPauseReason('Manual pause'), setPauseNow(false)) : hub.resume(c.channel_id_or_handle))}
                  onWatch={() => setWatch(c)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Panel title="Posting accounts" icon={Send} right={hub.destinations.length > 0 && <span className="text-[11px] text-muted hidden sm:inline">Tap one for its schedule and rules</span>}>
            {!hub.loaded ? (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
            ) : hub.destinations.length === 0 ? (
              <div className="text-center py-8">
                <div className="flex justify-center gap-2 mb-3">
                  <span className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#ff3b3b]/12 text-[#ff3b3b]"><YoutubeIcon size={22} /></span>
                  <span className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#e1306c]/12 text-[#e1306c]"><PLATFORM.instagram.icon size={22} /></span>
                  <span className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#25f4ee]/12 text-[#25f4ee]"><PLATFORM.tiktok.icon size={22} /></span>
                </div>
                <p className="text-[14px] font-semibold text-ink">Nothing connected yet</p>
                <p className="text-[12px] text-muted mt-1 mb-4">Connect a YouTube channel, Instagram or TikTok account to start posting clips.</p>
                <Button variant="primary" icon={Plus} onClick={() => setConnectOpen(true)}>Connect account</Button>
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {hub.destinations.map((d) => <DestinationCard key={d.id} dest={d} streamers={streamersOf(d)} onOpen={() => setDestId(d.id)} />)}
                <button type="button" onClick={() => setConnectOpen(true)}
                  className="rounded-2xl border border-dashed border-line-strong text-muted hover:text-ink hover:border-accent/60 min-h-[120px] flex flex-col items-center justify-center gap-1.5 text-[12.5px] font-semibold">
                  <Plus size={20} /> Connect another
                </button>
              </div>
            )}
          </Panel>

          {hub.loaded && <RoutingBoard channels={hub.channels} destinations={hub.destinations} routes={hub.routes} pending={hub.pending} onToggle={(d, h) => hub.toggle(d, h)} />}

          <Panel title="Platform apps" icon={Key}>
            <p className="text-[11.5px] text-muted -mt-1.5 mb-2.5">Developer credentials used for signing in. Set once per platform.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                ['google', 'Google (YouTube)', hub.yt.client_id && hub.yt.has_secret, YoutubeIcon, PLATFORM.youtube.color],
                ['tiktok', 'TikTok', hub.tt.client_key && hub.tt.has_secret, PLATFORM.tiktok.icon, PLATFORM.tiktok.color],
              ].map(([id, label, ready, Icon, color]) => (
                <button key={id} type="button" onClick={() => setSetup(id)} data-testid={`app-${id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-canvas hover:bg-raised px-3 py-2.5 text-left">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}><Icon size={18} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ink">{label}</span>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-muted"><Dot tone={ready ? 'good' : 'warn'} />{ready ? 'Configured' : 'Not set up'}</span>
                  </span>
                  <ChevronRight size={15} className="text-faint" />
                </button>
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* sheets */}
      {openStreamer && (
        <StreamerSheet hub={hub} channel={openStreamer} info={hub.live[openStreamer.channel_id_or_handle]}
          tab={sheetTab} onTab={(t) => openSheet(openStreamer.channel_id_or_handle, t)} onClose={closeSheet} onConnect={connect} />
      )}
      <AddStreamerSheet hub={hub} open={addOpen} onClose={() => setAddOpen(false)} onConnect={connect} />
      <ConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} yt={hub.yt} tt={hub.tt}
        onYouTube={hub.startYouTube} onTikTok={hub.startTikTok}
        onYouTubeImport={async (k, t) => { if (await hub.importYouTube(k, t)) setConnectOpen(false); }}
        onInstagram={async (c) => { const r = await hub.connectInstagram(c); if (r.success) setConnectOpen(false); return r; }}
        onInstagramImport={async (d) => { const r = await hub.importInstagram(d); if (r.success) setConnectOpen(false); return r; }}
        onSetup={(w) => { setConnectOpen(false); setSetup(w); }} />
      <DestinationSheet dest={openDest} channels={hub.channels} routes={hub.routes} pending={hub.pending} onToggle={(d, h) => hub.toggle(d, h)}
        onUpdate={(changes) => hub.updateDest(openDest, changes)} onDisconnect={async () => { await hub.disconnect(openDest); setDestId(null); }}
        onReconnect={() => (openDest.platform === 'youtube' ? hub.startYouTube(openDest.key) : openDest.platform === 'tiktok' ? hub.startTikTok(openDest.raw.mode || 'inbox') : setConnectOpen(true))}
        onClose={() => setDestId(null)} />
      <AppSetupSheet which={setup} yt={hub.yt} tt={hub.tt} onSave={async (w, id, sec) => { if (await hub.saveApp(w, id, sec)) setSetup(null); }} onClose={() => setSetup(null)} />

      <Sheet open={!!pauseFor} onClose={() => setPauseFor(null)} title={`Pause ${pauseFor?.display_name || pauseFor?.channel_id_or_handle || ''}`}
        footer={<div className="flex gap-2"><Button block onClick={() => setPauseFor(null)}>Cancel</Button>
          <Button block variant="warn" onClick={() => { hub.pause(pauseFor.channel_id_or_handle, pauseReason, pauseNow); setPauseFor(null); }}>Pause</Button></div>}>
        <p className="text-xs text-muted mb-3">While paused, recording stops and no clips are made for this streamer.</p>
        <div className="space-y-3">
          <Field label="Reason"><Input value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} /></Field>
          <Checkbox checked={pauseNow} onChange={setPauseNow} label="Also cancel renders in progress right now" />
        </div>
      </Sheet>

      {watch && (
        <Sheet open onClose={() => setWatch(null)} wide title={(<span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-bad animate-pulse" />{watch.display_name || watch.channel_id_or_handle}</span>)}>
          <div className="aspect-video w-full bg-black rounded-xl overflow-hidden">
            <iframe title={`Live: ${watch.channel_id_or_handle}`} className="w-full h-full border-0" allowFullScreen
              allow="autoplay; encrypted-media; picture-in-picture"
              src={(watch.platform || 'twitch').toLowerCase() === 'twitch'
                ? `https://player.twitch.tv/?channel=${encodeURIComponent(watch.channel_id_or_handle)}&parent=${window.location.hostname || 'localhost'}&autoplay=true&muted=true`
                : `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(watch.channel_id_or_handle)}&autoplay=1&mute=1`} />
          </div>
        </Sheet>
      )}
    </Page>
  );
}
