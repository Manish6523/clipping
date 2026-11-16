import React, { useEffect, useRef, useState } from 'react';
import {
  Eye, EyeOff, Lock, Unlock, MoreHorizontal, GripVertical, Plus, Copy, BringToFront, SendToBack, Trash2, SlidersHorizontal,
  Type, Sparkles, Stamp, Palette, ChevronRight, Wand2,
} from 'lucide-react';
import { useTemplateEditorStore } from '../../store/templateEditorStore';
import { LAYER_KINDS, LAYOUT_PRESETS, MAX_LAYERS, makeLayer } from './layoutPresets';
import { isVideoUrl } from './stageDraw';

const vibrate = () => { try { navigator.vibrate?.(5); } catch { /* unsupported */ } };
const cx = (...c) => c.filter(Boolean).join(' ');
const LONG_PRESS_MS = 260;

function Thumb({ layer, url }) {
  const s = layer.src || { x: 0, y: 0, w: 1, h: 1 };
  const usable = url && !isVideoUrl(url);
  const style = usable ? {
    backgroundImage: `url(${url})`,
    backgroundSize: `${100 / Math.max(0.05, s.w)}% ${100 / Math.max(0.05, s.h)}%`,
    backgroundPosition: `${s.w >= 0.999 ? 0 : (s.x / (1 - s.w)) * 100}% ${s.h >= 0.999 ? 0 : (s.y / (1 - s.h)) * 100}%`,
  } : { background: `${layer.color || '#334155'}55` };
  return <span className="block h-8 w-8 shrink-0 rounded-md border border-white/15 bg-black bg-no-repeat" style={style} aria-hidden="true" />;
}

function IconBtn({ label, onClick, children, active, className = '' }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cx('flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl active:bg-white/10', active ? 'text-accent' : 'text-slate-300', className)}>
      {children}
    </button>
  );
}

export function EmptyLayersCard({ onPreset, onAdd }) {
  return (
    <div className="m-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5" data-testid="empty-layers-cta">
      <div className="mb-2 flex items-center gap-2"><Wand2 size={16} className="text-accent" /><h3 className="text-[14px] font-semibold text-ink">Start with a layout</h3></div>
      <div className="grid gap-1.5">
        {LAYOUT_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => onPreset(p.id)} className="flex min-h-[44px] flex-col items-start justify-center rounded-xl bg-white/[0.06] px-3 py-1.5 text-left active:bg-white/[0.12]">
            <span className="text-[13px] font-semibold text-ink">{p.title}</span><span className="text-[11px] text-muted">{p.hint}</span>
          </button>
        ))}
        <button type="button" onClick={onAdd} className="flex h-[44px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/25 text-[13px] font-semibold text-slate-200"><Plus size={15} /> Add layer</button>
      </div>
    </div>
  );
}

const PINNED = [
  { type: 'captions', label: 'Captions & subtitles', icon: Type },
  { type: 'hook', label: 'Hook title card', icon: Sparkles },
  { type: 'watermark', label: 'Channel watermark', icon: Stamp },
  { type: 'background', label: 'Canvas background', icon: Palette },
];

