import React, { useState, useEffect } from 'react';
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
  AlertTriangle
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

export default function ChannelManager() {
  const [channels, setChannels] = useState([]);
  const [streamers, setStreamers] = useState({});
  const [templates, setTemplates] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newChannel, setNewChannel] = useState('');
  const [newPlatform, setNewPlatform] = useState('twitch');
  const [newTemplate, setNewTemplate] = useState('');

  // Pause Modal
  const [pauseModalChannel, setPauseModalChannel] = useState(null);
  const [pauseImmediate, setPauseImmediate] = useState(false);
  const [pauseReason, setPauseReason] = useState('Manual maintenance');

  // Settings Drawer
  const [drawerChannel, setDrawerChannel] = useState(null);
  const [drawerForm, setDrawerForm] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
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

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newChannel.trim()) return;

    try {
      await addChannel({
        platform: newPlatform,
        channel: newChannel.trim(),
        template: newTemplate
      });
      setNewChannel('');
      setShowAddModal(false);
      fetchData();
    } catch (err) {
      alert('Failed to add channel: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleTogglePause = async (c) => {
    if (c.enabled === 1) {
      setPauseModalChannel(c);
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
        notes: drawerForm.notes,
        settings: {
          clip_rules: drawerForm.clip_rules,
          detection: drawerForm.detection,
          ai: drawerForm.ai,
          publishing: drawerForm.publishing,
        }
      });
      // Optimistically update local channel state immediately
      setChannels((prev) =>
        prev.map((c) =>
          c.channel_id_or_handle === handle
            ? { ...c, template_name: updatedTemplate, display_name: updatedDisplay }
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Radio className="text-rose-500 animate-pulse" /> Monitored Streamers &amp; Channels
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Toggle monitoring on/off, adjust live sensitivity rules, and map visual templates.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-lg text-xs shadow-lg shadow-indigo-600/20"
        >
          <Plus size={16} /> Add Channel
        </button>
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/80 text-slate-400 font-bold uppercase tracking-wider border-b border-white/10">
            <tr>
              <th className="py-3 px-4">Channel / Handle</th>
              <th className="py-3 px-4">Pipeline Status</th>
              <th className="py-3 px-4">Chat Velocity</th>
              <th className="py-3 px-4">Active Template</th>
              <th className="py-3 px-4">Clips Today</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {channels.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-8 text-center text-slate-500">
                  No monitored channels configured. Click "Add Channel" to begin monitoring.
                </td>
              </tr>
            ) : (
              channels.map((c) => {
                const streamInfo = streamers[c.channel_id_or_handle] || {};
                const isLive = streamInfo.is_live;
                const isEnabled = c.enabled === 1;

                return (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        !isEnabled ? 'bg-amber-500' : isLive ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'
                      }`} />
                      <div>
                        <div>{c.display_name || c.channel_id_or_handle}</div>
                        {c.display_name && (
                          <div className="text-[10px] text-slate-500 font-mono font-normal">
                            @{c.channel_id_or_handle} ({c.platform})
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      {!isEnabled ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-[11px] inline-flex items-center gap-1">
                          <span>PAUSED</span>
                        </span>
                      ) : isLive ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold text-[11px] inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping inline-block" />
                          <span>LIVE MONITORING</span>
                        </span>
                      ) : (
                        <span className="text-slate-500 font-medium">Idle / Offline</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {streamInfo.current_mps ? `${streamInfo.current_mps.toFixed(1)} MPS` : '0.0 MPS'}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-indigo-400 font-bold">
                      {c.template_name}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {c.clips_today || 0} clips
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Pause / Resume Button */}
                        <button
                          onClick={() => handleTogglePause(c)}
                          className={`p-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${
                            isEnabled
                              ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20'
                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                          }`}
                          title={isEnabled ? "Pause Monitoring" : "Resume Monitoring"}
                        >
                          {isEnabled ? <Pause size={13} /> : <Play size={13} />}
                        </button>

                        {/* Settings Drawer Button */}
                        <button
                          onClick={() => openSettings(c)}
                          className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                          title="Streamer Settings"
                        >
                          <Settings size={14} />
                        </button>

                        {/* Remove */}
                        <button
                          onClick={() => handleRemove(c.channel_id_or_handle)}
                          className="text-slate-500 hover:text-rose-400 p-1.5 rounded hover:bg-white/5 transition-colors"
                          title="Remove Channel"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* PAUSE CONFIRMATION MODAL */}
      {pauseModalChannel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
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
                  className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-white/5 space-y-2">
                <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                  <input
                    type="radio"
                    name="pauseMode"
                    checked={!pauseImmediate}
                    onChange={() => setPauseImmediate(false)}
                    className="accent-indigo-500"
                  />
                  <span>Finish current rendering jobs, then stop (Default)</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-rose-300 cursor-pointer">
                  <input
                    type="radio"
                    name="pauseMode"
                    checked={pauseImmediate}
                    onChange={() => setPauseImmediate(true)}
                    className="accent-rose-500"
                  />
                  <span>Stop everything now (Cancel in-flight renders)</span>
                </label>
              </div>
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
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg text-xs shadow-lg shadow-amber-500/20"
              >
                Confirm Pause
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STREAMER SETTINGS DRAWER */}
      {drawerChannel && drawerForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-end z-50">
          <div className="bg-[#13151A] border-l border-white/10 w-full max-w-xl h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Settings size={18} className="text-indigo-400" />
                  Settings: {drawerChannel.channel_id_or_handle}
                </h3>
                <span className="text-[11px] text-slate-400">Configure AI context, clip rules, and template bindings</span>
              </div>
              <button
                onClick={() => setDrawerChannel(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Identity & Template */}
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Identity &amp; Template</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Display Name</label>
                    <input
                      type="text"
                      value={drawerForm.display_name}
                      onChange={(e) => setDrawerForm({ ...drawerForm, display_name: e.target.value })}
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Assigned Template</label>
                    <select
                      value={drawerForm.template_name}
                      onChange={(e) => setDrawerForm({ ...drawerForm, template_name: e.target.value })}
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                    >
                      {templates.map((t) => (
                        <option key={t.name} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Clip Rules */}
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Clip Boundary &amp; Virality Rules</span>
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
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
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
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
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
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {/* AI & Context Prompt */}
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">AI Context &amp; Persona</span>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Gemini Creator Context</label>
                  <textarea
                    rows={3}
                    value={drawerForm.ai.gemini_context}
                    onChange={(e) => setDrawerForm({
                      ...drawerForm,
                      ai: { ...drawerForm.ai, gemini_context: e.target.value }
                    })}
                    className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. Counter-Strike streamer, high energy reaction clips are highest priority."
                  />
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-slate-950">
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

      {/* ADD CHANNEL MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4">Add Creator to Monitor</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Channel Handle / ID
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ohnepixel or ishowspeed"
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Platform
                </label>
                <select
                  value={newPlatform}
                  onChange={(e) => setNewPlatform(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                >
                  <option value="twitch">Twitch</option>
                  <option value="youtube">YouTube</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Visual Layout Template
                </label>
                <select
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {templates.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs"
                >
                  Add Creator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
