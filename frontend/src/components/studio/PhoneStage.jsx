import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, Lock, Unlock, Eye, EyeOff, Copy, Trash2, BringToFront, SendToBack, Crop, ZoomOut, Plus, Wand2,
} from 'lucide-react';
import {
  GAP_PX, RESET_VIEW, clampPan, handleAt, moveRect, normRectToPx, nextInStack, pointInRect, resizeRect, zoomAbout,
} from './geometry';
import { OUT_W, OUT_H, SRC_CW, SRC_CH, drawOutput, drawSource, watermarkRectNorm } from './stageDraw';
import { buildCaptionsConfig } from './captionsConfig';
import { LAYOUT_PRESETS } from './layoutPresets';

/**
 * Stacked dual stage for phones: 16:9 source on top, 9:16 output below (portrait) or side by side (landscape).
 *
 * - Everything interactive lives inside ONE isolated, clipped region (overflow hidden, isolation, z-index 0), so no
 *   gizmo can ever paint over the bottom sheet.
 * - Drag state is transient (ref + one rAF-throttled redraw); the store is written once, on pointer up (one undo step).
 * - Pointer Events with touch-action:none. 1 finger = move/resize the selected object, 2 fingers = pinch-zoom + pan,
 *   double-tap on empty space = reset zoom, tapping a stack of overlapping objects cycles through them.
 * - Canvases are drawn on state change only - no permanent animation loop.
 */

const CAPTION_H = 0.07;
const TAP_MS = 450;
const MOVE_SLOP = 6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round3 = (n) => Math.round(n * 1000) / 1000;
const vibrate = () => { try { navigator.vibrate?.(5); } catch { /* unsupported */ } };

/* ------------------------------------------------------------------ objects */

function captionRect(pos) {
  const p = pos || { x: 0.5, y: 0.76, max_width: 0.85 };
  const w = p.max_width ?? 0.85;
  return { x: (p.x ?? 0.5) - w / 2, y: (p.y ?? 0.76) - CAPTION_H / 2, w, h: CAPTION_H };
}

/** Selectable objects of one stage, TOPMOST FIRST. */
function buildObjects(kind, layers, subtitles, watermark, wmAspect) {
  const out = [];
  if (kind === 'output') {
    if (watermark?.enabled && watermark?.url) out.push({ type: 'watermark', id: null, rect: watermarkRectNorm(watermark, wmAspect), locked: false, label: 'Watermark' });
    if (subtitles) out.push({ type: 'captions', id: null, rect: captionRect(subtitles.position), locked: false, label: 'Captions' });
  }
  const key = kind === 'output' ? 'dst' : 'src';
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const l = layers[i];
    if (l.visible === false || !l[key]) continue;
    out.push({ type: 'layer', id: l.id, rect: l[key], locked: Boolean(l.locked), label: l.name, color: l.color, layer: l });
  }
  return out;
}

const isSel = (o, sel) => Boolean(sel) && o.type === sel.type && (o.type !== 'layer' || o.id === sel.id);
const sameObj = (a, b) => a.type === b.type && a.id === b.id;

/* ------------------------------------------------------------------ one stage */

