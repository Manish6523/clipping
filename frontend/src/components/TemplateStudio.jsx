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
import { useLayoutMode } from '../hooks/useLayoutMode';
import MobileStage from './editor/MobileStage';

export default function TemplateStudio() {
  const { isPhone, isLandscape } = useLayoutMode();
  const [templates, setTemplates] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [templateName, setTemplateName] = useState('custom_gaming_split');
  const [description, setDescription] = useState('Multi-layer custom layout');
  const [minScore, setMinScore] = useState(65);
  const [isDirty, setIsDirty] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selectedLayerId, setSelectedLayerId] = useState(null);

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
        const first = data[0];
        setSelectedChannel(first.channel_id_or_handle);
        fetchChannelFrame(first.channel_id_or_handle);
        if (first.template_name) {
          handleLoadPreset(first.template_name);
        }
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  };

  const fetchChannelFrame = (ch) => {
    if (!ch) return;
    const cacheBuster = Date.now();
    setChannelFrameUrl(`/api/channels/${ch}/frame?t=${cacheBuster}`);
  };

  const handleChannelSelect = (channelHandle) => {
    setSelectedChannel(channelHandle);
    fetchChannelFrame(channelHandle);
    // Auto-select streamer's template layout if mapped
    const channelObj = channels.find(c => c.channel_id_or_handle === channelHandle);
    if (channelObj && channelObj.template_name) {
      handleLoadPreset(channelObj.template_name);
    }
  };

  const handleLoadPreset = (tplName) => {
    const target = templates.find((t) => t.name === tplName);
    if (!target) return;

    setTemplateName(target.name);
    setDescription(target.description || '');
    setMinScore(target.min_virality_score || 65);

    if (target.layout && target.layout.layers) {
      setLayoutState(target.layout);
    } else {
      setLayoutState(PRESET_STARTERS.facecam_top_gameplay_bottom);
    }

    if (target.subtitles) {
      setFontFamily(target.subtitles.font_name || 'Montserrat ExtraBold');
      setFontSize(target.subtitles.font_size || 72);
      setOutlineWidth(target.subtitles.outline || 4);
      setAnimationPreset(target.subtitles.animation || 'pop');
      if (target.subtitles.position && target.subtitles.position.y) {
        setCaptionPositionY(Math.round(target.subtitles.position.y * 100));
      }
    }
    setIsDirty(false);
    showToast(`Loaded "${target.name}"`);
  };

  const handleDeleteTemplate = async (tplName) => {
    if (!confirm(`Are you sure you want to delete template "${tplName}"?`)) return;
    try {
      await deleteTemplate(tplName);
      showToast(`Deleted ${tplName}`);
      loadExistingTemplates();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const handleNewTemplate = () => {
    const name = prompt('Enter a new template name:', 'custom_layout_' + Date.now().toString().slice(-4));
    if (name) {
      setTemplateName(name.trim().toLowerCase().replace(/\s+/g, '_'));
      setDescription('Custom template');
      setLayoutState(PRESET_STARTERS.facecam_top_gameplay_bottom);
      setIsDirty(true);
      showToast('Created new template draft');
    }
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
    <div className="w-full h-[calc(100dvh-61px)] flex flex-col px-2 sm:px-4 py-2 select-none overflow-hidden bg-[#07090E]">
      {/* Sleek Minimal Top Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#8FD3FF] to-[#A9B8FF] flex items-center justify-center text-[#0A0B0E] font-black text-xs shadow-md shadow-[#8FD3FF]/20 shrink-0">
            <LayoutTemplate size={14} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-extrabold text-white">Template Studio</h2>
              {isDirty && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                  <AlertTriangle size={9} /> Unsaved
                </span>
              )}
              {feedback && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                  <CheckCircle2 size={9} /> {feedback}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center & Right Control Actions */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Template Picker Dropdown */}
          <div className="flex items-center gap-1 bg-[#0E1118] border border-white/[0.08] rounded-xl px-2 py-1">
            <span className="text-[9px] uppercase font-bold text-[#8B90A0]">Active:</span>
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
              className="p-0.5 rounded text-slate-500 hover:text-rose-400 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </div>

          {/* Sample Streamer Picker */}
          <div className="flex items-center gap-1 bg-[#0E1118] border border-white/[0.08] rounded-xl px-2 py-1">
            <span className="text-[9px] text-slate-400 font-bold uppercase">Sample:</span>
            <select
              value={selectedChannel}
              onChange={(e) => handleChannelSelect(e.target.value)}
              className="bg-transparent text-xs text-white font-medium focus:outline-none cursor-pointer max-w-[90px] truncate"
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
              className="p-0.5 rounded text-slate-400 hover:text-white"
            >
              <RefreshCw size={10} />
            </button>
          </div>

          <button
            onClick={handleNewTemplate}
            className="flex items-center gap-1 bg-[#0E1118] text-white font-bold py-1 px-2 rounded-xl text-xs border border-white/[0.08]"
          >
            <Plus size={11} className="text-[#8FD3FF]" /> New
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1 bg-gradient-to-r from-[#8FD3FF] to-[#A9B8FF] text-[#0A0B0E] font-black py-1 px-2.5 rounded-xl text-xs shadow-md shadow-[#8FD3FF]/20"
          >
            <Save size={11} /> Save
          </button>
        </div>
      </div>

      {/* Main Studio Viewport */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {isPhone ? (
          /* Phone Viewport: Adaptive MobileStage (PiP Swap + 44dp Touch Handles) */
          <div className="w-full h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-hidden">
              <MobileStage
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
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                isPhone={true}
              />
            </div>

            {/* Quick Frame Selector Chips */}
            <div className="h-9 px-2 bg-[#0A0B0E] border-t border-white/[0.06] flex items-center gap-1.5 overflow-x-auto shrink-0">
              <span className="text-[9px] uppercase font-bold text-slate-500 mr-1">Frames:</span>
              {(layoutState.layers || []).map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedLayerId(l.id)}
                  className={`h-6 px-2 rounded-md text-[10px] font-bold flex items-center gap-1 shrink-0 border ${
                    selectedLayerId === l.id ? 'bg-white/15 border-white text-white' : 'bg-white/[0.04] border-white/5 text-slate-400'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                  <span>{l.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Desktop / Tablet Viewport: Full dual-canvas LayoutBuilder */
          <div className="w-full h-full flex flex-col overflow-hidden">
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
        )}
      </div>

      {/* Slim Responsive Bottom Form Strip */}
      <div className="mt-1.5 bg-[#0E1118] border border-white/[0.08] rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 shadow-lg text-xs">
        {/* Template metadata input */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#8B90A0] shrink-0">Template:</span>
          <input
            type="text"
            value={templateName}
            onChange={(e) => { setTemplateName(e.target.value); setIsDirty(true); }}
            placeholder="Template name"
            className="bg-[#141722] border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono flex-1 max-w-[160px] focus:outline-none focus:border-[#8FD3FF]"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }}
            placeholder="Description"
            className="hidden sm:inline bg-[#141722] border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-300 flex-1 max-w-[200px] focus:outline-none focus:border-[#8FD3FF]"
          />
        </div>

        {/* Subtitle Typography Quick Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase text-[#8B90A0]">Font:</span>
            <select
              value={fontFamily}
              onChange={(e) => { setFontFamily(e.target.value); setIsDirty(true); }}
              className="bg-[#141722] border border-white/10 rounded-lg px-1.5 py-1 text-[11px] text-white focus:outline-none"
            >
              <option value="Montserrat ExtraBold">Montserrat</option>
              <option value="Anton">Anton</option>
              <option value="Bangers">Bangers</option>
              <option value="Poppins Black">Poppins</option>
              <option value="Inter Black">Inter</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase text-[#8B90A0]">Y:</span>
            <input
              type="range"
              min="10"
              max="90"
              value={captionPositionY}
              onChange={(e) => { setCaptionPositionY(Number(e.target.value)); setIsDirty(true); }}
              className="w-16 accent-[#8FD3FF] cursor-pointer"
            />
            <span className="font-mono text-slate-400 text-[10px] w-6">{captionPositionY}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
