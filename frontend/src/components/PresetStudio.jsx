import React, { useState, useEffect } from 'react';
import { 
  Bookmark, 
  Plus, 
  Trash2, 
  Save, 
  Sparkles, 
  Layers, 
  Sliders, 
  Type, 
  Check, 
  ChevronRight,
  Globe,
  Radio,
  UserCheck,
  Image as ImageIcon
} from 'lucide-react';
import { getPresets, createPreset, deletePreset, getChannels, patchChannelSettings } from '../api';
import LayoutBuilder, { PRESET_STARTERS } from './LayoutBuilder';

export default function PresetStudio() {
  const [presets, setPresets] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState(null);
  
  // New preset form states
  const [isCreating, setIsCreating] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetScope, setPresetScope] = useState('global');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [assigningStreamer, setAssigningStreamer] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Active editable layout
  const defaultStarter = PRESET_STARTERS.facecam_top_gameplay_bottom || Object.values(PRESET_STARTERS)[0];
  const [activeLayout, setActiveLayout] = useState({
    schema: 2,
    canvas: { w: 1080, h: 1920 },
    background: { ...(defaultStarter?.background || { type: 'solid', color: '#000000', blur: 0, dim: 0 }) },
    layers: (defaultStarter?.layers || []).map(l => ({ ...l }))
  });

  // Active editable captions
  const [captionsConfig, setCaptionsConfig] = useState({
    font: 'Montserrat ExtraBold',
    size: 72,
    color: '#FFFFFF',
    highlight: '#FACC15',
    animation: 'pop',
    position: { x: 0.5, y: 0.82 }
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [presetsData, channelsData] = await Promise.all([
        getPresets(),
        getChannels()
      ]);
      setPresets(presetsData || []);
      setChannels(channelsData || []);
      if (presetsData && presetsData.length > 0 && !selectedPreset) {
        selectPresetItem(presetsData[0]);
      }
    } catch (err) {
      console.error('Failed to load presets:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectPresetItem = (p) => {
    setSelectedPreset(p);
    setIsCreating(false);
    setPresetName(p.name || '');
    setPresetScope(p.scope || 'global');
    setSelectedChannel(p.channel_id || '');
    if (p.data?.layout) {
      setActiveLayout(p.data.layout);
    }
    if (p.data?.captions || p.data?.subtitles) {
      setCaptionsConfig({
        font: p.data?.captions?.font || p.data?.subtitles?.font_name || 'Montserrat ExtraBold',
        size: p.data?.captions?.size || p.data?.subtitles?.font_size || 72,
        color: p.data?.captions?.color || p.data?.subtitles?.primary_color || '#FFFFFF',
        highlight: p.data?.captions?.highlight || p.data?.subtitles?.highlight_color || '#FACC15',
        animation: p.data?.captions?.animation || p.data?.subtitles?.animation || 'pop',
        position: p.data?.captions?.position || p.data?.subtitles?.position || { x: 0.5, y: 0.82 }
      });
    }
  };

  const handleStartCreate = (starterKey = 'facecam_top_gameplay_bottom') => {
    const starter = PRESET_STARTERS[starterKey] || PRESET_STARTERS.facecam_top_gameplay_bottom || Object.values(PRESET_STARTERS)[0];
    setIsCreating(true);
    setSelectedPreset(null);
    setPresetName(`New Custom Preset ${presets.length + 1}`);
    setPresetScope('global');
    setSelectedChannel('');
    setActiveLayout({
      schema: 2,
      canvas: { w: 1080, h: 1920 },
      background: { ...(starter?.background || { type: 'solid', color: '#000000', blur: 0, dim: 0 }) },
      layers: (starter?.layers || []).map(l => ({ ...l, id: `l_${Date.now()}_${l.name.toLowerCase()}` }))
    });
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) {
      alert('Please provide a preset name');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: presetName.trim(),
        scope: presetScope,
        channel_id: presetScope === 'channel' ? selectedChannel : null,
        data: {
          layout: activeLayout,
          captions: captionsConfig,
          subtitles: captionsConfig
        }
      };
      const res = await createPreset(payload);
      setFeedback({ type: 'success', msg: `Preset '${presetName}' saved!` });
      setTimeout(() => setFeedback(null), 3000);
      await loadData();
      selectPresetItem(res);
    } catch (err) {
      setFeedback({ type: 'error', msg: `Failed saving preset: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePreset = async (pId) => {
    if (!confirm('Are you sure you want to permanently delete this preset?')) return;
    try {
      await deletePreset(pId);
      setFeedback({ type: 'success', msg: 'Preset deleted successfully' });
      setTimeout(() => setFeedback(null), 3000);
      setPresets(prev => prev.filter(p => p.id !== pId));
      if (selectedPreset?.id === pId) {
        setSelectedPreset(null);
      }
    } catch (err) {
      alert('Failed deleting preset: ' + err.message);
    }
  };

  // Direct 1-Click Assignment to Streamer
  const handleAssignToStreamer = async () => {
    if (!assigningStreamer) {
      alert('Please select a streamer to assign');
      return;
    }
    const targetPresetName = presetName.trim() || selectedPreset?.name;
    if (!targetPresetName) {
      alert('Please save the preset first');
      return;
    }
    try {
      await patchChannelSettings(assigningStreamer, { template_name: targetPresetName });
      setFeedback({ type: 'success', msg: `Successfully assigned preset '${targetPresetName}' to @${assigningStreamer}!` });
      setTimeout(() => setFeedback(null), 4000);
      setAssigningStreamer('');
    } catch (err) {
      alert('Failed assigning preset to streamer: ' + err.message);
    }
  };

  // Selected channel object for live frame or avatar
  const activeChannelObj = channels.find(c => c.channel_id_or_handle === (selectedChannel || assigningStreamer));
  const channelFrameUrl = activeChannelObj ? `/api/channels/${activeChannelObj.channel_id_or_handle}/frame` : null;

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 text-slate-100 flex flex-col gap-4 sm:gap-6 select-none">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
        <div>
          <h1 className="text-lg sm:text-2xl font-black text-white flex items-center gap-2">
            <Bookmark className="text-[#8FD3FF]" size={22} />
            Visual Preset Studio
          </h1>
          <p className="text-[11px] sm:text-xs text-[#8B90A0] mt-0.5">
            Design reusable 9:16 layout crops and kinetic caption presets. Assign them directly to your streamers.
          </p>
        </div>

        <button
          onClick={() => handleStartCreate('facecam_top_gameplay_bottom')}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] text-[#0A0B0E] font-extrabold text-xs shadow-md shadow-[#8FD3FF]/20 active:scale-95 transition-all self-start sm:self-auto"
        >
          <Plus size={14} />
          <span>New Preset</span>
        </button>
      </div>

      {feedback && (
        <div className={`p-2.5 sm:p-3 rounded-xl text-xs font-bold ${
          feedback.type === 'success' 
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' 
            : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
        }`}>
          {feedback.msg}
        </div>
      )}

      {/* Main Grid: Responsive stacked on mobile, 2-column on desktop */}
      <div className="flex flex-col lg:grid lg:grid-cols-[280px_1fr] gap-4 sm:gap-6">
        
        {/* Left Column: Preset List & Quick Delete */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] sm:text-[11px] uppercase font-bold text-[#8B90A0] tracking-wider">
              Saved Presets ({presets.length})
            </label>
          </div>

          <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[680px] custom-scrollbar pb-2 lg:pb-0 pr-1">
            {presets.map((p) => {
              const isSelected = selectedPreset?.id === p.id && !isCreating;
              return (
                <div
                  key={p.id}
                  onClick={() => selectPresetItem(p)}
                  className={`p-2.5 sm:p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 shrink-0 w-64 lg:w-full ${
                    isSelected
                      ? 'bg-[#1A1D24] border-[#8FD3FF] shadow-lg shadow-[#8FD3FF]/10'
                      : 'bg-[#101217] border-white/[0.06] hover:border-white/20'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-white text-xs truncate flex items-center gap-1.5">
                      <span>{p.name}</span>
                      {p.is_default ? (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[8px] font-extrabold">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[9px] sm:text-[10px] text-slate-400 font-mono">
                      {p.scope === 'global' ? (
                        <span className="flex items-center gap-0.5 text-[#8FD3FF]">
                          <Globe size={9} /> Global
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-emerald-400">
                          <Radio size={9} /> @{p.channel_id}
                        </span>
                      )}
                      <span>•</span>
                      <span>{p.data?.layout?.layers?.length || 2} layers</span>
                    </div>
                  </div>

                  {/* Always accessible Delete Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePreset(p.id);
                    }}
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-all shrink-0"
                    title="Delete Preset"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Configuration, Streamer Assignment, and Canvas */}
        <div className="flex flex-col gap-4 bg-[#101217] border border-white/[0.06] rounded-2xl p-3 sm:p-5 shadow-xl">
          
          {/* Streamer Avatar Header & 1-Click Assignment Bar */}
          <div className="p-3 rounded-xl bg-[#151922] border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {activeChannelObj?.avatar_url ? (
                <img
                  src={activeChannelObj.avatar_url}
                  alt={activeChannelObj.channel_id_or_handle}
                  className="w-10 h-10 rounded-full object-cover border-2 border-emerald-400 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 shrink-0">
                  <ImageIcon size={18} />
                </div>
              )}
              <div className="min-w-0">
                <div className="font-extrabold text-white text-xs truncate flex items-center gap-1.5">
                  <span>{activeChannelObj ? `@${activeChannelObj.channel_id_or_handle}` : 'No Streamer Selected'}</span>
                  {activeChannelObj && (
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[8px] font-mono uppercase">
                      {activeChannelObj.platform}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                  {activeChannelObj ? `Current layout: ${activeChannelObj.template_name || 'Standard'}` : 'Select a streamer below to preview their stream frame & assign'}
                </div>
              </div>
            </div>

            {/* Direct 1-Click Assign Button */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={assigningStreamer}
                onChange={(e) => {
                  setAssigningStreamer(e.target.value);
                  setSelectedChannel(e.target.value);
                }}
                className="bg-[#0E1118] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none flex-1 md:w-48"
              >
                <option value="">Choose Streamer...</option>
                {channels.map(c => (
                  <option key={c.channel_id_or_handle} value={c.channel_id_or_handle}>
                    @{c.channel_id_or_handle} ({c.platform})
                  </option>
                ))}
              </select>

              <button
                onClick={handleAssignToStreamer}
                disabled={!assigningStreamer}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs shadow-md shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-40 shrink-0"
                title="Assign this preset to the chosen streamer"
              >
                <UserCheck size={13} />
                <span>Assign</span>
              </button>
            </div>
          </div>

          {/* Preset Metadata Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pb-3 border-b border-white/[0.06]">
            <div>
              <label className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider block mb-1">
                Preset Name
              </label>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="w-full bg-[#1A1D24] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#8FD3FF]"
                placeholder="e.g. Center Split Top Cam"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider block mb-1">
                Preset Scope
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPresetScope('global')}
                  className={`py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    presetScope === 'global'
                      ? 'bg-[#8FD3FF]/20 text-[#8FD3FF] border-[#8FD3FF]'
                      : 'bg-[#1A1D24] text-slate-400 border-white/5'
                  }`}
                >
                  Global
                </button>
                <button
                  type="button"
                  onClick={() => setPresetScope('channel')}
                  className={`py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    presetScope === 'channel'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500'
                      : 'bg-[#1A1D24] text-slate-400 border-white/5'
                  }`}
                >
                  Streamer
                </button>
              </div>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleSavePreset}
                disabled={saving}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] text-[#0A0B0E] font-black text-xs shadow-md shadow-[#8FD3FF]/20 active:scale-95 transition-all disabled:opacity-50"
              >
                <Save size={13} />
                <span>{saving ? 'Saving...' : 'Save Preset'}</span>
              </button>
            </div>
          </div>

          {/* Subtitle Customizer */}
          <div className="p-3 rounded-xl bg-[#1A1D24]/50 border border-white/[0.06] flex flex-col gap-2">
            <label className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider flex items-center gap-1.5">
              <Type size={11} className="text-[#8FD3FF]" /> Caption Typography &amp; Styling
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <label className="text-slate-400 block text-[9px] mb-0.5">Font Family</label>
                <select
                  value={captionsConfig.font}
                  onChange={(e) => setCaptionsConfig(prev => ({ ...prev, font: e.target.value }))}
                  className="w-full bg-[#0E1118] border border-white/10 rounded-lg p-1.5 text-xs text-white"
                >
                  <option value="Montserrat ExtraBold">Montserrat ExtraBold</option>
                  <option value="TheBoldFont">TheBoldFont</option>
                  <option value="Anton">Anton</option>
                  <option value="Poppins">Poppins</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block text-[9px] mb-0.5">Animation</label>
                <select
                  value={captionsConfig.animation}
                  onChange={(e) => setCaptionsConfig(prev => ({ ...prev, animation: e.target.value }))}
                  className="w-full bg-[#0E1118] border border-white/10 rounded-lg p-1.5 text-xs text-white"
                >
                  <option value="pop">Pop / Pulse</option>
                  <option value="karaoke">Karaoke Fill</option>
                  <option value="glow">Neon Glow</option>
                  <option value="none">Static</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block text-[9px] mb-0.5">Highlight Color</label>
                <input
                  type="color"
                  value={captionsConfig.highlight}
                  onChange={(e) => setCaptionsConfig(prev => ({ ...prev, highlight: e.target.value }))}
                  className="w-full h-7 bg-transparent rounded cursor-pointer"
                />
              </div>

              <div>
                <label className="text-slate-400 block text-[9px] mb-0.5">Font Size ({captionsConfig.size}px)</label>
                <input
                  type="range"
                  min="40"
                  max="110"
                  value={captionsConfig.size}
                  onChange={(e) => setCaptionsConfig(prev => ({ ...prev, size: parseInt(e.target.value) }))}
                  className="w-full accent-[#8FD3FF] mt-1"
                />
              </div>
            </div>
          </div>

          {/* Interactive Layout Builder Canvas with live streamer frame support */}
          <div className="w-full min-h-[380px] sm:min-h-[480px]">
            <LayoutBuilder
              layout={activeLayout}
              onChange={(nextLayout) => setActiveLayout(nextLayout)}
              sourceMediaUrl={channelFrameUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