export default function PhoneLayersSheet({ mediaUrl, onProperties, onPinned, addOpen, setAddOpen, onPreset }) {
  const s = useTemplateEditorStore();
  const layers = s.layout.layers || [];
  const display = layers.slice().reverse();                      // top of the list = top of the canvas
  const [menuId, setMenuId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState(null);                        // { id, from, startY, y, over }
  const rowRefs = useRef({});
  const timer = useRef(0);
  const pending = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const overIndexFor = (y) => {
    let idx = display.length;
    for (let i = 0; i < display.length; i += 1) {
      const el = rowRefs.current[display[i].id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) { idx = i; break; }
    }
    return idx;
  };

  const onHandleDown = (e, layer, from) => {
    const pid = e.pointerId;
    const el = e.currentTarget;
    const startY = e.clientY;
    pending.current = { pid, startY, el };
    const begin = () => {
      try { el.setPointerCapture(pid); } catch { /* synthetic */ }
      setDrag({ id: layer.id, from, startY, y: startY, over: from });
      vibrate();
    };
    if (e.pointerType === 'mouse') begin();
    else timer.current = setTimeout(begin, LONG_PRESS_MS);
  };
  const onHandleMove = (e) => {
    if (!drag) {
      const p = pending.current;
      if (p && Math.abs(e.clientY - p.startY) > 10) clearTimeout(timer.current);     // it was a scroll, not a long press
      return;
    }
    setDrag((d) => (d ? { ...d, y: e.clientY, over: overIndexFor(e.clientY) } : d));
  };
  const onHandleUp = (e) => {
    clearTimeout(timer.current);
    pending.current = null;
    if (!drag) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const { from, over } = drag;
    setDrag(null);
    let to = over > from ? over - 1 : over;                        // index after removing the dragged row
    to = Math.max(0, Math.min(display.length - 1, to));
    if (to === from) return;
    const next = display.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    s.reorderLayers(next.reverse());                               // one undo step per drop
    vibrate();
  };

  const startRename = (l) => { setEditId(l.id); setDraft(l.name); };
  const finishRename = (id) => { if (draft.trim()) s.updateLayer(id, { name: draft.trim() }); setEditId(null); };
  const reorder = (id, dir) => {
    const i = layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (j < 0 || j >= layers.length) return;
    const next = [...layers];
    const [m] = next.splice(i, 1);
    next.splice(j, 0, m);
    s.reorderLayers(next);
  };
  const duplicate = (l) => {
    if (layers.length >= MAX_LAYERS) return;
    s.addLayer({ ...l, id: `l_${Date.now().toString(36)}`, name: `${l.name} copy`, locked: false, dst: { ...l.dst, x: Math.min(0.8, (l.dst?.x || 0) + 0.05), y: Math.min(0.8, (l.dst?.y || 0) + 0.05) } });
  };

  const dragFrom = drag ? drag.from : -1;
  const showIndicator = (i) => drag && drag.over === i && drag.over !== dragFrom && drag.over !== dragFrom + 1;

  return (
    <div className="pb-3" data-testid="layers-sheet">
      <div className="flex items-center justify-between px-3 pb-1 pt-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Layers {layers.length}/{MAX_LAYERS}</span>
        <button type="button" onClick={() => setAddOpen(!addOpen)} disabled={layers.length >= MAX_LAYERS} aria-expanded={addOpen}
          className="flex h-[44px] items-center gap-1.5 rounded-xl bg-accent/15 px-3 text-[13px] font-semibold text-accent disabled:opacity-40">
          <Plus size={15} /> Add layer
        </button>
      </div>

      {addOpen && (
        <div className="mx-3 mb-2 grid grid-cols-4 gap-1.5" data-testid="add-layer-menu">
          {LAYER_KINDS.map((k) => (
            <button key={k.kind} type="button" onClick={() => { s.addLayer(makeLayer(k.kind, layers)); setAddOpen(false); }}
              className="flex h-[56px] flex-col items-center justify-center gap-1 rounded-xl bg-white/[0.06] text-[11.5px] font-semibold text-slate-100 active:bg-white/[0.12]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.color }} />{k.name}
            </button>
          ))}
        </div>
      )}

      {layers.length === 0 ? (
        <EmptyLayersCard onPreset={onPreset} onAdd={() => setAddOpen(true)} />
      ) : (
        <ul className="px-2" data-testid="layer-rows">
          {display.map((l, i) => {
            const selected = s.selection.type === 'layer' && s.selection.id === l.id;
            const dragging = drag?.id === l.id;
            return (
              <React.Fragment key={l.id}>
                {showIndicator(i) && <li aria-hidden="true" className="mx-2 h-0.5 rounded bg-accent" data-testid="drop-indicator" />}
                <li
                  ref={(el) => { rowRefs.current[l.id] = el; }}
                  data-testid="layer-row" data-layer-id={l.id}
                  className={cx('relative mb-1 rounded-xl border', selected ? 'border-accent/60 bg-accent/10' : 'border-white/[0.06] bg-white/[0.03]', dragging && 'z-10 shadow-2xl')}
                  style={dragging ? { transform: `translateY(${drag.y - drag.startY}px)`, transition: 'none' } : undefined}
                >
                  <div className="flex h-[48px] items-center">
                    <button
                      type="button" aria-label={`Reorder ${l.name} (hold, then drag)`} data-testid="layer-handle"
                      onPointerDown={(e) => onHandleDown(e, l, i)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
                      className="flex h-[44px] w-[36px] shrink-0 cursor-grab items-center justify-center text-slate-400" style={{ touchAction: 'none' }}
                    >
                      <GripVertical size={16} />
                    </button>
                    <button type="button" onClick={() => s.setSelection({ type: 'layer', id: l.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-pressed={selected}>
                      <Thumb layer={l} url={mediaUrl} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden="true" />
                      {editId === l.id ? (
                        <input
                          autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onClick={(e) => e.stopPropagation()}
                          onBlur={() => finishRename(l.id)} onKeyDown={(e) => { if (e.key === 'Enter') finishRename(l.id); if (e.key === 'Escape') setEditId(null); }}
                          aria-label="Layer name" className="h-[36px] min-w-0 flex-1 rounded-lg border border-accent/50 bg-canvas px-2 text-[14px] text-ink outline-none"
                        />
                      ) : (
                        <span
                          className={cx('min-w-0 flex-1 truncate text-[13.5px] font-medium', l.visible === false ? 'text-faint line-through' : 'text-ink')}
                          onDoubleClick={() => startRename(l)}
                        >{l.name}</span>
                      )}
                    </button>
                    <IconBtn label={l.visible === false ? `Show ${l.name}` : `Hide ${l.name}`} onClick={() => s.updateLayer(l.id, { visible: l.visible === false })}>
                      {l.visible === false ? <EyeOff size={16} /> : <Eye size={16} />}
                    </IconBtn>
                    <IconBtn label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} active={l.locked} onClick={() => s.updateLayer(l.id, { locked: !l.locked })}>
                      {l.locked ? <Lock size={16} /> : <Unlock size={16} />}
                    </IconBtn>
                    <IconBtn label={`More for ${l.name}`} onClick={() => setMenuId(menuId === l.id ? null : l.id)} active={menuId === l.id}><MoreHorizontal size={18} /></IconBtn>
                  </div>
                  {menuId === l.id && (
                    <div className="grid grid-cols-5 gap-1 border-t border-white/[0.06] p-1.5" data-testid="layer-menu">
                      {[
                        { label: 'Rename', icon: Type, run: () => { startRename(l); setMenuId(null); } },
                        { label: 'Properties', icon: SlidersHorizontal, run: () => { setMenuId(null); onProperties(l.id); } },
                        { label: 'Duplicate', icon: Copy, run: () => { duplicate(l); setMenuId(null); }, off: layers.length >= MAX_LAYERS },
                        { label: 'Front', icon: BringToFront, run: () => reorder(l.id, 1), off: layers.indexOf(l) >= layers.length - 1 },
                        { label: 'Back', icon: SendToBack, run: () => reorder(l.id, -1), off: layers.indexOf(l) <= 0 },
                      ].map((a) => (
                        <button key={a.label} type="button" disabled={a.off} onClick={a.run}
                          className="flex h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10.5px] font-medium text-slate-200 active:bg-white/10 disabled:opacity-35">
                          <a.icon size={15} />{a.label}
                        </button>
                      ))}
                      <button type="button" disabled={layers.length <= 1} onClick={() => { s.deleteLayer(l.id); setMenuId(null); }}
                        className="col-span-5 flex h-[44px] items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold text-bad active:bg-bad/10 disabled:opacity-35">
                        <Trash2 size={15} /> Delete layer
                      </button>
                    </div>
                  )}
                </li>
              </React.Fragment>
            );
          })}
          {showIndicator(display.length) && <li aria-hidden="true" className="mx-2 h-0.5 rounded bg-accent" data-testid="drop-indicator" />}
        </ul>
      )}

      <div className="mt-2 px-2">
        <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Pinned</div>
        {PINNED.map((p) => {
          const on = s.selection.type === p.type;
          return (
            <button key={p.type} type="button" onClick={() => onPinned(p.type)} aria-pressed={on}
              className={cx('mb-1 flex h-[48px] w-full items-center gap-3 rounded-xl border px-3 text-left', on ? 'border-accent/60 bg-accent/10' : 'border-white/[0.06] bg-white/[0.03]')}>
              <p.icon size={16} className="text-slate-300" />
              <span className="flex-1 text-[13.5px] font-medium text-ink">{p.label}</span>
              <ChevronRight size={16} className="text-faint" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
