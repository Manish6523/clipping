/**
 * Pure layout / snap / zoom maths for the phone Template Studio (no React, fully unit-tested in
 * tests/test_studio_geometry_js.mjs). All sizes are CSS pixels (dp).
 */

export const TOP_BAR_PX = 48;
export const DOCK_PX = 56;                 // + env(safe-area-inset-bottom)
export const PEEK_PX = 148;                // 44dp handle + two 44dp rows + padding
export const HANDLE_PX = 32;               // collapsed "Source" bar
export const GAP_PX = 8;
export const COLLAPSE_MARGIN_PX = 300;     // free height must exceed source height + this to keep both stages
export const MIN_STAGE_PX = 96;            // the stage never shrinks below this, even with the sheet fully open
export const SNAPS = ['closed', 'peek', 'half', 'full'];

const round = (n) => Math.round(n);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Height of the sheet for a snap point. `avail` = viewport height - top bar - dock. */
export function sheetHeightPx(snap, avail) {
  if (snap === 'closed') return 0;
  if (snap === 'peek') return Math.min(PEEK_PX, Math.max(0, avail - MIN_STAGE_PX));
  if (snap === 'half') return Math.min(round(avail * 0.45), Math.max(0, avail - MIN_STAGE_PX));
  return Math.min(round(avail * 0.88), Math.max(0, avail - MIN_STAGE_PX));   // full
}

/** Snap point nearest to a dragged height; a fling (px per ms, positive = growing) carries it further. */
export function nearestSnap(heightPx, avail, velocityPxPerMs = 0) {
  const target = heightPx + velocityPxPerMs * 150;
  let best = 'closed';
  let bestD = Infinity;
  for (const s of SNAPS) {
    const d = Math.abs(sheetHeightPx(s, avail) - target);
    if (d < bestD - 0.001) { bestD = d; best = s; }
  }
  return best;
}

/**
 * Should the 16:9 source stage collapse to its thin handle?
 * pref: 'expanded' | 'collapsed' | null (automatic). Automatic rule from the spec: with the sheet open and
 * free height < source height + 300dp, the output keeps priority and the source collapses.
 */
export function shouldCollapseSource({ sheetPx, freeHeight, sourceHeight, pref = null }) {
  if (pref === 'collapsed') return true;
  if (pref === 'expanded') return false;
  return sheetPx > 0 && freeHeight < sourceHeight + COLLAPSE_MARGIN_PX;
}

/** Portrait: 16:9 source on top at full width, 9:16 output below using the remaining height ("contain" fit). */
export function computePortraitLayout({ width, height, collapsed }) {
  const srcH = (width * 9) / 16;
  const top = collapsed ? HANDLE_PX : srcH;
  let outH = Math.max(0, height - top - GAP_PX);
  let outW = (outH * 9) / 16;
  if (outW > width) { outW = width; outH = (outW * 16) / 9; }
  return {
    orientation: 'portrait',
    source: { w: width, h: collapsed ? HANDLE_PX : srcH, fullH: srcH, collapsed: Boolean(collapsed) },
    output: { w: outW, h: outH },
  };
}

/** Landscape phone: output on the left (full height), source on the right filling the remaining width. */
export function computeLandscapeLayout({ width, height }) {
  let outH = height;
  let outW = (outH * 9) / 16;
  const rest = Math.max(0, width - outW - GAP_PX);
  let srcW = Math.min(rest, (height * 16) / 9);
  let srcH = (srcW * 9) / 16;
  if (srcH > height) { srcH = height; srcW = (srcH * 16) / 9; }
  return {
    orientation: 'landscape',
    source: { w: srcW, h: srcH, fullH: srcH, collapsed: false },
    output: { w: outW, h: outH },
  };
}

/** One call for the shell: everything derived from the free area and the sheet. */
export function computeStudioLayout({ viewportW, viewportH, sheetPx, sourcePref = null, landscape = false, safeBottom = 0 }) {
  if (landscape) {
    const width = viewportW - DOCK_PX;                       // vertical rail takes the width
    const height = viewportH - TOP_BAR_PX;
    return { ...computeLandscapeLayout({ width, height }), freeW: width, freeH: height, avail: height };
  }
  const avail = viewportH - TOP_BAR_PX - DOCK_PX - safeBottom;
  const freeH = Math.max(0, avail - sheetPx);
  const srcH = (viewportW * 9) / 16;
  const collapsed = shouldCollapseSource({ sheetPx, freeHeight: freeH, sourceHeight: srcH, pref: sourcePref });
  return { ...computePortraitLayout({ width: viewportW, height: freeH, collapsed }), freeW: viewportW, freeH, avail };
}

/* ---------------------------------------------------------------- zoom / pan */

export function clampPan(scale, tx, ty, w, h) {
  return { scale, tx: clamp(tx, w - w * scale, 0), ty: clamp(ty, h - h * scale, 0) };
}

