import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getChannels, getStreamers, getTemplates, addChannel, removeChannel, pauseChannel, resumeChannel, patchChannelSettings,
  getYouTubeAppConfig, saveYouTubeAppConfig, getYouTubeAuthUrl, getYouTubeAccounts, patchYouTubeAccountConfig,
  deleteYouTubeAccount, importYouTubeAccount, getYouTubeMappings, setYouTubeMappings,
  getTikTokAppConfig, saveTikTokAppConfig, getTikTokAuthUrl, getTikTokAccounts, patchTikTokAccount, deleteTikTokAccount,
  getInstagramAccounts, connectInstagramAccount, importInstagramAccount, patchInstagramAccount, deleteInstagramAccount,
} from '../../api';
import { toDestinations, routeSet, routeKey, ytKeysFor, ttStreamersFor, igStreamersFor } from '../distribution/model';

export const errText = (e) => e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || String(e);
const LIVE_POLL_MS = 20000;
const withHandle = (list, handle) => (list.some((c) => c.channel_id_or_handle === handle) ? list : [...list, { channel_id_or_handle: handle }]);

/**
 * Everything the Streamers page needs, loaded once: streamers (+ live status), templates, every
 * posting account, who-posts-where and the platform apps. Only live status is polled.
 * Routing switches are optimistic (instant, rolled back with a message on failure).
 */
