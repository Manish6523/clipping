import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, CheckCircle2, AlertTriangle, Share2, Key, ChevronRight, Send, Users, Gauge, Zap } from 'lucide-react';
import {
  getYouTubeAppConfig, saveYouTubeAppConfig, getYouTubeAuthUrl, getYouTubeAccounts, patchYouTubeAccountConfig,
  deleteYouTubeAccount, importYouTubeAccount, getYouTubeMappings, setYouTubeMappings, getChannels,
  getTikTokAppConfig, saveTikTokAppConfig, getTikTokAuthUrl, getTikTokAccounts, patchTikTokAccount, deleteTikTokAccount,
  getInstagramAccounts, connectInstagramAccount, patchInstagramAccount, deleteInstagramAccount,
} from '../../api';
import { Page, Panel, Button, Notice, Stat, Skeleton, Dot } from '../ui';
import { DestinationCard, PLATFORM, YoutubeIcon } from './parts';
import RoutingBoard from './RoutingBoard';
import { ConnectSheet, DestinationSheet, AppSetupSheet } from './sheets';
import { toDestinations, routeSet, routeKey, ytKeysFor, ttStreamersFor, igStreamersFor } from './model';

const errText = (e) => e?.response?.data?.error || e?.message || String(e);

/**
 * Distribution: where clips get posted.
 *   1. Destinations - connected YouTube channels and TikTok accounts (tap one for its schedule & rules)
 *   2. Who posts where - streamer x destination routing board
 *   3. Platform apps - the OAuth credentials connecting needs (set once)
 */
