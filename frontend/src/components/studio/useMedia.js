import { useEffect, useRef, useState } from 'react';
import { isVideoUrl } from './stageDraw';

/**
 * Preview media (a channel frame image, or a video) as a ref + a version counter that bumps whenever a new frame is
 * available. Images/videos are drawn on demand; a video only drives redraws while it is actually playing.
 */
export function useMedia(url) {
  const mediaRef = useRef(null);
  const [version, setVersion] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    mediaRef.current = null;
    setPlaying(false);
    if (!url) { setVersion((v) => v + 1); return undefined; }
    if (isVideoUrl(url)) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      v.setAttribute('aria-hidden', 'true');
      // iOS stops decoding detached/display:none videos - keep it in the DOM but invisible
      Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
      document.body.appendChild(v);
      const bump = () => { mediaRef.current = v; setVersion((n) => n + 1); };
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      v.addEventListener('loadeddata', bump);
      v.addEventListener('seeked', bump);
      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      v.addEventListener('ended', onPause);
      v.src = url;
      return () => {
        v.pause();
        v.removeAttribute('src');
        v.remove();
        mediaRef.current = null;
      };
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { mediaRef.current = img; setVersion((n) => n + 1); };
    img.onerror = () => { mediaRef.current = null; setVersion((n) => n + 1); };
    img.src = url;
    return () => { img.onload = null; img.onerror = null; };
  }, [url]);

  // While a preview video plays, redraw per frame - and ONLY then (no permanent animation loop).
  useEffect(() => {
    if (!playing) return undefined;
    let id = 0;
    const tick = () => { setVersion((n) => n + 1); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  return { mediaRef, version, isVideo: isVideoUrl(url), loaded: Boolean(mediaRef.current) };
}

/** A plain image (watermark logo) as { img, version }. */
export function useImage(url) {
  const [state, setState] = useState({ img: null, version: 0 });
  useEffect(() => {
    if (!url) { setState((s) => ({ img: null, version: s.version + 1 })); return undefined; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setState((s) => ({ img, version: s.version + 1 }));
    img.onerror = () => setState((s) => ({ img: null, version: s.version + 1 }));
    img.src = url;
    return () => { img.onload = null; img.onerror = null; };
  }, [url]);
  return state;
}
