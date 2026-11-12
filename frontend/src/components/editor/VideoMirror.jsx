import React, { useEffect, useRef } from 'react';

/**
 * Draws frames from an existing <video> (the editor's master player) onto a canvas.
 * Lets thumbnails / alternate views stay perfectly in sync with playback without
 * downloading and decoding the source a second time.
 */
export default function VideoMirror({ videoRef, fit = 'cover', className = '', opacity = 1 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    resize();

    const draw = () => {
      const v = videoRef?.current;
      const cw = canvas.width;
      const ch = canvas.height;
      if (v && v.readyState >= 2 && v.videoWidth) {
        const vr = v.videoWidth / v.videoHeight;
        const cr = cw / ch;
        let dw = cw;
        let dh = ch;
        if ((fit === 'cover') === (vr > cr)) {
          dh = ch;
          dw = ch * vr;
        } else {
          dw = cw;
          dh = cw / vr;
        }
        ctx.clearRect(0, 0, cw, ch);
        try {
          ctx.drawImage(v, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        } catch {
          // Frame not decodable yet
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [videoRef, fit]);

  return <canvas ref={canvasRef} className={className} style={{ opacity }} />;
}