export default function DistributionPage() {
  const [loaded, setLoaded] = useState(false);
  const [yt, setYt] = useState({ client_id: '', has_secret: false });
  const [tt, setTt] = useState({ client_key: '', has_secret: false, redirect_uri: '' });
  const [ytAccounts, setYtAccounts] = useState([]);
  const [ttAccounts, setTtAccounts] = useState([]);
  const [igAccounts, setIgAccounts] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [channels, setChannels] = useState([]);
  const [routes, setRoutes] = useState(new Set());
  const [pending, setPending] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [setup, setSetup] = useState(null);       // 'google' | 'tiktok'

  const say = useCallback((text, tone = 'good') => {
    setToast({ text, tone });
    if (tone === 'good') setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500);
  }, []);

  const load = useCallback(async () => {
    const [cfgY, cfgT, accY, accT, accI, maps, chs] = await Promise.allSettled([
      getYouTubeAppConfig(), getTikTokAppConfig(), getYouTubeAccounts(), getTikTokAccounts(), getInstagramAccounts(), getYouTubeMappings(), getChannels(),
    ]);
    const v = (r, d) => (r.status === 'fulfilled' ? r.value : d);
    setYt(v(cfgY, { client_id: '', has_secret: false }));
    setTt(v(cfgT, { client_key: '', has_secret: false }));
    const ya = v(accY, []); const ta = v(accT, { accounts: [] }).accounts || [];
    const ia = v(accI, { accounts: [] }).accounts || []; const mp = v(maps, []);
    setYtAccounts(ya); setTtAccounts(ta); setIgAccounts(ia); setMappings(mp); setChannels(v(chs, []));
    setRoutes(routeSet(mp, ta, ia));
    setLoaded(true);
    const failed = [accY, accT, accI, chs].find((r) => r.status === 'rejected');
    if (failed) say(`Some data didn't load: ${errText(failed.reason)}`, 'bad');
  }, [say]);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    if (connected) {
      say(`YouTube channel "${connected}" connected - now pick which streamers post to it.`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [load, say]);

  const destinations = useMemo(() => toDestinations(ytAccounts, ttAccounts, igAccounts), [ytAccounts, ttAccounts, igAccounts]);
  const openDest = destinations.find((d) => d.id === openId) || null;
  const streamersOf = (d) => channels.filter((c) => routes.has(routeKey(d, c.channel_id_or_handle))).length;

  /* ---------------- routing (optimistic) */
  const toggle = async (dest, handle) => {
    const k = routeKey(dest, handle);
    if (pending.has(k)) return;
    const next = new Set(routes);
    if (next.has(k)) next.delete(k); else next.add(k);
    setRoutes(next);
    setPending((p) => new Set(p).add(k));
    try {
      if (dest.platform === 'youtube') {
        await setYouTubeMappings({ streamer_handle: handle, account_keys: ytKeysFor(next, handle, destinations) });
        setMappings(await getYouTubeMappings());
      } else if (dest.platform === 'tiktok') {
        await patchTikTokAccount(dest.key, { streamers: ttStreamersFor(next, dest, channels) });
        setTtAccounts((list) => list.map((a) => (a.key === dest.key ? { ...a, streamers: ttStreamersFor(next, dest, channels) } : a)));
      } else if (dest.platform === 'instagram') {
        await patchInstagramAccount(dest.key, { streamers: igStreamersFor(next, dest, channels) });
        setIgAccounts((list) => list.map((a) => (a.key === dest.key ? { ...a, streamers: igStreamersFor(next, dest, channels) } : a)));
      }
    } catch (e) {
      setRoutes((cur) => { const r = new Set(cur); if (r.has(k)) r.delete(k); else r.add(k); return r; });
      say(`Couldn't save that: ${errText(e)}`, 'bad');
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(k); return n; });
    }
  };

  /* ---------------- account actions */
  const updateDest = async (dest, changes) => {
    try {
      if (dest.platform === 'youtube') {
        await patchYouTubeAccountConfig(dest.key, changes);
        setYtAccounts(await getYouTubeAccounts());
      } else if (dest.platform === 'tiktok') {
        await patchTikTokAccount(dest.key, changes);
        setTtAccounts((await getTikTokAccounts()).accounts || []);
      } else if (dest.platform === 'instagram') {
        await patchInstagramAccount(dest.key, changes);
        setIgAccounts((await getInstagramAccounts()).accounts || []);
      }
    } catch (e) { say(`Couldn't save: ${errText(e)}`, 'bad'); }
  };

  const disconnect = async (dest) => {
    try {
      if (dest.platform === 'youtube') await deleteYouTubeAccount(dest.key);
      else if (dest.platform === 'tiktok') await deleteTikTokAccount(dest.key);
      else if (dest.platform === 'instagram') await deleteInstagramAccount(dest.key);
      setOpenId(null);
      say(`${dest.title} disconnected.`);
      load();
    } catch (e) { say(`Couldn't disconnect: ${errText(e)}`, 'bad'); }
  };

  const startYouTube = async (key) => {
    try { const { auth_url } = await getYouTubeAuthUrl(key); window.location.href = auth_url; } catch (e) { say(`Couldn't start Google sign-in: ${errText(e)}`, 'bad'); }
  };
  const startTikTok = async (mode) => {
    try { const r = await getTikTokAuthUrl(mode); window.location.href = r.auth_url; } catch (e) { say(`Couldn't start TikTok sign-in: ${errText(e)}`, 'bad'); }
  };
  const importYouTube = async (key, text) => {
    let parsed;
    try { parsed = JSON.parse(text); } catch { say('That token isn\'t valid JSON.', 'bad'); return; }
    try {
      await importYouTubeAccount({ account_key: key, token_json: parsed });
      setConnectOpen(false); say(`Imported "${key}".`); load();
    } catch (e) { say(`Import failed: ${errText(e)}`, 'bad'); }
  };
  const saveApp = async (which, id, secret) => {
    try {
      if (which === 'google') await saveYouTubeAppConfig({ client_id: id, client_secret: secret });
      else await saveTikTokAppConfig({ client_key: id, client_secret: secret });
      setSetup(null); say(`${which === 'google' ? 'Google' : 'TikTok'} app saved.`); load();
    } catch (e) { say(`Couldn't save: ${errText(e)}`, 'bad'); }
  };

  /* ---------------- summary */
  const routed = channels.filter((c) => destinations.some((d) => routes.has(routeKey(d, c.channel_id_or_handle)))).length;
  const autoCount = destinations.filter((d) => d.mode === 'on' || d.mode === 'direct').length;
  const quotaLeft = (() => {
    const byProject = {};
    ytAccounts.forEach((a) => { if (a.quota) byProject[a.quota.project || a.account_key] = a.quota.uploads_left_today; });
    const vals = Object.values(byProject);
    return vals.length ? vals.reduce((s, n) => s + n, 0) : null;
  })();
  const broken = destinations.filter((d) => !d.ok);
  const nYt = destinations.filter((d) => d.platform === 'youtube').length;
  const nTt = destinations.filter((d) => d.platform === 'tiktok').length;
  const nIg = destinations.filter((d) => d.platform === 'instagram').length;

  const connectInstagram = async (creds) => {
    const res = await connectInstagramAccount(creds);
    if (res.success) {
      setConnectOpen(false);
      say(`Instagram account @${res.account.username || res.account.key} connected!`);
      load();
    }
    return res;
  };

  return (
    <Page title="Distribution" icon={Send}
      subtitle="Connect where clips get posted, then choose which streamer goes where."
      actions={<Button variant="primary" icon={Plus} onClick={() => setConnectOpen(true)} data-testid="connect-open">Connect account</Button>}>

      {toast && <Notice tone={toast.tone} icon={toast.tone === 'good' ? CheckCircle2 : AlertTriangle}>
        <span className="flex items-center gap-3">{toast.text}<button type="button" className="underline text-muted" onClick={() => setToast(null)}>Dismiss</button></span>
      </Notice>}
      {broken.length > 0 && (
        <Notice tone="bad" icon={AlertTriangle}>
          {broken.map((d) => d.title).join(', ')} {broken.length === 1 ? 'needs' : 'need'} reconnecting - clips queued for {broken.length === 1 ? 'it' : 'them'} won't upload.
        </Notice>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-testid="dist-summary">
        <Stat icon={Send} label="Destinations" value={loaded ? destinations.length : '–'} sub={`${nYt} YouTube · ${nTt} TikTok · ${nIg} Instagram`} />
        <Stat icon={Users} label="Streamers posting" value={loaded ? `${routed}/${channels.length}` : '–'}
          sub={channels.length - routed ? `${channels.length - routed} not posting anywhere` : 'All routed'} tone={loaded && channels.length - routed ? 'warn' : undefined} />
        <Stat icon={Zap} label="Auto-posting" value={loaded ? autoCount : '–'} sub={autoCount ? 'post without asking' : 'you approve every clip'} />
        <Stat icon={Gauge} label="YouTube uploads left" value={quotaLeft ?? '–'} sub="today, across Google projects" />
      </div>

      <Panel title="Destinations" icon={Send} right={destinations.length > 0 && <span className="text-[11px] text-muted">Tap one for its schedule and rules</span>}>
        {!loaded ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
        ) : destinations.length === 0 ? (
          <div className="text-center py-8">
            <div className="flex justify-center gap-2 mb-3">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#ff3b3b]/12 text-[#ff3b3b]"><YoutubeIcon size={22} /></span>
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#25f4ee]/12 text-[#25f4ee]"><PLATFORM.tiktok.icon size={22} /></span>
            </div>
            <p className="text-[14px] font-semibold text-ink">Nothing connected yet</p>
            <p className="text-[12px] text-muted mt-1 mb-4">Connect a YouTube channel or TikTok account to start posting clips.</p>
            <Button variant="primary" icon={Plus} onClick={() => setConnectOpen(true)}>Connect account</Button>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {destinations.map((d) => <DestinationCard key={d.id} dest={d} streamers={streamersOf(d)} onOpen={() => setOpenId(d.id)} />)}
            <button type="button" onClick={() => setConnectOpen(true)}
              className="rounded-2xl border border-dashed border-line-strong text-muted hover:text-ink hover:border-accent/60 min-h-[120px] flex flex-col items-center justify-center gap-1.5 text-[12.5px] font-semibold">
              <Plus size={20} /> Connect another
            </button>
          </div>
        )}
      </Panel>

      {loaded && <RoutingBoard channels={channels} destinations={destinations} routes={routes} pending={pending} onToggle={toggle} />}

      <Panel title="Platform apps" icon={Key}>
        <p className="text-[11.5px] text-muted -mt-1.5 mb-2.5">Developer credentials used for signing in. Set once per platform.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            ['google', 'Google (YouTube)', yt.client_id && yt.has_secret, YoutubeIcon, PLATFORM.youtube.color],
            ['tiktok', 'TikTok', tt.client_key && tt.has_secret, PLATFORM.tiktok.icon, PLATFORM.tiktok.color],
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

      <ConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} yt={yt} tt={tt}
        onYouTube={startYouTube} onYouTubeImport={importYouTube} onTikTok={startTikTok}
        onInstagram={connectInstagram}
        onSetup={(w) => { setConnectOpen(false); setSetup(w); }} />
      <DestinationSheet dest={openDest} channels={channels} routes={routes} pending={pending} onToggle={toggle}
        onUpdate={(changes) => updateDest(openDest, changes)} onDisconnect={() => disconnect(openDest)}
        onReconnect={() => (openDest.platform === 'youtube' ? startYouTube(openDest.key) : openDest.platform === 'tiktok' ? startTikTok(openDest.raw.mode || 'inbox') : setConnectOpen(true))}
        onClose={() => setOpenId(null)} />
      <AppSetupSheet which={setup} yt={yt} tt={tt} onSave={saveApp} onClose={() => setSetup(null)} />
    </Page>
  );
}
