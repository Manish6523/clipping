import React, { useState, useEffect } from 'react';
import { 
  Palette, 
  Save, 
  Layers, 
  Type, 
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Plus,
  RefreshCw,
  FolderOpen,
  Sliders,
  ChevronDown,
  LayoutTemplate
} from 'lucide-react';
import { 
  getTemplates, 
  saveTemplate, 
  deleteTemplate, 
  getChannels, 
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

  // Background frame
  const [channelFrameUrl, setChannelFrameUrl] = useState(null);

  // Typography & Subtitles
  const [fontFamily, setFontFamily] = useState('Montserrat ExtraBold');
  const [fontSize, setFontSize] = useState(72);
  const [primaryColor, setPrimaryColor] = useState('#FFFFFF');
  const [highlightColor, setHighlightColor] = useState('#FACC15');
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
    setTimeout(() => setFeedback(null), 3000);
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
    showToast(`Loaded "${t.name}"`);
  };

  const handleDeleteTemplate = async (name) => {
    if (!window.confirm(`Permanently delete template "${name}"?`)) return;
    try {
      await deleteTemplate(name);
      showToast(`Deleted "${name}"`);
      await loadExistingTemplates();
      if (templateName === name) {
        setTemplateName('new_template');
      }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleNewTemplate = () => {
    const freshName = `layout_${Date.now().toString().slice(-4)}`;
    setTemplateName(freshName);
    setDescription('Custom multi-layer layout');
    setLayoutState(PRESET_STARTERS.facecam_top_gameplay_bottom);
    setIsDirty(true);
    showToast('Created new template draft');
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
      color_grade: { contrast: 1.03, saturation: 1.05 },
      pacing: { speed_multiplier: 1.02, teaser_preroll: true },
    };
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      alert('Please enter a template name.');
      return;
    }
    const payload = buildTemplatePayload();
    try {
      await saveTemplate(payload);
      showToast(`Template "${templateName}" saved!`);
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
      showToast(`Mapped "${templateName}" to ${selectedChannel}!`);
      loadChannelList();
    } catch (err) {
      alert('Failed to apply: ' + err.message);
    }
  };

  return (
    <div className="w-full min-h-[calc(100vh-61px)] lg:h-[calc(100vh-61px)] flex flex-col px-3 sm:px-4 py-2.5 select-none overflow-y-auto lg:overflow-hidden bg-[#07090E]">
      {/* Sleek Minimal Top Control Bar (Responsive wrap on mobile) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#8FD3FF] to-[#A9B8FF] flex items-center justify-center text-[#0A0B0E] font-black text-sm shadow-md shadow-[#8FD3FF]/20 shrink-0">
            <LayoutTemplate size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-white">Template Studio</h2>
              {isDirty && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={10} /> Unsaved
                </span>
              )}
              {feedback && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full animate-in fade-in">
                  <CheckCircle2 size={10} /> {feedback}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#8B90A0]">Design, reorder and test multi-frame 9:16 layout presets.</p>
          </div>
        </div>

        {/* Center & Right Control Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Center Template Picker Dropdown */}
          <div className="flex items-center gap-1.5 bg-[#0E1118] border border-white/[0.08] rounded-xl px-2.5 sm:px-3 py-1">
            <span className="text-[10px] uppercase font-bold text-[#8B90A0]">Active:</span>
            <select
              value={templateName}
              onChange={(e) => handleLoadPreset(e.target.value)}
              className="bg-transparent text-xs text-[#8FD3FF] font-bold focus:outline-none cursor-pointer pr-1"
            >
              {templates.map((t) => (
                <option key={t.name} value={t.name} className="bg-slate-900 text-white font-mono">
                  {t.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleDeleteTemplate(templateName)}
              title="Delete this template"
              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Streamer Frame Reference */}
          <div className="flex items-center gap-1.5 bg-[#0E1118] border border-white/[0.08] rounded-xl px-2 sm:px-2.5 py-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase">Sample:</span>
            <select
              value={selectedChannel}
              onChange={(e) => handleChannelSelect(e.target.value)}
              className="bg-transparent text-xs text-white font-medium focus:outline-none cursor-pointer"
            >
              {channels.map((c) => (
                <option key={c.channel_id_or_handle} value={c.channel_id_or_handle} className="bg-slate-900 text-white">
                  @{c.display_name || c.channel_id_or_handle}
                </option>
              ))}
            </select>
            <button
              onClick={() => fetchChannelFrame(selectedChannel)}
              title="Refresh snapshot"
              className="p-1 rounded text-slate-400 hover:text-white"
            >
              <RefreshCw size={11} />
            </button>
          </div>

          {/* Upload Custom Image */}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 font-bold bg-[#0E1118] hover:bg-white/10 px-2 sm:px-2.5 py-1.5 rounded-xl border border-white/[0.08] cursor-pointer transition-all">
            <FolderOpen size={13} className="text-[#8FD3FF]" />
            <span className="hidden sm:inline">Upload Image</span>
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
                    showToast(`Loaded: ${file.name}`);
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
          </label>

          <button
            onClick={handleNewTemplate}
            className="flex items-center gap-1.5 bg-[#0E1118] hover:bg-white/10 text-white font-bold py-1.5 px-2.5 sm:px-3 rounded-xl text-xs transition-all border border-white/[0.08]"
          >
            <Plus size={13} className="text-[#8FD3FF]" /> New
          </button>

          {selectedChannel && (
            <button
              onClick={handleApplyToChannel}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 px-2.5 sm:px-3 rounded-xl text-xs transition-all shadow-md shadow-emerald-600/20"
            >
              Map to @{selectedChannel}
            </button>
          )}

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] hover:from-[#A9B8FF] hover:to-[#8FD3FF] text-[#0A0B0E] font-black py-1.5 px-3 sm:px-4 rounded-xl text-xs shadow-lg shadow-[#8FD3FF]/20 transition-all"
          >
            <Save size={13} /> Save Template
          </button>
        </div>
      </div>

      {/* Main Studio Viewport */}
      <div className="flex-1 flex flex-col min-h-0 pt-2 lg:overflow-hidden">
        {/* Core Free-Form LayoutBuilder with Dual Stage Canvases */}
        <div className="flex-1 min-h-0 lg:overflow-hidden flex flex-col">
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
            showBottomPanel={false}
          />
        </div>

        {/* Slim Bottom Settings Drawer (Responsive Wrap & Touch Friendly) */}
        <div className="mt-2 bg-[#0E1118] border border-white/[0.08] rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0 shadow-lg text-xs">
          {/* Template Details */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] shrink-0">Template:</span>
            <input
              type="text"
              value={templateName}
              onChange={(e) => { setTemplateName(e.target.value); setIsDirty(true); }}
              placeholder="Template name"
              className="bg-[#141722] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono flex-1 sm:w-44 focus:outline-none focus:border-[#8FD3FF]"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }}
              placeholder="Description (optional)"
              className="bg-[#141722] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 flex-1 sm:w-56 focus:outline-none focus:border-[#8FD3FF]"
            />
          </div>

          {/* Subtitle Typography Quick Controls */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 border-t md:border-t-0 border-white/[0.06] pt-2 md:pt-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] shrink-0">Font:</span>
              <select
                value={fontFamily}
                onChange={(e) => { setFontFamily(e.target.value); setIsDirty(true); }}
                className="bg-[#141722] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="Montserrat ExtraBold">Montserrat ExtraBold</option>
                <option value="Anton">Anton</option>
                <option value="Bangers">Bangers</option>
                <option value="Poppins Black">Poppins Black</option>
                <option value="Inter Black">Inter</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] shrink-0">Animation:</span>
              <select
                value={animationPreset}
                onChange={(e) => { setAnimationPreset(e.target.value); setIsDirty(true); }}
                className="bg-[#141722] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="pop">Pop (Punchy)</option>
                <option value="bounce">Bounce</option>
                <option value="typewriter">Typewriter</option>
                <option value="none">Static</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B90A0] shrink-0">Captions Y:</span>
              <input
                type="range"
                min="10"
                max="90"
                value={captionPositionY}
                onChange={(e) => { setCaptionPositionY(Number(e.target.value)); setIsDirty(true); }}
                className="w-20 sm:w-24 accent-[#8FD3FF] cursor-pointer"
              />
              <span className="font-mono text-slate-400 w-7 text-[11px]">{captionPositionY}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
