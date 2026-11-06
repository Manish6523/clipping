import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { ShieldAlert, Move } from 'lucide-react';

export default function LivePreviewCanvas({ videoRef, isDebug = false }) {
  const { edl, currentTime, updateCaptionPos } = useEditorStore();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [showSafeArea, setShowSafeArea] = useState(false);
  const [isDraggingCaption, setIsDraggingCaption] = useState(false);
  const [dragStart, setDragStart] = useState({ mouseX: 0, mouseY: 0, origX: 0.5, origY: 0.76 });
  const [activeGuide, setActiveGuide] = useState(null); // 'center', 'third_top', 'third_bot', 'seam'

  const captionsPos = edl?.captions?.position || { x: 0.5, y: 0.76, max_width: 0.85 };
  const seamRatio = 0.38;

  // Check if caption enters dangerous social UI safe-area (bottom 20%, top 12%, right 15%)
  const isInsideDangerZone = (captionsPos.y > 0.80) || (captionsPos.y < 0.12) || (captionsPos.x > 0.82);

  // Render video + captions onto Canvas
  useEffect(() => {
    let animId;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const render = () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const vw = video.videoWidth || 1920;
        const vh = video.videoHeight || 1080;

        const cw = canvas.width;
        const ch = canvas.height;

        ctx.clearRect(0, 0, cw, ch);

        const person = edl?.layout?.regions?.person || { x: 0.0, y: 0.58, w: 0.32, h: 0.42 };
        const content = edl?.layout?.regions?.content || { x: 0.20, y: 0.0, w: 0.60, h: 1.0 };
        const layoutType = edl?.layout?.type || 'facecam_top_gameplay_bottom';

        if (layoutType === 'facecam_top_gameplay_bottom') {
          // Top Slot (Person / Facecam) -> 38% height
          const topH = Math.round(ch * seamRatio);
          const sx1 = Math.round(person.x * vw);
          const sy1 = Math.round(person.y * vh);
          const sw1 = Math.round(person.w * vw);
          const sh1 = Math.round(person.h * vh);
          try {
            ctx.drawImage(video, sx1, sy1, sw1, sh1, 0, 0, cw, topH);
          } catch (e) {}

          // Seam line
          ctx.fillStyle = '#0A0B0E';
          ctx.fillRect(0, topH - 2, cw, 4);

          // Bottom Slot (Main Content / Gameplay) -> 62% height
          const botH = ch - topH;
          const sx2 = Math.round(content.x * vw);
          const sy2 = Math.round(content.y * vh);
          const sw2 = Math.round(content.w * vw);
          const sh2 = Math.round(content.h * vh);
          try {
            ctx.drawImage(video, sx2, sy2, sw2, sh2, 0, topH, cw, botH);
          } catch (e) {}
        } else if (layoutType === 'split_screen_50_50') {
          const halfH = Math.round(ch * 0.5);
          const sx1 = Math.round(person.x * vw);
          const sy1 = Math.round(person.y * vh);
          const sw1 = Math.round(person.w * vw);
          const sh1 = Math.round(person.h * vh);
          try {
            ctx.drawImage(video, sx1, sy1, sw1, sh1, 0, 0, cw, halfH);
          } catch (e) {}

          const sx2 = Math.round(content.x * vw);
          const sy2 = Math.round(content.y * vh);
          const sw2 = Math.round(content.w * vw);
          const sh2 = Math.round(content.h * vh);
          try {
            ctx.drawImage(video, sx2, sy2, sw2, sh2, 0, halfH, cw, halfH);
          } catch (e) {}
        } else {
          // Blurred background + centered 16:9
          try {
            ctx.filter = 'blur(16px)';
            ctx.drawImage(video, 0, 0, vw, vh, -cw * 0.5, 0, cw * 2, ch);
            ctx.filter = 'none';

            const fgH = Math.round(cw * (vh / vw));
            const fgY = Math.round((ch - fgH) / 2);
            ctx.drawImage(video, 0, 0, vw, vh, 0, fgY, cw, fgH);
          } catch (e) {}
        }

        // Draw Captions & Active Words on top using direct positioning
        const curWord = edl?.words?.find(
          (w) => !w.deleted && currentTime >= w.start && currentTime <= w.end
        );

        const fontFam = edl?.captions?.font?.split(' ')[0] || 'Montserrat';
        const fontSize = Math.round((edl?.captions?.size || 72) * (cw / 1080));
        ctx.font = `900 ${fontSize}px "${fontFam}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textX = Math.round(captionsPos.x * cw);
        const textY = Math.round(captionsPos.y * ch);

        const activeText = curWord
          ? (curWord.word || curWord.text || '').toUpperCase()
          : (isDraggingCaption ? 'SUBTITLE PREVIEW' : '');

        if (activeText) {
          // Draw stroke outline
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.16));
          ctx.strokeText(activeText, textX, textY);

          // Draw fill highlight
          ctx.fillStyle = edl?.captions?.highlight || '#FACC15';
          ctx.fillText(activeText, textX, textY);
        }

        // Snap Guides when dragging
        if (isDraggingCaption) {
          ctx.save();
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);

          // Vertical Center Guide
          ctx.strokeStyle = activeGuide === 'center_x' ? '#8FD3FF' : 'rgba(255,255,255,0.2)';
          ctx.beginPath();
          ctx.moveTo(cw / 2, 0);
          ctx.lineTo(cw / 2, ch);
          ctx.stroke();

          // Seam Guide
          ctx.strokeStyle = activeGuide === 'seam' ? '#FACC15' : 'rgba(255,255,255,0.15)';
          ctx.beginPath();
          ctx.moveTo(0, ch * seamRatio);
          ctx.lineTo(cw, ch * seamRatio);
          ctx.stroke();

          // Thirds
          ctx.strokeStyle = activeGuide === 'third_bot' ? '#8FD3FF' : 'rgba(255,255,255,0.15)';
          ctx.beginPath();
          ctx.moveTo(0, ch * 0.67);
          ctx.lineTo(cw, ch * 0.67);
          ctx.stroke();

          ctx.restore();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [videoRef, edl, currentTime, captionsPos, isDraggingCaption, activeGuide]);

  // Mouse drag handlers for caption box
  const handleMouseDown = (e) => {
    e.preventDefault();
    if (!containerRef.current) return;
    setIsDraggingCaption(true);
    setDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      origX: captionsPos.x,
      origY: captionsPos.y,
    });
  };

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingCaption || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    const deltaX = (e.clientX - dragStart.mouseX) / rect.width;
    const deltaY = (e.clientY - dragStart.mouseY) / rect.height;

    let newX = Math.max(0.1, Math.min(0.9, dragStart.origX + deltaX));
    let newY = Math.max(0.1, Math.min(0.9, dragStart.origY + deltaY));

    // Snapping thresholds (0.02 delta)
    let guide = null;
    if (Math.abs(newX - 0.5) < 0.025) {
      newX = 0.5;
      guide = 'center_x';
    }
    if (Math.abs(newY - seamRatio) < 0.02) {
      newY = seamRatio;
      guide = 'seam';
    } else if (Math.abs(newY - 0.67) < 0.02) {
      newY = 0.67;
      guide = 'third_bot';
    } else if (Math.abs(newY - 0.50) < 0.02) {
      newY = 0.50;
      guide = 'middle';
    }

    setActiveGuide(guide);
    updateCaptionPos({ x: Number(newX.toFixed(3)), y: Number(newY.toFixed(3)) });
  }, [isDraggingCaption, dragStart, updateCaptionPos]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingCaption(false);
    setActiveGuide(null);
  }, []);

  useEffect(() => {
    if (isDraggingCaption) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDraggingCaption, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className="h-full aspect-[9/16] bg-black rounded-2xl overflow-hidden border-2 border-white/[0.14] relative shadow-2xl flex items-center justify-center select-none group"
    >
      <canvas
        ref={canvasRef}
        width={360}
        height={640}
        className="w-full h-full object-contain"
      />

      {/* Social Safe-Area Overlay (TikTok, Reels, Shorts) */}
      {showSafeArea && (
        <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between">
          {/* Top Bar Danger Zone (12%) */}
          <div className="h-[12%] bg-rose-500/15 border-b border-rose-500/30 flex items-center justify-center">
            <span className="text-[9px] font-mono font-bold text-rose-300">HEADER &amp; SOUND UI</span>
          </div>

          <div className="flex-1 flex justify-end">
            {/* Right Buttons Danger Zone (15%) */}
            <div className="w-[15%] bg-rose-500/15 border-l border-rose-500/30 flex items-center justify-center">
              <span className="text-[8px] font-mono font-bold text-rose-300 [writing-mode:vertical-lr]">ACTIONS UI</span>
            </div>
          </div>

          {/* Bottom Caption/Audio Danger Zone (20%) */}
          <div className="h-[20%] bg-rose-500/15 border-t border-rose-500/30 flex items-center justify-center">
            <span className="text-[9px] font-mono font-bold text-rose-300">CAPTION / USERNAME / AUDIO UI</span>
          </div>
        </div>
      )}

      {/* Draggable Caption Target Handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          left: `${captionsPos.x * 100}%`,
          top: `${captionsPos.y * 100}%`,
          width: `${(captionsPos.max_width || 0.85) * 100}%`,
        }}
        className={`absolute -translate-x-1/2 -translate-y-1/2 h-10 border-2 rounded-lg cursor-grab active:cursor-grabbing flex items-center justify-between px-2 transition-colors z-30 ${
          isDraggingCaption
            ? 'border-[#8FD3FF] bg-[#8FD3FF]/20 shadow-[0_0_15px_#8FD3FF]'
            : isInsideDangerZone
            ? 'border-rose-400/60 bg-rose-500/10 hover:border-rose-400'
            : 'border-white/30 hover:border-white/70 bg-white/5'
        }`}
        title="Drag captions to reposition. Snaps to center, seam, and thirds."
      >
        <span className="text-[9px] font-mono font-bold text-white/80 uppercase truncate">
          Captions Box (Y: {Math.round(captionsPos.y * 100)}%)
        </span>
        <Move size={12} className="text-white/60 shrink-0" />
      </div>

      {/* Floating Controls: Safe Area Toggle & Danger Warning */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5 z-30">
        {isInsideDangerZone && (
          <div className="px-2 py-0.5 rounded-md bg-rose-500/80 text-white font-mono text-[9px] flex items-center gap-1 shadow-md animate-pulse">
            <ShieldAlert size={10} /> Safe-Area Warning
          </div>
        )}
        <button
          onClick={() => setShowSafeArea(!showSafeArea)}
          className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition-all ${
            showSafeArea
              ? 'bg-[#8FD3FF] text-[#0A0B0E] border-[#8FD3FF]'
              : 'bg-[#13151A]/80 text-[#8B90A0] border-white/10 hover:text-white'
          }`}
          title="Toggle TikTok / Reels UI Safe-Area Overlay"
        >
          {showSafeArea ? 'Safe Zone: ON' : 'Safe Zone'}
        </button>
      </div>
    </div>
  );
}
