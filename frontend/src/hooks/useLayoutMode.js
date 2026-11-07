import { useState, useEffect } from 'react';

/**
 * useLayoutMode hook
 * Evaluates phone | tablet | desktop synchronously with matchMedia and window properties.
 * Rules:
 *  - phone: width < 640 || (portrait && isTouch && width < 820)
 *  - tablet: (width >= 640 && width <= 1023) || (phone landscape: height < 500 && width < 1024)
 *  - desktop: width >= 1024 && !isTouch (or default desktop screen)
 */
export function useLayoutMode() {
  const getSnapshot = () => {
    if (typeof window === 'undefined') {
      return {
        mode: 'desktop',
        isPhone: false,
        isTablet: false,
        isDesktop: true,
        isTouch: false,
        isLandscape: false,
        isPortrait: true,
        width: 1280,
        height: 800,
        safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
      };
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const isLandscape = w > h;
    const isPortrait = !isLandscape;
    const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    let mode = 'desktop';

    if (w < 640 || (isPortrait && isTouch && w < 820)) {
      mode = 'phone';
    } else if ((w >= 640 && w < 1024) || (isLandscape && h < 520 && w < 1024)) {
      mode = 'tablet';
    } else {
      mode = 'desktop';
    }

    return {
      mode,
      isPhone: mode === 'phone',
      isTablet: mode === 'tablet',
      isDesktop: mode === 'desktop',
      isTouch,
      isLandscape,
      isPortrait,
      width: w,
      height: h,
    };
  };

  const [layout, setLayout] = useState(getSnapshot);

  useEffect(() => {
    let timeoutId = null;
    const handleResize = () => {
      // Debounce slightly to prevent thrashing during fast orientation flip
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setLayout(getSnapshot());
      }, 50);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    const mqlPointer = window.matchMedia('(pointer: coarse)');
    if (mqlPointer.addEventListener) {
      mqlPointer.addEventListener('change', handleResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (mqlPointer.removeEventListener) {
        mqlPointer.removeEventListener('change', handleResize);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return layout;
}

