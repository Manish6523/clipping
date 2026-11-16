import React, { useEffect, useState } from 'react';
import { AudioLines, Key, Plus, Trash2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { Panel, Button, IconButton, Input, Field, Pill, Notice, EmptyState, Confirm, Select } from './ui';
import {
  getTikTokAppConfig, saveTikTokAppConfig, getTikTokAuthUrl, getTikTokAccounts, patchTikTokAccount, deleteTikTokAccount,
} from '../api';

const PRIVACY = [
  ['SELF_ONLY', 'Only me'], ['MUTUAL_FOLLOW_FRIENDS', 'Friends'], ['FOLLOWER_OF_CREATOR', 'Followers'], ['PUBLIC_TO_EVERYONE', 'Everyone'],
];

/** TikTok: app credentials, connect accounts (inbox or direct posting), and which streamers post where. */
export default function TikTokAccounts({ channels = [] }) {
  const [cfg, setCfg] = useState({ client_key: '', has_secret: false, redirect_uri: '' });
  const [keyIn, setKeyIn] = useState('');
  const [secretIn, setSecretIn] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [mode, setMode] = useState('inbox');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    try {
      const [c, a] = await Promise.all([getTikTokAppConfig(), getTikTokAccounts()]);
      setCfg(c); setKeyIn(c.client_key || ''); setAccounts(a.accounts || []);
    } catch (e) { setMsg({ tone: 'bad', text: e.response?.data?.error || e.message }); }
  };
  useEffect(() => { load(); }, []);

  const err = (e) => setMsg({ tone: 'bad', text: e.response?.data?.error || e.message });

  const saveCfg = async (e) => {
    e.preventDefault();
    try { await saveTikTokAppConfig({ client_key: keyIn, client_secret: secretIn }); setSecretIn(''); setMsg({ tone: 'good', text: 'TikTok app saved' }); load(); } catch (x) { err(x); }
  };

  const connect = async () => {
    setBusy(true);
    try { const r = await getTikTokAuthUrl(mode); window.location.href = r.auth_url; } catch (x) { err(x); setBusy(false); }
  };

  const patch = async (key, data) => {
    try { await patchTikTokAccount(key, data); load(); } catch (x) { err(x); }
  };

  const toggleStreamer = (acc, handle) => {
    const list = acc.streamers || [];
    const has = list.some((s) => s.toLowerCase().replace(/^@/, '') === handle.toLowerCase().replace(/^@/, ''));
    patch(acc.key, { streamers: has ? list.filter((s) => s.toLowerCase().replace(/^@/, '') !== handle.toLowerCase().replace(/^@/, '')) : [...list, handle] });
  };

  const ready = cfg.client_key && cfg.has_secret;

  return (
    <div className="flex flex-col gap-3" data-testid="tiktok-accounts">
      {msg && <Notice tone={msg.tone} icon={msg.tone === 'good' ? CheckCircle2 : AlertTriangle}>{msg.text}</Notice>}

      <Panel title="Connect a TikTok account" icon={Plus}>
        {!ready ? (
          <p className="text-xs text-muted">Add your TikTok developer app's client key and secret below first.</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <Field label="How clips are posted" className="flex-1">
              <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Posting mode">
                <option value="inbox">Send to TikTok drafts (you post from the app)</option>
                <option value="direct">Post directly (app must be approved by TikTok)</option>
              </Select>
            </Field>
            <Button variant="primary" icon={AudioLines} loading={busy} onClick={connect}>Sign in with TikTok</Button>
          </div>
        )}
      </Panel>

      {accounts.length === 0 ? (
        <Panel><EmptyState icon={AudioLines} title="No TikTok accounts connected" text="Connect one, then pick which streamers' clips it gets." /></Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          {accounts.map((acc) => (
            <Panel key={acc.key} className="!p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {acc.avatar ? <img src={acc.avatar} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-full object-cover shrink-0" />
                    : <div className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0"><AudioLines size={18} /></div>}
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-ink truncate">{acc.display_name}</div>
                    <div className="text-[11px] text-muted truncate">{acc.username ? `@${acc.username}` : acc.key}</div>
                  </div>
                </div>
                <IconButton icon={Trash2} label="Disconnect TikTok account" size="sm" onClick={() => setConfirm(acc)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill tone={acc.connected ? 'good' : 'bad'}>{acc.connected ? 'Connected' : 'Reconnect needed'}</Pill>
                <Select value={acc.mode || 'inbox'} onChange={(e) => patch(acc.key, { mode: e.target.value })} aria-label="Posting mode" className="!w-auto">
                  <option value="inbox">To drafts</option><option value="direct">Direct post</option>
                </Select>
                {acc.mode === 'direct' && (
                  <Select value={acc.privacy || 'SELF_ONLY'} onChange={(e) => patch(acc.key, { privacy: e.target.value })} aria-label="Who can see posts" className="!w-auto">
                    {PRIVACY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                )}
              </div>
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Posts clips from</div>
                <div className="flex flex-wrap gap-1.5">
                  {channels.length === 0 && <span className="text-[12px] text-muted">Add streamers under Channels first.</span>}
                  {channels.map((ch) => {
                    const h = ch.channel_id_or_handle;
                    const on = (acc.streamers || []).some((s) => s.toLowerCase().replace(/^@/, '') === h.toLowerCase().replace(/^@/, ''));
                    return (
                      <button key={h} type="button" aria-pressed={on} onClick={() => toggleStreamer(acc, h)}
                        className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold border ${on ? 'bg-accent-strong border-accent-strong text-white' : 'border-line-strong text-slate-300'}`}>
                        {on ? '✓ ' : ''}{ch.display_name || h}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel title="TikTok developer app" icon={Key} className="max-w-2xl">
        <p className="text-xs text-muted mb-3 leading-relaxed">
          Create an app on{' '}
          <a href="https://developers.tiktok.com/apps" target="_blank" rel="noreferrer" className="text-accent inline-flex items-center gap-1 underline underline-offset-2">TikTok for Developers <ExternalLink size={11} /></a>,
          add <b className="text-slate-300">Login Kit</b> and <b className="text-slate-300">Content Posting API</b>, and request the <code className="font-mono">video.upload</code> scope
          (plus <code className="font-mono">video.publish</code> for direct posting).
        </p>
        <form onSubmit={saveCfg} className="space-y-3">
          <Field label="Client key"><Input mono value={keyIn} onChange={(e) => setKeyIn(e.target.value)} autoComplete="off" /></Field>
          <Field label="Client secret">
            <Input mono type="password" value={secretIn} onChange={(e) => setSecretIn(e.target.value)} autoComplete="off"
              placeholder={cfg.has_secret ? '•••••••• (leave blank to keep the saved secret)' : ''} />
          </Field>
          <div className="rounded-xl bg-canvas border border-line p-3 text-[11.5px] text-muted">
            Redirect URI to register in your TikTok app (must be https):
            <div className="mt-1.5 font-mono text-good select-all bg-surface p-2 rounded-lg break-all">{cfg.redirect_uri}</div>
          </div>
          <Button type="submit" variant="primary" disabled={!keyIn || (!secretIn && !cfg.has_secret)}>Save</Button>
        </form>
      </Panel>

      <Confirm open={!!confirm} danger title={`Disconnect ${confirm?.display_name || 'TikTok'}?`} confirmLabel="Disconnect"
        text="The saved TikTok login is removed. Queued TikTok uploads for it will fail until you reconnect."
        onCancel={() => setConfirm(null)} onConfirm={async () => { const a = confirm; setConfirm(null); try { await deleteTikTokAccount(a.key); load(); } catch (x) { err(x); } }} />
    </div>
  );
}
