import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Copy, 
  Move, 
  ArrowUp, 
  ArrowDown, 
  Maximize2, 
  RotateCcw, 
  ShieldAlert, 
  Check, 
  Sparkles,
  Layers,
  Settings,
  HelpCircle,
  Smartphone,
  Monitor,
  Scissors
} from 'lucide-react';
import { calculateLayerGeometry } from '../utils/layoutMath';
import { renderCaptionsToCanvas } from '../utils/captionRenderer';

const LAYER_COLORS = [
  '#FFB020', '#00F0FF', '#A855F7', '#EC4899', 
  '#10B981', '#F59E0B', '#3B82F6', '#EF4444'
];

export const PRESET_STARTERS = {
  facecam_top_gameplay_bottom: {
    id: 'facecam_top_gameplay_bottom',
    label: 'Facecam Top (38%) + Game (62%)',
    layers: [
      {
        id: 'l_game',
        name: 'Gameplay',
        color: '#00F0FF',
        visible: true,
        locked: false,
        src: { x: 0.20, y: 0.0, w: 0.60, h: 1.0 },
        dst: { x: 0.0, y: 0.38, w: 1.0, h: 0.62 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'off', smooth: 0.8 },
      },
      {
        id: 'l_face',
        name: 'Facecam',
        color: '#FFB020',
        visible: true,
        locked: false,
        src: { x: 0.0, y: 0.58, w: 0.32, h: 0.42 },
        dst: { x: 0.0, y: 0.0, w: 1.0, h: 0.38 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'off', smooth: 0.8 },
      }
    ],
    background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
  },
  split_screen_50_50: {
    id: 'split_screen_50_50',
    label: '50/50 Vertical Split',
    layers: [
      {
        id: 'l_bot',
        name: 'Bottom Slot',
        color: '#00F0FF',
        visible: true,
        locked: false,
        src: { x: 0.20, y: 0.0, w: 0.60, h: 1.0 },
        dst: { x: 0.0, y: 0.50, w: 1.0, h: 0.50 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'off', smooth: 0.8 },
      },
      {
        id: 'l_top',
        name: 'Top Slot',
        color: '#FFB020',
        visible: true,
        locked: false,
        src: { x: 0.0, y: 0.58, w: 0.32, h: 0.42 },
        dst: { x: 0.0, y: 0.0, w: 1.0, h: 0.50 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'off', smooth: 0.8 },
      }
    ],
    background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
  },
  single_crop_9_16: {
    id: 'single_crop_9_16',
    label: 'Full 9:16 Single Crop',
    layers: [
      {
        id: 'l_main',
        name: 'Main Video',
        color: '#10B981',
        visible: true,
        locked: false,
        src: { x: 0.22, y: 0.0, w: 0.56, h: 1.0 },
        dst: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'off', smooth: 0.8 },
      }
    ],
    background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
  },
  blurred_bg_center: {
    id: 'blurred_bg_center',
    label: '16:9 Center with Blurred BG',
    layers: [
      {
        id: 'l_center',
        name: '16:9 Center Video',
        color: '#3B82F6',
        visible: true,
        locked: false,
        src: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
        dst: { x: 0.0, y: 0.31, w: 1.0, h: 0.38 },
        fit: 'contain',
        aspect_lock: true,
        style: { radius: 12, shape: 'rect', border: { w: 2, color: '#FFFFFF' }, shadow: { blur: 15, opacity: 0.6 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'off', smooth: 0.8 },
      }
    ],
    background: { type: 'blur', color: '#000000', blur: 40, dim: 0.35 }
  },
  auto_face_tracker: {
    id: 'auto_face_tracker',
    label: 'Auto Face Tracker (Single Layer)',
    layers: [
      {
        id: 'l_tracker',
        name: 'Auto Face Follower',
        color: '#EC4899',
        visible: true,
        locked: false,
        src: { x: 0.22, y: 0.0, w: 0.56, h: 1.0 },
        dst: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'face', smooth: 0.85 },
      }
    ],
    background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
  }
};

