import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { nearestSnap } from './geometry';

const vibrate = () => { try { navigator.vibrate?.(5); } catch { /* unsupported */ } };

/**
 * Bottom sheet with snap points (closed / peek / half / full). It never covers the stage: the shell gives the stage
 * the space above it, and this component only reports its height while it is dragged (`onDrag`) and where it lands
 * (`onSnap`). It sits at z-index 30 outside the (isolated, z-0) stage region.
 *
 * Landscape: a right-hand drawer (fixed width) that opens over the source stage.
 */
export default function SnapSheet({
  snap, heightPx, avail, landscape = false, bottomOffset = 0, title, right, onSnap, onDrag, children,
}) {
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const open = snap !== 'closed' || dragging;

  const onPointerDown = (e) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    drag.current = { y: e.clientY, h: heightPx, last: e.clientY, lastT: performance.now(), v: 0 };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.v = (d.last - e.clientY) / dt;                 // px/ms, positive = sheet growing
    d.last = e.clientY;
    d.lastT = now;
    const next = Math.max(0, Math.min(avail, d.h + (d.y - e.clientY)));
    onDrag(next);
  };
  const end = (e, cancelled) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!d) return;
    const px = Math.max(0, Math.min(avail, d.h + (d.y - e.clientY)));
    const target = cancelled ? snap : nearestSnap(px, avail, d.v);
    onDrag(null);
    if (target !== snap) vibrate();
    onSnap(target);
  };

  if (landscape) {
    return (
      <aside
        data-testid="studio-sheet" data-snap={snap}
        className={`absolute right-0 top-0 bottom-0 z-30 flex w-[min(360px,46%)] flex-col border-l border-white/10 bg-surface shadow-2xl transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        <div className="flex h-[48px] shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3">
          <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-1">{right}
            <button type="button" aria-label="Close panel" onClick={() => onSnap('closed')} className="flex h-[44px] w-[44px] items-center justify-center rounded-xl text-slate-300 active:bg-white/10"><X size={18} /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    );
  }

  return (
    <section
      data-testid="studio-sheet" data-snap={snap}
      aria-hidden={!open}
      className="absolute inset-x-0 z-30 flex flex-col rounded-t-3xl border-t border-white/10 bg-surface shadow-[0_-12px_40px_rgba(0,0,0,0.55)]"
      style={{
        bottom: bottomOffset, height: heightPx, overflow: 'hidden',
        transition: dragging ? 'none' : 'height 200ms cubic-bezier(.2,.8,.2,1)',
        visibility: heightPx <= 0 && !dragging ? 'hidden' : 'visible',
      }}
    >
      <div
        data-testid="sheet-handle" role="separator" aria-orientation="horizontal" aria-label="Resize panel"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={(e) => end(e, false)} onPointerCancel={(e) => end(e, true)}
        className="relative flex h-[44px] shrink-0 cursor-grab touch-none items-center gap-2 px-3 active:cursor-grabbing"
        style={{ touchAction: 'none', marginTop: -2 }}
      >
        <span className="absolute left-1/2 top-2 h-1.5 w-[40px] -translate-x-1/2 rounded-full bg-white/25" />
        <h2 className="mt-3 min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</h2>
        <div className="mt-3 flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>{right}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="sheet-content">{children}</div>
    </section>
  );
}
