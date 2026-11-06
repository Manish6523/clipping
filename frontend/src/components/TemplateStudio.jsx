import React, { useState, useRef, useEffect } from 'react';
import { 
  Palette, 
  Save, 
  Layers, 
  Type, 
  Smartphone, 
  Monitor, 
  Sparkles,
  Maximize2,
  Sliders,
  CheckCircle2,
  Play,
  RotateCcw,
  Check,
  AlertTriangle,
  Trash2,
  Edit2,
  Plus
} from 'lucide-react';
import { getTemplates, saveTemplate, deleteTemplate, getChannels, testTemplateSample, patchChannelSettings } from '../api';

export default function TemplateStudio() {
  const [templates, setTemplates] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [templateName, setTemplateName] = useState('custom_gaming_split');
  const [description, setDescription] = useState('Facecam top with gameplay bottom');
  const [layoutType, setLayoutType] = useState('facecam_top_gameplay_bottom');
  const [minScore, setMinScore] = useState(65);
  const [isDirty, setIsDirty] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Real Frame Canvas Background
  const [channelFrameUrl, setChannelFrameUrl] = useState(null);
  const [testingSample, setTestingSample] = useState(false);
  const [sampleVideoUrl, setSampleVideoUrl] = useState(null);

  // Typography & Styling
  const [fontFamily, setFontFamily] = useState('Montserrat ExtraBold');
  const [fontSize, setFontSize] = useState(72);
  const [primaryColor, setPrimaryColor] = useState('#FFFFFF');
  const [highlightColor, setHighlightColor] = useState('#FACC15');
  const [outlineColor, setOutlineColor] = useState('#000000');
  const [outlineWidth, setOutlineWidth] = useState(4);
  const [animationPreset, setAnimationPreset] = useState('pop'); // pop, bounce, typewriter

  // Drag and Resize Boxes (in normalized 0-100 percentage of the 16:9 canvas)
  const [boxes, setBoxes] = useState({
    facecam: { x: 0, y: 58, w: 32, h: 42 },
    gameplay: { x: 20, y: 0, w: 60, h: 100 },
  });

  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const [activeBoxId, setActiveBoxId] = useState('facecam');
  const [dragState, setDragState] = useState(null);

  const canvasRef = useRef(null);

  // Compute CSS background position & size for an exact crop window on a 16:9 source frame
  const getCropStyle = (box) => {
    if (!channelFrameUrl || !box) return undefined;
    const bw = Math.max(0.1, box.w);
    const bh = Math.max(0.1, box.h);

    const sizeX = (100 / bw) * 100;
    const sizeY = (100 / bh) * 100;

    const posX = bw >= 100 ? 50 : Math.max(0, Math.min(100, (box.x / (100 - bw)) * 100));
    const posY = bh >= 100 ? 50 : Math.max(0, Math.min(100, (box.y / (100 - bh)) * 100));

    return {
      backgroundImage: `url(${channelFrameUrl})`,
      backgroundPosition: `${posX}% ${posY}%`,
      backgroundSize: `${sizeX}% ${sizeY}%`,
      backgroundRepeat: 'no-repeat',
    };
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
    setLayoutType(t.layout?.type || 'facecam_top_gameplay_bottom');

    if (t.layout?.top_crop && t.layout?.bottom_crop) {
      const top = t.layout.top_crop;
      const bot = t.layout.bottom_crop;
      setBoxes({
        facecam: {
          x: Math.round(((top.source_x || 0) / 1920) * 100),
          y: Math.round(((top.source_y || 0) / 1080) * 100),
          w: Math.round(((top.source_w || 640) / 1920) * 100),
          h: Math.round(((top.source_h || 480) / 1080) * 100),
        },
        gameplay: {
          x: Math.round(((bot.source_x || 384) / 1920) * 100),
          y: Math.round(((bot.source_y || 0) / 1080) * 100),
          w: Math.round(((bot.source_w || 1152) / 1920) * 100),
          h: Math.round(((bot.source_h || 1080) / 1080) * 100),
        },
      });
    }

    if (t.subtitles) {
      setFontFamily(t.subtitles.font_name || 'Montserrat ExtraBold');
      setFontSize(t.subtitles.font_size || 72);
      setOutlineWidth(t.subtitles.outline || 4);
      setAnimationPreset(t.subtitles.animation || 'pop');
    }
    setIsDirty(false);
    showToast(`Loaded template "${t.name}"`);
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
    if (layoutType === 'single_crop_9_16') {
      setBoxes({
        facecam: { x: 5, y: 55, w: 32, h: 42 },
        gameplay: { x: 34.2, y: 0, w: 31.6, h: 100 },
      });
    } else {
      setBoxes({
        facecam: { x: 5, y: 55, w: 32, h: 42 },
        gameplay: { x: 20, y: 0, w: 60, h: 100 },
      });
    }
    setIsDirty(true);
    showToast('Ready to design new template!');
  };

  const handleResetAspect = () => {
    if (layoutType === 'single_crop_9_16') {
      // 9:16 aspect ratio: w = h * (9/16) * (1080/1920) in percentage terms = h * (9/16) * (9/16) = h * 0.3164
      setBoxes((prev) => ({
        ...prev,
        gameplay: { x: 34.2, y: 0, w: 31.6, h: 100 },
      }));
    } else if (layoutType === 'split_screen_50_50') {
      // Top 50% = 1080x960 (ratio 1.125), Bottom 50% = 1080x960 (ratio 1.125)
      setBoxes((prev) => ({
        facecam: { x: 2, y: 55, w: 30, h: 42 },
        gameplay: { x: 20, y: 0, w: 60, h: 100 },
      }));
    } else {
      // Default facecam top 38% + gameplay bottom 62%
      setBoxes({
        facecam: { x: 0, y: 58, w: 32, h: 42 },
        gameplay: { x: 20, y: 0, w: 60, h: 100 },
      });
    }
    setIsDirty(true);
    showToast('Reset aspect ratio & positions!');
  };

  // Direct Pointer Drag & 8-Point Resize Engine
  const handlePointerDown = (e, boxId, actionType, handle = null) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveBoxId(boxId);
    setIsDirty(true);

    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();

    setDragState({
      type: actionType,
      boxId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      canvasW: rect.width,
      canvasH: rect.height,
      origBox: { ...boxes[boxId] },
    });
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!dragState || !canvasRef.current) return;

      const deltaXPercent = ((e.clientX - dragState.startX) / dragState.canvasW) * 100;
      const deltaYPercent = ((e.clientY - dragState.startY) / dragState.canvasH) * 100;

      const box = { ...dragState.origBox };

      if (dragState.type === 'move') {
        let newX = Math.max(0, Math.min(100 - box.w, box.x + deltaXPercent));
        let newY = Math.max(0, Math.min(100 - box.h, box.y + deltaYPercent));

        if (Math.abs((newX + box.w / 2) - 50) < 1.5) {
          newX = 50 - box.w / 2;
        }

        setBoxes((prev) => ({
          ...prev,
          [dragState.boxId]: { ...box, x: Math.round(newX * 10) / 10, y: Math.round(newY * 10) / 10 },
        }));
      } else if (dragState.type === 'resize') {
        const handle = dragState.handle;
        let { x, y, w, h } = box;

        // Calculate aspect ratio in normalized percentages (w% / h% on 16:9 canvas)
        // Default target aspect ratio:
        // Full 9:16 crop: 1080/1920 on a 1920x1080 canvas = (1080/1920) * (1080/1920) = ~0.3164 (w% / h%)
        // Split top (38%): 1080/730 on 1920x1080 canvas = (1080/730) * (1080/1920) = ~0.832
        // Split bottom (62%): 1080/1190 on 1920x1080 canvas = (1080/1190) * (1080/1920) = ~0.510
        const shouldLock = lockAspectRatio || e.shiftKey;
        const targetAspect = layoutType === 'single_crop_9_16'
          ? (1080 / 1920) * (1080 / 1920)
          : dragState.boxId === 'facecam'
          ? (1080 / 730) * (1080 / 1920)
          : (1080 / 1190) * (1080 / 1920);

        // 1. Compute unconstrained new box boundaries based on dragged handle
        if (handle.includes('e')) {
          w = Math.max(8, Math.min(100 - x, box.w + deltaXPercent));
        }
        if (handle.includes('s')) {
          h = Math.max(8, Math.min(100 - y, box.h + deltaYPercent));
        }
        if (handle.includes('w')) {
          const propW = Math.max(8, box.w - deltaXPercent);
          const propX = box.x + (box.w - propW);
          if (propX >= 0) {
            w = propW;
            x = propX;
          }
        }
        if (handle.includes('n')) {
          const propH = Math.max(8, box.h - deltaYPercent);
          const propY = box.y + (box.h - propH);
          if (propY >= 0) {
            h = propH;
            y = propY;
          }
        }

        // 2. If aspect ratio is locked, smoothly constrain the secondary dimension
        if (shouldLock && targetAspect > 0) {
          if (handle === 'e' || handle === 'w') {
            // Dragging horizontal edge: adjust height to match
            const newH = Math.min(100 - y, w / targetAspect);
            h = Math.max(8, newH);
          } else if (handle === 'n' || handle === 's') {
            // Dragging vertical edge: adjust width to match
            const newW = Math.min(100 - x, h * targetAspect);
            w = Math.max(8, newW);
          } else {
            // Corner handles (nw, ne, sw, se)
            // Use whichever axis moved more to drive the scaling
            if (Math.abs(deltaXPercent) >= Math.abs(deltaYPercent * targetAspect)) {
              let newH = w / targetAspect;
              if (handle.includes('n')) {
                const newY = box.y + (box.h - newH);
                if (newY >= 0) {
                  y = newY;
                  h = newH;
                } else {
                  h = box.y + box.h;
                  y = 0;
                  w = h * targetAspect;
                  if (handle.includes('w')) x = box.x + (box.w - w);
                }
              } else {
                if (y + newH <= 100) {
                  h = newH;
                } else {
                  h = 100 - y;
                  w = h * targetAspect;
                  if (handle.includes('w')) x = box.x + (box.w - w);
                }
              }
            } else {
              let newW = h * targetAspect;
              if (handle.includes('w')) {
                const newX = box.x + (box.w - newW);
                if (newX >= 0) {
                  x = newX;
                  w = newW;
                } else {
                  w = box.x + box.w;
                  x = 0;
                  h = w / targetAspect;
                  if (handle.includes('n')) y = box.y + (box.h - h);
                }
              } else {
                if (x + newW <= 100) {
                  w = newW;
                } else {
                  w = 100 - x;
                  h = w / targetAspect;
                  if (handle.includes('n')) y = box.y + (box.h - h);
                }
              }
            }
          }
        }

        // Final boundary clamping
        x = Math.max(0, Math.min(100 - w, x));
        y = Math.max(0, Math.min(100 - h, y));
        w = Math.max(5, Math.min(100 - x, w));
        h = Math.max(5, Math.min(100 - y, h));

        setBoxes((prev) => ({
          ...prev,
          [dragState.boxId]: {
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            w: Math.round(w * 10) / 10,
            h: Math.round(h * 10) / 10,
          },
        }));
      }
    };

    const handlePointerUp = () => {
      if (dragState) setDragState(null);
    };

    if (dragState) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState]);

  const buildTemplatePayload = () => {
    const top_crop = {
      name: 'webcam',
      source_x: Math.round((boxes.facecam.x / 100) * 1920),
      source_y: Math.round((boxes.facecam.y / 100) * 1080),
      source_w: Math.round((boxes.facecam.w / 100) * 1920),
      source_h: Math.round((boxes.facecam.h / 100) * 1080),
      normalized_x: Number((boxes.facecam.x / 100).toFixed(4)),
      normalized_y: Number((boxes.facecam.y / 100).toFixed(4)),
      normalized_w: Number((boxes.facecam.w / 100).toFixed(4)),
      normalized_h: Number((boxes.facecam.h / 100).toFixed(4)),
      target_w: 1080,
      target_h: 730,
    };

    const bottom_crop = {
      name: 'gameplay',
      source_x: Math.round((boxes.gameplay.x / 100) * 1920),
      source_y: Math.round((boxes.gameplay.y / 100) * 1080),
      source_w: Math.round((boxes.gameplay.w / 100) * 1920),
      source_h: Math.round((boxes.gameplay.h / 100) * 1080),
      normalized_x: Number((boxes.gameplay.x / 100).toFixed(4)),
      normalized_y: Number((boxes.gameplay.y / 100).toFixed(4)),
      normalized_w: Number((boxes.gameplay.w / 100).toFixed(4)),
      normalized_h: Number((boxes.gameplay.h / 100).toFixed(4)),
      target_w: 1080,
      target_h: 1190,
    };

    return {
      name: templateName.trim(),
      description: description.trim(),
      min_virality_score: Number(minScore),
      chat_spike_multiplier: 2.5,
      hype_keywords: ['CLIP IT', 'WTF', 'LMAO', 'OMG', 'NO WAY', 'W', 'L'],
      layout: {
        type: layoutType,
        target_width: 1080,
        target_height: 1920,
        top_crop,
        bottom_crop,
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
        margin_v: 240,
        animation: animationPreset,
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
              <Palette className="text-[#8FD3FF]" /> Visual Template Studio
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
            Create, preview, customize, and delete multi-crop 9:16 layout templates.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            <Save size={14} /> Save Template JSON
          </button>
        </div>
      </div>

      {/* TEMPLATE MANAGER SHELF: View all templates, 1-click edit, or delete */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-4 mb-6 shadow-xl">
        <div className="flex items-center justify-between mb-3 border-b border-white/[0.04] pb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#8B90A0] flex items-center gap-2">
            <Layers size={14} className="text-[#8FD3FF]" /> All Available Templates ({templates.length})
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            Click to load &amp; tweak • Delete to remove
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {templates.map((t) => {
            const isSelected = templateName === t.name;
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

                <div className="text-[10px] text-slate-400 line-clamp-1 mb-2">
                  {t.layout?.type ? t.layout.type.replace(/_/g, ' ') : 'split layout'}
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

      <div className="grid grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: 16:9 Interactive Drag Canvas (Source Stream) - Expanded to 7 cols */}
        <div className="col-span-12 lg:col-span-7 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Monitor size={15} className="text-[#8FD3FF]" />
              16:9 Source Stream Canvas
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResetAspect}
                title="Reset crop boxes to optimal default proportions"
                className="flex items-center gap-1 text-xs text-slate-300 font-semibold bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 transition-all mr-2"
              >
                <RotateCcw size={12} className="text-[#8FD3FF]" /> Reset Ratio
              </button>

              <label className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold cursor-pointer bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 select-none mr-2">
                <input
                  type="checkbox"
                  checked={lockAspectRatio}
                  onChange={(e) => setLockAspectRatio(e.target.checked)}
                  className="accent-[#8FD3FF] rounded cursor-pointer"
                />
                Lock Ratio (No Stretch)
              </label>

              {layoutType !== 'single_crop_9_16' && layoutType !== 'blurred_bg_center' && (
                <button
                  onClick={() => setActiveBoxId('facecam')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    activeBoxId === 'facecam'
                      ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  🟡 Facecam Box
                </button>
              )}
              <button
                onClick={() => setActiveBoxId('gameplay')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeBoxId === 'gameplay'
                    ? 'bg-cyan-400 text-black shadow-md shadow-cyan-400/20'
                    : 'bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                🔵 {layoutType === 'single_crop_9_16' ? '9:16 Action Crop' : 'Gameplay Box'}
              </button>
            </div>
          </div>

          {/* Canvas with real video snapshot background */}
          <div
            ref={canvasRef}
            className="w-full aspect-video bg-black rounded-xl relative overflow-hidden border border-white/10 shadow-2xl select-none"
            style={{
              backgroundImage: channelFrameUrl ? `url(${channelFrameUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {/* Guide Grid overlay */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20 border border-white/10">
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div />
            </div>

            {/* Facecam Box (rendered only for dual-crop layouts) */}
            {layoutType !== 'single_crop_9_16' && layoutType !== 'blurred_bg_center' && (
              <div
                style={{
                  left: `${boxes.facecam.x}%`,
                  top: `${boxes.facecam.y}%`,
                  width: `${boxes.facecam.w}%`,
                  height: `${boxes.facecam.h}%`,
                }}
                onPointerDown={(e) => handlePointerDown(e, 'facecam', 'move')}
                className={`absolute border-2 cursor-grab active:cursor-grabbing rounded-lg flex flex-col justify-between p-1.5 transition-shadow ${
                  activeBoxId === 'facecam'
                    ? 'border-amber-400 bg-amber-400/15 shadow-[0_0_15px_rgba(251,191,36,0.3)] z-20'
                    : 'border-amber-400/50 bg-amber-400/5 hover:border-amber-400'
                }`}
              >
                <span className="text-[10px] font-mono font-bold text-amber-300 bg-black/60 px-1 py-0.5 rounded w-max select-none">
                  FACECAM CROP
                </span>
                <span className="text-[9px] font-mono text-amber-300/80 self-end bg-black/60 px-1 rounded select-none">
                  {boxes.facecam.w}% × {boxes.facecam.h}%
                </span>

                {/* 8 Resize Handles (rendered when active) */}
                {activeBoxId === 'facecam' && (
                  <>
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 'nw')} className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nwse-resize z-30 shadow" />
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 'n')} className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-amber-400 rounded-sm cursor-ns-resize z-30 shadow" />
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 'ne')} className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nesw-resize z-30 shadow" />
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 'w')} className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-3 bg-amber-400 rounded-sm cursor-ew-resize z-30 shadow" />
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 'e')} className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-amber-400 rounded-sm cursor-ew-resize z-30 shadow" />
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 'sw')} className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nesw-resize z-30 shadow" />
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 's')} className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-amber-400 rounded-sm cursor-ns-resize z-30 shadow" />
                    <div onPointerDown={(e) => handlePointerDown(e, 'facecam', 'resize', 'se')} className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nwse-resize z-30 shadow" />
                  </>
                )}
              </div>
            )}

            {/* Gameplay Box */}
            <div
              style={{
                left: `${boxes.gameplay.x}%`,
                top: `${boxes.gameplay.y}%`,
                width: `${boxes.gameplay.w}%`,
                height: `${boxes.gameplay.h}%`,
              }}
              onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'move')}
              className={`absolute border-2 cursor-grab active:cursor-grabbing rounded-lg flex flex-col justify-between p-1.5 transition-shadow ${
                activeBoxId === 'gameplay'
                  ? 'border-cyan-400 bg-cyan-400/15 shadow-[0_0_15px_rgba(34,211,238,0.3)] z-10'
                  : 'border-cyan-400/50 bg-cyan-400/5 hover:border-cyan-400'
              }`}
            >
              <span className="text-[10px] font-mono font-bold text-cyan-300 bg-black/60 px-1 py-0.5 rounded w-max select-none">
                GAMEPLAY / MAIN CROP
              </span>
              <span className="text-[9px] font-mono text-cyan-300/80 self-end bg-black/60 px-1 rounded select-none">
                {boxes.gameplay.w}% × {boxes.gameplay.h}%
              </span>

              {/* 8 Resize Handles (rendered when active) */}
              {activeBoxId === 'gameplay' && (
                <>
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 'nw')} className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-cyan-400 rounded-sm cursor-nwse-resize z-30 shadow" />
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 'n')} className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-sm cursor-ns-resize z-30 shadow" />
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 'ne')} className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-cyan-400 rounded-sm cursor-nesw-resize z-30 shadow" />
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 'w')} className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-3 bg-cyan-400 rounded-sm cursor-ew-resize z-30 shadow" />
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 'e')} className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-cyan-400 rounded-sm cursor-ew-resize z-30 shadow" />
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 'sw')} className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-cyan-400 rounded-sm cursor-nesw-resize z-30 shadow" />
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 's')} className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-sm cursor-ns-resize z-30 shadow" />
                  <div onPointerDown={(e) => handlePointerDown(e, 'gameplay', 'resize', 'se')} className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-cyan-400 rounded-sm cursor-nwse-resize z-30 shadow" />
                </>
              )}
            </div>
          </div>

          <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
            <span>💡 Click &amp; Drag inside boxes to reposition crop coords</span>
            <span>Canvas: 1920 × 1080 Normalized</span>
          </div>
        </div>

        {/* CENTER COLUMN: 9:16 Composite Vertical Preview */}
        <div className="col-span-12 lg:col-span-3 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Smartphone size={15} className="text-[#8FD3FF]" />
              Output 9:16 Live Preview
            </span>
            <span className="text-[10px] font-mono text-[#8FD3FF] bg-[#8FD3FF]/10 px-1.5 py-0.5 rounded">
              1080 × 1920
            </span>
          </div>

          {sampleVideoUrl ? (
            <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10 relative shadow-2xl flex flex-col">
              <video src={sampleVideoUrl} autoPlay loop controls className="w-full h-full object-cover" />
              <button
                onClick={() => setSampleVideoUrl(null)}
                className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white text-[10px] px-2 py-1 rounded"
              >
                ✕ Close Sample
              </button>
            </div>
          ) : layoutType === 'single_crop_9_16' ? (
            /* Single Full 9:16 Crop Preview (No Facecam) */
            <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10 relative shadow-2xl flex flex-col">
              <div
                className="w-full h-full relative overflow-hidden flex flex-col justify-between p-4 bg-slate-900"
                style={getCropStyle(boxes.gameplay)}
              >
                <span className="text-[10px] font-mono text-cyan-400 bg-black/70 px-2 py-0.5 rounded w-max z-10 border border-cyan-400/30">
                  FULL 9:16 CROP (NO CAM)
                </span>

                {/* Subtitle simulation overlay */}
                <div className="text-center z-10 mb-8">
                  <span
                    style={{
                      fontFamily: fontFamily.split(' ')[0],
                      fontSize: `${fontSize * 0.22}px`,
                      color: primaryColor,
                      textShadow: `0 0 3px ${outlineColor}, 0 2px 4px rgba(0,0,0,0.8)`,
                    }}
                    className="font-black uppercase tracking-wide inline-block leading-tight drop-shadow-lg"
                  >
                    THIS IS <span style={{ color: highlightColor }}>INSANE!</span>
                  </span>
                </div>
              </div>
            </div>
          ) : layoutType === 'blurred_bg_center' ? (
            /* 16:9 Center with Blurred 9:16 BG Preview */
            <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
              {/* Blurred background frame */}
              {channelFrameUrl && (
                <div
                  className="absolute inset-0 bg-cover bg-center filter blur-md opacity-50 scale-110"
                  style={{ backgroundImage: `url(${channelFrameUrl})` }}
                />
              )}
              {/* Crisp 16:9 foreground clip */}
              <div
                className="w-full aspect-video bg-black/80 relative z-10 border-y border-white/20 bg-cover bg-center flex items-center justify-center"
                style={channelFrameUrl ? { backgroundImage: `url(${channelFrameUrl})` } : undefined}
              >
                {!channelFrameUrl && <span className="text-xs text-slate-400">Centered 16:9 Source</span>}
              </div>

              {/* Subtitles at bottom */}
              <div className="absolute bottom-12 text-center z-20">
                <span
                  style={{
                    fontFamily: fontFamily.split(' ')[0],
                    fontSize: `${fontSize * 0.22}px`,
                    color: primaryColor,
                    textShadow: `0 0 3px ${outlineColor}, 0 2px 4px rgba(0,0,0,0.8)`,
                  }}
                  className="font-black uppercase tracking-wide inline-block leading-tight drop-shadow-lg"
                >
                  THIS IS <span style={{ color: highlightColor }}>INSANE!</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10 relative shadow-2xl flex flex-col">
              {/* Stacked Top Section with Real Cropped Frame Preview */}
              <div
                className={`${layoutType === 'split_screen_50_50' ? 'h-[50%]' : 'h-[38%]'} bg-amber-950/40 border-b-2 border-slate-900 relative overflow-hidden flex items-center justify-center`}
                style={getCropStyle(boxes.facecam)}
              >
                {!channelFrameUrl && (
                  <span className="text-amber-400/80 font-bold text-xs uppercase tracking-wider">
                    Facecam ({boxes.facecam.w}% w)
                  </span>
                )}
                <span className="absolute top-2 left-2 text-[9px] font-mono text-amber-500 bg-black/60 px-1 rounded z-10">
                  {layoutType === 'split_screen_50_50' ? 'TOP 50%' : 'TOP 38%'}
                </span>
              </div>

              {/* Stacked Bottom Section with Real Cropped Frame Preview */}
              <div
                className={`${layoutType === 'split_screen_50_50' ? 'h-[50%]' : 'h-[62%]'} bg-cyan-950/40 relative overflow-hidden flex flex-col items-center justify-between p-4`}
                style={getCropStyle(boxes.gameplay)}
              >
                <div />
                {!channelFrameUrl && (
                  <span className="text-cyan-400/80 font-bold text-xs uppercase tracking-wider">
                    Gameplay ({boxes.gameplay.w}% w)
                  </span>
                )}

                {/* Subtitle simulation overlay */}
                <div className="text-center z-10">
                  <span
                    style={{
                      fontFamily: fontFamily.split(' ')[0],
                      fontSize: `${fontSize * 0.22}px`,
                      color: primaryColor,
                      textShadow: `0 0 3px ${outlineColor}, 0 2px 4px rgba(0,0,0,0.8)`,
                    }}
                    className="font-black uppercase tracking-wide inline-block leading-tight drop-shadow-lg"
                  >
                    THIS IS <span style={{ color: highlightColor }}>INSANE!</span>
                  </span>
                </div>

                <span className="absolute bottom-2 left-2 text-[9px] font-mono text-cyan-500 bg-black/60 px-1 rounded z-10">
                  {layoutType === 'split_screen_50_50' ? 'BOTTOM 50%' : 'BOTTOM 62%'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Typography & Layout Settings - Expanded to 3 cols */}
        <div className="col-span-12 lg:col-span-2 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Type size={15} className="text-[#8FD3FF]" />
            Template Metadata &amp; Subtitles
          </span>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Template Name
            </label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => { setTemplateName(e.target.value); setIsDirty(true); }}
              className="w-full bg-[#13151A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#8FD3FF]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Layout Structure
            </label>
            <select
              value={layoutType}
              onChange={(e) => {
                const newType = e.target.value;
                setLayoutType(newType);
                setIsDirty(true);
                if (newType === 'single_crop_9_16') {
                  setBoxes((prev) => ({
                    ...prev,
                    gameplay: { x: 34.1, y: 0, w: 31.7, h: 100 },
                  }));
                  setActiveBoxId('gameplay');
                } else if (newType === 'blurred_bg_center') {
                  setBoxes((prev) => ({
                    ...prev,
                    gameplay: { x: 0, y: 0, w: 100, h: 100 },
                  }));
                  setActiveBoxId('gameplay');
                }
              }}
              className="w-full bg-[#13151A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#8FD3FF]"
            >
              <option value="facecam_top_gameplay_bottom">Facecam Top (38%) + Game Bottom (62%)</option>
              <option value="split_screen_50_50">50/50 Vertical Split</option>
              <option value="single_crop_9_16">Full 9:16 Crop (No Facecam)</option>
              <option value="blurred_bg_center">16:9 Center with Blurred 9:16 BG</option>
              <option value="dynamic_face_track">Full 9:16 Auto Face Tracker</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Subtitle Font
              </label>
              <select
                value={fontFamily}
                onChange={(e) => { setFontFamily(e.target.value); setIsDirty(true); }}
                className="w-full bg-[#13151A] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                <option value="Montserrat ExtraBold">Montserrat Ext</option>
                <option value="Anton">Anton</option>
                <option value="Bangers">Bangers</option>
                <option value="Poppins Black">Poppins</option>
                <option value="Inter Black">Inter</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Font Size ({fontSize}px)
              </label>
              <input
                type="number"
                value={fontSize}
                onChange={(e) => { setFontSize(e.target.value); setIsDirty(true); }}
                className="w-full bg-[#13151A] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Animation Style
            </label>
            <select
              value={animationPreset}
              onChange={(e) => { setAnimationPreset(e.target.value); setIsDirty(true); }}
              className="w-full bg-[#13151A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
            >
              <option value="pop">Pop (TikTok / Reels energetic)</option>
              <option value="bounce">Bounce (Spring punch)</option>
              <option value="typewriter">Typewriter (Karaoke flow)</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Min Score Filter
              </label>
              <span className="text-xs font-mono font-bold text-[#8FD3FF]">{minScore}/100</span>
            </div>
            <input
              type="range"
              min="40"
              max="90"
              value={minScore}
              onChange={(e) => { setMinScore(e.target.value); setIsDirty(true); }}
              className="w-full accent-[#8FD3FF] cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
