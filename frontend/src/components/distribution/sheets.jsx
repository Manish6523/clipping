import React, { useEffect, useState } from 'react';
import { ExternalLink, FileJson, Trash2, AlertTriangle, Key, ChevronLeft, Check, Copy } from 'lucide-react';
import { Sheet, Button, Input, Textarea, Field, Notice, Select, Divider } from '../ui';
import ChannelPublishing from '../ChannelPublishing';
import { Avatar, PLATFORM, YoutubeIcon } from './parts';
import { routeKey } from './model';

const TT_PRIVACY = [
  ['SELF_ONLY', 'Only me'], ['MUTUAL_FOLLOW_FRIENDS', 'Friends'], ['FOLLOWER_OF_CREATOR', 'Followers'], ['PUBLIC_TO_EVERYONE', 'Everyone'],
];

function CopyBox({ value }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* not allowed */ }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-canvas border border-line p-2">
      <code className="font-mono text-[11px] text-good break-all flex-1 select-all">{value}</code>
      <button type="button" onClick={copy} aria-label="Copy" className="w-8 h-8 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center text-muted">
        {done ? <Check size={14} className="text-good" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- connect */

export function ConnectSheet({ open, onClose, yt, tt, onYouTube, onYouTubeImport, onTikTok, onSetup }) {
  const [platform, setPlatform] = useState(null);
  const [name, setName] = useState('');
  const [ttMode, setTtMode] = useState('inbox');
  const [importing, setImporting] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPlatform(null); setName(''); setImporting(false); setToken(''); setBusy(false); } }, [open]);

  const key = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const ytReady = yt.client_id && yt.has_secret;
  const ttReady = tt.client_key && tt.has_secret;
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const title = platform ? (
    <span className="flex items-center gap-1.5">
      <button type="button" onClick={() => setPlatform(null)} aria-label="Back" className="w-7 h-7 -ml-1 rounded-lg hover:bg-white/10 flex items-center justify-center"><ChevronLeft size={16} /></button>
      Connect {PLATFORM[platform].label}
    </span>
  ) : 'Connect an account';

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {!platform && (
        <div className="grid grid-cols-2 gap-2.5" data-testid="connect-choose">
          {['youtube', 'tiktok'].map((p) => {
            const P = PLATFORM[p];
            return (
              <button key={p} type="button" onClick={() => setPlatform(p)}
                className="rounded-2xl border border-line-strong bg-canvas hover:bg-raised p-4 flex flex-col items-center gap-2 text-center">
                <span className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ color: P.color, background: `color-mix(in srgb, ${P.color} 14%, transparent)` }}>
                  <P.icon size={24} />
                </span>
                <span className="text-[13.5px] font-semibold text-ink">{P.label}</span>
                <span className="text-[11px] text-muted leading-snug">{p === 'youtube' ? 'Upload Shorts to a channel' : 'Send to drafts or post'}</span>
              </button>
            );
          })}
        </div>
      )}

      {platform === 'youtube' && !ytReady && (
        <SetupFirst label="Google" onSetup={() => onSetup('google')} />
      )}
      {platform === 'youtube' && ytReady && !importing && (
        <div className="space-y-3">
          <Field label="Name for this channel" hint={key ? `Saved as “${key}”` : 'Only used inside AutoClip, e.g. gaming_main'}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="gaming_main" aria-label="Channel name" />
          </Field>
          <Button block size="lg" variant="primary" className="!bg-[#e11d48] hover:!bg-[#be123c]" disabled={!key} loading={busy}
            onClick={() => run(() => onYouTube(key))}>
            <YoutubeIcon size={18} /> Sign in with Google
          </Button>
          <p className="text-[11px] text-muted text-center">Pick the YouTube channel on Google's screen; you come straight back here.</p>
          <Divider />
          <button type="button" onClick={() => setImporting(true)} className="w-full text-[12px] text-muted hover:text-ink inline-flex items-center justify-center gap-1.5">
            <FileJson size={13} /> Import a token file instead
          </button>
        </div>
      )}
      {platform === 'youtube' && ytReady && importing && (
        <div className="space-y-3">
          <Field label="Name for this channel"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="gaming_main" /></Field>
          <Field label="Token JSON" hint="Must contain refresh_token, client_id and client_secret.">
            <Textarea rows={6} className="font-mono !text-xs" value={token} onChange={(e) => setToken(e.target.value)} placeholder='{"refresh_token": "...", "client_id": "...", "client_secret": "..."}' />
          </Field>
          <Button block variant="primary" disabled={!key || !token.trim()} loading={busy} onClick={() => run(() => onYouTubeImport(key, token))}>Import channel</Button>
        </div>
      )}

      {platform === 'tiktok' && !ttReady && <SetupFirst label="TikTok" onSetup={() => onSetup('tiktok')} />}
      {platform === 'tiktok' && ttReady && (
        <div className="space-y-3">
          <Field label="How clips reach TikTok">
            <div className="grid gap-2">
              {[['inbox', 'Send to drafts', 'You add the sound and post from the TikTok app.'], ['direct', 'Post directly', 'Needs a TikTok-approved app (video.publish).']].map(([v, l, h]) => (
                <button key={v} type="button" onClick={() => setTtMode(v)} aria-pressed={ttMode === v}
                  className={`text-left rounded-xl border p-3 ${ttMode === v ? 'border-accent bg-accent/10' : 'border-line-strong'}`}>
                  <div className="text-[13px] font-semibold text-ink">{l}</div>
                  <div className="text-[11.5px] text-muted">{h}</div>
                </button>
              ))}
            </div>
          </Field>
          <Button block size="lg" variant="primary" loading={busy} onClick={() => run(() => onTikTok(ttMode))}>
            <PLATFORM.tiktok.icon size={18} /> Sign in with TikTok
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function SetupFirst({ label, onSetup }) {
  return (
    <div className="space-y-3">
      <Notice tone="warn" icon={Key}>Add your {label} app credentials once, then connecting accounts is one tap.</Notice>
      <Button block variant="primary" icon={Key} onClick={onSetup}>Set up {label} app</Button>
    </div>
  );
}

/* ------------------------------------------------------------- one destination */

export function DestinationSheet({ dest, channels, routes, pending, onToggle, onUpdate, onDisconnect, onReconnect, onClose }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [dest?.id]);
  if (!dest) return null;
  const raw = dest.raw;
  return (
    <Sheet open onClose={onClose} wide title={(
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar src={dest.avatar} name={dest.title} platform={dest.platform} size={30} />
        <span className="truncate">{dest.title}</span>
        <span className="text-[11.5px] font-normal text-muted truncate">{dest.handle}</span>
      </span>
    )}>
      <div className="space-y-4" data-testid="dest-sheet">
        {!dest.ok && (
          <Notice tone="bad" icon={AlertTriangle}>
            <p>The saved login stopped working, so uploads to this {PLATFORM[dest.platform].label} account will fail.</p>
            <Button size="sm" variant="primary" className="mt-2" onClick={onReconnect}>Reconnect</Button>
          </Notice>
        )}

        <section>
          <h4 className="text-[12px] font-semibold text-ink mb-2">Posts clips from</h4>
          {channels.length === 0 ? <p className="text-[12px] text-muted">Add streamers under Channels first.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {channels.map((c) => {
                const h = c.channel_id_or_handle;
                const k = routeKey(dest, h);
                const on = routes.has(k);
                return (
                  <button key={h} type="button" aria-pressed={on} disabled={pending.has(k)} onClick={() => onToggle(dest, h)}
                    className={`h-9 pl-1 pr-3 rounded-full border inline-flex items-center gap-1.5 text-[12px] font-semibold disabled:opacity-50 ${
                      on ? 'bg-accent-strong border-accent-strong text-white' : 'border-line-strong text-slate-300 hover:bg-white/[0.05]'}`}>
                    <Avatar src={c.avatar_url} name={c.display_name || h} size={26} />
                    {c.display_name || h}{on && <Check size={12} strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {dest.platform === 'youtube' && <ChannelPublishing acc={raw} onUpdate={onUpdate} />}

        {dest.platform === 'tiktok' && (
          <section className="grid sm:grid-cols-2 gap-3 pt-3.5 border-t border-line">
            <Field label="How clips are posted">
              <Select value={raw.mode || 'inbox'} onChange={(e) => onUpdate({ mode: e.target.value })}>
                <option value="inbox">Send to drafts</option><option value="direct">Post directly</option>
              </Select>
            </Field>
            {raw.mode === 'direct' && (
              <Field label="Who can see posts">
                <Select value={raw.privacy || 'SELF_ONLY'} onChange={(e) => onUpdate({ privacy: e.target.value })}>
                  {TT_PRIVACY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            )}
          </section>
        )}

        <section className="pt-3.5 border-t border-line">
          {!confirming ? (
            <Button variant="ghost" icon={Trash2} className="!text-bad" onClick={() => setConfirming(true)}>Disconnect {PLATFORM[dest.platform].label} account</Button>
          ) : (
            <div className="rounded-xl border border-bad/40 bg-bad/5 p-3 space-y-2.5">
              <p className="text-[12.5px] text-slate-300">The saved login is removed and queued uploads to <b className="text-ink">{dest.title}</b> won't post. Videos already uploaded stay up.</p>
              <div className="flex gap-2">
                <Button block onClick={() => setConfirming(false)}>Keep it</Button>
                <Button block variant="danger" onClick={onDisconnect}>Disconnect</Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------- app credentials */

export function AppSetupSheet({ which, yt, tt, onSave, onClose }) {
  const isG = which === 'google';
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setId(isG ? yt.client_id || '' : tt.client_key || ''); setSecret(''); }, [which]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!which) return null;
  const hasSecret = isG ? yt.has_secret : tt.has_secret;
  const redirect = isG ? `${window.location.origin}/api/youtube/oauth2callback` : (tt.redirect_uri || `${window.location.origin}/api/tiktok/oauth2callback`);
  const save = async () => { setBusy(true); try { await onSave(which, id.trim(), secret.trim()); } finally { setBusy(false); } };
  return (
    <Sheet open onClose={onClose} title={isG ? 'Google (YouTube) app' : 'TikTok app'}
      footer={<Button block variant="primary" loading={busy} disabled={!id.trim() || (!secret.trim() && !hasSecret)} onClick={save}>Save</Button>}>
      <ol className="text-[12px] text-muted space-y-1.5 mb-4 list-decimal pl-4 leading-relaxed">
        {isG ? (
          <>
            <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 inline-flex items-center gap-0.5">Google Cloud credentials <ExternalLink size={10} /></a> and enable <b className="text-slate-300">YouTube Data API v3</b>.</li>
            <li>Create an <b className="text-slate-300">OAuth client ID</b> (Web application) with the redirect URI below.</li>
            <li>Paste the client ID and secret here.</li>
          </>
        ) : (
          <>
            <li>Create an app on <a href="https://developers.tiktok.com/apps" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 inline-flex items-center gap-0.5">TikTok for Developers <ExternalLink size={10} /></a>.</li>
            <li>Add <b className="text-slate-300">Login Kit</b> + <b className="text-slate-300">Content Posting API</b>, scope <code className="font-mono">video.upload</code> (and <code className="font-mono">video.publish</code> to post directly).</li>
            <li>Register the redirect URI below (must be https).</li>
          </>
        )}
      </ol>
      <div className="space-y-3">
        <Field label="Redirect URI"><CopyBox value={redirect} /></Field>
        <Field label={isG ? 'Client ID' : 'Client key'}>
          <Input mono value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" placeholder={isG ? 'xxxx.apps.googleusercontent.com' : ''} />
        </Field>
        <Field label="Client secret">
          <Input mono type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off"
            placeholder={hasSecret ? 'Saved - leave blank to keep it' : isG ? 'GOCSPX-…' : ''} />
        </Field>
      </div>
    </Sheet>
  );
}
