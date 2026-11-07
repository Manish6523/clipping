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
    label: 'Full 9:16 Crop (No Facecam)',
    layers: [
      {
        id: 'l_main',
        name: 'Action 9:16',
        color: '#00F0FF',
        visible: true,
        locked: false,
        src: { x: 0.342, y: 0.0, w: 0.316, h: 1.0 },
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
        name: '16:9 Center',
        color: '#3B82F6',
        visible: true,
        locked: false,
        src: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
        dst: { x: 0.0, y: 0.342, w: 1.0, h: 0.316 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'off', smooth: 0.8 },
      }
    ],
    background: { type: 'blur', color: '#000000', blur: 40, dim: 0.4 }
  },
  dynamic_face_track: {
    id: 'dynamic_face_track',
    label: 'Full 9:16 Auto Face Tracker',
    layers: [
      {
        id: 'l_track',
        name: 'Auto Face Tracker',
        color: '#A855F7',
        visible: true,
        locked: false,
        src: { x: 0.342, y: 0.0, w: 0.316, h: 1.0 },
        dst: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
        fit: 'cover',
        aspect_lock: true,
        style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
        tracking: { mode: 'face', smooth: 0.8 },
      }
    ],
    background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
  },
  blank: {
    id: 'blank',
    label: 'Custom / Blank Canvas',
    layers: [],
    background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
  }
};

