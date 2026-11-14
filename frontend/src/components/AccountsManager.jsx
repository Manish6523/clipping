import React, { useState, useEffect } from 'react';
import ChannelPublishing from './ChannelPublishing';
import { Plus, Trash2, CheckCircle2, AlertTriangle, ExternalLink, Share2, FileJson, Radio, Key } from 'lucide-react';
import {
  getYouTubeAppConfig, saveYouTubeAppConfig, getYouTubeAuthUrl, getYouTubeAccounts, patchYouTubeAccountConfig,
  deleteYouTubeAccount, importYouTubeAccount, getYouTubeMappings, setYouTubeMappings, getChannels,
} from '../api';
import {
  Page, Panel, Segmented, Button, IconButton, Input, Textarea, Field, Pill, Notice, EmptyState, Sheet, Confirm, Checkbox,
} from './ui';

const YoutubeIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export default function AccountsManager() {
  const [appConfig, setAppConfig] = useState({ client_id: '', has_secret: false });
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [configSuccess, setConfigSuccess] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [channels, setChannels] = useState([]);
  const [mappings, setMappings] = useState([]);

  const [newAccountKey, setNewAccountKey] = useState('');
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [activeTab, setActiveTab] = useState('accounts'); // 'accounts' | 'mappings' | 'oauth_setup'

  // Manual Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [importJsonText, setImportJsonText] = useState('');

  useEffect(() => {
    loadAll();
    // Check if redirected from Google OAuth
    const params = new URLSearchParams(window.location.search);
    const connectedKey = params.get('connected');
    if (connectedKey) {
      showToast(`YouTube Account "${connectedKey}" connected successfully!`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const showToast = (msg) => {
    setError('');
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadAll = async () => {
    try {
      const [cfg, accs, chs, maps] = await Promise.all([
        getYouTubeAppConfig(),
        getYouTubeAccounts(),
        getChannels(),
        getYouTubeMappings()
      ]);
      setAppConfig(cfg);
      setClientIdInput(cfg.client_id || '');
      setAccounts(accs);
      setChannels(chs);
      setMappings(maps);
    } catch (err) {
      console.error('Failed to load accounts state:', err);
    }
  };

  const handleSaveAppConfig = async (e) => {
    e.preventDefault();
    if (!clientIdInput.trim() || !clientSecretInput.trim()) {
      setError('Both Client ID and Client Secret are required.');
      return;
    }
    try {
      await saveYouTubeAppConfig({ client_id: clientIdInput, client_secret: clientSecretInput });
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 3000);
      loadAll();
      showToast('Google OAuth Credentials Saved!');
    } catch (err) {
      setError(`Could not save the credentials: ${err.message}`);
    }
  };

  const handleStartOAuth = async () => {
    const key = newAccountKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key) {
      setError('Enter a unique key for this YouTube account first (for example main_channel).');
      return;
    }
    if (!appConfig.client_id || !appConfig.has_secret) {
      setError('Add your Google OAuth Client ID and Secret in the Google app tab first.');
      setActiveTab('oauth_setup');
      return;
    }

    setIsAuthorizing(true);
    try {
      const { auth_url } = await getYouTubeAuthUrl(key);
      // Redirect to Google OAuth consent
      window.location.href = auth_url;
    } catch (err) {
      setError(`Could not start sign-in: ${err.response?.data?.error || err.message}`);
      setIsAuthorizing(false);
    }
  };

  const handleDeleteAccount = async (key) => {
    setConfirmDelete(null);
    try {
      await deleteYouTubeAccount(key);
      showToast(`Account "${key}" disconnected.`);
      loadAll();
    } catch (err) {
      setError(`Could not remove the account: ${err.message}`);
    }
  };

  const handleImportJson = async () => {
    if (!importKey.trim() || !importJsonText.trim()) {
      setError('Provide both an account key and the token JSON.');
      return;
    }
    try {
      const parsed = JSON.parse(importJsonText);
      await importYouTubeAccount({ account_key: importKey.trim(), token_json: parsed });
      setShowImportModal(false);
      setImportKey('');
      setImportJsonText('');
      showToast(`Imported account "${importKey}"!`);
      loadAll();
    } catch (err) {
      setError(`Invalid JSON or import error: ${err.message}`);
    }
  };

  const toggleStreamerAccountMapping = async (streamerHandle, accountKey) => {
    // Current keys for this streamer
    const currentKeys = mappings
      .filter((m) => m.streamer_handle.toLowerCase() === streamerHandle.toLowerCase())
      .map((m) => m.account_key);

    const isMapped = currentKeys.includes(accountKey);
    const newKeys = isMapped
      ? currentKeys.filter((k) => k !== accountKey)
      : [...currentKeys, accountKey];

    try {
      await setYouTubeMappings({ streamer_handle: streamerHandle, account_keys: newKeys });
      const updated = await getYouTubeMappings();
      setMappings(updated);
      showToast(`Updated mappings for ${streamerHandle}`);
    } catch (err) {
      setError(`Could not update the mapping: ${err.message}`);
    }
  };

  const handleUpdateAccountSettings = async (accountKey, changes) => {
    try {
      await patchYouTubeAccountConfig(accountKey, changes);
      showToast(`Updated settings for "${accountKey}"`);
      loadAll();
    } catch (err) {
      setError(`Could not update the account: ${err.message}`);
    }
  };

  const tabs = [
    { value: 'accounts', label: 'Accounts', icon: () => <YoutubeIcon size={13} />, count: accounts.length },
    { value: 'mappings', label: 'Mappings', icon: Share2 },
    { value: 'oauth_setup', label: 'Google app', icon: Key },
  ];
  const isMapped = (handle, key) => mappings.some((m) => m.streamer_handle.toLowerCase() === handle.toLowerCase() && m.account_key === key);

  return (
    <Page title="Distribution" icon={() => <YoutubeIcon size={20} />}
      subtitle="Connect YouTube channels, choose which streamer posts where, and set each channel's schedule."
      actions={<Segmented value={activeTab} onChange={setActiveTab} options={tabs} ariaLabel="Section" />}>
      {feedback && <Notice tone="good" icon={CheckCircle2}>{feedback}</Notice>}
      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}

      {activeTab === 'accounts' && (
        <>
          <Panel title="Connect a YouTube channel" icon={Plus}>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input value={newAccountKey} onChange={(e) => setNewAccountKey(e.target.value)} placeholder="Account key, e.g. chaos_live"
                aria-label="Account key" className="flex-1" />
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1 sm:flex-none !bg-[#e11d48] hover:!bg-[#be123c]" loading={isAuthorizing} onClick={handleStartOAuth}>
                  <YoutubeIcon size={16} /> {isAuthorizing ? 'Opening Google…' : 'Sign in with YouTube'}
                </Button>
                <Button icon={FileJson} onClick={() => setShowImportModal(true)} title="Import a token file manually">Import</Button>
              </div>
            </div>
          </Panel>

          {accounts.length === 0 ? (
            <Panel><EmptyState icon={() => <YoutubeIcon size={30} className="mx-auto" />} title="No YouTube channels connected" text="Connect your first channel above to start automatic uploading." /></Panel>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
              {accounts.map((acc) => (
                <Panel key={acc.account_key} className="!p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {acc.thumbnail_url ? (
                        <img src={acc.thumbnail_url} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="w-10 h-10 rounded-full border border-line-strong object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-bad/15 text-bad flex items-center justify-center shrink-0"><YoutubeIcon size={18} /></div>
                      )}
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold text-ink truncate">{acc.channel_title}</div>
                        <div className="text-[11px] text-muted font-mono truncate">{acc.account_key}{acc.custom_url ? ` · ${acc.custom_url}` : ''}</div>
                      </div>
                    </div>
                    <IconButton icon={Trash2} label="Disconnect account" size="sm" className="hover:!text-bad" onClick={() => setConfirmDelete(acc.account_key)} />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <Pill tone="good">Connected</Pill>
                    <span className="text-[11px] text-muted">{mappings.filter((m) => m.account_key === acc.account_key).length} streamer(s) mapped</span>
                  </div>
                  <ChannelPublishing acc={acc} onUpdate={(changes) => handleUpdateAccountSettings(acc.account_key, changes)} />
                </Panel>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'mappings' && (
        <Panel title="Which channel does each streamer post to?" icon={Share2}>
          <p className="text-xs text-muted mb-3">Tick the YouTube channels that should receive clips for each streamer. One streamer can post to several channels - each channel gets its own scheduled copy.</p>
          {channels.length === 0 ? (
            <EmptyState icon={Radio} title="No streamers yet" text="Add a streamer under Channels first." className="!py-6" />
          ) : accounts.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Connect a YouTube channel first" action={<Button variant="primary" onClick={() => setActiveTab('accounts')}>Go to accounts</Button>} className="!py-6" />
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {channels.map((ch) => {
                const handle = ch.channel_id_or_handle;
                const mappedCount = accounts.filter((a) => isMapped(handle, a.account_key)).length;
                return (
                  <div key={handle} className="rounded-xl bg-canvas border border-line p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-semibold text-ink text-[13px] truncate">{ch.display_name || handle}</span>
                      <Pill dot={false} className="uppercase !text-[10px]">{ch.platform}</Pill>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {accounts.map((acc) => {
                        const on = isMapped(handle, acc.account_key);
                        return (
                          <button key={acc.account_key} type="button" aria-pressed={on} onClick={() => toggleStreamerAccountMapping(handle, acc.account_key)}
                            className={`h-9 px-3 rounded-xl text-xs font-semibold border transition-colors ${on ? 'bg-accent-strong border-accent-strong text-white' : 'border-line-strong text-slate-300 hover:bg-white/[0.05]'}`}>
                            {on ? '✓ ' : ''}{acc.channel_title}
                          </button>
                        );
                      })}
                    </div>
                    {mappedCount === 0 && <p className="text-[11px] text-warn mt-2">Not posting anywhere yet</p>}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {activeTab === 'oauth_setup' && (
        <Panel title="Google Cloud OAuth app" icon={Key} className="max-w-2xl">
          <p className="text-xs text-muted mb-4 leading-relaxed">
            To use one-tap <b className="text-slate-300">Sign in with YouTube</b>, add the OAuth Client ID and Secret from the{' '}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-accent inline-flex items-center gap-1 underline underline-offset-2">
              Google Cloud Console <ExternalLink size={11} />
            </a>.
          </p>
          <form onSubmit={handleSaveAppConfig} className="space-y-3.5">
            <Field label="OAuth client ID">
              <Input mono value={clientIdInput} onChange={(e) => setClientIdInput(e.target.value)} placeholder="xxxx-xxxxxxxx.apps.googleusercontent.com" autoComplete="off" />
            </Field>
            <Field label="OAuth client secret">
              <Input mono type="password" value={clientSecretInput} onChange={(e) => setClientSecretInput(e.target.value)} autoComplete="off"
                placeholder={appConfig.has_secret ? '•••••••• (leave blank to keep the saved secret)' : 'GOCSPX-…'} />
            </Field>
            <div className="rounded-xl bg-canvas border border-line p-3 text-[11.5px] text-muted">
              Authorised redirect URI to register in Google Console:
              <div className="mt-1.5 font-mono text-good select-all bg-surface p-2 rounded-lg break-all">{`${window.location.origin}/api/youtube/oauth2callback`}</div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary">Save credentials</Button>
              {configSuccess && <span className="text-xs font-semibold text-good flex items-center gap-1"><CheckCircle2 size={14} /> Saved</span>}
            </div>
          </form>
        </Panel>
      )}

      <Sheet open={showImportModal} onClose={() => setShowImportModal(false)} title="Import OAuth token JSON"
        footer={<div className="flex gap-2"><Button block onClick={() => setShowImportModal(false)}>Cancel</Button><Button block variant="primary" onClick={handleImportJson}>Import account</Button></div>}>
        <p className="text-xs text-muted mb-3">Paste the contents of an existing token file (with <code className="font-mono text-slate-300">refresh_token</code>, <code className="font-mono text-slate-300">client_id</code> …).</p>
        <div className="space-y-3">
          <Field label="Account key"><Input value={importKey} onChange={(e) => setImportKey(e.target.value)} placeholder="e.g. main_channel" /></Field>
          <Field label="Token JSON"><Textarea rows={6} className="font-mono !text-xs" value={importJsonText} onChange={(e) => setImportJsonText(e.target.value)} placeholder='{"client_id": "...", "client_secret": "...", "refresh_token": "..."}' /></Field>
        </div>
      </Sheet>

      <Confirm open={!!confirmDelete} danger title={`Disconnect "${confirmDelete}"?`} confirmLabel="Disconnect"
        text="The saved login for this YouTube channel is removed. Clips already uploaded stay on YouTube; queued ones for this channel won't post."
        onCancel={() => setConfirmDelete(null)} onConfirm={() => handleDeleteAccount(confirmDelete)} />
    </Page>
  );
}