function Stage({
  kind, w, h, layers, layout, subtitles, watermark, wmImg, wmAspect, selection, draft, bumpDraft, media, mediaVersion,
  view, setView, onSelect, onCommit, onDraft, tick, captionStyle, children,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ptrs = useRef(new Map());
  const gest = useRef(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const [readout, setReadout] = useState(null);

  const viewRef = useRef(view); viewRef.current = view;
  const selRef = useRef(selection); selRef.current = selection;

  // ---- effective (draft-applied) data
  const effLayers = useMemo(() => {
    if (draft?.kind !== 'layer') return layers;
    return layers.map((l) => (l.id === draft.id ? { ...l, [draft.key]: draft.rect } : l));
  }, [layers, draft]);
  const effSubs = useMemo(() => {
    if (draft?.kind !== 'captions') return subtitles;
    return { ...subtitles, position: { ...(subtitles.position || {}), x: draft.x, y: draft.y, max_width: draft.max_width } };
  }, [subtitles, draft]);
  const effWm = useMemo(() => {
    if (draft?.kind !== 'watermark') return watermark;
    return { ...watermark, x: draft.x, y: draft.y, width: draft.width, position: 'custom' };
  }, [watermark, draft]);

  const objects = useMemo(() => buildObjects(kind, effLayers, effSubs, effWm, wmAspect), [kind, effLayers, effSubs, effWm, wmAspect]);
  const objectsRef = useRef(objects); objectsRef.current = objects;

  // ---- draw on state change only
  const captionsConfig = useMemo(() => buildCaptionsConfig(effSubs, captionStyle), [effSubs, captionStyle]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (kind === 'output') {
      drawOutput(canvas, { layout: { ...layout, layers: effLayers }, media: media.current, captionsConfig, watermark: effWm, watermarkImg: wmImg });
    } else {
      drawSource(canvas, media.current);
    }
  }, [kind, layout, effLayers, captionsConfig, effWm, wmImg, media, mediaVersion, tick]);

  // ---- gestures
  const local = (e) => {
    const r = containerRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startPinch = () => {
    const [a, b] = [...ptrs.current.values()];
    if (gest.current && gest.current.mode !== 'pinch') { onDraft(null); setReadout(null); }
    gest.current = {
      mode: 'pinch', view0: { ...viewRef.current }, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const updatePinch = () => {
    const g = gest.current;
    const pts = [...ptrs.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = zoomAbout(g.view0, g.view0.scale * (d / g.d0), g.m0.x, g.m0.y, w, h);
    setView(clampPan(z.scale, z.tx + (m.x - g.m0.x), z.ty + (m.y - g.m0.y), w, h));
  };

  const applyDrag = (g, dxPx, dyPx) => {
    const v = viewRef.current;
    const dx = dxPx / (w * v.scale);
    const dy = dyPx / (h * v.scale);
    const o = g.obj;
    if (o.type === 'layer') {
      if (o.locked) return;
      const key = kind === 'output' ? 'dst' : 'src';
      let rect;
      let snapped = false;
      if (g.mode === 'move') ({ rect, snapped } = moveRect(g.startRect, dx, dy));
      else {
        const lock = kind === 'output' && o.layer?.aspect_lock;
        rect = resizeRect(g.startRect, g.handle, dx, dy, lock ? { aspect: (g.startRect.w * w) / (g.startRect.h * h), pxAspect: w / h } : {});
      }
      if (snapped && !g.snapBuzz) { vibrate(); g.snapBuzz = true; } else if (!snapped) g.snapBuzz = false;
      onDraft({ kind: 'layer', id: o.id, key, rect });
      setReadout(`x ${Math.round(rect.x * 100)}%  y ${Math.round(rect.y * 100)}%  ·  ${Math.round(rect.w * 100)}×${Math.round(rect.h * 100)}%`);
    } else if (o.type === 'captions') {
      const p0 = subtitles.position || { x: 0.5, y: 0.76, max_width: 0.85 };
      let x = p0.x ?? 0.5;
      let y = p0.y ?? 0.76;
      let mw = p0.max_width ?? 0.85;
      if (g.mode === 'move') {
        x = clamp(g.pos0.x + dx, 0.1, 0.9);
        y = clamp(g.pos0.y + dy, 0.08, 0.92);
        if (Math.abs(x - 0.5) < 0.02) x = 0.5;                      // snap to centre / the default caption line
        if (Math.abs(y - 0.76) < 0.02) y = 0.76;
        const snapNow = x === 0.5 || y === 0.76;
        if (snapNow && !g.snapBuzz) { vibrate(); g.snapBuzz = true; } else if (!snapNow) g.snapBuzz = false;
      } else {
        const sign = g.handle.includes('e') ? 1 : -1;
        mw = clamp(g.pos0.max_width + sign * 2 * dx, 0.2, 1);
        x = g.pos0.x; y = g.pos0.y;
      }
      onDraft({ kind: 'captions', x: round3(x), y: round3(y), max_width: round3(mw) });
      setReadout(`y ${Math.round(y * 100)}%  ·  width ${Math.round(mw * 100)}%`);
    } else if (o.type === 'watermark') {
      const wm0 = g.wm0;
      if (g.mode === 'move') {
        const r = o.rect;
        const x = clamp((wm0.x * 1080 + dx * 1080) / 1080, 0, 1 - r.w);
        const y = clamp((wm0.y * 1920 + dy * 1920) / 1920, 0, 1 - r.h);
        onDraft({ kind: 'watermark', x: round3(x), y: round3(y), width: wm0.width });
        setReadout(`x ${Math.round(x * 100)}%  y ${Math.round(y * 100)}%`);
      } else {
        const sign = g.handle.includes('e') ? 1 : -1;
        const width = clamp(Math.round(wm0.width + sign * dx * 1080), 40, 1000);
        const x = g.handle.includes('w') ? wm0.x + (wm0.width - width) / 1080 : wm0.x;
        onDraft({ kind: 'watermark', x: round3(clamp(x, 0, 1)), y: wm0.y, width });
        setReadout(`logo width ${width}px`);
      }
    }
  };

  const onPointerDown = (e) => {
    if (e.target.closest?.('[data-stage-ui]')) return;
    const el = containerRef.current;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic / already released */ }
    const pt = local(e);
    ptrs.current.set(e.pointerId, pt);
    if (ptrs.current.size === 2) { startPinch(); return; }
    if (ptrs.current.size > 2) return;

    const v = viewRef.current;
    const norm = { x: (pt.x - v.tx) / (w * v.scale), y: (pt.y - v.ty) / (h * v.scale) };
    const sel = selRef.current;
    const all = objectsRef.current;
    const selObj = all.find((o) => isSel(o, sel));
    const t0 = performance.now();
    const base = { start: pt, moved: false, t0 };

    if (selObj && !selObj.locked) {
      const handle = handleAt(pt.x, pt.y, normRectToPx(selObj.rect, v, w, h));
      if (handle && (selObj.type !== 'captions' || /[ew]/.test(handle)) && (selObj.type !== 'watermark' || handle.length === 2)) {
        gest.current = { ...base, mode: 'resize', obj: selObj, handle, startRect: selObj.rect, pos0: { ...(subtitles.position || { x: 0.5, y: 0.76, max_width: 0.85 }) }, wm0: { x: selObj.rect.x, y: selObj.rect.y, width: watermark?.width || 220 } };
        return;
      }
    }
    const hits = all.filter((o) => pointInRect(norm, o.rect));
    const target = selObj && hits.some((o) => sameObj(o, selObj)) ? selObj : hits[0];
    if (target) {
      gest.current = { ...base, mode: 'move', obj: target, hits, startRect: target.rect, pos0: { ...(subtitles.position || { x: 0.5, y: 0.76, max_width: 0.85 }) }, wm0: { x: target.rect.x, y: target.rect.y, width: watermark?.width || 220 } };
    } else {
      gest.current = { ...base, mode: 'empty', startView: { ...v } };
    }
  };

  const onPointerMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const pt = local(e);
    ptrs.current.set(e.pointerId, pt);
    const g = gest.current;
    if (!g) return;
    if (g.mode === 'pinch') { updatePinch(); return; }
    if (ptrs.current.size !== 1) return;
    const dxPx = pt.x - g.start.x;
    const dyPx = pt.y - g.start.y;
    if (!g.moved && Math.hypot(dxPx, dyPx) < MOVE_SLOP) return;
    g.moved = true;
    if (g.mode === 'empty') {
      const v = viewRef.current;
      if (v.scale > 1) setView(clampPan(v.scale, g.startView.tx + dxPx, g.startView.ty + dyPx, w, h));
      return;
    }
    applyDrag(g, dxPx, dyPx);
  };

  const finish = (e, cancelled) => {
    ptrs.current.delete(e.pointerId);
    try { containerRef.current.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const g = gest.current;
    if (!g) return;
    if (g.mode === 'pinch') { if (ptrs.current.size === 0) gest.current = null; return; }
    gest.current = null;
    setReadout(null);
    if (cancelled) { onDraft(null); return; }
    if (g.moved && (g.mode === 'move' || g.mode === 'resize')) { onCommit(); return; }
    if (g.moved || performance.now() - g.t0 > TAP_MS) return;

    // ---- tap
    if (g.mode === 'empty') {
      const now = performance.now();
      const lt = lastTap.current;
      if (now - lt.t < 320 && Math.hypot(g.start.x - lt.x, g.start.y - lt.y) < 24) {
        setView(RESET_VIEW);
        lastTap.current = { t: 0, x: 0, y: 0 };
      } else {
        lastTap.current = { t: now, x: g.start.x, y: g.start.y };
        onSelect({ type: 'template', id: null });
      }
      return;
    }
    const o = g.obj;
    if (o.type === 'layer') {
      const stack = g.hits.filter((x) => x.type === 'layer').map((x) => ({ id: x.id }));
      const sel = selRef.current;
      const already = sel?.type === 'layer' && sel.id === o.id;
      const next = already && stack.length > 1 ? nextInStack(stack, sel.id) : { id: o.id };
      onSelect({ type: 'layer', id: next.id });
    } else {
      onSelect({ type: o.type, id: null });
    }
  };

  // ---- overlay (screen-space, not scaled: handles/borders keep their size when zoomed)
  const sel = selection;
  const zoomed = view.scale > 1.001;
  const labelOf = (o) => `${o.locked ? '🔒 ' : ''}${o.label}`;

  return (
    <div
      ref={containerRef}
      data-testid={`stage-${kind}`}
      data-view-scale={view.scale.toFixed(3)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      className="relative overflow-hidden bg-black rounded-xl border border-white/10 select-none"
      style={{ width: w, height: h, touchAction: 'none', isolation: 'isolate', zIndex: 0 }}
    >
      <div className="absolute inset-0" style={{ transformOrigin: '0 0', transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
        <canvas
          ref={canvasRef}
          width={kind === 'output' ? OUT_W : SRC_CW}
          height={kind === 'output' ? OUT_H : SRC_CH}
          className="w-full h-full pointer-events-none block"
        />
      </div>

      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {objects.map((o) => {
          const px = normRectToPx(o.rect, view, w, h);
          const selected = isSel(o, sel);
          const color = o.color || (o.type === 'captions' ? '#7fb6f5' : '#FFFFFF');
          return (
            <div
              key={`${o.type}:${o.id ?? ''}`}
              data-testid={selected ? 'gizmo-selected' : undefined}
              className="absolute"
              style={{
                left: px.x, top: px.y, width: px.w, height: px.h,
                border: selected ? '2px solid #fff' : `1px ${o.type === 'layer' ? 'solid' : 'dashed'} ${color}99`,
                boxShadow: selected ? `0 0 0 1px ${color}, 0 0 12px rgba(0,0,0,.5)` : 'none',
                background: selected ? 'rgba(255,255,255,0.05)' : 'transparent',
                opacity: selected || !sel || sel.type === 'template' ? 1 : 0.75,
              }}
            >
              {selected && (
                <>
                  <span className="absolute left-1 top-1 max-w-[calc(100%-8px)] truncate rounded px-1.5 py-0.5 text-[10.5px] leading-none font-semibold text-white" style={{ background: `${color}cc` }}>
                    {labelOf(o)}
                  </span>
                  {!o.locked && ['nw', 'ne', 'sw', 'se', ...(px.w > 70 && px.h > 70 && o.type === 'layer' ? ['n', 's', 'e', 'w'] : []), ...(o.type === 'captions' ? ['e', 'w'] : [])].filter((hn, i, a) => a.indexOf(hn) === i).map((hn) => (
                    <span
                      key={hn}
                      className="absolute rounded-full bg-white border-2 border-black/70"
                      style={{
                        width: 14, height: 14, marginLeft: -7, marginTop: -7,
                        left: hn.includes('w') ? 0 : hn.includes('e') ? '100%' : '50%',
                        top: hn.includes('n') ? 0 : hn.includes('s') ? '100%' : '50%',
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}
        {readout && (
          <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-[10.5px] font-mono text-white tabular-nums whitespace-nowrap">{readout}</div>
        )}
      </div>

      {zoomed && (
        <button
          type="button" data-stage-ui aria-label="Reset zoom"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setView(RESET_VIEW)}
          className="absolute left-1.5 bottom-1.5 flex h-[44px] items-center gap-1 rounded-full bg-black/75 px-3 text-[11px] font-semibold text-white"
        >
          <ZoomOut size={14} /> {view.scale.toFixed(1)}× · Reset
        </button>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ toolbar + empty card */

function ObjectToolbar({ layer, index, count, left, top, maxW, actions }) {
  const Btn = ({ label, icon: Icon, onClick, active, danger, disabled }) => (
    <button
      type="button" aria-label={label} title={label} disabled={disabled} data-stage-ui
      onClick={onClick}
      className={`flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl ${danger ? 'text-bad' : active ? 'text-accent' : 'text-white'} ${disabled ? 'opacity-35' : 'active:bg-white/15'}`}
    >
      <Icon size={18} />
    </button>
  );
  return (
    <div
      data-testid="object-toolbar" data-stage-ui
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-10 flex gap-1 overflow-x-auto rounded-2xl border border-white/15 bg-[#0b0d12]/95 p-1 shadow-2xl no-scrollbar"
      style={{ left, top, maxWidth: maxW }}
    >
      <Btn label={layer.locked ? 'Unlock' : 'Lock'} icon={layer.locked ? Lock : Unlock} active={layer.locked} onClick={() => actions.toggleLock(layer.id)} />
      <Btn label={layer.visible === false ? 'Show' : 'Hide'} icon={layer.visible === false ? EyeOff : Eye} onClick={() => actions.toggleVisible(layer.id)} />
      <Btn label="Duplicate" icon={Copy} onClick={() => actions.duplicate(layer.id)} disabled={count >= 8} />
      <Btn label="Bring to front" icon={BringToFront} onClick={() => actions.reorder(layer.id, 1)} disabled={index >= count - 1} />
      <Btn label="Send to back" icon={SendToBack} onClick={() => actions.reorder(layer.id, -1)} disabled={index <= 0} />
      <Btn label="Crop (show source)" icon={Crop} onClick={actions.crop} />
      <Btn label="Delete layer" icon={Trash2} danger onClick={() => actions.remove(layer.id)} disabled={count <= 1} />
    </div>
  );
}

function EmptyCard({ onPreset, onAddLayer, onRepair, canRepair }) {
  return (
    <div data-testid="empty-layout-card" data-stage-ui onPointerDown={(e) => e.stopPropagation()} className="absolute inset-x-3 bottom-2 top-[72px] z-10 overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#0b0d12]/95 p-3 shadow-2xl">
      <div className="mb-2.5 flex items-center gap-2">
        <Wand2 size={16} className="text-accent" />
        <h3 className="text-[14px] font-semibold text-ink">Start with a layout</h3>
      </div>
      <div className="grid gap-1.5">
        {LAYOUT_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => onPreset(p.id)} className="flex min-h-[44px] flex-col items-start justify-center rounded-xl bg-white/[0.06] px-3 py-1.5 text-left active:bg-white/[0.12]">
            <span className="text-[13px] font-semibold text-ink">{p.title}</span>
            <span className="text-[11px] text-muted">{p.hint}</span>
          </button>
        ))}
        <button type="button" onClick={onAddLayer} className="flex h-[44px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/25 text-[13px] font-semibold text-slate-200">
          <Plus size={15} /> Add layer
        </button>
        {canRepair && (
          <button type="button" onClick={onRepair} className="flex h-[44px] items-center justify-center rounded-xl text-[12.5px] font-semibold text-accent">
            Repair from legacy fields
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the stack */

export default function StageStack({
  info, store, media, mediaVersion, wmImg, wmAspect, tick, sourcePref, onToggleSource, onCrop, onSelected, onAddLayerMenu,
}) {
  const { layout, subtitles, watermark, selection } = store;
  const layers = layout.layers || [];
  const [views, setViews] = useState({ source: RESET_VIEW, output: RESET_VIEW });
  const draftRef = useRef(null);
  const [, force] = useReducer((n) => n + 1, 0);
  const raf = useRef(0);

  const bump = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; force(); });
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const setDraft = useCallback((d) => { draftRef.current = d; bump(); }, [bump]);
  const draft = draftRef.current;

  const commit = useCallback(() => {
    const d = draftRef.current;
    draftRef.current = null;
    if (!d) { bump(); return; }
    const s = store.actions;
    s.beginGesture();                                   // ONE undo step per gesture
    if (d.kind === 'layer') s.patchLayer(d.id, { [d.key]: d.rect });
    else if (d.kind === 'captions') s.patchSubtitles({ position: { ...(store.subtitles.position || {}), x: d.x, y: d.y, max_width: d.max_width } });
    else if (d.kind === 'watermark') s.patchWatermark({ x: d.x, y: d.y, width: d.width, position: 'custom' });
    bump();
  }, [store, bump]);

  const select = useCallback((sel) => { store.actions.setSelection(sel); onSelected?.(sel); }, [store, onSelected]);

  const setView = useCallback((kind) => (v) => setViews((p) => ({ ...p, [kind]: typeof v === 'function' ? v(p[kind]) : v })), []);
  const setSrcView = useMemo(() => setView('source'), [setView]);
  const setOutView = useMemo(() => setView('output'), [setView]);

  // Preview animation (the caption highlight cycles): tick slowly ONLY while captions are being tuned and the tab is visible
  const [capTick, setCapTick] = useState(0);
  useEffect(() => {
    if (selection.type !== 'captions') return undefined;
    const id = setInterval(() => { if (!document.hidden) setCapTick((n) => n + 1); }, 800);
    return () => clearInterval(id);
  }, [selection.type]);

  const landscape = info.orientation === 'landscape';
  const W = info.freeW;
  const srcBlockH = info.source.collapsed ? info.source.h : info.source.h;
  const outLeft = landscape ? 0 : Math.max(0, (W - info.output.w) / 2);
  const outTop = landscape ? 0 : srcBlockH + GAP_PX + Math.max(0, (info.freeH - srcBlockH - GAP_PX - info.output.h) / 2);
  const srcLeft = landscape ? info.output.w + GAP_PX : Math.max(0, (W - info.source.w) / 2);

  const common = { layers, layout, subtitles, watermark, wmImg, wmAspect, selection, draft, bumpDraft: bump, media, mediaVersion, onSelect: select, onCommit: commit, onDraft: setDraft, tick: tick + capTick, captionStyle: store.captionStyle };

  // ---- floating toolbar anchor (region coordinates)
  const selLayer = selection.type === 'layer' ? layers.find((l) => l.id === selection.id) : null;
  let toolbar = null;
  if (selLayer && !draft && layers.length > 0) {
    const rect = selLayer.dst || { x: 0, y: 0, w: 1, h: 1 };
    const px = normRectToPx(rect, views.output, info.output.w, info.output.h);
    const maxW = Math.max(120, W - 16);
    const tbW = Math.min(maxW, 7 * 44 + 6 * 4 + 8);
    const objTop = outTop + px.y;
    const objBottom = outTop + px.y + px.h;
    let top = objTop - 52;
    if (top < 4) top = Math.min(info.freeH - 52, objBottom + 8);
    if (objBottom + 8 > info.freeH - 52 && top < 4) top = 4;
    const left = clamp(outLeft + px.x + px.w / 2 - tbW / 2, 8, Math.max(8, W - tbW - 8));
    toolbar = (
      <ObjectToolbar
        layer={selLayer} index={layers.indexOf(selLayer)} count={layers.length} left={left} top={clamp(top, 4, Math.max(4, info.freeH - 52))} maxW={maxW}
        actions={{
          toggleLock: (id) => store.actions.updateLayer(id, { locked: !layers.find((l) => l.id === id).locked }),
          toggleVisible: (id) => store.actions.updateLayer(id, { visible: layers.find((l) => l.id === id).visible === false }),
          duplicate: (id) => {
            const l = layers.find((x) => x.id === id);
            const copy = { ...l, id: `l_${Date.now().toString(36)}`, name: `${l.name} copy`, locked: false, dst: { ...l.dst, x: Math.min(0.8, (l.dst?.x || 0) + 0.05), y: Math.min(0.8, (l.dst?.y || 0) + 0.05) } };
            store.actions.addLayer(copy);
          },
          reorder: (id, dir) => {
            const i = layers.findIndex((l) => l.id === id);
            const j = i + dir;
            if (j < 0 || j >= layers.length) return;
            const next = [...layers];
            const [m] = next.splice(i, 1);
            next.splice(j, 0, m);
            store.actions.reorderLayers(next);
          },
          crop: onCrop,
          remove: (id) => store.actions.deleteLayer(id),
        }}
      />
    );
  }

  return (
    <div
      data-testid="stage-region"
      className="absolute inset-0 overflow-hidden"
      style={{ isolation: 'isolate', zIndex: 0, touchAction: 'none' }}
    >
      {/* SOURCE */}
      {info.source.collapsed ? (
        <button
          type="button" data-testid="source-handle" onClick={onToggleSource} aria-label="Show source stage"
          className="absolute flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] text-[12px] font-semibold text-slate-200 active:bg-white/10"
          style={{ left: srcLeft, top: 0, width: info.source.w, height: info.source.h }}
        >
          Source <ChevronDown size={14} />
        </button>
      ) : (
        <div className="absolute" style={{ left: srcLeft, top: 0, width: info.source.w, height: info.source.h }}>
          <Stage kind="source" w={info.source.w} h={info.source.h} view={views.source} setView={setSrcView} {...common}>
            {!landscape && (
              <button
                type="button" data-stage-ui aria-label="Hide source stage" data-testid="source-hide"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onToggleSource}
                className="absolute right-1 top-1 flex h-[44px] w-[44px] items-center justify-center rounded-full bg-black/60 text-white"
              >
                <ChevronUp size={16} />
              </button>
            )}
          </Stage>
        </div>
      )}

      {/* OUTPUT */}
      <div className="absolute" style={{ left: outLeft, top: outTop, width: info.output.w, height: info.output.h }}>
        <Stage kind="output" w={info.output.w} h={info.output.h} view={views.output} setView={setOutView} {...common} />
      </div>

      {toolbar}

      {layers.length === 0 && (
        <EmptyCard
          onPreset={(id) => store.actions.applyPreset(id)}
          onAddLayer={onAddLayerMenu}
          onRepair={store.actions.repairFromLegacy}
          canRepair={Boolean(store.legacyLayout)}
        />
      )}
    </div>
  );
}
