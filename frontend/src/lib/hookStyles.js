import { useEffect, useState } from 'react';
import axios from 'axios';

// Specs come from GET /api/hook-styles (src/compositor/hook_styles.py), so the preview
// always matches what the renderer draws.
let cache = null;
let pending = null;

export function useHookStyles() {
  const [styles, setStyles] = useState(cache);
  useEffect(() => {
    if (cache) return undefined;
    let alive = true;
    pending = pending || axios.get('/api/hook-styles').then((r) => { cache = r.data.styles || []; return cache; });
    pending.then((s) => alive && setStyles(s)).catch(() => alive && setStyles([]));
    return () => { alive = false; };
  }, []);
  return styles;
}

export const HOOK_SAMPLES = {
  pov: 'you challenge Speed to a tennis match',
  question: 'Would you survive this?',
  breaking: 'Speed gets mobbed by fans in Seoul',
  cinematic: 'The comeback',
  bubble: "I'm never doing this again",
};
export const hookSample = (id) => HOOK_SAMPLES[id] || 'He did not expect this to happen';

const STORE_KEY = 'autoclip_hook_style';
export function loadHookStyle() {
  try { return localStorage.getItem(STORE_KEY) || 'template'; } catch { return 'template'; }
}
export function saveHookStyle(id) {
  try { localStorage.setItem(STORE_KEY, id); } catch { /* private mode */ }
}