export function useHub() {
  const [loaded, setLoaded] = useState(false);
  const [channels, setChannels] = useState([]);
  const [live, setLive] = useState({});
  const [templates, setTemplates] = useState([]);
  const [yt, setYt] = useState({ client_id: '', has_secret: false });
  const [tt, setTt] = useState({ client_key: '', has_secret: false, redirect_uri: '' });
  const [ytAccounts, setYtAccounts] = useState([]);
  const [ttAccounts, setTtAccounts] = useState([]);
  const [igAccounts, setIgAccounts] = useState([]);
  const [routes, setRoutes] = useState(new Set());
  const [pending, setPending] = useState(new Set());
  const [toast, setToast] = useState(null);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const say = useCallback((text, tone = 'good') => {
    setToast({ text, tone, at: Date.now() });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), tone === 'good' ? 3500 : 7000);
  }, []);

  const loadChannels = useCallback(async () => {
    const got = await getChannels();
    const list = Array.isArray(got) ? got : [];
    channelsRef.current = list;                 // read right away by setPosting after an add
    setChannels(list);
  }, []);
  const loadLive = useCallback(async () => { try { setLive((await getStreamers()) || {}); } catch { /* keep last */ } }, []);

  const loadAll = useCallback(async () => {
    const r = await Promise.allSettled([
      getChannels(), getStreamers(), getTemplates(), getYouTubeAppConfig(), getTikTokAppConfig(),
      getYouTubeAccounts(), getTikTokAccounts(), getInstagramAccounts(), getYouTubeMappings(),
    ]);
    const v = (i, d) => (r[i].status === 'fulfilled' && r[i].value != null ? r[i].value : d);
    const arr = (x) => (Array.isArray(x) ? x : []);                // one bad response never blanks the page
    const ta = arr(v(6, {}).accounts);
    const ia = arr(v(7, {}).accounts);
    const ch = arr(v(0, []));
    channelsRef.current = ch;
    setChannels(ch); setLive(v(1, {}) || {}); setTemplates(arr(v(2, [])));
    setYt(v(3, { client_id: '', has_secret: false })); setTt(v(4, { client_key: '', has_secret: false }));
    setYtAccounts(arr(v(5, []))); setTtAccounts(ta); setIgAccounts(ia);
    setRoutes(routeSet(arr(v(8, [])), ta, ia));
    setLoaded(true);
    const failed = [0, 5, 6, 7, 8].map((i) => r[i]).find((x) => x.status === 'rejected');
    if (failed) say(`Some data didn't load: ${errText(failed.reason)}`, 'bad');
  }, [say]);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadLive, LIVE_POLL_MS);
    return () => clearInterval(t);
  }, [loadAll, loadLive]);

  const destinations = useMemo(() => toDestinations(ytAccounts, ttAccounts, igAccounts), [ytAccounts, ttAccounts, igAccounts]);

  /** Destinations a streamer posts to. */
  const postsTo = useCallback((handle) => destinations.filter((d) => routes.has(routeKey(d, handle))), [destinations, routes]);

  /* ---------------- routing: switch one streamer x destination (instant, optimistic) */
  const toggle = useCallback(async (dest, handle, want) => {
    const k = routeKey(dest, handle);
    const cur = routesRef.current;
    if (pending.has(k)) return;
    const on = cur.has(k);
    if (want !== undefined && want === on) return;
    const next = new Set(cur);
    if (on) next.delete(k); else next.add(k);
    routesRef.current = next;
    setRoutes(next);
    setPending((p) => new Set(p).add(k));
    try {
      if (dest.platform === 'youtube') {
        await setYouTubeMappings({ streamer_handle: handle, account_keys: ytKeysFor(next, handle, destinations) });
      } else if (dest.platform === 'tiktok') {
        const list = ttStreamersFor(next, dest, withHandle(channelsRef.current, handle));
        await patchTikTokAccount(dest.key, { streamers: list });
        setTtAccounts((all) => all.map((a) => (a.key === dest.key ? { ...a, streamers: list } : a)));
      } else if (dest.platform === 'instagram') {
        const list = igStreamersFor(next, dest, withHandle(channelsRef.current, handle));
        await patchInstagramAccount(dest.key, { streamers: list });
        setIgAccounts((all) => all.map((a) => (a.key === dest.key ? { ...a, streamers: list } : a)));
      }
    } catch (e) {
      setRoutes((c) => { const r = new Set(c); if (r.has(k)) r.delete(k); else r.add(k); routesRef.current = r; return r; });
      say(`Couldn't save that: ${errText(e)}`, 'bad');
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(k); return n; });
    }
  }, [destinations, pending, say]);

  /** Set a streamer's destinations in one go (Add streamer step 2). Sequential so list PATCHes don't race. */
  const setPosting = useCallback(async (handle, destIds) => {
    for (const d of destinations) {
      // eslint-disable-next-line no-await-in-loop
      await toggle(d, handle, destIds.includes(d.id));
    }
  }, [destinations, toggle]);

  /* ---------------- streamers */
  const addStreamer = useCallback(async ({ platform, channel, template, group }) => {
    await addChannel({ platform, channel, template, group_tag: group });
    await loadChannels();
    loadLive();
  }, [loadChannels, loadLive]);

  const saveStreamer = useCallback(async (handle, payload) => {
    const res = await patchChannelSettings(handle, payload);
    setChannels((list) => list.map((c) => (c.channel_id_or_handle === handle ? {
      ...c, template_name: payload.template_name ?? c.template_name, display_name: payload.display_name ?? c.display_name,
      group_tag: payload.group_tag ?? c.group_tag, avatar_url: payload.avatar_url ?? c.avatar_url, notes: payload.notes ?? c.notes,
      settings: payload.settings ? { ...(c.settings || {}), ...payload.settings } : c.settings,
    } : c)));
    return res;
  }, []);

  const pause = useCallback(async (handle, reason, immediate) => {
    setChannels((l) => l.map((c) => (c.channel_id_or_handle === handle ? { ...c, enabled: 0 } : c)));
    try { await pauseChannel(handle, reason, immediate); } catch (e) { say(`Couldn't pause: ${errText(e)}`, 'bad'); }
    loadChannels();
  }, [loadChannels, say]);

  const resume = useCallback(async (handle) => {
    setChannels((l) => l.map((c) => (c.channel_id_or_handle === handle ? { ...c, enabled: 1 } : c)));
    try { await resumeChannel(handle); } catch (e) { say(`Couldn't resume: ${errText(e)}`, 'bad'); }
    loadChannels();
  }, [loadChannels, say]);

  const remove = useCallback(async (handle) => {
    try {
      await removeChannel(handle);
      setChannels((l) => l.filter((c) => c.channel_id_or_handle !== handle));
      say(`Stopped watching ${handle}.`);
    } catch (e) { say(`Couldn't remove: ${errText(e)}`, 'bad'); }
  }, [say]);

  /* ---------------- accounts */
  const updateDest = useCallback(async (dest, changes) => {
    try {
      if (dest.platform === 'youtube') { await patchYouTubeAccountConfig(dest.key, changes); setYtAccounts(await getYouTubeAccounts()); }
      else if (dest.platform === 'tiktok') { await patchTikTokAccount(dest.key, changes); setTtAccounts((await getTikTokAccounts()).accounts || []); }
      else if (dest.platform === 'instagram') { await patchInstagramAccount(dest.key, changes); setIgAccounts((await getInstagramAccounts()).accounts || []); }
    } catch (e) { say(`Couldn't save: ${errText(e)}`, 'bad'); }
  }, [say]);

  const disconnect = useCallback(async (dest) => {
    try {
      if (dest.platform === 'youtube') await deleteYouTubeAccount(dest.key);
      else if (dest.platform === 'tiktok') await deleteTikTokAccount(dest.key);
      else if (dest.platform === 'instagram') await deleteInstagramAccount(dest.key);
      say(`${dest.title} disconnected.`);
      loadAll();
    } catch (e) { say(`Couldn't disconnect: ${errText(e)}`, 'bad'); }
  }, [loadAll, say]);

  const startYouTube = useCallback(async (key) => {
    try { const { auth_url } = await getYouTubeAuthUrl(key); window.location.href = auth_url; } catch (e) { say(`Couldn't start Google sign-in: ${errText(e)}`, 'bad'); }
  }, [say]);
  const startTikTok = useCallback(async (mode) => {
    try { const r = await getTikTokAuthUrl(mode); window.location.href = r.auth_url; } catch (e) { say(`Couldn't start TikTok sign-in: ${errText(e)}`, 'bad'); }
  }, [say]);
  const importYouTube = useCallback(async (key, text) => {
    let parsed;
    try { parsed = JSON.parse(text); } catch { say('That token isn\'t valid JSON.', 'bad'); return false; }
    try { await importYouTubeAccount({ account_key: key, token_json: parsed }); say(`Imported "${key}".`); loadAll(); return true; } catch (e) { say(`Import failed: ${errText(e)}`, 'bad'); return false; }
  }, [loadAll, say]);
  const saveApp = useCallback(async (which, id, secret) => {
    try {
      if (which === 'google') await saveYouTubeAppConfig({ client_id: id, client_secret: secret });
      else await saveTikTokAppConfig({ client_key: id, client_secret: secret });
      say(`${which === 'google' ? 'Google' : 'TikTok'} app saved.`); loadAll(); return true;
    } catch (e) { say(`Couldn't save: ${errText(e)}`, 'bad'); return false; }
  }, [loadAll, say]);
  const connectInstagram = useCallback(async (creds) => {
    const res = await connectInstagramAccount(creds);
    if (res.success) { say(`Instagram @${res.account.username || res.account.key} connected.`); loadAll(); }
    return res;
  }, [loadAll, say]);
  const importInstagram = useCallback(async (data) => {
    const res = await importInstagramAccount(data);
    if (res.success) { say(`Instagram @${res.account.username || res.account.key} imported.`); loadAll(); }
    return res;
  }, [loadAll, say]);

  /* ---------------- summary */
  const summary = useMemo(() => {
    const isLive = (c) => c.enabled === 1 && (live[c.channel_id_or_handle] || {}).is_live;
    const routed = channels.filter((c) => destinations.some((d) => routes.has(routeKey(d, c.channel_id_or_handle)))).length;
    const byProject = {};
    ytAccounts.forEach((a) => { if (a.quota) byProject[a.quota.project || a.account_key] = a.quota.uploads_left_today; });
    const q = Object.values(byProject);
    return {
      watching: channels.filter((c) => c.enabled === 1).length,
      live: channels.filter(isLive).length,
      paused: channels.filter((c) => c.enabled !== 1).length,
      routed,
      unrouted: channels.length - routed,
      broken: destinations.filter((d) => !d.ok),
      uploadsLeft: q.length ? q.reduce((s, n) => s + n, 0) : null,
    };
  }, [channels, live, destinations, routes, ytAccounts]);

  return {
    loaded, channels, live, templates, yt, tt, destinations, routes, pending, toast, setToast, say, summary,
    postsTo, toggle, setPosting, addStreamer, saveStreamer, pause, resume, remove,
    updateDest, disconnect, startYouTube, startTikTok, importYouTube, saveApp, connectInstagram, importInstagram,
    reload: loadAll,
  };
}
