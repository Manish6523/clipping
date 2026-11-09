import React, { useState, useEffect, useMemo } from 'react';
import { 
  Radio, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  ExternalLink,
  Pause, 
  Play, 
  Settings, 
  Flame, 
  X, 
  Save, 
  AlertTriangle,
  Tag,
  Folder,
  Layers,
  RefreshCw,
  Search,
  Filter,
  Tv,
  Check
} from 'lucide-react';
import { 
  getChannels, 
  addChannel, 
  removeChannel, 
  getStreamers, 
  getTemplates,
  pauseChannel,
  resumeChannel,
  patchChannelSettings
} from '../api';

const DEFAULT_GROUPS = ['Casual Gaming', 'GTA RP', 'Valorant', 'IRL', 'Shooters', 'Reaction', 'General'];

export default function ChannelManager() {
  const [channels, setChannels] = useState([]);
  const [streamers, setStreamers] = useState({});
  const [templates, setTemplates] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newChannel, setNewChannel] = useState('');
  const [newPlatform, setNewPlatform] = useState('twitch');
  const [newTemplate, setNewTemplate] = useState('');
  const [newGroupTag, setNewGroupTag] = useState('Casual Gaming');
  const [customGroupInput, setCustomGroupInput] = useState('');
  const [isAddingLoading, setIsAddingLoading] = useState(false);

  // Group filter & search state
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Pause Modal
  const [pauseModalChannel, setPauseModalChannel] = useState(null);
  const [pauseImmediate, setPauseImmediate] = useState(false);
  const [pauseReason, setPauseReason] = useState('Manual maintenance');

  // Settings Drawer
  const [drawerChannel, setDrawerChannel] = useState(null);
  const [drawerForm, setDrawerForm] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isRefreshingAvatar, setIsRefreshingAvatar] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [chanData, streamData, templData] = await Promise.all([
        getChannels(),
        getStreamers(),
        getTemplates()
      ]);
      setChannels(chanData);
      setStreamers(streamData);
      setTemplates(templData);
      if (templData && templData.length > 0 && !newTemplate) {
        setNewTemplate(templData[0].name);
      }
    } catch (err) {
      console.error('Failed to load channel data:', err);
    }
  };

  // Collect distinct groups from existing channels + defaults
  const availableGroups = useMemo(() => {
    const s = new Set(DEFAULT_GROUPS);
    channels.forEach(c => {
      if (c.group_tag && c.group_tag.trim()) {
        s.add(c.group_tag.trim());
      }
    });
    return Array.from(s);
  }, [channels]);

  // Filter channels by selected group and search
  const filteredChannels = useMemo(() => {
    return channels.filter(c => {
      const matchesGroup = selectedGroup === 'all' || (c.group_tag || 'General').toLowerCase() === selectedGroup.toLowerCase();
      const name = (c.display_name || c.channel_id_or_handle || '').toLowerCase();
      const handle = (c.channel_id_or_handle || '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || name.includes(q) || handle.includes(q);
      return matchesGroup && matchesSearch;
    });
  }, [channels, selectedGroup, searchQuery]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newChannel.trim()) return;

    const group = (customGroupInput.trim() || newGroupTag.trim() || 'General');
    setIsAddingLoading(true);

    try {
      await addChannel({
        platform: newPlatform,
        channel: newChannel.trim(),
        template: newTemplate,
        group_tag: group,
      });
      setNewChannel('');
      setCustomGroupInput('');
      setShowAddModal(false);
      await fetchData();
    } catch (err) {
      alert('Failed to add channel: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setIsAddingLoading(false);
    }
  };

  const handleTogglePause = async (c) => {
    if (c.enabled === 1) {
      setPauseModalChannel(c);
      setPauseReason('Manual pause');
      setPauseImmediate(false);
    } else {
      try {
        await resumeChannel(c.channel_id_or_handle);
        fetchData();
      } catch (err) {
        alert('Failed to resume: ' + err.message);
      }
    }
  };

  const confirmPause = async () => {
    if (!pauseModalChannel) return;
    try {
      await pauseChannel(pauseModalChannel.channel_id_or_handle, pauseReason, pauseImmediate);
      setPauseModalChannel(null);
      fetchData();
    } catch (err) {
      alert('Failed to pause: ' + err.message);
    }
  };

  const openSettings = (c) => {
    setDrawerChannel(c);
    const existing = c.settings || {};
    setDrawerForm({
      display_name: c.display_name || c.channel_id_or_handle,
      template_name: c.template_name || 'custom_gaming_split',
      group_tag: c.group_tag || 'General',
      avatar_url: c.avatar_url || '',
      notes: c.notes || '',
      clip_rules: {
        min_length: existing.clip_rules?.min_length || 15,
        max_length: existing.clip_rules?.max_length || 60,
        min_score: existing.clip_rules?.min_score || 65,
        cooldown: existing.clip_rules?.cooldown || 90,
      },
      detection: {
        chat_spikes: existing.detection?.chat_spikes ?? true,
        audio_peaks: existing.detection?.audio_peaks ?? true,
        gemini_scoring: existing.detection?.gemini_scoring ?? true,
      },
      ai: {
        whisper_model: existing.ai?.whisper_model || 'base',
        gemini_context: existing.ai?.gemini_context || 'Gaming streamer, prioritize funny clips and energetic reactions.',
        persona: existing.ai?.persona || '',
        good_clip_notes: existing.ai?.good_clip_notes || '',
        avoid_notes: existing.ai?.avoid_notes || '',
        inside_jokes: existing.ai?.inside_jokes || '',
      },
      publishing: {
        auto_approve_score: existing.publishing?.auto_approve_score || 95,
        telegram_alerts: existing.publishing?.telegram_alerts ?? true,
      }
    });
    setSaveSuccess(false);
  };

  const saveSettings = async () => {
    if (!drawerChannel || !drawerForm) return;
    const handle = drawerChannel.channel_id_or_handle;
    const updatedTemplate = drawerForm.template_name;
    const updatedDisplay = drawerForm.display_name;
    try {
      await patchChannelSettings(handle, {
        template_name: updatedTemplate,
        display_name: updatedDisplay,
        group_tag: drawerForm.group_tag,
        avatar_url: drawerForm.avatar_url,
        notes: drawerForm.notes,
        settings: {
          clip_rules: drawerForm.clip_rules,
          detection: drawerForm.detection,
          ai: drawerForm.ai,
          publishing: drawerForm.publishing,
        }
      });
      // Optimistically update local channel state
      setChannels((prev) =>
        prev.map((c) =>
          c.channel_id_or_handle === handle
            ? { ...c, template_name: updatedTemplate, display_name: updatedDisplay, group_tag: drawerForm.group_tag, avatar_url: drawerForm.avatar_url }
            : c
        )
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      await fetchData();
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleRefreshAvatar = async () => {
    if (!drawerChannel || !drawerForm) return;
    setIsRefreshingAvatar(true);
    try {
      const res = await patchChannelSettings(drawerChannel.channel_id_or_handle, {
        refresh_avatar: true,
        settings: drawerForm,
      });
      if (res?.avatar_url) {
        setDrawerForm(prev => ({ ...prev, avatar_url: res.avatar_url }));
      }
      await fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshingAvatar(false);
    }
  };

  const handleRemove = async (handle) => {
    if (!confirm(`Stop monitoring channel "${handle}"?`)) return;
    try {
      await removeChannel(handle);
      fetchData();
    } catch (err) {
      alert('Failed to remove channel: ' + err.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Radio className="text-rose-500 animate-pulse" /> Monitored Streamers &amp; Channels
          </h2>
          <p className="text-xs text-[#8B90A0] mt-1">
            Group creators by niche (GTA RP, Casual Gaming, IRL), auto-fetch platform logos, and customize viral detection.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold py-2 px-4 rounded-xl text-xs shadow-lg shadow-indigo-600/25 transition-all shrink-0"
        >
          <Plus size={16} /> Add Streamer
        </button>
      </div>

      {/* Control Bar: Category Group Pills & Search Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-[#0E1118] border border-white/[0.08] p-2.5 rounded-2xl mb-6 shadow-xl">
        {/* Category Group Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 lg:pb-0">
          <button
            onClick={() => setSelectedGroup('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
              selectedGroup === 'all'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.04]'
            }`}
          >
            <Layers size={13} />
            <span>All Channels</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-black/40 rounded-full font-mono">
              {channels.length}
            </span>
          </button>

          {availableGroups.map((grp) => {
            const count = channels.filter(c => (c.group_tag || 'General').toLowerCase() === grp.toLowerCase()).length;
            const isSel = selectedGroup.toLowerCase() === grp.toLowerCase();
            return (
              <button
                key={grp}
                onClick={() => setSelectedGroup(grp)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  isSel
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.04]'
                }`}
              >
                <Tag size={12} className={isSel ? 'text-white' : 'text-indigo-400'} />
                <span>{grp}</span>
                {count > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 bg-black/40 rounded-full font-mono">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search streamer or handle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#141722] border border-white/[0.08] text-white rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Streamers Grid / Cards View */}
      {filteredChannels.length === 0 ? (
        <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center text-slate-500">
            <Radio size={24} />
          </div>
          <span className="text-sm font-bold text-white">No Streamers Found</span>
          <span className="text-xs text-slate-500 max-w-sm">
            {selectedGroup !== 'all'
              ? `No streamers currently assigned to the "${selectedGroup}" group.`
              : 'Add your first streamer by clicking "+ Add Streamer" above.'}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredChannels.map((c) => {
            const streamInfo = streamers[c.channel_id_or_handle] || {};
            const isLive = streamInfo.is_live;
            const isEnabled = c.enabled === 1;
            const platform = (c.platform || 'twitch').toLowerCase();
            const groupName = c.group_tag || 'General';

            return (
              <div
                key={c.id}
                className={`bg-[#0E1118] border rounded-2xl p-4 transition-all flex flex-col justify-between shadow-xl relative overflow-hidden group ${
                  !isEnabled
                    ? 'border-amber-500/20 opacity-70'
                    : isLive
                    ? 'border-rose-500/40 ring-1 ring-rose-500/20'
                    : 'border-white/[0.08] hover:border-white/20'
                }`}
              >
                {/* Live Indicator Accent Bar */}
                {isLive && isEnabled && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-amber-500 animate-pulse" />
                )}

                {/* Card Top: Avatar + Streamer Info + Platform Badge */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar / Logo with Platform Overlay */}
                      <div className="relative shrink-0">
                        {c.avatar_url ? (
                          <img
                            src={c.avatar_url}
                            alt={c.display_name || c.channel_id_or_handle}
                            className="w-12 h-12 rounded-full object-cover border-2 border-white/[0.12] shadow-md"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-900 to-slate-800 border-2 border-white/[0.12] flex items-center justify-center font-extrabold text-indigo-300 text-sm shadow-md">
                            {(c.display_name || c.channel_id_or_handle).substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        {/* Platform Pill Icon */}
                        <span className={`absolute -bottom-1 -right-1 text-[9px] font-black uppercase px-1.5 py-0.2 rounded-full border shadow-sm ${
                          platform === 'twitch'
                            ? 'bg-[#9146FF] text-white border-white/20'
                            : 'bg-[#FF0000] text-white border-white/20'
                        }`}>
                          {platform === 'twitch' ? 'TW' : 'YT'}
                        </span>
                      </div>

                      {/* Name, Handle, and Group Badge */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-white truncate">
                            {c.display_name || c.channel_id_or_handle}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono truncate">
                          @{c.channel_id_or_handle}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center gap-1">
                            <Tag size={10} /> {groupName}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Live/Paused Status Pill */}
                    <div className="shrink-0">
                      {!isEnabled ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-[10px] inline-flex items-center gap-1">
                          PAUSED
                        </span>
                      ) : isLive ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-300 font-bold text-[10px] inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                          LIVE
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-white/[0.06] text-slate-400 font-medium text-[10px]">
                          Offline
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stream Title (if live) or Notes */}
                  {isLive && streamInfo.title ? (
                    <div className="text-[11px] text-slate-300 line-clamp-1 italic mb-3 bg-white/[0.02] p-1.5 rounded-lg border border-white/[0.04]">
                      🔴 {streamInfo.title}
                    </div>
                  ) : c.notes ? (
                    <div className="text-[11px] text-[#8B90A0] line-clamp-1 mb-3">
                      📝 {c.notes}
                    </div>
                  ) : null}

                  {/* Stream & Template Stats Grid */}
                  <div className="grid grid-cols-3 gap-2 bg-[#12151E] p-2 rounded-xl border border-white/[0.04] mb-3">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Layout</span>
                      <span className="text-xs font-mono font-bold text-indigo-300 truncate block" title={c.template_name}>
                        {c.template_name}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Velocity</span>
                      <span className="text-xs font-mono font-bold text-white block">
                        {streamInfo.current_mps ? `${streamInfo.current_mps.toFixed(1)} MPS` : '0.0 MPS'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Clips Today</span>
                      <span className="text-xs font-mono font-bold text-emerald-400 block">
                        {c.clips_today || 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Footer: Action Controls */}
                <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                  <a
                    href={platform === 'twitch' ? `https://twitch.tv/${c.channel_id_or_handle}` : `https://youtube.com/@${c.channel_id_or_handle}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-semibold text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    Open Stream <ExternalLink size={11} />
                  </a>

                  <div className="flex items-center gap-1.5">
                    {/* Pause/Resume Toggle */}
                    <button
                      onClick={() => handleTogglePause(c)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                        isEnabled
                          ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                      }`}
                      title={isEnabled ? "Pause Monitoring" : "Resume Monitoring"}
                    >
                      {isEnabled ? <Pause size={12} /> : <Play size={12} />}
                      <span>{isEnabled ? 'Pause' : 'Resume'}</span>
                    </button>

                    {/* Settings Button */}
                    <button
                      onClick={() => openSettings(c)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors border border-white/[0.04]"
                      title="Settings & Persona"
                    >
                      <Settings size={14} />
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={() => handleRemove(c.channel_id_or_handle)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="Remove Channel"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PAUSE CONFIRMATION MODAL */}
      {pauseModalChannel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0E1118] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Pause className="text-amber-400" size={18} />
              Pause Monitoring for {pauseModalChannel.channel_id_or_handle}
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              While paused, the HLS buffer is stopped and no clips or jobs will be processed for this creator.
            </p>

            <div className="space-y-3 mb-6">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Pause Reason
                </label>
                <input
                  type="text"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  className="w-full bg-[#141722] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={pauseImmediate}
                  onChange={(e) => setPauseImmediate(e.target.checked)}
                  className="rounded border-white/20 bg-slate-950 text-indigo-500"
                />
                Cancel active in-flight rendering jobs immediately
              </label>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setPauseModalChannel(null)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={confirmPause}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs"
              >
                Confirm Pause
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS & PERSONA SLIDE-OVER DRAWER */}
      {drawerChannel && drawerForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-xl bg-[#0E1118] border-l border-white/10 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-[#12151E]">
              <div className="flex items-center gap-3">
                {drawerForm.avatar_url ? (
                  <img
                    src={drawerForm.avatar_url}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover border border-white/20"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-indigo-600/30 border border-indigo-400 flex items-center justify-center font-bold text-white text-xs">
                    {(drawerForm.display_name || 'CH').substring(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h3 className="font-extrabold text-sm text-white">
                    {drawerForm.display_name || drawerChannel.channel_id_or_handle}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    @{drawerChannel.channel_id_or_handle} • {drawerChannel.platform}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDrawerChannel(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Form Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
              {/* Identity & Grouping */}
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Tag size={12} className="text-indigo-400" /> Channel Group &amp; Identity
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Display Name</label>
                    <input
                      type="text"
                      value={drawerForm.display_name}
                      onChange={(e) => setDrawerForm({ ...drawerForm, display_name: e.target.value })}
                      className="w-full bg-[#141722] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-indigo-400 block mb-1 font-bold">Group / Label</label>
                    <input
                      type="text"
                      value={drawerForm.group_tag || ''}
                      onChange={(e) => setDrawerForm({ ...drawerForm, group_tag: e.target.value })}
                      className="w-full bg-[#141722] border border-indigo-500/30 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. GTA RP, Casual Gaming, IRL"
                    />
                  </div>
                </div>

                {/* Avatar URL with Auto-Refresh button */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-slate-400 block">Avatar / Logo Image URL</label>
                    <button
                      type="button"
                      onClick={handleRefreshAvatar}
                      disabled={isRefreshingAvatar}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold"
                    >
                      <RefreshCw size={10} className={isRefreshingAvatar ? 'animate-spin' : ''} />
                      {isRefreshingAvatar ? 'Fetching...' : 'Auto-Fetch Logo'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={drawerForm.avatar_url || ''}
                    onChange={(e) => setDrawerForm({ ...drawerForm, avatar_url: e.target.value })}
                    className="w-full bg-[#141722] border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-300"
                    placeholder="https://static-cdn.jtvnw.net/..."
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Active Visual Template</label>
                  <select
                    value={drawerForm.template_name}
                    onChange={(e) => setDrawerForm({ ...drawerForm, template_name: e.target.value })}
                    className="w-full bg-[#141722] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    {templates.map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Clip Rules */}
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Clip Rules</span>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Min Length (s)</label>
                    <input
                      type="number"
                      value={drawerForm.clip_rules.min_length}
                      onChange={(e) => setDrawerForm({
                        ...drawerForm,
                        clip_rules: { ...drawerForm.clip_rules, min_length: Number(e.target.value) }
                      })}
                      className="w-full bg-[#141722] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Max Length (s)</label>
                    <input
                      type="number"
                      value={drawerForm.clip_rules.max_length}
                      onChange={(e) => setDrawerForm({
                        ...drawerForm,
                        clip_rules: { ...drawerForm.clip_rules, max_length: Number(e.target.value) }
                      })}
                      className="w-full bg-[#141722] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Min Score (/100)</label>
                    <input
                      type="number"
                      value={drawerForm.clip_rules.min_score}
                      onChange={(e) => setDrawerForm({
                        ...drawerForm,
                        clip_rules: { ...drawerForm.clip_rules, min_score: Number(e.target.value) }
                      })}
                      className="w-full bg-[#141722] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {/* AI & Context Prompt */}
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">AI Context &amp; Persona Guidelines</span>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Creator Persona &amp; Niche</label>
                  <textarea
                    rows={2}
                    value={drawerForm.ai.persona || ''}
                    onChange={(e) => setDrawerForm({
                      ...drawerForm,
                      ai: { ...drawerForm.ai, persona: e.target.value }
                    })}
                    className="w-full bg-[#141722] border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. High energy German streamer who unboxes CS cases, screams at rare knives, and talks fast."
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-emerald-400 block mb-1">What Makes a GOOD Clip</label>
                    <textarea
                      rows={2}
                      value={drawerForm.ai.good_clip_notes || ''}
                      onChange={(e) => setDrawerForm({
                        ...drawerForm,
                        ai: { ...drawerForm.ai, good_clip_notes: e.target.value }
                      })}
                      className="w-full bg-[#141722] border border-emerald-500/20 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                      placeholder="e.g. Unboxing gold knives, sudden rage quits, hilarious voice cracks."
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-rose-400 block mb-1">What to AVOID / REJECT</label>
                    <textarea
                      rows={2}
                      value={drawerForm.ai.avoid_notes || ''}
                      onChange={(e) => setDrawerForm({
                        ...drawerForm,
                        ai: { ...drawerForm.ai, avoid_notes: e.target.value }
                      })}
                      className="w-full bg-[#141722] border border-rose-500/20 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-rose-500"
                      placeholder="e.g. Boring inventory sorting, quiet AFK moments, off-topic chat reading."
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-amber-400 block mb-1">Inside Jokes &amp; Key Catchphrases</label>
                  <input
                    type="text"
                    value={drawerForm.ai.inside_jokes || ''}
                    onChange={(e) => setDrawerForm({
                      ...drawerForm,
                      ai: { ...drawerForm.ai, inside_jokes: e.target.value }
                    })}
                    className="w-full bg-[#141722] border border-amber-500/20 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                    placeholder="e.g. gold gold gold, L, W, Cooked, Juicer"
                  />
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-[#12151E]">
              {saveSuccess ? (
                <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
                  <CheckCircle2 size={15} /> Settings Saved &amp; Hot-Reloaded!
                </span>
              ) : <div />}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDrawerChannel(null)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs"
                >
                  Close
                </button>
                <button
                  onClick={saveSettings}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-5 rounded-lg text-xs shadow-lg shadow-indigo-600/20"
                >
                  <Save size={14} /> Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD STREAMER MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0E1118] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-black text-white mb-1 flex items-center gap-2">
              <Plus className="text-indigo-400" size={18} /> Add Streamer to Monitor
            </h3>
            <p className="text-xs text-[#8B90A0] mb-4">
              We'll automatically fetch their Twitch/YouTube avatar and begin tracking moments.
            </p>

            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Channel Handle / Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ohnepixel or ishowspeed"
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  className="w-full bg-[#141722] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Platform
                  </label>
                  <select
                    value={newPlatform}
                    onChange={(e) => setNewPlatform(e.target.value)}
                    className="w-full bg-[#141722] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="twitch">Twitch</option>
                    <option value="youtube">YouTube</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Layout Template
                  </label>
                  <select
                    value={newTemplate}
                    onChange={(e) => setNewTemplate(e.target.value)}
                    className="w-full bg-[#141722] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    {templates.map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Group / Label Preset & Custom */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 block mb-1 flex items-center gap-1.5">
                  <Tag size={12} /> Group / Niche Label
                </label>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {DEFAULT_GROUPS.map((grp) => (
                    <button
                      key={grp}
                      type="button"
                      onClick={() => { setNewGroupTag(grp); setCustomGroupInput(''); }}
                      className={`px-2 py-1.5 rounded-lg text-xs font-semibold border transition-all text-center truncate ${
                        newGroupTag === grp && !customGroupInput
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                          : 'bg-[#141722] text-slate-400 hover:text-white border-white/[0.06]'
                      }`}
                    >
                      {grp}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Or type a custom group (e.g. Minecraft, Poker)..."
                  value={customGroupInput}
                  onChange={(e) => setCustomGroupInput(e.target.value)}
                  className="w-full bg-[#141722] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingLoading}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold rounded-xl text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2"
                >
                  {isAddingLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Fetching Avatar...</span>
                    </>
                  ) : (
                    <span>Add Creator</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
