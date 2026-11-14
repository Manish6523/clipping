import React, { useState, useEffect } from 'react';
import CaptionStylePicker from './CaptionStylePicker';
import HookStylePicker from './HookStylePicker';
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
  LayoutTemplate,
  UserCheck,
  Play,
  Loader2,
  Upload,
  Download,
  FileDown,
  FileUp,
  X,
  Lock,
  Unlock,
  Undo2,
  Redo2,
  MoreHorizontal,
} from 'lucide-react';
import { 
  getTemplates, 
  saveTemplate, 
  deleteTemplate, 
  getChannels, 
  patchChannelSettings,
  testTemplateSample
} from '../api';
import LayoutBuilder, { PRESET_STARTERS } from './LayoutBuilder';
import { useLayoutMode } from '../hooks/useLayoutMode';
import MobileStage from './editor/MobileStage';

export default function TemplateStudio() {
  const { isPhone, isLandscape } = useLayoutMode();
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [templateName, setTemplateName] = useState('custom_gaming_split');
  const [description, setDescription] = useState('Multi-layer custom layout');
  const [minScore, setMinScore] = useState(65);
  const [isDirty, setIsDirty] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selectedLayerId, setSelectedLayerId] = useState(null);

  // Background frame & custom uploads
  const [channelFrameUrl, setChannelFrameUrl] = useState(null);
  const [customImage, setCustomImage] = useState(null);

  // Real render test preview modal
  const [testingSample, setTestingSample] = useState(false);
  const [sampleVideoUrl, setSampleVideoUrl] = useState(null);

  // Typography & Subtitles
  const [fontFamily, setFontFamily] = useState('Montserrat');
  const [fontSize, setFontSize] = useState(72);
  const [primaryColor, setPrimaryColor] = useState('#FFFFFF');
  const [highlightColor, setHighlightColor] = useState('#FACC15');
  const [outlineColor, setOutlineColor] = useState('#000000');
  const [outlineWidth, setOutlineWidth] = useState(8);
  const [shadowBlur, setShadowBlur] = useState(8);
  const [animationPreset, setAnimationPreset] = useState('pop');
  const [captionPositionY, setCaptionPositionY] = useState(76);
  const [uppercase, setUppercase] = useState(true);
  const [showAdvancedTypography, setShowAdvancedTypography] = useState(false);
  const [showStyleDefaults, setShowStyleDefaults] = useState(false);
  const [defaultCaptionStyle, setDefaultCaptionStyle] = useState('template'); // 'template' = typography below
  const [defaultHookStyle, setDefaultHookStyle] = useState('classic');

  // Direct channel assignment
  const [assigningStreamer, setAssigningStreamer] = useState('');

  // Schema v2 Multi-Layer Layout State
  const [layoutState, setLayoutState] = useState(PRESET_STARTERS.facecam_top_gameplay_bottom);
  const [history, setHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const pushHistory = (prevState) => {
    setHistory((h) => [...h.slice(-30), JSON.parse(JSON.stringify(prevState))]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, h.length - 1));
    setRedoStack((r) => [...r, JSON.parse(JSON.stringify(layoutState))]);
    setLayoutState(prev);
    setIsDirty(true);
    showToast('Undo');
  };

  const handleRedo = () => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, r.length - 1));
    setHistory((h) => [...h, JSON.parse(JSON.stringify(layoutState))]);
    setLayoutState(next);
    setIsDirty(true);
    showToast('Redo');
  };

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
    setDefaultCaptionStyle(target.caption_style || 'template');
    setDefaultHookStyle(target.hook_style || 'classic');
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
      setDefaultCaptionStyle('template');
      setDefaultHookStyle('classic');
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
      // Defaults for clips made with this template (Quick Clip / swipe can override per clip)
      caption_style: defaultCaptionStyle !== 'template' ? defaultCaptionStyle : undefined,
      hook_style: defaultHookStyle,
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

  const handleApplyToChannel = async (targetChannel) => {
    const ch = targetChannel || selectedChannel;
    if (!ch) return;
    try {
      await patchChannelSettings(ch, { template_name: templateName.trim() });
      showToast(`Mapped "${templateName}" to ${ch}!`);
      loadChannelList();
    } catch (err) {
      alert('Failed to apply: ' + err.message);
    }
  };

  // Export current template as a portable .json file
  const handleExportTemplate = () => {
    const payload = buildTemplatePayload();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${templateName.trim() || 'template'}.autoclip.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast(`Exported "${templateName}.autoclip.json"`);
  };

  // Import a template .json file and automatically register it
  const handleImportTemplate = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported || !imported.name) {
          throw new Error('Invalid template file: missing name property.');
        }

        // Save imported template to server
        await saveTemplate(imported);

        // Apply imported template parameters to the studio canvas
        setTemplateName(imported.name);
        setDescription(imported.description || '');
        setMinScore(imported.min_score || 65);

        if (imported.layout) {
          setLayoutState(imported.layout);
        }

        if (imported.caption_style) setDefaultCaptionStyle(imported.caption_style);
        if (imported.hook_style) setDefaultHookStyle(imported.hook_style);
        if (imported.subtitles) {
          if (imported.subtitles.font_name) setFontFamily(imported.subtitles.font_name);
          if (imported.subtitles.font_size) setFontSize(imported.subtitles.font_size);
          if (imported.subtitles.animation) setAnimationPreset(imported.subtitles.animation);
          if (imported.subtitles.position && typeof imported.subtitles.position.y === 'number') {
            setCaptionPositionY(Math.round(imported.subtitles.position.y * 100));
          } else if (imported.subtitles.margin_v) {
            setCaptionPositionY(Math.round((1 - imported.subtitles.margin_v / 1920) * 100));
          }
        }

        await loadExistingTemplates();
        setIsDirty(false);
        showToast(`Template "${imported.name}" successfully imported & loaded!`);
      } catch (err) {
        alert('Failed to import template: ' + (err.message || 'Invalid JSON format'));
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input to allow re-uploading same file if edited
  };

  const handleCustomImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setCustomImage(event.target.result);
      showToast('Loaded custom reference frame');
    };
    reader.readAsDataURL(file);
  };

  const handleTestRenderSample = async () => {
    setTestingSample(true);
    setSampleVideoUrl(null);
    try {
      const payload = {
        template: buildTemplatePayload(),
        channel_id: selectedChannel || channels[0]?.channel_id_or_handle || 'general'
      };
      const res = await testTemplateSample(payload);
      if (res && res.video_url) {
        setSampleVideoUrl(res.video_url);
        showToast('Sample render complete!');
      } else {
        alert('Sample render finished without video URL.');
      }
    } catch (err) {
      alert('Test render failed: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setTestingSample(false);
    }
  };

  return (
    <div className="w-full h-[calc(100dvh-57px-64px-env(safe-area-inset-bottom))] md:h-[calc(100dvh-61px)] flex flex-col px-2 sm:px-4 py-2 select-none overflow-hidden bg-canvas">
      {/* Phone toolbar: picker + save, then frame + quick actions; rest in a ⋯ sheet */}
      {isPhone && (
        <div className="flex flex-col gap-2 pb-2 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-surface border border-white/[0.08] rounded-xl px-2.5 h-10">
              <LayoutTemplate size={14} className="text-accent shrink-0" />
              <select
                value={templateName}
                onChange={(e) => handleLoadPreset(e.target.value)}
                aria-label="Active template"
                className="flex-1 min-w-0 bg-transparent text-sm text-accent font-bold focus:outline-none truncate"
              >
                {templates.map((t) => (
                  <option key={t.name} value={t.name} className="bg-slate-900 text-white">{t.name}</option>
                ))}
              </select>
              {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />}
            </div>
            <button
              onClick={handleSave}
              className="h-10 px-4 flex items-center gap-1.5 bg-gradient-to-r from-accent to-accent text-canvas font-black rounded-xl text-sm shrink-0"
            >
              <Save size={14} /> Save
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0 flex items-center gap-1 bg-surface border border-white/[0.08] rounded-xl px-2.5 h-10">
              <span className="text-[11px] text-slate-500 font-bold uppercase shrink-0">Frame</span>
              <select
                value={selectedChannel}
                onChange={(e) => { setCustomImage(null); handleChannelSelect(e.target.value); }}
                aria-label="Preview frame from streamer"
                className="flex-1 min-w-0 bg-transparent text-xs text-white focus:outline-none truncate"
              >
                {channels.map((c) => (
                  <option key={c.channel_id_or_handle} value={c.channel_id_or_handle} className="bg-slate-900 text-white">
                    @{c.display_name || c.channel_id_or_handle}
                  </option>
                ))}
              </select>
              <button onClick={() => { setCustomImage(null); fetchChannelFrame(selectedChannel); }} className="p-1.5 text-slate-400" aria-label="Refresh frame">
                <RefreshCw size={13} />
              </button>
            </div>
            <button onClick={handleUndo} disabled={history.length === 0} aria-label="Undo"
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface border border-white/[0.08] text-slate-200 disabled:opacity-30">
              <Undo2 size={15} />
            </button>
            <button onClick={handleRedo} disabled={redoStack.length === 0} aria-label="Redo"
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface border border-white/[0.08] text-slate-200 disabled:opacity-30">
              <Redo2 size={15} />
            </button>
            <button onClick={handleTestRenderSample} disabled={testingSample} aria-label="Test render"
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface border border-amber-500/30 text-amber-300">
              {testingSample ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            </button>
            <button onClick={() => setPhoneMenuOpen(true)} aria-label="More template actions"
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface border border-white/[0.08] text-slate-200">
              <MoreHorizontal size={16} />
            </button>
          </div>
          {feedback && (
            <span className="self-start flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              <CheckCircle2 size={11} /> {feedback}
            </span>
          )}

          {phoneMenuOpen && (
            <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" onClick={() => setPhoneMenuOpen(false)}>
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-surface border-t border-white/10 p-4 space-y-2"
                style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-10 h-1.5 rounded-full bg-white/15 mx-auto mb-2" />
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => { setPhoneMenuOpen(false); handleNewTemplate(); }}
                    className="h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] text-xs font-bold text-slate-200 flex flex-col items-center justify-center gap-1">
                    <Plus size={18} className="text-accent" /> New
                  </button>
                  <label className="h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] text-xs font-bold text-slate-200 flex flex-col items-center justify-center gap-1 cursor-pointer">
                    <FileUp size={18} className="text-accent" /> Import
                    <input type="file" accept=".json,application/json" onChange={(e) => { setPhoneMenuOpen(false); handleImportTemplate(e); }} className="hidden" />
                  </label>
                  <button onClick={() => { setPhoneMenuOpen(false); handleExportTemplate(); }}
                    className="h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] text-xs font-bold text-slate-200 flex flex-col items-center justify-center gap-1">
                    <FileDown size={18} className="text-accent" /> Export
                  </button>
                  <label className="h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] text-xs font-bold text-slate-200 flex flex-col items-center justify-center gap-1 cursor-pointer">
                    <Upload size={18} className="text-accent" /> Frame image
                    <input type="file" accept="image/*" onChange={(e) => { setPhoneMenuOpen(false); handleCustomImageUpload(e); }} className="hidden" />
                  </label>
                  <button onClick={() => { setPhoneMenuOpen(false); handleDeleteTemplate(templateName); }}
                    className="h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs font-bold text-rose-300 flex flex-col items-center justify-center gap-1">
                    <Trash2 size={18} /> Delete
                  </button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <select
                    value={assigningStreamer}
                    onChange={(e) => setAssigningStreamer(e.target.value)}
                    aria-label="Assign template to streamer"
                    className="flex-1 min-w-0 h-11 bg-slate-950 border border-white/10 rounded-xl px-3 text-sm text-white"
                  >
                    <option value="">Use this template for…</option>
                    {channels.map((c) => (
                      <option key={c.channel_id_or_handle} value={c.channel_id_or_handle}>@{c.display_name || c.channel_id_or_handle}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { handleApplyToChannel(assigningStreamer); setPhoneMenuOpen(false); }}
                    disabled={!assigningStreamer}
                    className="h-11 px-4 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40"
                  >
                    Assign
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sleek Minimal Top Control Bar */}
      {!isPhone && (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-accent to-accent flex items-center justify-center text-canvas font-black text-xs shadow-md shadow-accent/20 shrink-0">
            <LayoutTemplate size={14} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-extrabold text-white">Template Studio</h2>
              {isDirty && (
                <span className="flex items-center gap-1 text-[10.5px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                  <AlertTriangle size={9} /> Unsaved
                </span>
              )}
              {feedback && (
                <span className="flex items-center gap-1 text-[10.5px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                  <CheckCircle2 size={9} /> {feedback}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center & Right Control Actions */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Template Picker Dropdown */}
          <div className="flex items-center gap-1 bg-surface border border-white/[0.08] rounded-xl px-2 py-1">
            <span className="text-[10.5px] uppercase font-bold text-muted">Active:</span>
            <select
              value={templateName}
              onChange={(e) => handleLoadPreset(e.target.value)}
              className="bg-transparent text-xs text-accent font-bold focus:outline-none cursor-pointer pr-1"
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

          {/* Sample Streamer Picker & Custom Upload */}
          <div className="flex items-center gap-1 bg-surface border border-white/[0.08] rounded-xl px-2 py-1">
            <span className="text-[10.5px] text-slate-400 font-bold uppercase">Frame:</span>
            <select
              value={selectedChannel}
              onChange={(e) => {
                setCustomImage(null);
                handleChannelSelect(e.target.value);
              }}
              className="bg-transparent text-xs text-white font-medium focus:outline-none cursor-pointer max-w-[95px] truncate"
            >
              {channels.map((c) => (
                <option key={c.channel_id_or_handle} value={c.channel_id_or_handle} className="bg-slate-900 text-white">
                  @{c.display_name || c.channel_id_or_handle}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setCustomImage(null);
                fetchChannelFrame(selectedChannel);
              }}
              title="Refresh streamer snapshot"
              className="p-0.5 rounded text-slate-400 hover:text-white"
            >
              <RefreshCw size={10} />
            </button>
            <label
              title="Upload custom reference image"
              className="p-0.5 rounded text-slate-400 hover:text-accent cursor-pointer"
            >
              <Upload size={11} />
              <input type="file" accept="image/*" onChange={handleCustomImageUpload} className="hidden" />
            </label>
            {customImage && (
              <span className="text-[10.5px] font-bold text-cyan-400 bg-cyan-500/10 px-1 rounded">Custom</span>
            )}
          </div>

          {/* Quick Assign to Streamer */}
          <div className="hidden md:flex items-center gap-1 bg-surface border border-white/[0.08] rounded-xl px-2 py-1">
            <span className="text-[10.5px] text-slate-400 font-bold uppercase">Assign:</span>
            <select
              value={assigningStreamer}
              onChange={(e) => setAssigningStreamer(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer max-w-[90px] truncate"
            >
              <option value="" className="bg-slate-900 text-slate-400">Streamer...</option>
              {channels.map((c) => (
                <option key={c.channel_id_or_handle} value={c.channel_id_or_handle} className="bg-slate-900 text-white">
                  @{c.display_name || c.channel_id_or_handle}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleApplyToChannel(assigningStreamer)}
              disabled={!assigningStreamer}
              title="Map active template to this streamer"
              className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <UserCheck size={12} />
            </button>
          </div>

          {/* Test Render Button */}
          <button
            onClick={handleTestRenderSample}
            disabled={testingSample}
            title="Render real 3-second FFmpeg test short"
            className="flex items-center gap-1 bg-surface hover:bg-white/[0.06] text-amber-300 font-bold py-1 px-2 rounded-xl text-xs border border-amber-500/30"
          >
            {testingSample ? <Loader2 size={11} className="animate-spin text-amber-400" /> : <Play size={11} className="text-amber-400" />}
            <span className="hidden sm:inline">Test Render</span>
          </button>

          {/* Undo and Redo Controls */}
          <div className="flex items-center gap-0.5 bg-surface border border-white/[0.08] rounded-xl p-0.5">
            <button
              onClick={handleUndo}
              disabled={history.length === 0}
              title="Undo (Ctrl+Z)"
              className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Undo2 size={13} />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Y)"
              className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Redo2 size={13} />
            </button>
          </div>

          {/* Export Template Button */}
          <button
            onClick={handleExportTemplate}
            title="Export template as .json file"
            className="flex items-center gap-1 bg-surface hover:bg-white/[0.06] text-slate-300 font-bold py-1 px-2 rounded-xl text-xs border border-white/[0.08]"
          >
            <FileDown size={11} className="text-accent" />
            <span className="hidden sm:inline">Export</span>
          </button>

          {/* Import Template Button */}
          <label
            title="Import template from .json file"
            className="flex items-center gap-1 bg-surface hover:bg-white/[0.06] text-slate-300 font-bold py-1 px-2 rounded-xl text-xs border border-white/[0.08] cursor-pointer"
          >
            <FileUp size={11} className="text-accent" />
            <span className="hidden sm:inline">Import</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImportTemplate}
              className="hidden"
            />
          </label>

          <button
            onClick={handleNewTemplate}
            className="flex items-center gap-1 bg-surface text-white font-bold py-1 px-2 rounded-xl text-xs border border-white/[0.08]"
          >
            <Plus size={11} className="text-accent" /> New
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1 bg-gradient-to-r from-accent to-accent text-canvas font-black py-1 px-2.5 rounded-xl text-xs shadow-md shadow-accent/20"
          >
            <Save size={11} /> Save
          </button>
        </div>
      </div>
      )}

      {/* Main Studio Viewport */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {isPhone ? (
          /* Phone Viewport: Adaptive MobileStage (PiP Swap + 44dp Touch Handles) */
          <div className="w-full h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-hidden">
              <MobileStage
                layout={layoutState}
                onPointerActionStart={() => pushHistory(layoutState)}
                onChange={(next) => {
                  setLayoutState(next);
                  setIsDirty(true);
                }}
                sourceMediaUrl={customImage || channelFrameUrl}
                captionsConfig={{
                  font: fontFamily,
                  fontSize,
                  color: primaryColor,
                  highlight: highlightColor,
                  outline_color: outlineColor,
                  outline_width: outlineWidth,
                  shadow_blur: shadowBlur,
                  animation: animationPreset,
                  uppercase,
                  position: { x: 0.5, y: captionPositionY / 100, max_width: 0.85 },
                  onChangePos: (newPos) => {
                    if (newPos && typeof newPos.y === 'number') {
                      setCaptionPositionY(Math.round(newPos.y * 100));
                      setIsDirty(true);
                    }
                  }
                }}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                isPhone={true}
                mode="template"
              />
            </div>
          </div>
        ) : (
          /* Desktop / Tablet Viewport: Full dual-canvas LayoutBuilder */
          <div className="w-full h-full flex flex-col overflow-hidden">
            <LayoutBuilder
              layout={layoutState}
              onPointerActionStart={() => pushHistory(layoutState)}
              onChange={(next) => {
                setLayoutState(next);
                setIsDirty(true);
              }}
              sourceMediaUrl={customImage || channelFrameUrl}
              captionsConfig={{
                font: fontFamily,
                fontSize,
                color: primaryColor,
                highlight: highlightColor,
                outline_color: outlineColor,
                outline_width: outlineWidth,
                shadow_blur: shadowBlur,
                animation: animationPreset,
                uppercase,
                position: { x: 0.5, y: captionPositionY / 100, max_width: 0.85 },
                onChangePos: (newPos) => {
                  if (newPos && typeof newPos.y === 'number') {
                    setCaptionPositionY(Math.round(newPos.y * 100));
                    setIsDirty(true);
                  }
                }
              }}
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              mode="template"
              showToolbar={false}
              showBottomPanel={false}
            />
          </div>
        )}
      </div>

      {/* Quick Frame Selector Chips Bar & Add/Delete Frame Actions */}
      <div className="min-h-9 py-1 px-2 bg-canvas border-t border-white/[0.06] flex items-center justify-between gap-2 shrink-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10.5px] uppercase font-bold text-slate-500 mr-1 flex items-center gap-1 shrink-0">
            <Layers size={11} className="text-accent" /> Frames / Layers:
          </span>
          {(layoutState.layers || []).map((l) => (
            <button
              key={l.id}
              onClick={() => setSelectedLayerId(l.id)}
              className={`h-5 px-2 rounded text-[11px] font-bold flex items-center gap-1 shrink-0 border transition-all ${
                selectedLayerId === l.id
                  ? 'bg-white/20 border-white text-white shadow-sm'
                  : 'bg-white/[0.04] border-white/5 text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
              <span>{l.name}</span>
            </button>
          ))}
        </div>

        {/* Add and Delete Box Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              const currentLayers = layoutState.layers || [];
              if (currentLayers.length >= 8) {
                alert('Maximum 8 frames per layout.');
                return;
              }
              pushHistory(layoutState);
              const layerColors = ['#FFB020', '#00F0FF', '#A855F7', '#EC4899', '#10B981', '#F59E0B', '#3B82F6', '#EF4444'];
              const color = layerColors[currentLayers.length % layerColors.length];
              const newId = `l_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
              const newLayer = {
                id: newId,
                name: `Frame ${currentLayers.length + 1}`,
                color,
                visible: true,
                locked: false,
                src: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
                dst: { x: 0.05, y: 0.05, w: 0.9, h: 0.35 },
                fit: 'cover',
                aspect_lock: true,
                style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
                tracking: { mode: 'off', smooth: 0.8 }
              };
              setLayoutState((prev) => ({
                ...prev,
                layers: [...(prev.layers || []), newLayer]
              }));
              setSelectedLayerId(newId);
              setIsDirty(true);
              showToast(`Added Frame ${currentLayers.length + 1}`);
            }}
            disabled={(layoutState.layers || []).length >= 8}
            className="flex items-center gap-1 h-6 px-2 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/40 text-accent text-[11px] font-bold transition-all shadow-sm disabled:opacity-40 shrink-0"
            title="Add a new crop frame box"
          >
            <Plus size={11} /> Add Box ({(layoutState.layers || []).length}/8)
          </button>

          {selectedLayerId && (
            <>
              {/* Aspect Ratio Lock Toggle for Selected Frame */}
              <button
                type="button"
                onClick={() => {
                  const target = (layoutState.layers || []).find((l) => l.id === selectedLayerId);
                  if (!target) return;
                  pushHistory(layoutState);
                  const newLockState = !target.aspect_lock;
                  setLayoutState((prev) => ({
                    ...prev,
                    layers: (prev.layers || []).map((l) =>
                      l.id === selectedLayerId ? { ...l, aspect_lock: newLockState } : l
                    )
                  }));
                  setIsDirty(true);
                  showToast(`Aspect ratio ${newLockState ? 'Locked' : 'Unlocked (Freeform)'}`);
                }}
                className={`flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-bold border transition-all shrink-0 ${
                  (layoutState.layers || []).find((l) => l.id === selectedLayerId)?.aspect_lock
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                }`}
                title="Toggle Aspect Ratio Lock (Locked keeps shape, Unlocked allows freeform stretch/resize)"
              >
                {(layoutState.layers || []).find((l) => l.id === selectedLayerId)?.aspect_lock ? (
                  <>
                    <Lock size={10} className="text-amber-400" /> Lock Aspect: ON
                  </>
                ) : (
                  <>
                    <Unlock size={10} /> Lock Aspect: OFF
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  const currentLayers = layoutState.layers || [];
                  if (currentLayers.length <= 1) {
                    alert('You must have at least 1 frame in the layout.');
                    return;
                  }
                  pushHistory(layoutState);
                  setLayoutState((prev) => ({
                    ...prev,
                    layers: (prev.layers || []).filter((l) => l.id !== selectedLayerId)
                  }));
                  setSelectedLayerId(null);
                  setIsDirty(true);
                  showToast('Deleted selected frame');
                }}
                disabled={(layoutState.layers || []).length <= 1}
                className="flex items-center gap-1 h-6 px-2 rounded-md bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[11px] font-bold transition-all shadow-sm shrink-0"
                title="Delete the currently selected frame box"
              >
                <Trash2 size={11} /> Delete Box
              </button>
            </>
          )}
        </div>
      </div>

      {/* Slim Responsive Bottom Form Strip */}
      <div className="mt-1.5 bg-surface border border-white/[0.08] rounded-xl px-2.5 py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0 shadow-lg text-xs overflow-x-auto no-scrollbar">
        {/* Row 1 / Left on desktop: Template metadata */}
        <div className="flex items-center gap-1.5 shrink-0 min-w-max">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted shrink-0">Template:</span>
          <input
            type="text"
            value={templateName}
            onChange={(e) => { setTemplateName(e.target.value); setIsDirty(true); }}
            placeholder="Template name"
            className="bg-raised border border-white/10 rounded-lg px-2 py-0.5 text-xs text-white font-mono w-32 focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }}
            placeholder="Description"
            className="hidden sm:inline bg-raised border border-white/10 rounded-lg px-2 py-0.5 text-xs text-slate-300 w-36 focus:outline-none focus:border-accent"
          />
        </div>

        {/* Row 2 / Right on desktop: Subtitle Typography Quick Controls */}
        <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar py-0.5">
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10.5px] font-bold uppercase text-muted">Font:</span>
            <select
              value={fontFamily}
              onChange={(e) => { setFontFamily(e.target.value); setIsDirty(true); }}
              className="bg-raised border border-white/10 rounded-lg px-1.5 py-0.5 text-[11px] text-white focus:outline-none max-w-[100px]"
            >
              <option value="Montserrat">Montserrat</option>
              <option value="Anton">Anton (Bold)</option>
              <option value="Bangers">Bangers (Comic)</option>
              <option value="Poppins">Poppins</option>
              <option value="Inter">Inter</option>
              <option value="Oswald">Oswald (Tall)</option>
              <option value="Russo One">Russo One</option>
              <option value="Teko">Teko (Ultra Cond)</option>
              <option value="Permanent Marker">Marker (Graffiti)</option>
              <option value="Black Ops One">Black Ops (Army)</option>
              <option value="Bungee">Bungee (Punchy)</option>
            </select>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10.5px] font-bold uppercase text-muted">Size:</span>
            <input
              type="number"
              min="30"
              max="140"
              value={fontSize}
              onChange={(e) => { setFontSize(Number(e.target.value)); setIsDirty(true); }}
              className="w-11 bg-raised border border-white/10 rounded-lg px-1 py-0.5 text-[11px] text-white text-center font-mono focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10.5px] font-bold uppercase text-muted">Anim:</span>
            <select
              value={animationPreset}
              onChange={(e) => { setAnimationPreset(e.target.value); setIsDirty(true); }}
              className="bg-raised border border-white/10 rounded-lg px-1 py-0.5 text-[11px] text-white focus:outline-none max-w-[95px]"
            >
              <option value="pop">Pop (Punch)</option>
              <option value="bounce">Bounce</option>
              <option value="typewriter">Karaoke</option>
              <option value="none">None (Static)</option>
            </select>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10.5px] font-bold uppercase text-muted">Y:</span>
            <input
              type="range"
              min="10"
              max="90"
              value={captionPositionY}
              onChange={(e) => { setCaptionPositionY(Number(e.target.value)); setIsDirty(true); }}
              className="w-14 accent-accent cursor-pointer"
            />
            <span className="font-mono text-slate-400 text-[11px] w-5">{captionPositionY}%</span>
          </div>

          {/* Advanced Typography Modal / Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvancedTypography(!showAdvancedTypography)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-all shrink-0 ${
              showAdvancedTypography 
                ? 'bg-accent/20 border-accent text-accent' 
                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
            }`}
            title="Open Advanced Subtitle Styling (Colors, Outline, Shadow, Case)"
          >
            <Sliders size={11} /> Advanced
          </button>

          <button
            type="button"
            onClick={() => setShowStyleDefaults(true)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-all shrink-0 bg-pink-500/10 border-pink-400/40 text-pink-200"
            title="Default caption style and hook title card for clips made with this template"
          >
            <Sparkles size={11} /> Styles
          </button>

          {/* Background Mode Toggle: Solid Black vs Blurred 9:16 */}
          <button
            type="button"
            onClick={() => {
              pushHistory(layoutState);
              const currentType = layoutState.background?.type || 'solid';
              const nextType = currentType === 'blur' ? 'solid' : 'blur';
              setLayoutState((prev) => ({
                ...prev,
                background: nextType === 'blur'
                  ? { type: 'blur', color: '#000000', blur: 35, dim: 0.35 }
                  : { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
              }));
              setIsDirty(true);
              showToast(`Background set to ${nextType === 'blur' ? 'Blurred 9:16' : 'Solid Black'}`);
            }}
            className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all border shrink-0 ${
              layoutState.background?.type === 'blur'
                ? 'bg-accent/20 border-accent text-accent shadow-sm'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}
            title="Toggle between Blurred video backdrop and Solid black background"
          >
            {layoutState.background?.type === 'blur' ? '💧 Blur' : '⬛ Black'}
          </button>

          <div className="hidden lg:flex items-center gap-1 pl-2 border-l border-white/10 shrink-0">
            <span className="text-[10.5px] font-bold uppercase text-muted">Min Score:</span>
            <input
              type="number"
              min="30"
              max="95"
              value={minScore}
              onChange={(e) => { setMinScore(Number(e.target.value)); setIsDirty(true); }}
              className="w-11 bg-raised border border-white/10 rounded-lg px-1 py-0.5 text-[11px] text-white text-center font-mono focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Render Test Sample Video Modal */}
      {sampleVideoUrl && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-white/[0.12] rounded-2xl max-w-sm w-full p-4 flex flex-col gap-3 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Play size={13} className="text-emerald-400" /> Real Render Preview
              </span>
              <button
                onClick={() => setSampleVideoUrl(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X size={15} />
              </button>
            </div>
            <div className="relative aspect-[9/16] w-full rounded-xl overflow-hidden bg-black border border-white/10">
              <video
                src={sampleVideoUrl}
                controls
                autoPlay
                loop
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setSampleVideoUrl(null)}
                className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-1.5 px-3 rounded-lg"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Typography Settings Modal */}
      {showStyleDefaults && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowStyleDefaults(false)}>
          <div className="bg-surface border border-white/[0.15] rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 shadow-2xl"
            style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-pink-300" />
                <h3 className="text-sm font-bold text-white">Template styles</h3>
              </div>
              <button type="button" onClick={() => setShowStyleDefaults(false)} className="text-slate-400 hover:text-white text-xs font-bold">Done</button>
            </div>
            <p className="text-[11px] text-slate-400 -mt-2">Every clip made with <b className="text-slate-200">{templateName}</b> uses these unless you pick something else in Quick Clip or swipe review. Remember to save the template.</p>
            <div>
              <p className="text-xs font-bold text-slate-200 mb-2">Caption style</p>
              <CaptionStylePicker value={defaultCaptionStyle} onChange={(v) => { setDefaultCaptionStyle(v); setIsDirty(true); }} compact
                captionY={captionPositionY / 100} />
              <p className="text-[11px] text-slate-500 mt-1">"Template default" keeps the font, size and colours set in this studio.</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200 mb-2">Hook title card (auto edit)</p>
              <HookStylePicker value={defaultHookStyle} onChange={(v) => { setDefaultHookStyle(v); setIsDirty(true); }} compact allowTemplate={false} />
            </div>
          </div>
        </div>
      )}

      {showAdvancedTypography && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-white/[0.15] rounded-2xl max-w-md w-full p-5 flex flex-col gap-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-accent" />
                <h3 className="text-sm font-bold text-white">Advanced Caption Typography</h3>
              </div>
              <button
                onClick={() => setShowAdvancedTypography(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Primary Color */}
              <div className="flex flex-col gap-1.5 bg-raised p-2.5 rounded-xl border border-white/5">
                <label className="text-[11px] uppercase font-bold text-slate-400">Main Text Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => { setPrimaryColor(e.target.value); setIsDirty(true); }}
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-white text-[11px]">{primaryColor}</span>
                </div>
              </div>

              {/* Highlight Color */}
              <div className="flex flex-col gap-1.5 bg-raised p-2.5 rounded-xl border border-white/5">
                <label className="text-[11px] uppercase font-bold text-slate-400">Word Pop Highlight</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={highlightColor}
                    onChange={(e) => { setHighlightColor(e.target.value); setIsDirty(true); }}
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-white text-[11px]">{highlightColor}</span>
                </div>
              </div>

              {/* Outline Color */}
              <div className="flex flex-col gap-1.5 bg-raised p-2.5 rounded-xl border border-white/5">
                <label className="text-[11px] uppercase font-bold text-slate-400">Outline Stroke Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={outlineColor}
                    onChange={(e) => { setOutlineColor(e.target.value); setIsDirty(true); }}
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-white text-[11px]">{outlineColor}</span>
                </div>
              </div>

              {/* Outline Width */}
              <div className="flex flex-col gap-1.5 bg-raised p-2.5 rounded-xl border border-white/5">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] uppercase font-bold text-slate-400">Outline Width</label>
                  <span className="font-mono text-slate-400 text-[11px]">{outlineWidth}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={outlineWidth}
                  onChange={(e) => { setOutlineWidth(Number(e.target.value)); setIsDirty(true); }}
                  className="accent-accent cursor-pointer"
                />
              </div>

              {/* Shadow Blur */}
              <div className="flex flex-col gap-1.5 bg-raised p-2.5 rounded-xl border border-white/5">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] uppercase font-bold text-slate-400">Drop Shadow</label>
                  <span className="font-mono text-slate-400 text-[11px]">{shadowBlur}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={shadowBlur}
                  onChange={(e) => { setShadowBlur(Number(e.target.value)); setIsDirty(true); }}
                  className="accent-accent cursor-pointer"
                />
              </div>

              {/* Uppercase Toggle */}
              <div className="flex flex-col gap-1.5 bg-raised p-2.5 rounded-xl border border-white/5 justify-between">
                <label className="text-[11px] uppercase font-bold text-slate-400">Letter Casing</label>
                <button
                  type="button"
                  onClick={() => { setUppercase(!uppercase); setIsDirty(true); }}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all border ${
                    uppercase
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'bg-white/5 border-white/10 text-slate-400'
                  }`}
                >
                  {uppercase ? 'ALL CAPS (ON)' : 'Original Case'}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                onClick={() => setShowAdvancedTypography(false)}
                className="bg-accent text-black font-bold px-4 py-2 rounded-xl text-xs hover:bg-accent transition-all shadow"
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
