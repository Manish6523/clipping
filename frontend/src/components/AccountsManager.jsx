import React, { useState, useEffect } from 'react';
import { 
  Video, 
  Key, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink, 
  ShieldCheck, 
  ArrowRight, 
  RefreshCw,
  Users,
  Share2,
  FileJson,
  Layers,
  Radio,
  PlaySquare,
  Sliders,
  Zap,
  Globe,
  Lock,
  Eye,
  SlidersHorizontal
} from 'lucide-react';

const YoutubeIcon = ({ size = 20, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);
import {
  getYouTubeAppConfig,
  saveYouTubeAppConfig,
  getYouTubeAuthUrl,
  getYouTubeAccounts,
  patchYouTubeAccountConfig,
  deleteYouTubeAccount,
  importYouTubeAccount,
  getYouTubeMappings,
  setYouTubeMappings,
  getChannels
} from '../api';

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
      alert('Both Client ID and Client Secret are required.');
      return;
    }
    try {
      await saveYouTubeAppConfig({ client_id: clientIdInput, client_secret: clientSecretInput });
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 3000);
      loadAll();
      showToast('Google OAuth Credentials Saved!');
    } catch (err) {
      alert('Failed to save OAuth credentials: ' + err.message);
    }
  };

  const handleStartOAuth = async () => {
    const key = newAccountKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key) {
      alert('Please enter a unique key for this YouTube account (e.g. main_channel, clips_hub)');
      return;
    }
    if (!appConfig.client_id || !appConfig.has_secret) {
      alert('Please configure your Google OAuth Client ID & Secret in the Setup tab first.');
      setActiveTab('oauth_setup');
      return;
    }

    setIsAuthorizing(true);
    try {
      const { auth_url } = await getYouTubeAuthUrl(key);
      // Redirect to Google OAuth consent
      window.location.href = auth_url;
    } catch (err) {
      alert('Could not start OAuth: ' + (err.response?.data?.error || err.message));
      setIsAuthorizing(false);
    }
  };

  const handleDeleteAccount = async (key) => {
    if (!window.confirm(`Disconnect and remove YouTube account "${key}"?`)) return;
    try {
      await deleteYouTubeAccount(key);
      showToast(`Account "${key}" disconnected.`);
      loadAll();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleImportJson = async () => {
    if (!importKey.trim() || !importJsonText.trim()) {
      alert('Please provide both an account key and valid JSON credentials.');
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
      alert('Invalid JSON or import error: ' + err.message);
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
      alert('Failed to update mapping: ' + err.message);
    }
  };

  const handleUpdateAccountSettings = async (accountKey, changes) => {
    try {
      await patchYouTubeAccountConfig(accountKey, changes);
      showToast(`Updated settings for "${accountKey}"`);
      loadAll();
    } catch (err) {
      alert('Failed to update account settings: ' + err.message);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 text-slate-100 select-none animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500 to-red-600 flex items-center justify-center text-white shadow-lg shadow-rose-500/25">
            <YoutubeIcon size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-black text-white tracking-tight">YouTube & Multi-Account Distribution</h1>
              {feedback && (
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 rounded-full animate-in fade-in">
                  <CheckCircle2 size={12} /> {feedback}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Connect multiple YouTube channels and map streamers to broadcast highlights automatically.
            </p>
          </div>
        </div>

        {/* Tab Switcher (Scrollable horizontally on mobile) */}
        <div className="flex items-center gap-1 bg-[#0E121B] p-1 rounded-xl border border-white/[0.08] overflow-x-auto max-w-full custom-scrollbar">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === 'accounts'
                ? 'bg-[#8FD3FF] text-[#0A0D14] shadow-md shadow-[#8FD3FF]/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <YoutubeIcon size={14} /> Connected Accounts ({accounts.length})
          </button>
          <button
            onClick={() => setActiveTab('mappings')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === 'mappings'
                ? 'bg-[#8FD3FF] text-[#0A0D14] shadow-md shadow-[#8FD3FF]/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Share2 size={14} /> Streamer Mappings
          </button>
          <button
            onClick={() => setActiveTab('oauth_setup')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === 'oauth_setup'
                ? 'bg-[#8FD3FF] text-[#0A0D14] shadow-md shadow-[#8FD3FF]/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Key size={14} /> Google App Credentials
          </button>
        </div>
      </div>

      {/* TAB 1: CONNECTED ACCOUNTS */}
      {activeTab === 'accounts' && (
        <div className="mt-6 space-y-6">
          {/* Connect New Account Card */}
          <div className="bg-[#0E121B] border border-white/[0.08] rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <Plus size={16} className="text-[#8FD3FF]" /> Connect a YouTube Channel
            </h3>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  placeholder="Account Key (e.g. main_channel, speed_shorts, gaming_clips)"
                  value={newAccountKey}
                  onChange={(e) => setNewAccountKey(e.target.value)}
                  className="w-full bg-[#141824] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#8FD3FF]"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleStartOAuth}
                  disabled={isAuthorizing}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-red-600/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  <YoutubeIcon size={16} />
                  {isAuthorizing ? 'Redirecting to Google...' : 'Sign in with YouTube'}
                </button>

                <button
                  onClick={() => setShowImportModal(true)}
                  className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-slate-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border border-white/[0.08]"
                  title="Import token JSON manually"
                >
                  <FileJson size={14} /> Import JSON
                </button>
              </div>
            </div>
          </div>

          {/* Accounts Grid */}
          <div>
            <h3 className="text-xs uppercase font-extrabold tracking-wider text-slate-400 mb-3">
              Active YouTube Destinations
            </h3>
            {accounts.length === 0 ? (
              <div className="bg-[#0E121B] border border-white/[0.08] rounded-2xl p-10 text-center text-slate-500">
                <YoutubeIcon size={36} className="mx-auto mb-2 text-slate-600 opacity-60" />
                <p className="text-xs">No YouTube accounts connected yet.</p>
                <p className="text-[11px] text-slate-600 mt-1">Connect your first channel above to start automated uploading.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {accounts.map((acc) => (
                  <div
                    key={acc.account_key}
                    className="bg-[#0E121B] border border-white/[0.08] hover:border-white/20 rounded-2xl p-4 flex flex-col justify-between transition-all group"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          {acc.thumbnail_url ? (
                            <img
                              src={acc.thumbnail_url}
                              alt={acc.channel_title}
                              referrerPolicy="no-referrer"
                              onError={(e) => { e.target.style.display = 'none'; }}
                              className="w-9 h-9 rounded-full border border-white/10 object-cover"
                            />
                          ) : null}
                          {(!acc.thumbnail_url) && (
                            <div className="w-9 h-9 rounded-full bg-red-600/20 text-red-400 border border-red-500/30 flex items-center justify-center font-bold text-xs">
                              YT
                            </div>
                          )}
                          <div>
                            <div className="text-xs font-bold text-white group-hover:text-[#8FD3FF] transition-colors truncate max-w-[160px]">
                              {acc.channel_title}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              key: <span className="text-amber-400 font-bold">{acc.account_key}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeleteAccount(acc.account_key)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Disconnect account"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400 bg-white/[0.03] p-2 rounded-xl border border-white/[0.04]">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="font-semibold text-emerald-400">Authenticated & Ready</span>
                        {acc.custom_url && (
                          <span className="ml-auto text-slate-500 font-mono truncate max-w-[120px]">
                            {acc.custom_url}
                          </span>
                        )}
                      </div>

                      {/* Automation & Policy Controls */}
                      <div className="mt-3.5 pt-3 border-t border-white/[0.06] space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Zap size={13} className={acc.auto_upload ? "text-amber-400" : "text-slate-500"} />
                            <span className="text-[11px] font-bold text-white">Auto-Pilot Upload</span>
                          </div>
                          <button
                            onClick={() => handleUpdateAccountSettings(acc.account_key, {
                              auto_upload: !acc.auto_upload,
                              min_score_threshold: acc.min_score_threshold || 75,
                              drip_delay_hours: acc.drip_delay_hours || 4,
                              privacy_status: acc.privacy_status || 'public',
                              tag_override: acc.tag_override || '#Shorts #Viral #Gaming'
                            })}
                            className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                              acc.auto_upload ? 'bg-amber-500' : 'bg-slate-700'
                            }`}
                          >
                            <span className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${
                              acc.auto_upload ? 'left-4.5' : 'left-1'
                            }`} />
                          </button>
                        </div>

                        {acc.auto_upload ? (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 space-y-2 animate-in fade-in">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">Min Virality Score:</span>
                              <div className="flex items-center gap-1">
                                <span className="font-bold font-mono text-amber-400">{acc.min_score_threshold || 75}</span>
                                <span className="text-[9px] text-slate-500">/ 100</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={50}
                              max={95}
                              step={5}
                              value={acc.min_score_threshold || 75}
                              onChange={(e) => handleUpdateAccountSettings(acc.account_key, {
                                auto_upload: true,
                                min_score_threshold: Number(e.target.value),
                                drip_delay_hours: acc.drip_delay_hours || 4,
                                privacy_status: acc.privacy_status || 'public',
                                tag_override: acc.tag_override || '#Shorts #Viral #Gaming'
                              })}
                              className="w-full accent-amber-500 cursor-pointer h-1 bg-black/40 rounded-lg"
                            />

                            <div className="grid grid-cols-2 gap-2 pt-1 text-[10px]">
                              <div>
                                <label className="text-slate-400 block mb-0.5">Drip Interval:</label>
                                <select
                                  value={acc.drip_delay_hours || 4}
                                  onChange={(e) => handleUpdateAccountSettings(acc.account_key, {
                                    auto_upload: true,
                                    min_score_threshold: acc.min_score_threshold || 75,
                                    drip_delay_hours: Number(e.target.value),
                                    privacy_status: acc.privacy_status || 'public',
                                    tag_override: acc.tag_override || '#Shorts #Viral #Gaming'
                                  })}
                                  className="w-full bg-[#141824] border border-white/10 rounded px-1.5 py-1 text-white text-[10px] font-mono"
                                >
                                  <option value={1}>Every 1 hr</option>
                                  <option value={2}>Every 2 hrs</option>
                                  <option value={4}>Every 4 hrs</option>
                                  <option value={6}>Every 6 hrs</option>
                                  <option value={8}>Every 8 hrs</option>
                                </select>
                              </div>

                              <div>
                                <label className="text-slate-400 block mb-0.5">Privacy:</label>
                                <select
                                  value={acc.privacy_status || 'public'}
                                  onChange={(e) => handleUpdateAccountSettings(acc.account_key, {
                                    auto_upload: true,
                                    min_score_threshold: acc.min_score_threshold || 75,
                                    drip_delay_hours: acc.drip_delay_hours || 4,
                                    privacy_status: e.target.value,
                                    tag_override: acc.tag_override || '#Shorts #Viral #Gaming'
                                  })}
                                  className="w-full bg-[#141824] border border-white/10 rounded px-1.5 py-1 text-white text-[10px] font-mono"
                                >
                                  <option value="public">Public</option>
                                  <option value="unlisted">Unlisted</option>
                                  <option value="private">Private</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 bg-white/[0.02] p-2 rounded-xl flex items-center gap-1.5">
                            <ShieldCheck size={12} className="text-[#8FD3FF]" />
                            <span>Requires manual approval in Review Station.</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-400">
                      <span>Mapped to:</span>
                      <span className="font-bold text-white">
                        {mappings.filter((m) => m.account_key === acc.account_key).length} streamers
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: STREAMER MAPPINGS (1-to-MANY) */}
      {activeTab === 'mappings' && (
        <div className="mt-6 space-y-6">
          <div className="bg-[#0E121B] border border-white/[0.08] rounded-2xl p-5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <Share2 size={16} className="text-[#8FD3FF]" /> Streamer-to-YouTube Distribution Matrix
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Check which YouTube channel(s) should automatically receive clips when generated for each streamer. One streamer can upload to multiple channels simultaneously!
            </p>

            {channels.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No streamers registered in Channels & Live yet.</p>
            ) : accounts.length === 0 ? (
              <div className="p-6 text-center text-slate-500">
                <AlertTriangle size={24} className="mx-auto mb-2 text-amber-400" />
                <p className="text-xs text-amber-300 font-bold">Please connect at least one YouTube Account first.</p>
                <button
                  onClick={() => setActiveTab('accounts')}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-[#8FD3FF] text-[#0A0D14] text-xs font-bold"
                >
                  Go to Connected Accounts
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs min-w-[500px]">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-slate-400 uppercase text-[10px] font-mono">
                      <th className="py-3 px-4">Streamer Channel</th>
                      {accounts.map((acc) => (
                        <th key={acc.account_key} className="py-3 px-4 text-center">
                          <div className="font-bold text-white">{acc.channel_title}</div>
                          <div className="text-[9px] text-amber-400 font-mono">({acc.account_key})</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {channels.map((ch) => {
                      const handle = ch.channel_id_or_handle;
                      return (
                        <tr key={handle} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                            <Radio size={14} className="text-[#8FD3FF]" />
                            <span>{handle}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 uppercase">
                              {ch.platform}
                            </span>
                          </td>

                          {accounts.map((acc) => {
                            const isChecked = mappings.some(
                              (m) =>
                                m.streamer_handle.toLowerCase() === handle.toLowerCase() &&
                                m.account_key === acc.account_key
                            );

                            return (
                              <td key={acc.account_key} className="py-3.5 px-4 text-center">
                                <label className="inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleStreamerAccountMapping(handle, acc.account_key)}
                                    className="w-4 h-4 rounded bg-[#141824] border-white/20 text-[#8FD3FF] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#8FD3FF]"
                                  />
                                </label>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: OAUTH APP SETUP */}
      {activeTab === 'oauth_setup' && (
        <div className="mt-6 max-w-2xl bg-[#0E121B] border border-white/[0.08] rounded-2xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
            <Key size={16} className="text-[#8FD3FF]" /> Google Cloud OAuth App Credentials
          </h3>
          <p className="text-xs text-slate-400 mb-5 leading-relaxed">
            To enable the 1-click <b>"Sign in with YouTube"</b> flow, configure your OAuth Client ID and Secret from the{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="text-[#8FD3FF] underline hover:text-white inline-flex items-center gap-1"
            >
              Google Cloud Console <ExternalLink size={11} />
            </a>.
          </p>

          <form onSubmit={handleSaveAppConfig} className="space-y-4">
            <div>
              <label className="block text-[11px] uppercase font-bold text-slate-400 mb-1">
                OAuth 2.0 Client ID
              </label>
              <input
                type="text"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                placeholder="xxxx-xxxxxxxxxx.apps.googleusercontent.com"
                className="w-full bg-[#141824] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-[#8FD3FF]"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase font-bold text-slate-400 mb-1">
                OAuth 2.0 Client Secret
              </label>
              <input
                type="password"
                value={clientSecretInput}
                onChange={(e) => setClientSecretInput(e.target.value)}
                placeholder={appConfig.has_secret ? '•••••••••••••••• (Leave blank to keep existing)' : 'GOCSPX-xxxxxxxxxxxxx'}
                className="w-full bg-[#141824] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-[#8FD3FF]"
              />
            </div>

            <div className="p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-[11px] text-slate-400">
              <span className="font-bold text-white">Authorized redirect URI to register in Google Console:</span>
              <div className="mt-1 font-mono text-emerald-400 select-all bg-black/40 p-1.5 rounded">
                http://localhost:8080/api/youtube/oauth2callback
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-[#8FD3FF] hover:bg-[#A9B8FF] text-[#0A0D14] text-xs font-black shadow-lg shadow-[#8FD3FF]/20 transition-all cursor-pointer"
              >
                Save Credentials
              </button>
              {configSuccess && (
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={14} /> Saved!
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Manual JSON Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0E121B] border border-white/10 rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-in zoom-in-95">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <FileJson size={16} className="text-[#8FD3FF]" /> Import OAuth Token JSON
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Paste the contents of your existing token file (containing <code className="text-amber-400">refresh_token</code>, <code className="text-amber-400">client_id</code>, etc.).
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">Account Key</label>
                <input
                  type="text"
                  placeholder="e.g. main_channel"
                  value={importKey}
                  onChange={(e) => setImportKey(e.target.value)}
                  className="w-full bg-[#141824] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8FD3FF]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">Token JSON</label>
                <textarea
                  rows={6}
                  placeholder='{"client_id": "...", "client_secret": "...", "refresh_token": "..."}'
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  className="w-full bg-[#141824] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-[#8FD3FF]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleImportJson}
                className="px-4 py-2 rounded-xl bg-[#8FD3FF] text-[#0A0D14] text-xs font-bold shadow-md shadow-[#8FD3FF]/20"
              >
                Import Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