/** Zoom keeping the content point under (cx, cy) fixed. */
export function zoomAbout(view, nextScale, cx, cy, w, h, min = 1, max = 6) {
  const scale = clamp(nextScale, min, max);
  const contentX = (cx - view.tx) / view.scale;
  const contentY = (cy - view.ty) / view.scale;
  return clampPan(scale, cx - contentX * scale, cy - contentY * scale, w, h);
}

export const RESET_VIEW = Object.freeze({ scale: 1, tx: 0, ty: 0 });

/** Normalised (0..1) coordinates of a client point inside a stage that is zoomed/panned. */
export function clientToNorm(clientX, clientY, rect, view, w, h) {
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  return { x: (px - view.tx) / (w * view.scale), y: (py - view.ty) / (h * view.scale) };
}

/** Normalised rect -> pixel rect inside the stage, honouring zoom/pan. */
export function normRectToPx(r, view, w, h) {
  return { x: r.x * w * view.scale + view.tx, y: r.y * h * view.scale + view.ty, w: r.w * w * view.scale, h: r.h * h * view.scale };
}

/* ---------------------------------------------------------------- rect editing (normalised) */

export const MIN_SIZE = 0.04;

export function moveRect(rect, dx, dy, { snap = true, snapEps = 0.02 } = {}) {
  let x = clamp(rect.x + dx, 0, 1 - rect.w);
  let y = clamp(rect.y + dy, 0, 1 - rect.h);
  let snapped = false;
  if (snap) {
    const cx = 0.5 - rect.w / 2;
    const cy = 0.5 - rect.h / 2;
    if (Math.abs(x - cx) < snapEps) { x = cx; snapped = true; }
    if (Math.abs(y - cy) < snapEps) { y = cy; snapped = true; }
  }
  return { rect: { ...rect, x: round3(x), y: round3(y) }, snapped };
}

/**
 * Resize by a handle ('nw','n','ne','e','se','s','sw','w'). `aspect` (w_px/h_px of the real box, or null) keeps the
 * proportions: the stage's pixel aspect is taken into account via `pxAspect` = stageW / stageH.
 */
export function resizeRect(rect, handle, dx, dy, { aspect = null, pxAspect = 1 } = {}) {
  let { x, y, w, h } = rect;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  if (handle.includes('e')) w = clamp(rect.w + dx, MIN_SIZE, 1 - x);
  if (handle.includes('s')) h = clamp(rect.h + dy, MIN_SIZE, 1 - y);
  if (handle.includes('w')) { x = clamp(rect.x + dx, 0, right - MIN_SIZE); w = right - x; }
  if (handle.includes('n')) { y = clamp(rect.y + dy, 0, bottom - MIN_SIZE); h = bottom - y; }
  if (aspect && rect.h > 0) {
    // keep the box proportions (aspect = (w * stageW) / (h * stageH) of the original box)
    const ratio = aspect;
    const horizontal = handle.includes('e') || handle.includes('w');
    if (horizontal) {
      let nh = (w * pxAspect) / ratio;
      if (handle.includes('n')) { y = clamp(bottom - nh, 0, bottom - MIN_SIZE); nh = bottom - y; w = (nh * ratio) / pxAspect; if (handle.includes('w')) x = right - w; }
      else if (y + nh > 1) { nh = 1 - y; w = (nh * ratio) / pxAspect; if (handle.includes('w')) x = right - w; h = nh; }
      else h = nh;
    } else {
      let nw = (h * ratio) / pxAspect;
      if (x + nw > 1) { nw = 1 - x; h = (nw * pxAspect) / ratio; }
      w = nw;
    }
  }
  return { x: round3(x), y: round3(y), w: round3(w), h: round3(h) };
}

function round3(n) { return Math.round(n * 1000) / 1000; }

/* ---------------------------------------------------------------- hit testing */

export function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Layers under a point, topmost first (layers array order = bottom -> top). */
export function layersAt(point, layers, key) {
  const hits = [];
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const l = layers[i];
    if (l.visible === false || !l[key]) continue;
    if (pointInRect(point, l[key])) hits.push(l);
  }
  return hits;
}

/** Overlapping objects cycle on repeated taps: returns the layer to select next. */
export function nextInStack(hits, selectedId) {
  if (!hits.length) return null;
  const i = hits.findIndex((l) => l.id === selectedId);
  return hits[(i + 1) % hits.length];
}

/** Which handle of a pixel rect is within `slop` px of a point (null if none). Corners win over edges. */
export function handleAt(px, py, r, slop = 22) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const pts = {
    nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h],
    n: [cx, r.y], s: [cx, r.y + r.h], w: [r.x, cy], e: [r.x + r.w, cy],
  };
  const edgesUsable = r.w > slop * 3.2 && r.h > slop * 3.2;      // tiny boxes: corners only, so the body stays draggable
  let best = null;
  let bestD = slop;
  for (const [name, [hx, hy]] of Object.entries(pts)) {
    if (name.length === 1 && !edgesUsable) continue;
    const d = Math.hypot(px - hx, py - hy);
    if (d <= bestD) { best = name; bestD = d; }
  }
  return best;
}
