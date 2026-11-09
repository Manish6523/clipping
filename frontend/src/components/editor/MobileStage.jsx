import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Repeat, 
  Smartphone, 
  Monitor, 
  Sparkles,
  Maximize2,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Layers,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  LockKeyhole,
  UnlockKeyhole
} from 'lucide-react';
import { calculateLayerGeometry } from '../../utils/layoutMath';
import { renderCaptionsToCanvas } from '../../utils/captionRenderer';

export default function MobileStage({
  layout,
  onChange,
  sourceMediaUrl,
  videoRef,
  captionsConfig,
  words = [],
  currentTime = 0,
  selectedLayerId,
  onSelectLayer,
  onSelectCaption,
  showSafeArea = false,
  isPhone = true,
}) {
  // 'output' means 9:16 is main stage, 16:9 is PiP thumbnail
  // 'source' means 16:9 is main stage, 9:16 is PiP thumbnail
  const [mainView, setMainView] = useState('output'); 
  const [dragReadout, setDragReadout] = useState(null); // Floating { x, y, w, h } readout near finger

  const srcCanvasRef = useRef(null);
  const dstCanvasRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  const lastSnapVibrate = useRef(0);

  const triggerHaptic = useCallback(() => {
    const now = Date.now();
    if (now - lastSnapVibrate.current > 120 && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(5);
        lastSnapVibrate.current = now;
      } catch (e) {}
    }
  }, []);

  const layers = useMemo(() => layout?.layers || [], [layout]);
  const selectedLayer = useMemo(() => layers.find(l => l.id === selectedLayerId), [layers, selectedLayerId]);

  const updateLayout = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(layout) : { ...layout, ...updater };
    onChange?.(next);
  }, [layout, onChange]);

  const updateLayer = useCallback((layerId, partial) => {
    updateLayout((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...partial } : l))
    }));
  }, [updateLayout]);

  // Touch gesture pointerDown for crop / placement box manipulation
  const handlePointerDown = (e, target, layerId, actionType, handle = null) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectLayer?.(layerId);

    const layer = layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return;

    const canvasElem = target === 'src' ? srcCanvasRef.current : dstCanvasRef.current;
    if (!canvasElem) return;
    const rect = canvasElem.getBoundingClientRect();

    if (e.target.setPointerCapture && e.pointerId) {
      try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    }

    setDragState({
      target, // 'src' | 'dst'
      layerId,
      actionType, // 'move' | 'resize'
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      canvasW: rect.width,
      canvasH: rect.height,
      origRect: { ...(target === 'src' ? layer.src : layer.dst) },
    });
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!dragState) return;

      const deltaXNorm = (e.clientX - dragState.startX) / dragState.canvasW;
      const deltaYNorm = (e.clientY - dragState.startY) / dragState.canvasH;
      const rectKey = dragState.target;
      const curRect = { ...dragState.origRect };

      if (dragState.actionType === 'move') {
        let newX = Math.max(0, Math.min(1.0 - curRect.w, curRect.x + deltaXNorm));
        let newY = Math.max(0, Math.min(1.0 - curRect.h, curRect.y + deltaYNorm));

        // Snapping with haptic feedback
        const centerGuideX = 0.5 - curRect.w / 2;
        const centerGuideY = 0.5 - curRect.h / 2;
        if (Math.abs(newX - centerGuideX) < 0.02) {
          newX = centerGuideX;
          triggerHaptic();
        }
        if (Math.abs(newY - centerGuideY) < 0.02) {
          newY = centerGuideY;
          triggerHaptic();
        }

        const finalX = Math.round(newX * 1000) / 1000;
        const finalY = Math.round(newY * 1000) / 1000;

        setDragReadout({
          x: Math.round(finalX * 100),
          y: Math.round(finalY * 100),
          w: Math.round(curRect.w * 100),
          h: Math.round(curRect.h * 100),
        });

        updateLayer(dragState.layerId, {
          [rectKey]: {
            ...curRect,
            x: finalX,
            y: finalY,
          }
        });
      } else if (dragState.actionType === 'resize') {
        const hnd = dragState.handle;
        let { x, y, w, h } = curRect;
        if (hnd.includes('e')) {
          w = Math.max(0.04, Math.min(1.0 - x, curRect.w + deltaXNorm));
        }
        if (hnd.includes('s')) {
          h = Math.max(0.04, Math.min(1.0 - y, curRect.h + deltaYNorm));
        }
        if (hnd.includes('w')) {
          const rawW = curRect.w - deltaXNorm;
          const maxAllowedW = curRect.x + curRect.w;
          const clampedW = Math.max(0.04, Math.min(maxAllowedW, rawW));
          w = clampedW;
          x = Math.max(0, curRect.x + (curRect.w - clampedW));
        }
        if (hnd.includes('n')) {
          const rawH = curRect.h - deltaYNorm;
          const maxAllowedH = curRect.y + curRect.h;
          const clampedH = Math.max(0.04, Math.min(maxAllowedH, rawH));
          h = clampedH;
          y = Math.max(0, curRect.y + (curRect.h - clampedH));
        }

        // Clamp inside bounds
        x = Math.max(0, Math.min(1.0 - 0.04, x));
        y = Math.max(0, Math.min(1.0 - 0.04, y));
        w = Math.max(0.04, Math.min(1.0 - x, w));
        h = Math.max(0.04, Math.min(1.0 - y, h));

        // If aspect ratio is locked for dst
        const layer = dragState.layer;
        if (dragState.target === 'dst' && layer?.aspect_lock && curRect.h > 0) {
          const targetRatio = (curRect.w * dragState.canvasW) / (curRect.h * dragState.canvasH);
          if (hnd.includes('e') || hnd.includes('w')) {
            const desiredH = (w * dragState.canvasW) / targetRatio / dragState.canvasH;
            if (y + desiredH <= 1.0) {
              h = desiredH;
            } else {
              h = 1.0 - y;
              w = (h * dragState.canvasH * targetRatio) / dragState.canvasW;
            }
          }
        }

        const finalX = Math.round(x * 1000) / 1000;
        const finalY = Math.round(y * 1000) / 1000;
        const finalW = Math.round(w * 1000) / 1000;
        const finalH = Math.round(h * 1000) / 1000;

        setDragReadout({
          x: Math.round(finalX * 100),
          y: Math.round(finalY * 100),
          w: Math.round(finalW * 100),
          h: Math.round(finalH * 100),
        });

        updateLayer(dragState.layerId, {
          [rectKey]: {
            x: finalX,
            y: finalY,
            w: finalW,
            h: finalH,
          }
        });
      }
    };

    const handlePointerUp = () => {
      if (dragState) {
        setDragState(null);
        setDragReadout(null);
      }
    };

    if (dragState) {
      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, updateLayer, triggerHaptic]);

  // Layer quick operations for floating mini-toolbar
  const handleToggleLock = (layerId) => {
    const l = layers.find(x => x.id === layerId);
    if (l) updateLayer(layerId, { locked: !l.locked });
  };

  const handleToggleVisibility = (layerId) => {
    const l = layers.find(x => x.id === layerId);
    if (l) updateLayer(layerId, { visible: !l.visible });
  };

  const handleDuplicateLayer = (layerId) => {
    const l = layers.find(x => x.id === layerId);
    if (!l) return;
    const newLayer = {
      ...l,
      id: `layer_${Date.now()}`,
      name: `${l.name} Copy`,
      dst: { ...l.dst, x: Math.min(0.8, (l.dst?.x || 0) + 0.05), y: Math.min(0.8, (l.dst?.y || 0) + 0.05) }
    };
    updateLayout(prev => ({ ...prev, layers: [...prev.layers, newLayer] }));
    onSelectLayer?.(newLayer.id);
  };

  const handleDeleteLayer = (layerId) => {
    updateLayout(prev => ({
      ...prev,
      layers: prev.layers.filter(l => l.id !== layerId)
    }));
    onSelectLayer?.(null);
  };

  const handleMoveOrder = (layerId, dir) => {
    const idx = layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= layers.length) return;
    const nextLayers = [...layers];
    const [removed] = nextLayers.splice(idx, 1);
    nextLayers.splice(targetIdx, 0, removed);
    updateLayout(prev => ({ ...prev, layers: nextLayers }));
  };

  // Cycle overlap layers under touch
  const handleCycleLayers = () => {
    if (!layers.length) return;
    const curIdx = layers.findIndex(l => l.id === selectedLayerId);
    const nextIdx = (curIdx + 1) % layers.length;
    onSelectLayer?.(layers[nextIdx].id);
  };

  // Image reference for static snapshot when editing templates or when source is an image
  const imgRef = useRef(null);
  useEffect(() => {
    if (sourceMediaUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = sourceMediaUrl;
      img.onload = () => {
        imgRef.current = img;
      };
    } else {
      imgRef.current = null;
    }
  }, [sourceMediaUrl]);

  // 60FPS Composite 9:16 canvas loop
  useEffect(() => {
    const canvas = dstCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId = null;

    const render = () => {
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      const media = (videoRef?.current && videoRef.current.readyState >= 1)
        ? videoRef.current
        : (imgRef.current && imgRef.current.complete ? imgRef.current : null);

      // Solid background
      ctx.fillStyle = layout?.background?.color || '#000000';
      ctx.fillRect(0, 0, cw, ch);

      // Render layers
      for (const layer of layers) {
        if (!layer.visible) continue;
        const geo = calculateLayerGeometry(layer, 1920, 1080, cw, ch);
        const dr = geo.dst_rect;
        const sc = geo.src_crop || geo.src_rect;
        const sz = geo.scale_size || geo.scaled_size;

        if (media && sc && dr && sz) {
          ctx.save();
          ctx.globalAlpha = layer.style?.opacity ?? 1.0;
          if (layer.style?.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(dr.x + dr.w / 2, dr.y + dr.h / 2, Math.min(dr.w, dr.h) / 2, 0, Math.PI * 2);
            ctx.clip();
          }
          if (geo.fit === 'cover' && geo.inner_crop) {
            ctx.drawImage(media, sc.x, sc.y, sc.w, sc.h, dr.x - geo.inner_crop.x, dr.y - geo.inner_crop.y, sz.w, sz.h);
          } else {
            ctx.drawImage(media, sc.x, sc.y, sc.w, sc.h, dr.x, dr.y, dr.w, dr.h);
          }
          ctx.restore();
        }
      }

      // Live Captions
      const curTime = videoRef?.current && !videoRef.current.paused ? videoRef.current.currentTime : (currentTime || 0);
      renderCaptionsToCanvas({
        ctx,
        canvasW: cw,
        canvasH: ch,
        words,
        currentTime: curTime,
        captionsConfig,
      });

      // Safe areas overlay
      if (showSafeArea) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(cw * 0.05, ch * 0.12, cw * 0.90, ch * 0.68);
        ctx.setLineDash([]);
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [layout, layers, videoRef, showSafeArea, captionsConfig, words, currentTime]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden p-2 select-none touch-none bg-black/40">
      {/* 
        MASTER PERSISTENT VIDEO ELEMENT:
        Must ALWAYS remain mounted in the DOM regardless of mainView ('output' or 'source')
        so that:
        1. Media loads and buffers without being destroyed on view toggle.
        2. Mobile browsers allow play/pause transport control.
        3. Canvas 2D ctx.drawImage has a continuous, loaded video frame source.
      */}
      <video
        ref={videoRef}
        src={sourceMediaUrl || undefined}
        crossOrigin="anonymous"
        playsInline
        webkit-playsinline="true"
        preload="auto"
        className={mainView === 'source' ? 'hidden' : 'sr-only'}
      />

      {/* 1. PRIMARY STAGE (Either 9:16 Output Canvas or 16:9 Source Crop) */}
      {mainView === 'output' ? (
        /* MAIN VIEW = 9:16 LIVE OUTPUT */
        <div 
          onClick={() => onSelectLayer?.(null)}
          className="h-full aspect-[9/16] max-w-full bg-black rounded-2xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center"
        >
          <canvas
            ref={dstCanvasRef}
            width={540}
            height={960}
            className="w-full h-full object-contain pointer-events-none"
          />

          {/* Overlaid draggable placement frames */}
          {layers.map((layer) => {
            if (!layer.visible) return null;
            const isSelected = selectedLayerId === layer.id;
            const { x, y, w, h } = layer.dst || { x: 0, y: 0, w: 1, h: 1 };

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
                className={`absolute border rounded-none cursor-grab active:cursor-grabbing transition-shadow touch-none ${
                  isSelected 
                    ? 'border-white shadow-[0_0_10px_rgba(255,255,255,0.7)] z-30 ring-1 ring-white/40' 
                    : 'border-white/40 z-20'
                }`}
              >
                {/* Clean minimal corner dot instead of obstructing banner */}
                <div
                  style={{ backgroundColor: layer.color || '#00F0FF' }}
                  className="absolute top-0 left-0 w-2 h-2 rounded-br pointer-events-none"
                />

                {/* 4 Touch Corner Handles with 44x44dp hit area */}
                {isSelected && !layer.locked && ['nw', 'ne', 'sw', 'se'].map((hnd) => (
                  <div
                    key={hnd}
                    onPointerDown={(e) => handlePointerDown(e, 'dst', layer.id, 'resize', hnd)}
                    className={`absolute w-10 h-10 -m-3.5 flex items-center justify-center z-40 touch-none active:scale-110 transition-transform ${
                      hnd === 'nw' ? 'top-0 left-0' :
                      hnd === 'ne' ? 'top-0 right-0' :
                      hnd === 'sw' ? 'bottom-0 left-0' :
                      'bottom-0 right-0'
                    }`}
                  >
                    <div className="w-4 h-4 bg-[#8FD3FF] border-2 border-black rounded-full shadow-lg" />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        /* MAIN VIEW = 16:9 SOURCE CROP SELECTOR */
        <div 
          ref={srcCanvasRef}
          onClick={() => onSelectLayer?.(null)}
          className="w-full aspect-video max-h-full bg-black rounded-2xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center"
        >
          {sourceMediaUrl && (
            sourceMediaUrl.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
              <video
                src={sourceMediaUrl}
                crossOrigin="anonymous"
                playsInline
                webkit-playsinline="true"
                preload="auto"
                className="w-full h-full object-cover pointer-events-none"
                ref={(el) => {
                  if (el && videoRef?.current) {
                    el.currentTime = videoRef.current.currentTime;
                  }
                }}
              />
            ) : (
              <img
                src={sourceMediaUrl}
                alt="Source Frame"
                className="w-full h-full object-cover pointer-events-none"
              />
            )
          )}

          {/* 16:9 Crop Boxes Overlay */}
          {layers.map((layer) => {
            if (!layer.visible) return null;
            const isSelected = selectedLayerId === layer.id;
            const { x, y, w, h } = layer.src || { x: 0, y: 0, w: 1, h: 1 };

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
                className={`absolute border rounded-none cursor-grab active:cursor-grabbing transition-shadow touch-none ${
                  isSelected 
                    ? 'border-white shadow-[0_0_10px_rgba(255,255,255,0.7)] z-30 ring-1 ring-white/40' 
                    : 'border-white/40 z-20'
                }`}
              >
                {/* Clean minimal corner dot instead of obstructing banner */}
                <div
                  style={{ backgroundColor: layer.color || '#00F0FF' }}
                  className="absolute top-0 left-0 w-2 h-2 rounded-br pointer-events-none"
                />

                {/* 4 Touch Corner Handles with 44x44dp hit area */}
                {isSelected && !layer.locked && ['nw', 'ne', 'sw', 'se'].map((hnd) => (
                  <div
                    key={hnd}
                    onPointerDown={(e) => handlePointerDown(e, 'src', layer.id, 'resize', hnd)}
                    className={`absolute w-10 h-10 -m-3.5 flex items-center justify-center z-40 touch-none active:scale-110 transition-transform ${
                      hnd === 'nw' ? 'top-0 left-0' :
                      hnd === 'ne' ? 'top-0 right-0' :
                      hnd === 'sw' ? 'bottom-0 left-0' :
                      'bottom-0 right-0'
                    }`}
                  >
                    <div className="w-4 h-4 bg-white border-2 border-black rounded-full shadow-lg" />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Coordinate & Dimension Readout during drag */}
      {dragReadout && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-black/85 border border-[#8FD3FF]/50 text-white px-3 py-1 rounded-full text-xs font-mono shadow-xl flex items-center gap-2 pointer-events-none animate-in fade-in">
          <span>X: {dragReadout.x}%</span>
          <span>Y: {dragReadout.y}%</span>
          <span className="text-[#8FD3FF]">W: {dragReadout.w}%</span>
          <span className="text-[#8FD3FF]">H: {dragReadout.h}%</span>
        </div>
      )}

      {/* Floating Mini-Toolbar for Selected Layer (44x44dp touch targets) */}
      {selectedLayer && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-[#0E1118]/95 backdrop-blur-md border border-white/15 px-2 py-1 rounded-2xl shadow-2xl flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center gap-1 px-1.5 border-r border-white/10 mr-0.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedLayer.color }} />
            <span className="text-[11px] font-bold text-white max-w-[70px] truncate">{selectedLayer.name}</span>
          </div>

          {/* Cycle overlapping layers */}
          {layers.length > 1 && (
            <button
              onClick={handleCycleLayers}
              title="Cycle frame under touch"
              className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-white flex items-center justify-center text-xs"
            >
              <Layers size={14} className="text-[#8FD3FF]" />
            </button>
          )}

          {/* Lock / Unlock */}
          <button
            onClick={() => handleToggleLock(selectedLayer.id)}
            title={selectedLayer.locked ? 'Unlock frame' : 'Lock frame'}
            className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-white flex items-center justify-center"
          >
            {selectedLayer.locked ? <Lock size={14} className="text-amber-400" /> : <Unlock size={14} className="text-slate-400" />}
          </button>

          {/* Aspect Ratio Lock / Unlock */}
          <button
            onClick={() => handleUpdateLayer(selectedLayer.id, { aspect_lock: !selectedLayer.aspect_lock })}
            title={selectedLayer.aspect_lock ? "Unlock aspect ratio" : "Lock aspect ratio"}
            className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-white flex items-center justify-center"
          >
            {selectedLayer.aspect_lock ? <LockKeyhole size={14} className="text-[#8FD3FF]" /> : <UnlockKeyhole size={14} className="text-slate-400" />}
          </button>

          {/* Reset Aspect Ratio */}
          <button
            onClick={() => {
              const curDst = selectedLayer.dst || { x: 0, y: 0, w: 1, h: 1 };
              const srcW = selectedLayer.src?.w || 1;
              const srcH = selectedLayer.src?.h || 1;
              const srcAspect = (srcW * 16) / (srcH * 9);
              const newH = Math.min(1.0 - curDst.y, (curDst.w * 9) / (srcAspect * 16));
              handleUpdateLayer(selectedLayer.id, {
                dst: {
                  ...curDst,
                  h: Math.round(newH * 1000) / 1000
                },
                aspect_lock: true
              });
            }}
            title="Reset aspect ratio to source crop"
            className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-white flex items-center justify-center"
          >
            <RotateCcw size={13} className="text-[#8FD3FF]" />
          </button>

          {/* Visibility */}
          <button
            onClick={() => handleToggleVisibility(selectedLayer.id)}
            title="Toggle visibility"
            className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-white flex items-center justify-center"
          >
            {selectedLayer.visible ? <Eye size={14} className="text-slate-300" /> : <EyeOff size={14} className="text-rose-400" />}
          </button>

          {/* Z-order up / down */}
          <button
            onClick={() => handleMoveOrder(selectedLayer.id, -1)}
            title="Move back"
            className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-slate-300 flex items-center justify-center"
          >
            <ArrowDown size={14} />
          </button>
          <button
            onClick={() => handleMoveOrder(selectedLayer.id, 1)}
            title="Move front"
            className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-slate-300 flex items-center justify-center"
          >
            <ArrowUp size={14} />
          </button>

          {/* Duplicate */}
          <button
            onClick={() => handleDuplicateLayer(selectedLayer.id)}
            title="Duplicate frame"
            className="w-9 h-9 rounded-xl bg-white/[0.06] active:bg-white/15 text-slate-300 flex items-center justify-center"
          >
            <Copy size={13} />
          </button>

          {/* Delete */}
          <button
            onClick={() => handleDeleteLayer(selectedLayer.id)}
            title="Delete frame"
            className="w-9 h-9 rounded-xl bg-rose-500/15 active:bg-rose-500/25 text-rose-400 flex items-center justify-center"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {/* 2. PICTURE-IN-PICTURE (PiP) THUMBNAIL (Pinned Top-Right) */}
      <div 
        onClick={() => setMainView(mainView === 'output' ? 'source' : 'output')}
        className={`absolute top-3 right-3 z-30 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl bg-black/90 cursor-pointer active:scale-95 transition-all group ${
          mainView === 'output' ? 'w-28 aspect-video' : 'w-16 aspect-[9/16]'
        }`}
        title="Tap to swap main and thumbnail view"
      >
        {mainView === 'output' ? (
          /* PiP displays 16:9 source with mini crop boxes */
          <div className="w-full h-full relative flex items-center justify-center">
            {sourceMediaUrl && (
              sourceMediaUrl.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
                <video
                  src={sourceMediaUrl}
                  playsInline
                  webkit-playsinline="true"
                  muted
                  className="w-full h-full object-cover pointer-events-none opacity-80"
                  ref={(el) => {
                    if (el && videoRef?.current) {
                      el.currentTime = videoRef.current.currentTime;
                    }
                  }}
                />
              ) : (
                <img
                  src={sourceMediaUrl}
                  alt="PiP Source"
                  className="w-full h-full object-cover pointer-events-none opacity-80"
                />
              )
            )}
            {layers.map((l) => (
              <div
                key={l.id}
                style={{
                  left: `${(l.src?.x ?? 0) * 100}%`,
                  top: `${(l.src?.y ?? 0) * 100}%`,
                  width: `${(l.src?.w ?? 1) * 100}%`,
                  height: `${(l.src?.h ?? 1) * 100}%`,
                  borderColor: l.color || '#00F0FF',
                }}
                className="absolute border"
              />
            ))}
            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent flex items-center justify-center">
              <span className="p-1 rounded-full bg-black/60 text-white shadow">
                <Repeat size={12} />
              </span>
            </div>
          </div>
        ) : (
          /* PiP displays 9:16 output thumbnail */
          <div className="w-full h-full relative flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="p-1 rounded-full bg-black/60 text-white shadow">
                <Repeat size={12} />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