export default function LayoutBuilder({
  layout,
  onChange,
  sourceMediaUrl,
  videoRef,
  captionsConfig,
  words = [],
  currentTime = 0,
  mode = 'template', // 'template' | 'clip'
  selectedLayerId: controlledSelectedLayerId,
  onSelectLayer,
  onSelectCaption,
  onTestRenderFrame,
  showBottomPanel = false, // Deleted in round 3; kept as opt-in prop for legacy
}) {
  const [internalSelectedLayerId, setInternalSelectedLayerId] = useState(null);
  const selectedLayerId = controlledSelectedLayerId !== undefined ? controlledSelectedLayerId : internalSelectedLayerId;
  const setSelectedLayerId = useCallback((id) => {
    if (onSelectLayer) onSelectLayer(id);
    else setInternalSelectedLayerId(id);
  }, [onSelectLayer]);

  const [enableSnapping, setEnableSnapping] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [captionDragState, setCaptionDragState] = useState(null);

  // References
  const srcCanvasRef = useRef(null);
  const dstCanvasRef = useRef(null);

  // Fallback default layout schema v2
  const currentLayout = useMemo(() => {
    if (layout && layout.layers && Array.isArray(layout.layers) && layout.layers.length > 0) {
      return layout;
    }
    return {
      schema: 2,
      canvas: { w: 1080, h: 1920 },
      background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 },
      layers: [...PRESET_STARTERS.facecam_top_gameplay_bottom.layers]
    };
  }, [layout]);

  const layers = useMemo(() => currentLayout.layers || [], [currentLayout]);

  const updateLayout = useCallback((updater) => {
    const nextLayout = typeof updater === 'function' ? updater(currentLayout) : { ...currentLayout, ...updater };
    onChange?.(nextLayout);
  }, [currentLayout, onChange]);

  const updateLayer = useCallback((layerId, partial) => {
    updateLayout((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...partial } : l))
    }));
  }, [updateLayout]);

  const handleAddLayer = () => {
    if (layers.length >= 8) return;
    const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];
    const newId = `l_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newLayer = {
      id: newId,
      name: `Frame ${layers.length + 1}`,
      color,
      visible: true,
      locked: false,
      src: { x: 0.25, y: 0.25, w: 0.50, h: 0.50 },
      dst: { x: 0.10, y: 0.20, w: 0.80, h: 0.40 },
      fit: 'cover',
      aspect_lock: true,
      style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
      tracking: { mode: 'off', smooth: 0.8 }
    };

    updateLayout((prev) => ({
      ...prev,
      layers: [...prev.layers, newLayer]
    }));
    setSelectedLayerId(newId);
  };

  const handleDeleteLayer = (layerId) => {
    if (layers.length <= 1) return;
    updateLayout((prev) => ({
      ...prev,
      layers: prev.layers.filter((l) => l.id !== layerId)
    }));
    if (selectedLayerId === layerId) {
      setSelectedLayerId(null);
    }
  };

  const handleMoveZ = (layerId, direction) => {
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= layers.length) return;

    const newLayers = [...layers];
    const [moved] = newLayers.splice(idx, 1);
    newLayers.splice(newIdx, 0, moved);

    updateLayout((prev) => ({ ...prev, layers: newLayers }));
  };

  const handleSelectPreset = (presetKey) => {
    const starter = PRESET_STARTERS[presetKey];
    if (!starter) return;
    updateLayout({
      schema: 2,
      canvas: { w: 1080, h: 1920 },
      background: { ...starter.background },
      layers: starter.layers.map((l) => ({ ...l, id: `l_${Date.now()}_${l.name.toLowerCase()}` }))
    });
    setSelectedLayerId(null);
  };

  // ----------------------------------------------------
  // Live 9:16 Canvas Destination Rendering (requestAnimationFrame)
  // ----------------------------------------------------
  useEffect(() => {
    const canvas = dstCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId = null;

    const renderDst = () => {
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      // Determine active media element
      let media = null;
      if (mode === 'clip' && videoRef?.current && videoRef.current.readyState >= 2) {
        media = videoRef.current;
      } else if (imgRef.current && imgRef.current.complete) {
        media = imgRef.current;
      }

      // 1. Draw Background
      const bg = currentLayout.background || { type: 'solid', color: '#000000' };
      if (bg.type === 'solid' || !media) {
        ctx.fillStyle = bg.color || '#000000';
        ctx.fillRect(0, 0, cw, ch);
      } else if (bg.type === 'blur' && media) {
        ctx.save();
        ctx.filter = `blur(${bg.blur || 30}px)`;
        // Draw centered and covering entire 9:16
        ctx.drawImage(media, -cw * 0.5, 0, cw * 2.0, ch);
        ctx.restore();

        if (bg.dim > 0) {
          ctx.fillStyle = `rgba(0,0,0,${bg.dim || 0.35})`;
          ctx.fillRect(0, 0, cw, ch);
        }
      }

      // 2. Draw Layers in z-order
      for (const layer of layers) {
        if (!layer.visible) continue;

        const geo = calculateLayerGeometry(layer, 1920, 1080, cw, ch);
        const dr = geo.dst_rect;
        const sc = geo.src_crop || geo.src_rect;
        const sz = geo.scale_size || geo.scaled_size;

        if (media && sc && dr && sz) {
          ctx.save();
          ctx.globalAlpha = layer.style?.opacity ?? 1.0;

          // Clipping for shape
          if (layer.style?.shape === 'circle') {
            ctx.beginPath();
            const cx = dr.x + dr.w / 2;
            const cy = dr.y + dr.h / 2;
            const radius = Math.min(dr.w, dr.h) / 2;
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.clip();
          } else if (layer.style?.radius > 0) {
            const rad = layer.style.radius;
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(dr.x, dr.y, dr.w, dr.h, rad);
            } else {
              ctx.rect(dr.x, dr.y, dr.w, dr.h);
            }
            ctx.clip();
          }

          // Draw layer based on fit mode
          if (geo.fit === 'contain' && geo.letterbox_offset) {
            ctx.drawImage(
              media,
              sc.x, sc.y, sc.w, sc.h,
              dr.x + geo.letterbox_offset.dx, dr.y + geo.letterbox_offset.dy, sz.w, sz.h
            );
          } else if (geo.fit === 'cover' && geo.inner_crop) {
            ctx.drawImage(
              media,
              sc.x, sc.y, sc.w, sc.h,
              dr.x - geo.inner_crop.x, dr.y - geo.inner_crop.y, sz.w, sz.h
            );
          } else {
            ctx.drawImage(media, sc.x, sc.y, sc.w, sc.h, dr.x, dr.y, dr.w, dr.h);
          }

          ctx.restore();
        }
      }

      // 3. Live Captions Render onto 9:16 Canvas
      const curTime = (videoRef?.current && !videoRef.current.paused)
        ? videoRef.current.currentTime
        : (currentTime || 0);

      renderCaptionsToCanvas({
        ctx,
        canvasW: cw,
        canvasH: ch,
        words,
        currentTime: curTime,
        captionsConfig,
        isTemplateStudio: mode === 'template',
      });

      // 4. Safe area overlay lines
      if (showSafeArea) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(cw * 0.05, ch * 0.12, cw * 0.90, ch * 0.68);
        ctx.setLineDash([]);
      }

      if (mode === 'clip' && videoRef?.current) {
        animId = requestAnimationFrame(renderDst);
      }
    };

    renderDst();
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [currentLayout, layers, videoRef, sourceMediaUrl, showSafeArea, mode, captionsConfig, words, currentTime]);

  // Image reference for static snapshot in Template Studio
  const imgRef = useRef(null);
  useEffect(() => {
    if (sourceMediaUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = sourceMediaUrl;
      img.onload = () => {
        imgRef.current = img;
      };
    }
  }, [sourceMediaUrl]);

  // ----------------------------------------------------
  // Drag & Resize Math (Source Canvas & Destination Canvas)
  // ----------------------------------------------------
  const handlePointerDown = (e, target, layerId, actionType, handle = null) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedLayerId(layerId);

    const layer = layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return;

    const canvasElem = target === 'src' ? srcCanvasRef.current : dstCanvasRef.current;
    if (!canvasElem) return;
    const rect = canvasElem.getBoundingClientRect();

    setDragState({
      target, // 'src' | 'dst'
      layerId,
      actionType, // 'move' | 'resize'
      handle,
      startX: e.clientX,
      startY: e.clientY,
      canvasW: rect.width,
      canvasH: rect.height,
      origRect: { ...(target === 'src' ? layer.src : layer.dst) },
      layer: { ...layer }
    });
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!dragState) return;

      const deltaXNorm = (e.clientX - dragState.startX) / dragState.canvasW;
      const deltaYNorm = (e.clientY - dragState.startY) / dragState.canvasH;

      const rectKey = dragState.target; // 'src' or 'dst'
      const curRect = { ...dragState.origRect };

      if (dragState.actionType === 'move') {
        let newX = Math.max(0, Math.min(1.0 - curRect.w, curRect.x + deltaXNorm));
        let newY = Math.max(0, Math.min(1.0 - curRect.h, curRect.y + deltaYNorm));

        if (enableSnapping) {
          if (Math.abs((newX + curRect.w / 2) - 0.5) < 0.02) newX = 0.5 - curRect.w / 2;
          if (Math.abs((newY + curRect.h / 2) - 0.5) < 0.02) newY = 0.5 - curRect.h / 2;
        }

        updateLayer(dragState.layerId, {
          [rectKey]: {
            ...curRect,
            x: Math.round(newX * 1000) / 1000,
            y: Math.round(newY * 1000) / 1000,
          }
        });
      } else if (dragState.actionType === 'resize') {
        const handle = dragState.handle;
        let { x, y, w, h } = curRect;

        if (handle.includes('e')) w = Math.max(0.04, Math.min(1.0 - x, curRect.w + deltaXNorm));
        if (handle.includes('s')) h = Math.max(0.04, Math.min(1.0 - y, curRect.h + deltaYNorm));
        if (handle.includes('w')) {
          const propW = Math.max(0.04, curRect.w - deltaXNorm);
          const propX = curRect.x + (curRect.w - propW);
          if (propX >= 0) {
            w = propW;
            x = propX;
          }
        }
        if (handle.includes('n')) {
          const propH = Math.max(0.04, curRect.h - deltaYNorm);
          const propY = curRect.y + (curRect.h - propH);
          if (propY >= 0) {
            h = propH;
            y = propY;
          }
        }

        updateLayer(dragState.layerId, {
          [rectKey]: {
            x: Math.round(x * 1000) / 1000,
            y: Math.round(y * 1000) / 1000,
            w: Math.round(w * 1000) / 1000,
            h: Math.round(h * 1000) / 1000,
          }
        });
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
  }, [dragState, updateLayer, enableSnapping]);

  // Caption drag handling
  const handleCaptionPointerDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onSelectCaption) onSelectCaption();

    const canvasElem = dstCanvasRef.current;
    if (!canvasElem) return;
    const rect = canvasElem.getBoundingClientRect();
    const curPos = captionsConfig?.position || { x: 0.5, y: 0.76, max_width: 0.85 };

    setCaptionDragState({
      startX: e.clientX,
      startY: e.clientY,
      canvasW: rect.width,
      canvasH: rect.height,
      origX: curPos.x,
      origY: curPos.y,
    });
  };

  useEffect(() => {
    const handleCaptionMove = (e) => {
      if (!captionDragState) return;
      const deltaXNorm = (e.clientX - captionDragState.startX) / captionDragState.canvasW;
      const deltaYNorm = (e.clientY - captionDragState.startY) / captionDragState.canvasH;

      let newX = Math.max(0.1, Math.min(0.9, captionDragState.origX + deltaXNorm));
      let newY = Math.max(0.08, Math.min(0.92, captionDragState.origY + deltaYNorm));

      if (enableSnapping) {
        if (Math.abs(newX - 0.5) < 0.02) newX = 0.5;
        if (Math.abs(newY - 0.38) < 0.02) newY = 0.38; // seam
        if (Math.abs(newY - 0.50) < 0.02) newY = 0.50; // middle
        if (Math.abs(newY - 0.76) < 0.02) newY = 0.76; // lower third
      }

      if (captionsConfig && captionsConfig.onChangePos) {
        captionsConfig.onChangePos({
          x: Math.round(newX * 1000) / 1000,
          y: Math.round(newY * 1000) / 1000,
        });
      }
    };

    const handleCaptionUp = () => {
      if (captionDragState) setCaptionDragState(null);
    };

    if (captionDragState) {
      window.addEventListener('pointermove', handleCaptionMove);
      window.addEventListener('pointerup', handleCaptionUp);
    }
    return () => {
      window.removeEventListener('pointermove', handleCaptionMove);
      window.removeEventListener('pointerup', handleCaptionUp);
    };
  }, [captionDragState, enableSnapping, captionsConfig]);

  const selectedLayer = layers.find((l) => l.id === selectedLayerId);
  const captionPos = captionsConfig?.position || { x: 0.5, y: 0.76, max_width: 0.85 };

  return (
    <div className="w-full flex flex-col gap-3 select-none flex-1 min-h-0">
      {/* Action Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0D1017] px-3 py-2 rounded-xl border border-white/[0.08] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
            <Layers size={14} className="text-[#8FD3FF]" /> Layout Builder (Schema v2)
          </span>

          {/* Preset Starters */}
          <div className="flex items-center gap-1 bg-[#13151A] px-2 py-0.5 rounded-lg border border-white/10">
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Preset:</span>
            <select
              onChange={(e) => handleSelectPreset(e.target.value)}
              defaultValue="facecam_top_gameplay_bottom"
              className="bg-transparent text-xs text-[#8FD3FF] font-bold focus:outline-none cursor-pointer"
            >
              {Object.values(PRESET_STARTERS).map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAddLayer()}
            disabled={layers.length >= 8}
            className="flex items-center gap-1 bg-gradient-to-r from-[#8FD3FF]/20 to-[#A9B8FF]/20 hover:from-[#8FD3FF]/30 hover:to-[#A9B8FF]/30 border border-[#8FD3FF]/40 text-[#8FD3FF] px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-sm"
          >
            <Plus size={13} /> Add Frame ({layers.length}/8)
          </button>

          <button
            onClick={() => setShowSafeArea(!showSafeArea)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
              showSafeArea ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone size={12} /> Safe Areas
          </button>

          <button
            onClick={() => setEnableSnapping(!enableSnapping)}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
              enableSnapping ? 'bg-[#8FD3FF]/15 border-[#8FD3FF]/40 text-[#8FD3FF]' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            Snap: {enableSnapping ? 'ON' : 'OFF'}
          </button>

          {onTestRenderFrame && (
            <button
              onClick={onTestRenderFrame}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white px-2.5 py-1 rounded-lg text-xs font-bold transition-all border border-white/10"
            >
              <Sparkles size={12} className="text-amber-400" /> Test Render Frame
            </button>
          )}
        </div>
      </div>

      {/* Main Dual Canvases Row */}
      <div className="grid grid-cols-12 gap-3 items-stretch flex-1 min-h-0">
        {/* LEFT COLUMN: 16:9 SOURCE CANVAS (Crop Selector) */}
        <div className="col-span-12 lg:col-span-7 bg-[#0D1017] border border-white/[0.08] rounded-xl p-3 flex flex-col gap-2 shadow-xl min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Monitor size={14} className="text-[#8FD3FF]" /> 16:9 Source Stream (Crop Boundaries)
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              Drag boxes to reposition what gets cropped
            </span>
          </div>

          {/* Interactive Source Canvas */}
          <div className="w-full flex-1 flex items-center justify-center min-h-0 overflow-hidden">
            <div
              ref={srcCanvasRef}
              className="w-full aspect-video max-h-full bg-black rounded-lg overflow-hidden border border-white/10 relative shadow-inner flex items-center justify-center select-none"
            >
              {mode === 'clip' && sourceMediaUrl ? (
                <video
                  key={sourceMediaUrl}
                  ref={videoRef}
                  src={sourceMediaUrl}
                  crossOrigin="anonymous"
                  playsInline
                  preload="auto"
                  className="w-full h-full object-cover pointer-events-none"
                />
              ) : sourceMediaUrl ? (
                <img
                  key={sourceMediaUrl}
                  src={sourceMediaUrl}
                  alt="Source Frame"
                  className="w-full h-full object-cover pointer-events-none"
                />
              ) : (
                <div className="text-slate-600 text-xs">No media loaded</div>
              )}

            {/* Source Crop Boxes Overlay */}
            {layers.map((layer) => {
              if (!layer.visible) return null;
              const isSelected = selectedLayerId === layer.id;
              const srcRect = layer.src || { x: 0, y: 0, w: 1, h: 1 };
              const { x, y, w, h } = srcRect;

              return (
                <div
                  key={layer.id}
                  style={{
                    left: `${(x ?? 0) * 100}%`,
                    top: `${(y ?? 0) * 100}%`,
                    width: `${(w ?? 1) * 100}%`,
                    height: `${(h ?? 1) * 100}%`,
                    borderColor: layer.color || '#00F0FF',
                  }}
                  onPointerDown={(e) => handlePointerDown(e, 'src', layer.id, 'move')}
                  className={`absolute border-2 rounded cursor-grab active:cursor-grabbing transition-shadow ${
                    isSelected 
                      ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.6)] z-30'
                      : 'border-white/40 hover:border-white/80 z-20'
                  }`}
                >
                  <div
                    style={{ backgroundColor: layer.color || '#00F0FF' }}
                    className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-black uppercase text-black flex items-center gap-1 shadow pointer-events-none select-none"
                  >
                    <span>{layer.name}</span>
                    <span className="text-[9px] font-mono bg-black/70 px-1 rounded text-white border border-white/10">
                      {Math.round(w * 100)}% x {Math.round(h * 100)}%
                    </span>
                  </div>

                  {/* 8-Point Resize Handles (Active only on selected layer) */}
                  {isSelected && !layer.locked && (
                    <>
                      {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((hnd) => (
                        <div
                          key={hnd}
                          onPointerDown={(e) => handlePointerDown(e, 'src', layer.id, 'resize', hnd)}
                          style={{ borderColor: layer.color || '#00F0FF' }}
                          className={`absolute w-3 h-3 bg-white border-2 rounded-full cursor-${hnd}-resize z-30 shadow hover:scale-125 transition-transform ${
                            hnd === 'nw' ? '-top-1.5 -left-1.5' :
                            hnd === 'ne' ? '-top-1.5 -right-1.5' :
                            hnd === 'sw' ? '-bottom-1.5 -left-1.5' :
                            hnd === 'se' ? '-bottom-1.5 -right-1.5' :
                            hnd === 'n' ? '-top-1.5 left-1/2 -translate-x-1/2' :
                            hnd === 's' ? '-bottom-1.5 left-1/2 -translate-x-1/2' :
                            hnd === 'e' ? 'top-1/2 -right-1.5 -translate-y-1/2' :
                            'top-1/2 -left-1.5 -translate-y-1/2'
                          }`}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: 9:16 LIVE OUTPUT COMPOSITE CANVAS */}
        <div className="col-span-12 lg:col-span-5 bg-[#0D1017] border border-white/[0.08] rounded-xl p-3 flex flex-col gap-2 shadow-xl min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Smartphone size={14} className="text-[#8FD3FF]" /> 9:16 Live Canvas (Output Placement)
            </span>
            <span className="text-[10px] font-mono text-slate-500">1080 x 1920</span>
          </div>

          {/* Interactive 9:16 Composite Viewport */}
          <div className="w-full flex-1 flex justify-center items-center min-h-0">
            <div className="h-full aspect-[9/16] bg-black rounded-lg overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
              <canvas
                ref={dstCanvasRef}
                width={1080}
                height={1920}
                className="w-full h-full object-cover pointer-events-none"
              />

              {/* Destination Placement Drag & Resize Overlays */}
              {layers.map((layer) => {
                if (!layer.visible) return null;
                const isSelected = selectedLayerId === layer.id;
                const dstRect = layer.dst || { x: 0, y: 0, w: 1, h: 1 };
                const { x, y, w, h } = dstRect;

                return (
                  <div
                    key={layer.id}
                    style={{
                      left: `${(x ?? 0) * 100}%`,
                      top: `${(y ?? 0) * 100}%`,
                      width: `${(w ?? 1) * 100}%`,
                      height: `${(h ?? 1) * 100}%`,
                      borderColor: layer.color || '#00F0FF',
                    }}
                    onPointerDown={(e) => handlePointerDown(e, 'dst', layer.id, 'move')}
                    className={`absolute border-2 rounded cursor-grab active:cursor-grabbing transition-shadow ${
                      isSelected
                        ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.5)] z-30'
                        : 'border-white/30 hover:border-white/80 z-20'
                    }`}
                  >
                    {/* Destination 8-Point Resize Handles */}
                    {isSelected && !layer.locked && (
                      <>
                        {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((hnd) => (
                          <div
                            key={hnd}
                            onPointerDown={(e) => handlePointerDown(e, 'dst', layer.id, 'resize', hnd)}
                            className={`absolute w-3 h-3 bg-[#8FD3FF] border-2 border-black rounded-full cursor-${hnd}-resize z-40 shadow hover:scale-125 transition-transform ${
                              hnd === 'nw' ? '-top-1.5 -left-1.5' :
                              hnd === 'ne' ? '-top-1.5 -right-1.5' :
                              hnd === 'sw' ? '-bottom-1.5 -left-1.5' :
                              hnd === 'se' ? '-bottom-1.5 -right-1.5' :
                              hnd === 'n' ? '-top-1.5 left-1/2 -translate-x-1/2' :
                              hnd === 's' ? '-bottom-1.5 left-1/2 -translate-x-1/2' :
                              hnd === 'e' ? 'top-1/2 -right-1.5 -translate-y-1/2' :
                              'top-1/2 -left-1.5 -translate-y-1/2'
                            }`}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}

              {/* Draggable Caption Hit Box */}
              <div
                style={{
                  top: `${(captionPos.y ?? 0.76) * 100}%`,
                  left: `${(captionPos.x ?? 0.5) * 100}%`,
                  width: `${(captionPos.max_width ?? 0.85) * 100}%`,
                }}
                onPointerDown={handleCaptionPointerDown}
                className="absolute -translate-x-1/2 -translate-y-1/2 z-40 h-10 border border-dashed border-[#8FD3FF]/40 hover:border-[#8FD3FF] hover:bg-[#8FD3FF]/10 cursor-move rounded-lg flex items-center justify-center transition-all group"
                title="Click or drag to position captions"
              >
                <span className="text-[9px] font-mono font-bold text-[#8FD3FF] opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 px-1.5 py-0.5 rounded border border-white/10 pointer-events-none">
                  Captions ({Math.round(captionPos.x * 100)}%, {Math.round(captionPos.y * 100)}%)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* OPTIONAL LEGACY BOTTOM PANEL (Only rendered if showBottomPanel is true) */}
      {showBottomPanel && (
        <div className="grid grid-cols-12 gap-4 bg-[#0D1017] border border-white/[0.08] rounded-xl p-3 shadow-xl shrink-0">
          <div className="col-span-12 lg:col-span-6 flex flex-col gap-2">
            <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Layers size={13} className="text-[#8FD3FF]" /> Stacking Order
              </span>
            </div>
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto">
              {layers.slice().reverse().map((layer, revIdx) => (
                <div
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                  className={`p-2 rounded-lg border flex items-center justify-between text-xs ${
                    selectedLayerId === layer.id ? 'bg-[#1A1D24] border-[#8FD3FF]' : 'bg-[#13151A] border-white/5'
                  }`}
                >
                  <span className="font-bold text-white">{layer.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
