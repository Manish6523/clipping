import React, { useState, useRef, useEffect } from 'react';
import { 
  Palette, 
  Save, 
  Layers, 
  Type, 
  Sparkles,
  CheckCircle2,
  Play,
  RotateCcw,
  Check,
  AlertTriangle,
  Trash2,
  Edit2,
  Plus,
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import { 
  getTemplates, 
  saveTemplate, 
  deleteTemplate, 
  getChannels, 
  testTemplateSample, 
  patchChannelSettings 
} from '../api';
import LayoutBuilder, { PRESET_STARTERS } from './LayoutBuilder';

export default function TemplateStudio() {
  const [templates, setTemplates] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [templateName, setTemplateName] = useState('custom_gaming_split');
  const [description, setDescription] = useState('Multi-layer custom layout');
  const [minScore, setMinScore] = useState(65);
  const [isDirty, setIsDirty] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Real Frame Canvas Background & Time Scrubbing
  const [channelFrameUrl, setChannelFrameUrl] = useState(null);
  const [testingSample, setTestingSample] = useState(false);
  const [sampleVideoUrl, setSampleVideoUrl] = useState(null);

  // Typography & Subtitles
  const [fontFamily, setFontFamily] = useState('Montserrat ExtraBold');
  const [fontSize, setFontSize] = useState(72);
  const [primaryColor, setPrimaryColor] = useState('#FFFFFF');
  const [highlightColor, setHighlightColor] = useState('#FACC15');
  const [outlineColor, setOutlineColor] = useState('#000000');
  const [outlineWidth, setOutlineWidth] = useState(4);
  const [animationPreset, setAnimationPreset] = useState('pop');
  const [captionPositionY, setCaptionPositionY] = useState(76);

  // Schema v2 Multi-Layer Layout State
  const [layoutState, setLayoutState] = useState(PRESET_STARTERS.facecam_top_gameplay_bottom);

  useEffect(() => {
    loadExistingTemplates();
    loadChannelList();
  }, []);

  const showToast = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  const loadExistingTemplates = async () => {
    try {
      const data = await getTemplates();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  const loadChannelList = async () => {
    try {
      const data = await getChannels();
      setChannels(data);
      if (data.length > 0) {
        setSelectedChannel(data[0].channel_id_or_handle);
        fetchChannelFrame(data[0].channel_id_or_handle);
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  };

  const fetchChannelFrame = (handle) => {
    if (!handle) return;
    setChannelFrameUrl(`/api/channels/${handle}/frame?t=${Date.now()}`);
  };

  const handleChannelSelect = (handle) => {
    setSelectedChannel(handle);
    fetchChannelFrame(handle);
    const ch = channels.find(c => c.channel_id_or_handle === handle);
    if (ch && ch.template_name) {
      handleLoadPreset(ch.template_name);
    }
  };

  const handleLoadPreset = (name) => {
    const t = templates.find((item) => item.name === name);
    if (!t) return;
    setTemplateName(t.name);
    setDescription(t.description || '');
    setMinScore(t.min_virality_score || 65);

    if (t.layout) {
      if (t.layout.schema === 2 && Array.isArray(t.layout.layers)) {
        setLayoutState(t.layout);
      } else {
        // Fallback or legacy mapping
        setLayoutState(PRESET_STARTERS[t.layout.type] || PRESET_STARTERS.facecam_top_gameplay_bottom);
      }
    }

    if (t.subtitles) {
      setFontFamily(t.subtitles.font_name || 'Montserrat ExtraBold');
      setFontSize(t.subtitles.font_size || 72);
      setOutlineWidth(t.subtitles.outline || 4);
      setAnimationPreset(t.subtitles.animation || 'pop');
      if (t.subtitles.position && t.subtitles.position.y !== undefined) {
        setCaptionPositionY(Math.round(t.subtitles.position.y * 100));
      } else if (t.subtitles.margin_v) {
        setCaptionPositionY(Math.round(((1920 - t.subtitles.margin_v) / 1920) * 100));
      }
    }
    setIsDirty(false);
    showToast(`Loaded layout "${t.name}"`);
  };

  const handleDeleteTemplate = async (name) => {
    if (!window.confirm(`Are you sure you want to permanently delete template "${name}"?`)) return;
    try {
      await deleteTemplate(name);
      showToast(`Deleted template "${name}"`);
      await loadExistingTemplates();
      if (templateName === name) {
        setTemplateName('new_custom_template');
      }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleNewTemplate = () => {
    setTemplateName(`custom_template_${Date.now().toString().slice(-4)}`);
    setDescription('Custom multi-crop layout');
    setLayoutState(PRESET_STARTERS.facecam_top_gameplay_bottom);
    setIsDirty(true);
    showToast('Ready to design new template!');
  };

  const buildTemplatePayload = () => {
    return {
      name: templateName.trim(),
      description: description.trim(),
      min_virality_score: Number(minScore),
      chat_spike_multiplier: 2.5,
      hype_keywords: ['CLIP IT', 'WTF', 'LMAO', 'OMG', 'NO WAY', 'W', 'L'],
      layout: {
        ...layoutState,
        schema: 2,
        canvas: { w: 1080, h: 1920 }
      },
      subtitles: {
        font_name: fontFamily,
        font_size: Number(fontSize),
        primary_color: '&H00FFFFFF',
        highlight_color: '&H0000FFFF',
        outline_color: '&H00000000',
        back_color: '&H80000000',
        bold: true,
        italic: false,
        outline: Number(outlineWidth),
        shadow: 2.0,
        alignment: 2,
        margin_v: Math.round(1920 * (1 - captionPositionY / 100)),
        animation: animationPreset,
        position: {
          x: 0.5,
          y: Number((captionPositionY / 100).toFixed(4)),
          max_width: 0.85,
        },
      },
      color_grade: {
        contrast: 1.03,
        saturation: 1.05,
      },
      pacing: {
        speed_multiplier: 1.02,
        teaser_preroll: true,
      },
    };
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      alert('Template name required.');
      return;
    }

    const payload = buildTemplatePayload();
    try {
      await saveTemplate(payload);
      showToast(`🎉 Template "${templateName}" saved to disk!`);
      setIsDirty(false);
      loadExistingTemplates();
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleApplyToChannel = async () => {
    if (!selectedChannel) return;
    try {
      await patchChannelSettings(selectedChannel, { template_name: templateName.trim() });
      showToast(`✅ Applied "${templateName}" to ${selectedChannel}!`);
      loadChannelList();
    } catch (err) {
      alert('Failed to apply: ' + err.message);
    }
  };

  const handleTestSample = async () => {
    setTestingSample(true);
    setSampleVideoUrl(null);
    try {
      const payload = buildTemplatePayload();
      const res = await testTemplateSample({ template: payload });
      if (res.sample_url) {
        setSampleVideoUrl(`${res.sample_url}?t=${Date.now()}`);
      }
    } catch (err) {
      alert('Test render failed: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setTestingSample(false);
    }
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto px-4 md:px-8 py-6 select-none">
      {/* Top Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <Palette className="text-[#8FD3FF]" /> Free-Form Layout Studio
            </h2>
            {isDirty && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
                <AlertTriangle size={12} /> Unsaved Changes
              </span>
            )}
            {feedback && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                <CheckCircle2 size={12} /> {feedback}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Build custom unlimited-box layouts, reorder z-depth, and test live renders.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Streamer Frame Selector */}
          <div className="flex items-center gap-1.5 bg-[#13151A] border border-white/10 rounded-xl px-2.5 py-1.5">
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Streamer:</span>
            <select
              value={selectedChannel}
              onChange={(e) => handleChannelSelect(e.target.value)}
              className="bg-transparent text-xs text-[#8FD3FF] font-bold focus:outline-none cursor-pointer"
            >
              {channels.map((c) => (
                <option key={c.channel_id_or_handle} value={c.channel_id_or_handle} className="bg-slate-900 text-white">
                  @{c.display_name || c.channel_id_or_handle} ({c.platform})
                </option>
              ))}
            </select>
            <button
              onClick={() => fetchChannelFrame(selectedChannel)}
              title="Refresh Frame Snapshot"
              className="p-1 rounded text-slate-400 hover:text-white"
            >
              <RefreshCw size={12} />
            </button>
          </div>

          {/* Upload Custom Snapshot Image */}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold bg-[#13151A] hover:bg-white/10 px-3 py-2 rounded-xl border border-white/10 cursor-pointer transition-all">
            <FolderOpen size={13} className="text-[#8FD3FF]" />
            <span>Upload Image</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    setChannelFrameUrl(event.target.result);
                    showToast(`Loaded custom image: ${file.name}`);
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
          </label>

          <button
            onClick={handleNewTemplate}
            className="flex items-center gap-1.5 bg-[#13151A] hover:bg-white/10 text-white font-bold py-2 px-3 rounded-xl text-xs transition-all border border-white/10"
          >
            <Plus size={14} className="text-[#8FD3FF]" /> New Template
          </button>

          {selectedChannel && (
            <button
              onClick={handleApplyToChannel}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-3 rounded-xl text-xs transition-all shadow-md"
            >
              <Check size={14} /> Map to {selectedChannel}
            </button>
          )}

          <button
            onClick={handleTestSample}
            disabled={testingSample}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-3 rounded-xl text-xs transition-all border border-white/10"
          >
            <Play size={14} className={testingSample ? "animate-spin" : ""} /> 
            {testingSample ? "Rendering..." : "Test Clip (3s)"}
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] hover:from-[#A9B8FF] hover:to-[#8FD3FF] text-[#0A0B0E] font-black py-2 px-4 rounded-xl text-xs shadow-lg shadow-[#8FD3FF]/20 transition-all"
          >
            <Save size={14} /> Save Template
          </button>
        </div>
      </div>

      {/* Mini Visual Diagram Cards for Saved Templates */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-4 mb-6 shadow-xl">
        <div className="flex items-center justify-between mb-3 border-b border-white/[0.04] pb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#8B90A0] flex items-center gap-2">
            <Layers size={14} className="text-[#8FD3FF]" /> Saved Layout Presets ({templates.length})
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            Click to load &amp; tweak • Delete to remove
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {templates.map((t) => {
            const isSelected = templateName === t.name;
            const tLayers = t.layout?.layers || [];

            return (
              <div
                key={t.name}
                onClick={() => handleLoadPreset(t.name)}
                className={`p-2.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between group ${
                  isSelected
                    ? 'bg-[#1A1D26] border-[#8FD3FF] shadow-md shadow-[#8FD3FF]/10'
                    : 'bg-[#13151A]/80 border-white/[0.06] hover:bg-[#13151A] hover:border-white/20'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1.5">
                  <span className={`font-bold text-xs truncate ${isSelected ? 'text-[#8FD3FF]' : 'text-white'}`}>
                    {t.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTemplate(t.name);
                    }}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-60 group-hover:opacity-100"
                    title={`Delete template "${t.name}"`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Mini 9:16 layout diagram outline */}
                <div className="w-12 h-20 bg-black/60 border border-white/20 rounded mx-auto my-1 relative overflow-hidden">
                  {tLayers.map((l, i) => (
                    <div
                      key={i}
                      style={{
                        left: `${(l.dst?.x ?? 0) * 100}%`,
                        top: `${(l.dst?.y ?? 0) * 100}%`,
                        width: `${(l.dst?.w ?? 1) * 100}%`,
                        height: `${(l.dst?.h ?? 0.5) * 100}%`,
                        backgroundColor: l.color || '#00F0FF',
                      }}
                      className="absolute opacity-80 border border-black/40"
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-white/[0.04]">
                  <span className="text-amber-400 font-bold">★ {t.min_virality_score || 65}</span>
                  <span className="text-[#8FD3FF] flex items-center gap-0.5">
                    <Edit2 size={9} /> Edit
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Free-Form LayoutBuilder Component */}
      <LayoutBuilder
        layout={layoutState}
        onChange={(next) => {
          setLayoutState(next);
          setIsDirty(true);
        }}
        sourceMediaUrl={channelFrameUrl}
        captionsConfig={{
          font: fontFamily,
          fontSize,
          color: primaryColor,
          highlight: highlightColor,
          position: { y: captionPositionY / 100 }
        }}
        mode="template"
      />

      {/* Bottom Subtitle & Metadata Settings */}
      <div className="mt-6 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-5 shadow-xl grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Type size={14} className="text-[#8FD3FF]" /> Template Metadata
          </span>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Template Identifier
            </label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => { setTemplateName(e.target.value); setIsDirty(true); }}
              className="w-full bg-[#13151A] border border-white/10 rounded-lg p-2 text-xs text-white font-mono focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }}
              className="w-full bg-[#13151A] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none"
            />
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Type size={14} className="text-[#8FD3FF]" /> Subtitle &amp; Motion Typography
          </span>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Font Family</label>
              <select
                value={fontFamily}
                onChange={(e) => { setFontFamily(e.target.value); setIsDirty(true); }}
                className="w-full bg-[#13151A] border border-white/10 rounded-lg p-2 text-xs text-white"
              >
                <option value="Montserrat ExtraBold">Montserrat Ext</option>
                <option value="Anton">Anton</option>
                <option value="Bangers">Bangers</option>
                <option value="Poppins Black">Poppins</option>
                <option value="Inter Black">Inter</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Animation Style</label>
              <select
                value={animationPreset}
                onChange={(e) => { setAnimationPreset(e.target.value); setIsDirty(true); }}
                className="w-full bg-[#13151A] border border-white/10 rounded-lg p-2 text-xs text-white"
              >
                <option value="pop">Pop (Punchy TikTok)</option>
                <option value="bounce">Bounce (Elastic)</option>
                <option value="typewriter">Typewriter (Karaoke)</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold uppercase text-slate-400">Caption Y ({captionPositionY}%)</label>
                <div className="flex gap-1 text-[9px]">
                  <button onClick={() => setCaptionPositionY(10)} className="px-1 py-0.5 bg-white/5 rounded">10%</button>
                  <button onClick={() => setCaptionPositionY(50)} className="px-1 py-0.5 bg-white/5 rounded">50%</button>
                  <button onClick={() => setCaptionPositionY(76)} className="px-1 py-0.5 bg-white/5 rounded">76%</button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={captionPositionY}
                onChange={(e) => { setCaptionPositionY(Number(e.target.value)); setIsDirty(true); }}
                className="w-full accent-[#8FD3FF] cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
