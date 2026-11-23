import React, { useEffect, useState } from 'react';
import { Copy, Check, KeyRound, ExternalLink } from 'lucide-react';
import { Panel, Field, Input, Button, Notice, Pill } from './ui';
import { getKickAppConfig, saveKickAppConfig } from '../api';

/** Kick developer app: official live status + chat (delivered to our webhook). Optional - without it
 *  Kick streamers are still recorded and clipped from audio peaks. */
export default function KickApp() {
  const [cfg, setCfg] = useState(null);
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getKickAppConfig().then((c) => { setCfg(c); setId(c.client_id || ''); }).catch(() => setCfg({ client_id: '', has_secret: false, webhook_url: '' }));
  }, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await saveKickAppConfig({ client_id: id.trim(), client_secret: secret.trim() || undefined });
      setCfg((c) => ({ ...c, client_id: id.trim(), has_secret: c.has_secret || !!secret.trim() }));
      setSecret('');
      setMsg({ tone: 'good', text: 'Kick app connected. Chat from live Kick streamers now feeds clip detection.' });
    } catch (e) {
      setMsg({ tone: 'bad', text: e?.response?.data?.error || e.message });
    } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(cfg.webhook_url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  const ready = cfg?.client_id && cfg?.has_secret;

  return (
    <Panel title="Kick app (live status & chat)" icon={KeyRound} right={cfg && <Pill tone={ready ? 'good' : 'idle'}>{ready ? 'Connected' : 'Not set up'}</Pill>} data-testid="kick-app">
      <p className="text-[12px] text-muted mb-3 leading-snug">
        Kick streamers are recorded and clipped from loud moments without this. Add a Kick developer app so chat spikes,
        emote walls and keywords trigger clips too, the same as Twitch.
      </p>
      <ol className="text-[12px] text-slate-300 list-decimal pl-4 space-y-1 mb-3">
        <li>Create an app at <a className="text-accent inline-flex items-center gap-0.5" href="https://kick.com/settings/developer" target="_blank" rel="noreferrer">kick.com/settings/developer <ExternalLink size={11} /></a> and turn on <b>Webhooks</b>.</li>
        <li>Set its webhook URL to this address:</li>
      </ol>
      {cfg?.webhook_url && (
        <div className="flex items-center gap-2 rounded-lg bg-canvas border border-line p-2 mb-3">
          <code className="font-mono text-[11px] text-good break-all flex-1 select-all">{cfg.webhook_url}</code>
          <button type="button" onClick={copy} aria-label="Copy webhook URL" className="w-9 h-9 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center text-muted">
            {copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
          </button>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Client ID"><Input mono value={id} onChange={(e) => setId(e.target.value)} placeholder="01K…" aria-label="Kick client ID" /></Field>
        <Field label="Client secret" hint={cfg?.has_secret ? 'Saved - leave empty to keep it.' : undefined}>
          <Input mono type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={cfg?.has_secret ? '••••••••' : ''} aria-label="Kick client secret" />
        </Field>
      </div>
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
      <div className="flex justify-end mt-3">
        <Button variant="primary" loading={busy} disabled={!id.trim() || (!secret.trim() && !cfg?.has_secret)} onClick={save}>Save & test</Button>
      </div>
    </Panel>
  );
}