export default function LayoutBuilder({
  layout,
  onChange,
  sourceMediaUrl = null,
  videoRef = null,
  captionsConfig = null,
  mode = 'template', // 'template' | 'clip'
  onTestRenderFrame = null
}) {
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [dragState, setDragState] = useState(null); // { target: 'src'|'dst', layerId, type: 'move'|'resize', handle, startX, startY, origRect, canvasW, canvasH }
  const [drawNewLayer, setDrawNewLayer] = useState(null); // { startX, startY, curX, curY }
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [enableSnapping, setEnableSnapping] = useState(true);

  const srcCanvasRef = useRef(null);
  const dstCanvasRef = useRef(null);

  // Normalize current layout to Schema v2
  const currentLayout = useMemo(() => {
    if (!layout) return PRESET_STARTERS.facecam_top_gameplay_bottom;
    if (layout.schema === 2 && Array.isArray(layout.layers)) return layout;

    // Migrate on-the-fly
    return {
      schema: 2,
      canvas: { w: 1080, h: 1920 },
      background: layout.background || { type: 'solid', color: '#000000' },
      layers: PRESET_STARTERS.facecam_top_gameplay_bottom.layers
    };
  }, [layout]);

  const layers = currentLayout.layers || [];
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || layers[layers.length - 1] || null;

  useEffect(() => {
    if (!selectedLayerId && layers.length > 0) {
      setSelectedLayerId(layers[layers.length - 1].id);
    }
  }, [layers, selectedLayerId]);

  // Handler for layout mutation
  const updateLayout = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(currentLayout) : { ...currentLayout, ...updater };
    onChange?.(next);
  }, [currentLayout, onChange]);

  // Update specific layer
  const updateLayer = useCallback((layerId, layerUpdater) => {
    updateLayout((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? (typeof layerUpdater === 'function' ? layerUpdater(l) : { ...l, ...layerUpdater }) : l))
    }));
  }, [updateLayout]);

  // Add new layer
  const handleAddLayer = (initialSrc = null) => {
    if (layers.length >= 8) {
      alert('Maximum of 8 layers reached.');
      return;
    }
    const idx = layers.length;
    const newId = `l_${Date.now().toString().slice(-4)}`;
    const newLayer = {
      id: newId,
      name: `Frame ${idx + 1}`,
      color: LAYER_COLORS[idx % LAYER_COLORS.length],
      visible: true,
      locked: false,
      src: initialSrc || { x: 0.25, y: 0.25, w: 0.50, h: 0.50 },
      dst: { x: 0.10, y: 0.10 + (idx * 0.05), w: 0.80, h: 0.40 },
      fit: 'cover',
      aspect_lock: true,
      style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
      tracking: { mode: 'off', smooth: 0.8 },
      keyframes: { src: [], dst: [] },
      visible_range: null
    };

    updateLayout((prev) => ({
      ...prev,
      layers: [...prev.layers, newLayer]
    }));
    setSelectedLayerId(newId);
  };

  // Delete layer
  const handleDeleteLayer = (id) => {
    updateLayout((prev) => ({
      ...prev,
      layers: prev.layers.filter((l) => l.id !== id)
    }));
    if (selectedLayerId === id) {
      const remaining = layers.filter((l) => l.id !== id);
      setSelectedLayerId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  // Reorder layers (move up/down in z-order)
  const handleMoveZ = (id, direction) => {
    const idx = layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= layers.length) return;

    const reordered = [...layers];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    updateLayout((prev) => ({ ...prev, layers: reordered }));
  };

  // Switch starting preset
  const handleSelectPreset = (presetKey) => {
    const starter = PRESET_STARTERS[presetKey];
    if (!starter) return;

    if (layers.length > 0 && !window.confirm(`Switch layout to "${starter.label}"? Custom frame modifications will be reset.`)) {
      return;
    }

    updateLayout((prev) => ({
      ...prev,
      background: { ...starter.background },
      layers: starter.layers.map((l, i) => ({ ...l, id: `l_${Date.now()}_${i}` }))
    }));
  };

  // ----------------------------------------------------
  // Output Canvas 2D Live Composite Renderer
  // ----------------------------------------------------
  useEffect(() => {
    let animId;
    const canvas = dstCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const renderDst = () => {
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      // 1. Background
      const bg = currentLayout.background || { type: 'solid', color: '#000000' };
      if (bg.type === 'blur' && (videoRef?.current || sourceMediaUrl)) {
        ctx.fillStyle = bg.color || '#000000';
        ctx.fillRect(0, 0, cw, ch);
        // Blurred stream simulation
        ctx.save();
        ctx.filter = `blur(${bg.blur || 40}px) brightness(${1.0 - (bg.dim || 0.35)})`;
        const media = videoRef?.current || (sourceMediaUrl ? imgRef.current : null);
        if (media) {
          ctx.drawImage(media, 0, 0, cw, ch);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = bg.color || '#000000';
        ctx.fillRect(0, 0, cw, ch);
      }

      // 2. Visible Layers in z-order
      const media = videoRef?.current || (sourceMediaUrl ? imgRef.current : null);
      if (media) {
        const mw = media.videoWidth || media.naturalWidth || 1920;
        const mh = media.videoHeight || media.naturalHeight || 1080;

        for (const layer of layers) {
          if (!layer.visible) continue;
          const geo = calculateLayerGeometry(layer, mw, mh, cw, ch);
          const sc = geo.src_crop;
          const dr = geo.dst_rect;
          const sz = geo.scale_size;

          ctx.save();
          if (layer.style?.opacity !== undefined) {
            ctx.globalAlpha = layer.style.opacity;
          }

          // Path clipping for border-radius or circle
          if (layer.style?.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(dr.x + dr.w / 2, dr.y + dr.h / 2, Math.min(dr.w, dr.h) / 2, 0, Math.PI * 2);
            ctx.clip();
          } else if (layer.style?.radius > 0) {
            const rad = layer.style.radius;
            ctx.beginPath();
            ctx.roundRect(dr.x, dr.y, dr.w, dr.h, rad);
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
            // Virtual draw offscreen or scaled
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

      // Safe area overlay lines
      if (showSafeArea) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        // Top 12% & Bottom 20%
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
  }, [currentLayout, layers, videoRef, sourceMediaUrl, showSafeArea, mode]);

  // Image reference for static snapshot in Template Studio
  const imgRef = useRef(null);
  useEffect(() => {
    if (sourceMediaUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = sourceMediaUrl;
      img.onload = () => {
        imgRef.current = img;
        // Trigger redrawing
        const canvas = dstCanvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#000';
        }
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
          // Snap to center
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

  return (
    <div className="w-full flex flex-col gap-4 select-none">
      {/* Action Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0D1017] p-3 rounded-2xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <Layers size={15} className="text-[#8FD3FF]" /> Layout Builder (Schema v2)
          </span>

          {/* Preset Starters */}
          <div className="flex items-center gap-1.5 bg-[#13151A] px-2.5 py-1 rounded-lg border border-white/10">
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
            className="flex items-center gap-1.5 bg-gradient-to-r from-[#8FD3FF]/20 to-[#A9B8FF]/20 hover:from-[#8FD3FF]/30 hover:to-[#A9B8FF]/30 border border-[#8FD3FF]/40 text-[#8FD3FF] px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Plus size={14} /> Add Frame ({layers.length}/8)
          </button>

          <button
            onClick={() => setShowSafeArea(!showSafeArea)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
              showSafeArea ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone size={13} /> Safe Areas
          </button>

          <button
            onClick={() => setEnableSnapping(!enableSnapping)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
              enableSnapping ? 'bg-[#8FD3FF]/15 border-[#8FD3FF]/40 text-[#8FD3FF]' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            Snap: {enableSnapping ? 'ON' : 'OFF'}
          </button>

          {onTestRenderFrame && (
            <button
              onClick={onTestRenderFrame}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all border border-white/10"
            >
              <Sparkles size={13} className="text-amber-400" /> Test Render Frame
            </button>
          )}
        </div>
      </div>

      {/* Main Dual Canvases Row */}
      <div className="grid grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: 16:9 SOURCE CANVAS (Crop Selector) */}
        <div className="col-span-12 lg:col-span-7 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Monitor size={14} className="text-[#8FD3FF]" /> 16:9 Source Stream (Crop Boundaries)
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              Drag boxes to reposition what gets cropped
            </span>
          </div>

          {/* Interactive Source Canvas */}
          <div
            ref={srcCanvasRef}
            className="w-full aspect-video bg-black rounded-xl relative overflow-hidden border border-white/10 shadow-2xl select-none"
            style={{
              backgroundImage: (mode === 'template' && sourceMediaUrl) ? `url(${sourceMediaUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {/* Live Video Player in Clip Editor Mode */}
            {mode === 'clip' && (
              <video
                ref={videoRef}
                src={sourceMediaUrl || undefined}
                playsInline
                preload="auto"
                crossOrigin="anonymous"
                className="w-full h-full object-contain pointer-events-none"
              />
            )}

            {/* Draw overlay boxes for each layer */}
            {layers.map((layer) => {
              if (!layer.visible) return null;
              const isSelected = selectedLayerId === layer.id;
              const { x, y, w, h } = layer.src;

              return (
                <div
                  key={layer.id}
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${w * 100}%`,
                    height: `${h * 100}%`,
                    borderColor: layer.color || '#00F0FF',
                  }}
                  onPointerDown={(e) => handlePointerDown(e, 'src', layer.id, 'move')}
                  className={`absolute border-2 rounded-lg cursor-grab active:cursor-grabbing flex flex-col justify-between p-1.5 transition-shadow ${
                    isSelected
                      ? 'shadow-[0_0_15px_rgba(255,255,255,0.4)] z-20'
                      : 'opacity-70 hover:opacity-100 z-10'
                  }`}
                >
                  {/* Top Badge */}
                  <div className="flex items-center justify-between pointer-events-none">
                    <span
                      style={{ backgroundColor: layer.color || '#00F0FF' }}
                      className="text-black font-extrabold text-[10px] px-1.5 py-0.5 rounded shadow tracking-wider uppercase truncate max-w-[120px]"
                    >
                      {layer.name}
                    </span>
                    <span className="text-[9px] font-mono bg-black/70 px-1 rounded text-white border border-white/10">
                      {Math.round(w * 100)}% × {Math.round(h * 100)}%
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

        {/* RIGHT COLUMN: 9:16 LIVE OUTPUT COMPOSITE CANVAS */}
        <div className="col-span-12 lg:col-span-5 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Smartphone size={14} className="text-[#8FD3FF]" /> 9:16 Live Canvas (Output Placement)
            </span>
            <span className="text-[11px] font-mono text-slate-500">1080 × 1920</span>
          </div>

          {/* Interactive 9:16 Composite Viewport */}
          <div className="w-full flex justify-center">
            <div
              className="w-full max-w-[320px] aspect-[9/16] bg-black rounded-xl overflow-hidden border border-white/10 relative shadow-2xl"
            >
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
                const { x, y, w, h } = layer.dst;

                return (
                  <div
                    key={layer.id}
                    style={{
                      left: `${x * 100}%`,
                      top: `${y * 100}%`,
                      width: `${w * 100}%`,
                      height: `${h * 100}%`,
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

              {/* Subtitle simulation overlay */}
              {captionsConfig && (
                <div
                  style={{ top: `${(captionsConfig.position?.y ?? 0.76) * 100}%` }}
                  className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-40 w-[90%] pointer-events-none"
                >
                  <span
                    style={{
                      fontFamily: captionsConfig.font || 'Montserrat ExtraBold',
                      fontSize: '15px',
                      color: captionsConfig.color || '#FFFFFF',
                      textShadow: '0 0 3px #000, 0 2px 4px rgba(0,0,0,0.8)',
                    }}
                    className="font-black uppercase tracking-wide inline-block drop-shadow"
                  >
                    THIS IS <span style={{ color: captionsConfig.highlight || '#FACC15' }}>INSANE!</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LAYERS MANAGER SHELF & INSPECTOR */}
      <div className="grid grid-cols-12 gap-6 bg-[#0D1017] border border-white/[0.08] rounded-2xl p-5 shadow-xl">
        {/* Left: Layers Stacking Order list (z-order) */}
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers size={14} className="text-[#8FD3FF]" /> Stacking Order (Top to Bottom)
            </span>
            <span className="text-[10px] font-mono text-slate-500">Highest item renders in front</span>
          </div>

          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
            {layers.slice().reverse().map((layer, revIdx) => {
              const origIdx = layers.length - 1 - revIdx;
              const isSelected = selectedLayerId === layer.id;

              return (
                <div
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[#1A1D24] border-[#8FD3FF] shadow-sm'
                      : 'bg-[#13151A]/60 border-white/[0.06] hover:bg-[#13151A] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      style={{ backgroundColor: layer.color || '#00F0FF' }}
                      className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                    />
                    <input
                      type="text"
                      value={layer.name}
                      onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                      className="bg-transparent text-xs font-bold text-white focus:outline-none focus:border-b border-[#8FD3FF]"
                    />
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleMoveZ(layer.id, 1)}
                      disabled={origIdx === layers.length - 1}
                      title="Bring Forward"
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => handleMoveZ(layer.id, -1)}
                      disabled={origIdx === 0}
                      title="Send Backward"
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                      title={layer.visible ? 'Hide' : 'Show'}
                      className="p-1 rounded text-slate-400 hover:text-white"
                    >
                      {layer.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-slate-600" />}
                    </button>
                    <button
                      onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                      title={layer.locked ? 'Unlock' : 'Lock'}
                      className="p-1 rounded text-slate-400 hover:text-white"
                    >
                      {layer.locked ? <Lock size={13} className="text-amber-400" /> : <Unlock size={13} />}
                    </button>
                    <button
                      onClick={() => handleDeleteLayer(layer.id)}
                      title="Delete Frame"
                      className="p-1 rounded text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Layer Inspector */}
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Settings size={14} className="text-[#8FD3FF]" /> Frame Inspector
            </span>
            {selectedLayer && (
              <span className="text-[10px] font-mono text-[#8FD3FF] font-bold">
                {selectedLayer.name} ({selectedLayer.id})
              </span>
            )}
          </div>

          {selectedLayer ? (
            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* Fit Mode */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                  Fit Mode
                </label>
                <select
                  value={selectedLayer.fit || 'cover'}
                  onChange={(e) => updateLayer(selectedLayer.id, { fit: e.target.value })}
                  className="w-full bg-[#13151A] border border-white/10 rounded-lg p-1.5 text-white focus:outline-none"
                >
                  <option value="cover">Cover (Fill slot, crop overflow)</option>
                  <option value="contain">Contain (Letterbox inside slot)</option>
                  <option value="stretch">Stretch (Fill directly)</option>
                </select>
              </div>

              {/* Shape / Radius */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                  Corner Shape
                </label>
                <select
                  value={selectedLayer.style?.shape || 'rect'}
                  onChange={(e) => updateLayer(selectedLayer.id, { style: { ...selectedLayer.style, shape: e.target.value } })}
                  className="w-full bg-[#13151A] border border-white/10 rounded-lg p-1.5 text-white focus:outline-none"
                >
                  <option value="rect">Rectangle</option>
                  <option value="circle">Circle / Bubble</option>
                </select>
              </div>

              {/* Border Width & Color */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                  Border Width ({selectedLayer.style?.border?.w || 0}px)
                </label>
                <input
                  type="range"
                  min="0"
                  max="12"
                  value={selectedLayer.style?.border?.w || 0}
                  onChange={(e) => updateLayer(selectedLayer.id, {
                    style: {
                      ...selectedLayer.style,
                      border: { ...selectedLayer.style?.border, w: Number(e.target.value) }
                    }
                  })}
                  className="w-full accent-[#8FD3FF] cursor-pointer"
                />
              </div>

              {/* Opacity Slider */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                  Opacity ({Math.round((selectedLayer.style?.opacity ?? 1.0) * 100)}%)
                </label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={Math.round((selectedLayer.style?.opacity ?? 1.0) * 100)}
                  onChange={(e) => updateLayer(selectedLayer.id, {
                    style: { ...selectedLayer.style, opacity: Number(e.target.value) / 100 }
                  })}
                  className="w-full accent-[#8FD3FF] cursor-pointer"
                />
              </div>

              {/* Background Configuration */}
              <div className="col-span-2 pt-2 border-t border-white/[0.06] flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Canvas Background
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {currentLayout.background?.type === 'blur' ? 'Blurred Video Stream' : 'Solid Canvas'}
                  </span>
                </div>
                <button
                  onClick={() => updateLayout((prev) => ({
                    ...prev,
                    background: prev.background?.type === 'blur'
                      ? { type: 'solid', color: '#000000', blur: 0, dim: 0.0 }
                      : { type: 'blur', color: '#000000', blur: 40, dim: 0.35 }
                  }))}
                  className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold text-[#8FD3FF] border border-white/10 transition-all"
                >
                  Switch to {currentLayout.background?.type === 'blur' ? 'Solid Color' : 'Blurred BG'}
                </button>
              </div>
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center text-slate-600 italic text-xs">
              Select or add a frame to customize its properties.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

