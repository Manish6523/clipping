import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, Lock, Unlock, Eye, EyeOff, Copy, Trash2, BringToFront, SendToBack, Crop, ZoomOut, ZoomIn, Plus, Wand2, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ImageIcon, Move, Check, LayoutGrid,
} from 'lucide-react';
import {
  GAP_PX, RESET_VIEW, PLACE_SLOTS, clampPan, computeTabLayout, handleAt, matchCropToOutput, moveRect, normRectToPx, nextInStack, pointInRect, resizeRect, zoomAbout,
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
  view, setView, onSelect, onCommit, onDraft, tick, captionStyle, pad = 0, active = false, onActivate, passive = false,
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
    return { x: e.clientX - r.left - pad, y: e.clientY - r.top - pad };      // relative to the stage proper (pad can be negative)
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
    onActivate?.(kind);
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
      data-testid={passive ? `preview-${kind}` : `stage-${kind}`}
      data-view-scale={view.scale.toFixed(3)}
      onPointerDown={passive ? undefined : onPointerDown}
      onPointerMove={passive ? undefined : onPointerMove}
      onPointerUp={passive ? undefined : (e) => finish(e, false)}
      onPointerCancel={passive ? undefined : (e) => finish(e, true)}
      className={`relative select-none ${passive ? 'pointer-events-none' : ''}`}
      style={{ width: w + 2 * pad, height: h + 2 * pad, touchAction: passive ? 'auto' : 'none', zIndex: 0 }}
    >
      {/* the picture (clipped) */}
      <div
        className={`absolute overflow-hidden rounded-xl border bg-black ${active ? 'border-accent/70' : 'border-white/10'}`}
        style={{ left: pad, top: pad, width: w, height: h, isolation: 'isolate' }}
      >
        <div className="absolute inset-0" style={{ transformOrigin: '0 0', transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
          <canvas
            ref={canvasRef}
            width={kind === 'output' ? OUT_W : SRC_CW}
            height={kind === 'output' ? OUT_H : SRC_CH}
            className="w-full h-full pointer-events-none block"
          />
        </div>
      </div>

      {/* boxes + handles (NOT clipped: edge handles stay fully visible inside the padding) */}
      {!passive && <div className="absolute pointer-events-none" style={{ left: pad, top: pad, width: w, height: h }} aria-hidden="true">
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
                border: selected ? '2px solid #fff' : `2px ${o.type === 'layer' ? 'solid' : 'dashed'} ${color}`,
                boxShadow: selected ? `0 0 0 1px ${color}, 0 0 12px rgba(0,0,0,.5)` : '0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 1px rgba(0,0,0,.45)',
                background: selected ? 'rgba(255,255,255,0.05)' : 'transparent',
              }}
            >
              <span
                className={`absolute left-3 top-1.5 max-w-[calc(100%-24px)] truncate rounded px-1.5 py-0.5 font-semibold leading-none text-white ${selected ? 'text-[10.5px]' : 'text-[9.5px]'} ${px.w < 56 || px.h < 26 ? 'hidden' : ''}`}
                style={{ background: selected ? `${color}ee` : `${color}d9`, color: selected ? '#fff' : '#0b0d12' }}
              >
                {labelOf(o)}
              </span>
              {selected && !o.locked && ['nw', 'ne', 'sw', 'se', ...(px.w > 70 && px.h > 70 && o.type === 'layer' ? ['n', 's', 'e', 'w'] : []), ...(o.type === 'captions' ? ['e', 'w'] : [])].filter((hn, i, a) => a.indexOf(hn) === i).map((hn) => (
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
            </div>
          );
        })}
        {readout && (
          <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-[10.5px] font-mono text-white tabular-nums whitespace-nowrap">{readout}</div>
        )}
      </div>}
    </div>
  );
}

/* ------------------------------------------------------------------ toolbar + empty card */

