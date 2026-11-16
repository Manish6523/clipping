import { useEffect, useState } from 'react';

/**
 * The area the Studio can really use: visualViewport (shrinks when the on-screen keyboard opens) with 100dvh as the
 * fallback, plus the bottom safe-area inset. Updates on resize and orientation change without losing component state.
 */
export function useViewportBox() {
  const read = () => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    return {
      w: Math.round(vv?.width ?? window.innerWidth),
      h: Math.round(vv?.height ?? window.innerHeight),
      keyboard: vv ? Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0))) : 0,
    };
  };
  const [box, setBox] = useState(read);
  const [safeBottom, setSafeBottom] = useState(0);

  useEffect(() => {
    const update = () => setBox((prev) => {
      const n = read();
      return prev.w === n.w && prev.h === n.h && prev.keyboard === n.keyboard ? prev : n;
    });
    const vv = window.visualViewport;
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    setSafeBottom(probe.offsetHeight || 0);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      probe.remove();
    };
  }, []);

  return { ...box, safeBottom, landscape: box.w > box.h && box.h < 500 };
}
