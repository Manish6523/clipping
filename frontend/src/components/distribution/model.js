/** Distribution data: YouTube channels and TikTok accounts as one list of "destinations",
 * and routing (which streamer posts where) with one toggle for both platforms. */

export const norm = (h) => String(h || '').trim().toLowerCase().replace(/^@/, '');

export function toDestinations(ytAccounts = [], ttAccounts = []) {
  const yt = ytAccounts.map((a) => ({
    id: `yt:${a.account_key}`,
    platform: 'youtube',
    key: a.account_key,
    title: a.channel_title || a.account_key,
    handle: a.custom_url || a.account_key,
    avatar: a.thumbnail_url,
    ok: (a.status || 'connected') === 'connected' && a.has_token_file !== false,
    mode: a.auto_mode || (a.auto_upload ? 'on' : 'off'),
    raw: a,
  }));
  const tt = ttAccounts.map((a) => ({
    id: `tt:${a.key}`,
    platform: 'tiktok',
    key: a.key,
    title: a.display_name || a.username || a.key,
    handle: a.username ? `@${a.username}` : a.key,
    avatar: a.avatar,
    ok: !!a.connected,
    mode: a.mode || 'inbox',
    raw: a,
  }));
  return [...yt, ...tt];
}

/** Set of `${destId}|${streamer}` pairs that are switched on. */
export function routeSet(ytMappings = [], ttAccounts = []) {
  const s = new Set();
  ytMappings.forEach((m) => s.add(`yt:${m.account_key}|${norm(m.streamer_handle)}`));
  ttAccounts.forEach((a) => (a.streamers || []).forEach((h) => s.add(`tt:${a.key}|${norm(h)}`)));
  return s;
}

export const routeKey = (dest, handle) => `${dest.id}|${norm(handle)}`;

/** YouTube channels a streamer posts to (the mappings API takes the whole list per streamer). */
export function ytKeysFor(routes, handle, destinations) {
  return destinations
    .filter((d) => d.platform === 'youtube' && routes.has(routeKey(d, handle)))
    .map((d) => d.key);
}

/** Streamers a TikTok account posts (its PATCH takes the whole list). */
export function ttStreamersFor(routes, dest, channels) {
  return channels.map((c) => c.channel_id_or_handle).filter((h) => routes.has(routeKey(dest, h)));
}

export const MODE_LABEL = {
  off: 'Manual approval', trial: 'Trial', on: 'Auto-posting',
  inbox: 'Sends to drafts', direct: 'Posts directly',
};
