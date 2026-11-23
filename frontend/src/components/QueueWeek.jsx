import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Move, X, Sparkles } from 'lucide-react';
import { Button, IconButton, PILL } from './ui';
import { withToken } from '../api';

const HOUR_PX = 44;
const DAYS = 7;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const hhmm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Snap a pointer position inside a day column to a time (30-minute steps). */
export function timeAt(day, y, hourPx = HOUR_PX) {
  const mins = Math.max(0, Math.min(24 * 60 - 30, Math.round((y / hourPx) * 2) * 30));
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(mins / 60), mins % 60);
}

/**
 * A week of scheduled posts on an hour grid.
 * Mouse: drag a post to a new day/time. Touch (or keyboard): tap a post, then tap the new time.
 * Best posting hours (learned from views) are tinted.
 */
export default function QueueWeek({ items, now, bestHours = [], onMove, onOpen }) {
  const [weekStart, setWeekStart] = useState(() => startOfDay(now));
  const [drag, setDrag] = useState(null);           // {item, day, y, dx}
  const [picked, setPicked] = useState(null);        // tap-to-move selection
  const [hover, setHover] = useState(null);          // {dayIdx, time}
  const scroller = useRef(null);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {   // open at the morning, or at the first post of the week
    const first = items.map((i) => new Date(i.scheduled_for)).filter((d) => d >= weekStart && d < addDays(weekStart, DAYS)).sort((a, b) => a - b)[0];
    const h = first ? Math.max(0, first.getHours() - 1) : 8;
    if (scroller.current) scroller.current.scrollTop = h * HOUR_PX;
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => days.map((d) => items.filter((it) => {
    const t = new Date(it.scheduled_for);
    return startOfDay(t).getTime() === d.getTime();
  })), [days, items]);

  const colAt = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-day-col]');
    if (!el) return null;
    const idx = Number(el.dataset.dayCol);
    const rect = el.getBoundingClientRect();
    return { idx, time: timeAt(days[idx], clientY - rect.top) };
  };

  const startDrag = (e, item) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      moved = true;
      setDrag({ item, x: ev.clientX, y: ev.clientY });
      setHover(colAt(ev.clientX, ev.clientY));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      setHover(null);
      if (!moved) { onOpen(item); return; }
      const at = colAt(ev.clientX, ev.clientY);
      if (at && at.time.getTime() !== new Date(item.scheduled_for).getTime()) onMove(item, at.time);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tapCell = (e, dayIdx) => {
    if (!picked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const time = timeAt(days[dayIdx], e.clientY - rect.top);
    onMove(picked, time);
    setPicked(null);
  };

  const weekLabel = `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  const nowTop = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;

  return (
    <div className="rounded-2xl border border-line bg-surface overflow-hidden" data-testid="queue-week">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
        <IconButton icon={ChevronLeft} label="Previous week" size="sm" onClick={() => setWeekStart((d) => addDays(d, -7))} />
        <span className="text-[13px] font-semibold text-ink tabular-nums">{weekLabel}</span>
        <IconButton icon={ChevronRight} label="Next week" size="sm" onClick={() => setWeekStart((d) => addDays(d, 7))} />
        {weekStart.getTime() !== startOfDay(now).getTime() && <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfDay(now))}>Today</Button>}
        {bestHours.length > 0 && (
          <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[11px] text-muted"><span className="w-3 h-3 rounded bg-accent/15 border border-accent/30" /> best hours from your views</span>
        )}
      </div>
      {picked && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 border-b border-accent/30 text-[12px] text-ink" role="status">
          <Move size={14} className="text-accent shrink-0" />
          <span className="truncate">Moving <b>{picked.title || `clip #${picked.clip_id}`}</b> - tap the new time</span>
          <IconButton icon={X} label="Cancel move" size="sm" className="ml-auto" onClick={() => setPicked(null)} />
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: `40px repeat(${DAYS}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => {
          const today = d.getTime() === startOfDay(now).getTime();
          return (
            <div key={d.toISOString()} className={`text-center py-1.5 text-[11px] border-l border-line ${today ? 'text-accent font-semibold' : 'text-muted'}`}>
              <div className="uppercase tracking-wide text-[9.5px]">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
              <div className="tabular-nums text-[13px] text-ink">{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="overflow-y-auto max-h-[62vh] relative select-none">
        <div className="grid relative" style={{ gridTemplateColumns: `40px repeat(${DAYS}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 text-[9.5px] text-faint tabular-nums" style={{ top: h * HOUR_PX - 5 }}>{h ? `${String(h).padStart(2, '0')}` : ''}</div>
            ))}
          </div>
          {days.map((d, di) => {
            const today = d.getTime() === startOfDay(now).getTime();
            return (
              <div key={d.toISOString()} data-day-col={di} onClick={(e) => tapCell(e, di)}
                className={`relative border-l border-line ${picked ? 'cursor-copy' : ''} ${hover?.idx === di ? 'bg-white/[0.02]' : ''}`}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className={`absolute inset-x-0 border-t border-line/60 ${bestHours.includes(h) ? 'bg-accent/[0.07]' : ''}`} style={{ top: h * HOUR_PX, height: HOUR_PX }}>
                    {bestHours.includes(h) && h === Math.min(...bestHours) && di === 0 && <Sparkles size={9} className="absolute left-0.5 top-0.5 text-accent/60" />}
                  </div>
                ))}
                {today && <div className="absolute inset-x-0 h-px bg-bad z-10 pointer-events-none" style={{ top: nowTop }} />}
                {hover?.idx === di && (
                  <div className="absolute inset-x-0.5 rounded-md border border-dashed border-accent bg-accent/10 z-20 pointer-events-none text-[10px] text-accent font-semibold px-1"
                    style={{ top: (hover.time.getHours() + hover.time.getMinutes() / 60) * HOUR_PX, height: HOUR_PX - 4 }}>
                    {hhmm(hover.time)}
                  </div>
                )}
                {byDay[di].map((it) => {
                  const t = new Date(it.scheduled_for);
                  const top = (t.getHours() + t.getMinutes() / 60) * HOUR_PX;
                  const failed = it.yt_status === 'failed' || it.ig_status === 'failed';
                  const isPicked = picked?.id === it.id;
                  const dragging = drag?.item.id === it.id;
                  return (
                    <button key={it.id} type="button" data-testid="week-item" data-queue-id={it.id}
                      onPointerDown={(e) => startDrag(e, it)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.detail === 0 || e.nativeEvent.pointerType !== 'mouse') setPicked(isPicked ? null : it);   // touch / keyboard: pick
                      }}
                      title={`${hhmm(t)} · ${it.title || ''} - drag to move`}
                      className={`absolute inset-x-0.5 z-10 rounded-md text-left overflow-hidden flex gap-1 p-0.5 border text-[10px] leading-tight touch-manipulation
                        ${isPicked ? 'ring-2 ring-accent border-accent' : failed ? 'border-bad/50 bg-bad/15' : 'border-white/10 bg-raised hover:border-accent/60'}
                        ${dragging ? 'opacity-40' : ''} cursor-grab active:cursor-grabbing`}
                      style={{ top: top + 1, height: HOUR_PX - 3 }}>
                      {it.thumbnail_path && <img src={withToken(`/api/clips/${it.clip_id}/thumbnail`)} alt="" draggable={false} className="h-full aspect-[9/16] rounded-sm object-cover hidden sm:block" />}
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink tabular-nums">{hhmm(t)}</span>
                        <span className="block text-muted truncate">{it.title || `#${it.clip_id}`}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {drag && (
        <div className={`fixed z-50 pointer-events-none px-2 py-1 text-[11px] ${PILL}`} style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {hover ? `Move to ${hover.time.toLocaleDateString(undefined, { weekday: 'short' })} ${hhmm(hover.time)}` : 'Drop on a day'}
        </div>
      )}
      <p className="text-[11px] text-faint px-3 py-2 border-t border-line">Drag a post to move it (30-minute steps). On a phone: tap a post, then tap the new time.</p>
    </div>
  );
}