function ObjectToolbar({ tab, layer, index, count, actions }) {
  const [mode, setMode] = useState('main');            // 'main' | 'move' | 'place'
  const [step, setStep] = useState(10);
  useEffect(() => { setMode('main'); }, [layer.id, tab]);
  const Btn = ({ label, icon: Icon, onClick, active, danger, disabled, text, testid }) => (
    <button
      type="button" aria-label={label} title={label} disabled={disabled} data-stage-ui data-testid={testid}
      onClick={onClick}
      className={`flex h-[44px] min-w-[40px] flex-1 items-center justify-center gap-1 rounded-xl ${danger ? 'text-bad' : active ? 'bg-accent-strong/30 text-accent' : 'text-white'} ${disabled ? 'opacity-35' : 'active:bg-white/15'}`}
    >
      {Icon && <Icon size={18} />}{text && <span className="text-[12px] font-semibold">{text}</span>}
    </button>
  );
  let row;
  if (mode === 'move') {
    row = (
      <>
        <Btn label="Nudge left" icon={ArrowLeft} onClick={() => actions.nudge(layer.id, -step, 0)} disabled={layer.locked} />
        <Btn label="Nudge right" icon={ArrowRight} onClick={() => actions.nudge(layer.id, step, 0)} disabled={layer.locked} />
        <Btn label="Nudge up" icon={ArrowUp} onClick={() => actions.nudge(layer.id, 0, -step)} disabled={layer.locked} />
        <Btn label="Nudge down" icon={ArrowDown} onClick={() => actions.nudge(layer.id, 0, step)} disabled={layer.locked} />
        <Btn label={`Step ${step} px - tap to change`} text={`${step}px`} onClick={() => setStep(step === 10 ? 1 : 10)} />
        <Btn label="Done moving" icon={Check} active onClick={() => setMode('main')} />
      </>
    );
  } else if (mode === 'place') {
    row = (
      <>
        {PLACE_SLOTS.map((p) => (
          <Btn key={p.id} label={`Place ${p.label.toLowerCase()}`} testid={`slot-${p.id}`} text={p.label} onClick={() => actions.place(layer.id, p.rect)} disabled={layer.locked} />
        ))}
        <Btn label="Done placing" icon={Check} active onClick={() => setMode('main')} />
      </>
    );
  } else {
    row = (
      <>
        <Btn label="Move precisely" icon={Move} onClick={() => setMode('move')} disabled={layer.locked} />
        {tab === 'layout'
          ? <Btn label="Place in a slot" icon={LayoutGrid} onClick={() => setMode('place')} disabled={layer.locked} />
          : <Btn label="Match output shape" icon={Crop} onClick={() => actions.matchShape(layer.id)} disabled={layer.locked} />}
        <Btn label={layer.locked ? 'Unlock' : 'Lock'} icon={layer.locked ? Lock : Unlock} active={layer.locked} onClick={() => actions.toggleLock(layer.id)} />
        <Btn label={layer.visible === false ? 'Show' : 'Hide'} icon={layer.visible === false ? EyeOff : Eye} onClick={() => actions.toggleVisible(layer.id)} />
        <Btn label="Bring forward" icon={BringToFront} onClick={() => actions.reorder(layer.id, 1)} disabled={index >= count - 1} />
        <Btn label="Send backward" icon={SendToBack} onClick={() => actions.reorder(layer.id, -1)} disabled={index <= 0} />
        <Btn label="Delete layer" icon={Trash2} danger onClick={() => actions.remove(layer.id)} disabled={count <= 1} />
      </>
    );
  }
  return (
    <div
      data-testid="object-toolbar" data-mode={mode} data-stage-ui
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute inset-x-2 bottom-1 z-10 flex items-center gap-0.5 rounded-2xl border border-white/15 bg-[#0b0d12]/95 p-1 shadow-2xl"
      style={{ height: 52 }}
    >
      {row}
    </div>
  );
}

/**
 * Two rows above the stage (nothing ever sits on the picture):
 *  1. Crop | Layout tabs, the reference image, zoom
 *  2. layer chips - select a layer without hunting for its box
 */
function StageBar({ tab, onTab, referenceLabel, referenceLoaded, onPickReference, view, onZoom, onResetZoom, chips, selection, onChip, onAdd }) {
  const zoomed = view.scale > 1.001;
  const pill = 'flex h-[36px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold';
  return (
    <div data-testid="stage-bar" className="absolute inset-x-2 top-0 flex flex-col">
      <div className="flex h-[44px] items-center gap-1.5">
        <div role="tablist" aria-label="Edit mode" className="flex h-[36px] shrink-0 rounded-full border border-white/12 bg-white/[0.04] p-0.5">
          {[['crop', 'Crop'], ['layout', 'Layout']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`tab-${id}`} onClick={() => onTab(id)}
              className={`h-full rounded-full px-3 text-[12.5px] font-semibold ${tab === id ? 'bg-accent-strong text-white' : 'text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        <button
          type="button" data-testid="reference-chip" onClick={onPickReference} aria-label={`Reference image: ${referenceLabel || 'none'} - change`}
          className={`${pill} min-w-0 flex-1 ${referenceLoaded ? 'border-white/12 bg-white/[0.06] text-slate-100' : 'border-warn/50 bg-warn/15 text-warn'}`}
        >
          <ImageIcon size={14} className="shrink-0" />
          <span className="truncate">{referenceLoaded ? (referenceLabel || 'Reference') : 'No frame'}</span>
          <ChevronDown size={14} className="ml-auto shrink-0 opacity-70" />
        </button>
        <button type="button" data-testid="zoom-button" onClick={onZoom} aria-label={`Zoom (now ${view.scale.toFixed(1)}×)`}
          className={`${pill} border-white/12 bg-white/[0.06] tabular-nums text-slate-100`}>
          <ZoomIn size={14} />{view.scale.toFixed(view.scale % 1 ? 1 : 0)}×
        </button>
        {zoomed && (
          <button type="button" data-testid="zoom-reset" onClick={onResetZoom} aria-label="Reset zoom"
            className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-slate-100">
            <ZoomOut size={15} />
          </button>
        )}
      </div>
      <div className="flex h-[44px] items-center gap-1.5 overflow-x-auto no-scrollbar" data-testid="layer-chips" role="listbox" aria-label="Select a layer">
        {chips.map((c) => {
          const on = selection.type === c.type && (c.type !== 'layer' || selection.id === c.id);
          return (
            <button key={`${c.type}:${c.id || ''}`} type="button" role="option" aria-selected={on} data-testid="layer-chip" onClick={() => onChip(c)}
              className={`flex h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${on ? 'border-transparent text-[#0b0d12]' : 'border-white/12 bg-white/[0.04] text-slate-200'} ${c.hidden ? 'opacity-50' : ''}`}
              style={on ? { background: c.color } : undefined}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? '#0b0d12' : c.color }} aria-hidden="true" />
              {c.label}{c.locked && <Lock size={11} />}
            </button>
          );
        })}
        <button type="button" onClick={onAdd} aria-label="Add layer" className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/25 text-slate-300">
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

function EmptyCard({ onPreset, onAddLayer, onRepair, canRepair }) {
  return (
    <div data-testid="empty-layout-card" data-stage-ui onPointerDown={(e) => e.stopPropagation()} className="absolute inset-x-3 bottom-2 top-[118px] z-10 overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#0b0d12]/95 p-3 shadow-2xl">
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

/* ------------------------------------------------------------------ the stage area */

export default function StageStack({
  info, tab, onTab, store, media, mediaVersion, wmImg, wmAspect, tick, onSelected, onAddLayerMenu,
  referenceLabel, referenceLoaded = true, onPickReference,
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
  const P = info.pad || 0;
  const B = info.bar || 0;
  const T = computeTabLayout({ tab, width: info.freeW, height: info.freeH, landscape });
  const mainKind = T.main.kind;
  const mainView = views[mainKind];
  const mainSetView = mainKind === 'output' ? setOutView : setSrcView;
  const ox = P;                // free-area origin inside the region
  const oy = B + P;

  const cycleZoom = () => {
    const next = mainView.scale < 1.5 ? 2 : mainView.scale < 3 ? 4 : 1;
    mainSetView(next === 1 ? RESET_VIEW : zoomAbout(mainView, next, T.main.w / 2, T.main.h / 2, T.main.w, T.main.h));
  };

  const common = { layers, layout, subtitles, watermark, wmImg, wmAspect, selection, draft, bumpDraft: bump, media, mediaVersion, onSelect: select, onCommit: commit, onDraft: setDraft, tick: tick + capTick, captionStyle: store.captionStyle, pad: P };

  // ---- chips: every layer (top of the canvas first); captions/watermark only exist on the output
  const chips = layers.slice().reverse().map((l) => ({ type: 'layer', id: l.id, label: l.name, color: l.color || '#94a3b8', hidden: l.visible === false, locked: l.locked }));
  if (tab === 'layout') {
    chips.push({ type: 'captions', id: null, label: 'Captions', color: '#7fb6f5' });
    if (watermark?.enabled && watermark?.url) chips.push({ type: 'watermark', id: null, label: 'Logo', color: '#e2e8f0' });
  }

  // ---- toolbar (a strip the layout reserves, so it never covers a box)
  const selLayer = selection.type === 'layer' ? layers.find((l) => l.id === selection.id) : null;
  const key = tab === 'crop' ? 'src' : 'dst';
  const toolbar = selLayer && layers.length > 0 ? (
    <ObjectToolbar
      tab={tab} layer={selLayer} index={layers.indexOf(selLayer)} count={layers.length}
      actions={{
        nudge: (id, dxPx, dyPx) => {
          const l = layers.find((x) => x.id === id);
          if (!l || l.locked) return;
          const r = l[key] || { x: 0, y: 0, w: 1, h: 1 };
          const [cw, ch] = key === 'src' ? [1920, 1080] : [1080, 1920];
          store.actions.beginGesture();
          store.actions.patchLayer(id, { [key]: { ...r, x: Math.round(clamp(r.x + dxPx / cw, 0, 1 - r.w) * 10000) / 10000, y: Math.round(clamp(r.y + dyPx / ch, 0, 1 - r.h) * 10000) / 10000 } });
        },
        place: (id, rect) => { store.actions.beginGesture(); store.actions.patchLayer(id, { dst: { ...rect } }); },
        matchShape: (id) => {
          const l = layers.find((x) => x.id === id);
          if (!l?.src || !l?.dst) return;
          store.actions.beginGesture();
          store.actions.patchLayer(id, { src: matchCropToOutput(l.src, l.dst) });
        },
        toggleLock: (id) => store.actions.updateLayer(id, { locked: !layers.find((l) => l.id === id).locked }),
        toggleVisible: (id) => store.actions.updateLayer(id, { visible: layers.find((l) => l.id === id).visible === false }),
        reorder: (id, dir) => {
          const i = layers.findIndex((l) => l.id === id);
          const j = i + dir;
          if (j < 0 || j >= layers.length) return;
          const next = [...layers];
          const [m] = next.splice(i, 1);
          next.splice(j, 0, m);
          store.actions.reorderLayers(next);
        },
        remove: (id) => store.actions.deleteLayer(id),
      }}
    />
  ) : null;

  return (
    <div data-testid="stage-region" data-tab={tab} className="absolute inset-0 overflow-hidden" style={{ isolation: 'isolate', zIndex: 0, touchAction: 'none' }}>
      {B > 0 && (
        <StageBar
          tab={tab} onTab={onTab} referenceLabel={referenceLabel} referenceLoaded={referenceLoaded} onPickReference={onPickReference}
          view={mainView} onZoom={cycleZoom} onResetZoom={() => mainSetView(RESET_VIEW)}
          chips={chips} selection={selection} onAdd={onAddLayerMenu}
          onChip={(c) => select({ type: c.type, id: c.id })}
        />
      )}

      {/* the ONE interactive stage */}
      <div className="absolute" style={{ left: ox + T.main.x - P, top: oy + T.main.y - P, width: T.main.w + 2 * P, height: T.main.h + 2 * P }}>
        <Stage key={mainKind} kind={mainKind} w={T.main.w} h={T.main.h} view={mainView} setView={mainSetView} {...common} />
      </div>

      {/* passive live preview of the result (Crop tab) - picture only, no boxes */}
      {T.preview && (
        <div className="absolute" style={{ left: ox + T.preview.x - P, top: oy + T.preview.y - P, width: T.preview.w + 2 * P, height: T.preview.h + 2 * P }}>
          <Stage kind="output" passive w={T.preview.w} h={T.preview.h} view={RESET_VIEW} setView={() => {}} {...common} />
          <span className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0b0d12] px-2 text-[10px] font-semibold uppercase tracking-wider text-muted" style={{ top: P }}>Result</span>
        </div>
      )}

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
