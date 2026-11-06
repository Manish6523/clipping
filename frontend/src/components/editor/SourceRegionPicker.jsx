import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';

export default function SourceRegionPicker({ videoRef, onVideoLoaded }) {
  const { clipId, edl, updateRegion } = useEditorStore();
  const containerRef = useRef(null);

  const [activeBox, setActiveBox] = useState('person'); // 'person' or 'content'
  const [dragState, setDragState] = useState(null);
  const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const personBox = edl?.layout?.regions?.person || { x: 0.0, y: 0.58, w: 0.32, h: 0.42 };
  const contentBox = edl?.layout?.regions?.content || { x: 0.20, y: 0.0, w: 0.60, h: 1.0 };

  // Calculate actual rendered video dimensions inside letterboxed object-contain container
  const updateVideoRect = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    const cWidth = container.clientWidth;
    const cHeight = container.clientHeight;
    const vWidth = video.videoWidth || 1920;
    const vHeight = video.videoHeight || 1080;

    const videoAspect = vWidth / vHeight;
    const containerAspect = cWidth / cHeight;

    let width, height, left, top;
    if (containerAspect > videoAspect) {
      // Letterbox left/right
      height = cHeight;
      width = cHeight * videoAspect;
      top = 0;
      left = (cWidth - width) / 2;
    } else {
      // Letterbox top/bottom
      width = cWidth;
      height = cWidth / videoAspect;
      left = 0;
      top = (cHeight - height) / 2;
    }

    setVideoRect({ left, top, width, height });
  }, [videoRef]);

  useEffect(() => {
    const ro = new ResizeObserver(updateVideoRect);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateVideoRect);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateVideoRect);
    };
  }, [updateVideoRect]);

  const handlePointerDown = (e, boxKey, actionType, handle = null) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveBox(boxKey);

    setDragState({
      boxKey,
      actionType,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      videoW: videoRect.width,
      videoH: videoRect.height,
      origBox: boxKey === 'person' ? { ...personBox } : { ...contentBox },
    });
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!dragState || dragState.videoW <= 0) return;

      const deltaXNorm = (e.clientX - dragState.startX) / dragState.videoW;
      const deltaYNorm = (e.clientY - dragState.startY) / dragState.videoH;

      const box = { ...dragState.origBox };

      if (dragState.actionType === 'move') {
        const newX = Math.max(0, Math.min(1 - box.w, box.x + deltaXNorm));
        const newY = Math.max(0, Math.min(1 - box.h, box.y + deltaYNorm));
        updateRegion(dragState.boxKey, { x: roundNorm(newX), y: roundNorm(newY), w: box.w, h: box.h });
      } else if (dragState.actionType === 'resize') {
        let { x, y, w, h } = box;
        const handle = dragState.handle;

        // Slot aspect ratios (e.g. Person = 1080/730 ~ 1.48, Content = 1080/1190 ~ 0.908)
        const targetAspect = dragState.boxKey === 'person' 
          ? (1080 / 730) * (9 / 16) 
          : (1080 / 1190) * (9 / 16);

        if (handle.includes('e')) w = Math.max(0.1, Math.min(1 - x, box.w + deltaXNorm));
        if (handle.includes('s')) h = Math.max(0.1, Math.min(1 - y, box.h + deltaYNorm));
        if (handle.includes('w')) {
          const propW = Math.max(0.1, box.w - deltaXNorm);
          const propX = box.x + (box.w - propW);
          if (propX >= 0) { w = propW; x = propX; }
        }
        if (handle.includes('n')) {
          const propH = Math.max(0.1, box.h - deltaYNorm);
          const propY = box.y + (box.h - propH);
          if (propY >= 0) { h = propH; y = propY; }
        }

        // Clamp inside frame
        w = Math.min(w, 1 - x);
        h = Math.min(h, 1 - y);

        updateRegion(dragState.boxKey, { x: roundNorm(x), y: roundNorm(y), w: roundNorm(w), h: roundNorm(h) });
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
  }, [dragState, updateRegion]);

  const roundNorm = (val) => Math.round(val * 1000) / 1000;

  const renderHandles = (boxKey) => {
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    return handles.map((h) => {
      let pos = '';
      if (h === 'nw') pos = '-top-1.5 -left-1.5 cursor-nwse-resize';
      if (h === 'n') pos = '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize';
      if (h === 'ne') pos = '-top-1.5 -right-1.5 cursor-nesw-resize';
      if (h === 'e') pos = 'top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize';
      if (h === 'se') pos = '-bottom-1.5 -right-1.5 cursor-nwse-resize';
      if (h === 's') pos = '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize';
      if (h === 'sw') pos = '-bottom-1.5 -left-1.5 cursor-nesw-resize';
      if (h === 'w') pos = 'top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize';

      return (
        <div
          key={h}
          onPointerDown={(e) => handlePointerDown(e, boxKey, 'resize', h)}
          className={`absolute w-3 h-3 bg-white border-2 border-indigo-600 rounded-sm z-30 shadow-md ${pos}`}
        />
      );
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-[#0A0B0E] relative overflow-hidden select-none flex items-center justify-center rounded-2xl border border-white/[0.06]"
    >
      <video
        ref={videoRef}
        src={`/api/clips/${clipId}/source`}
        playsInline
        preload="metadata"
        onLoadedMetadata={() => {
          updateVideoRect();
          if (onVideoLoaded) onVideoLoaded();
        }}
        className="w-full h-full object-contain pointer-events-none"
      />

      {/* Overlay Active Crop Rectangles mapped exactly to the active video frame */}
      {videoRect.width > 0 && (
        <div
          style={{
            position: 'absolute',
            left: `${videoRect.left}px`,
            top: `${videoRect.top}px`,
            width: `${videoRect.width}px`,
            height: `${videoRect.height}px`,
            pointerEvents: 'none',
          }}
        >
          {/* Person Box (Yellow) */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'person', 'move')}
            style={{
              left: `${personBox.x * 100}%`,
              top: `${personBox.y * 100}%`,
              width: `${personBox.w * 100}%`,
              height: `${personBox.h * 100}%`,
              pointerEvents: 'auto',
            }}
            className={`absolute border-2 rounded-lg cursor-move z-20 ${
              activeBox === 'person'
                ? 'border-amber-400 bg-amber-400/20 ring-4 ring-amber-400/20 shadow-lg'
                : 'border-amber-400/60 bg-amber-400/10'
            }`}
          >
            <div className="absolute top-1 left-1 bg-amber-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded shadow pointer-events-none">
              PERSON / FACECAM
            </div>
            {activeBox === 'person' && renderHandles('person')}
          </div>

          {/* Content Box (Cyan) */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'content', 'move')}
            style={{
              left: `${contentBox.x * 100}%`,
              top: `${contentBox.y * 100}%`,
              width: `${contentBox.w * 100}%`,
              height: `${contentBox.h * 100}%`,
              pointerEvents: 'auto',
            }}
            className={`absolute border-2 rounded-lg cursor-move z-10 ${
              activeBox === 'content'
                ? 'border-cyan-400 bg-cyan-400/20 ring-4 ring-cyan-400/20 shadow-lg'
                : 'border-cyan-400/60 bg-cyan-400/10'
            }`}
          >
            <div className="absolute bottom-1 left-1 bg-cyan-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded shadow pointer-events-none">
              MAIN CONTENT / GAMEPLAY
            </div>
            {activeBox === 'content' && renderHandles('content')}
          </div>
        </div>
      )}
    </div>
  );
}
