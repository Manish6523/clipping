import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Small time-series line chart (one y-axis) with dashed reference lines, event markers
 * and a hover crosshair + tooltip. Plain SVG - no chart library.
 *
 * series:   [{ key, label, color, dash? }]   (1-2 lines; the second is usually a reference)
 * refLines: [{ value | (point) => value, label, color, dash }]
 * markers:  [{ t, label }]                    vertical event lines (hype triggers)
 */
export default function TimeChart({
  data, series, refLines = [], markers = [], height = 150, unit = '', yMin, yMax, formatY = (v) => v,
  emptyText = 'Waiting for data…',
}) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    const t = setTimeout(measure, 250); // after fonts/layout settle
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); clearTimeout(t); };
  }, []);

  const pad = { l: 34, r: 8, t: 10, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const geo = useMemo(() => {
    if (!data || data.length < 2) return null;
    const t0 = data[0].t;
    const t1 = data[data.length - 1].t;
    const vals = [];
    data.forEach((p) => series.forEach((s) => { const v = p[s.key]; if (v != null) vals.push(v); }));
    refLines.forEach((r) => data.forEach((p) => {
      const v = typeof r.value === 'function' ? r.value(p) : r.value;
      if (v != null) vals.push(v);
    }));
    let lo = yMin ?? Math.min(...vals);
    let hi = yMax ?? Math.max(...vals);
    if (hi - lo < 1e-6) { hi += 1; lo -= yMin == null ? 1 : 0; }
    hi += (hi - lo) * 0.08;
    const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * w;
    const y = (v) => pad.t + h - ((v - lo) / (hi - lo)) * h;
    const ticks = [lo, lo + (hi - lo) / 2, hi].map((v) => ({ v, y: y(v) }));
    return { t0, t1, x, y, lo, hi, ticks };
  }, [data, series, refLines, yMin, yMax, w, h, pad.l, pad.t]);

  const path = (getter) => {
    let d = '';
    let pen = false;
    data.forEach((p) => {
      const v = getter(p);
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${geo.x(p.t).toFixed(1)},${geo.y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = geo.t0 + ((px - pad.l) / w) * (geo.t1 - geo.t0);
    let best = 0;
    for (let i = 1; i < data.length; i += 1) if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i;
    setHover(best);
  };

  const timeLabel = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height }}>
      {!geo ? (
        <div className="h-full flex items-center justify-center text-xs text-[var(--tl-muted)]">{emptyText}</div>
      ) : (
        <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          className="touch-none block" role="img"
          aria-label={`${series.map((s) => s.label).join(' and ')} over the last ${Math.round((geo.t1 - geo.t0) / 60)} minutes`}>
          {geo.ticks.map((tk, i) => (
            <g key={i}>
              <line x1={pad.l} x2={pad.l + w} y1={tk.y} y2={tk.y} stroke="var(--tl-grid)" strokeWidth="1" />
              <text x={pad.l - 6} y={tk.y + 3} textAnchor="end" fontSize="10" fill="var(--tl-muted)">{formatY(tk.v)}</text>
            </g>
          ))}
          <text x={pad.l} y={height - 4} fontSize="10" fill="var(--tl-muted)">{timeLabel(geo.t0)}</text>
          <text x={pad.l + w} y={height - 4} fontSize="10" fill="var(--tl-muted)" textAnchor="end">now</text>

          {markers.filter((m) => m.t >= geo.t0 && m.t <= geo.t1).map((m, i) => (
            <g key={`m${i}`}>
              <line x1={geo.x(m.t)} x2={geo.x(m.t)} y1={pad.t} y2={pad.t + h} stroke="var(--tl-event)" strokeWidth="2" strokeDasharray="2 3" />
              <circle cx={geo.x(m.t)} cy={pad.t + 3} r="4" fill="var(--tl-event)" stroke="var(--tl-surface)" strokeWidth="2" />
            </g>
          ))}

          {refLines.map((r, i) => (
            <path key={`r${i}`} d={path((p) => (typeof r.value === 'function' ? r.value(p) : r.value))}
              fill="none" stroke={r.color} strokeWidth="1.5" strokeDasharray={r.dash || '5 4'} />
          ))}
          {series.map((s) => (
            <path key={s.key} d={path((p) => p[s.key])} fill="none" stroke={s.color} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {hover != null && data[hover] && (
            <g>
              <line x1={geo.x(data[hover].t)} x2={geo.x(data[hover].t)} y1={pad.t} y2={pad.t + h} stroke="var(--tl-muted)" strokeWidth="1" />
              {series.map((s) => data[hover][s.key] != null && (
                <circle key={s.key} cx={geo.x(data[hover].t)} cy={geo.y(data[hover][s.key])} r="4" fill={s.color}
                  stroke="var(--tl-surface)" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
      )}
      {geo && hover != null && data[hover] && (() => {
        const p = data[hover];
        const left = geo.x(p.t);
        return (
          <div className="pointer-events-none absolute top-1 z-10 rounded-lg border border-white/10 bg-surface/95 px-2.5 py-1.5 text-[11px] shadow-xl whitespace-nowrap"
            style={{ left: Math.min(Math.max(left + 10, 0), width - 150) }}>
            <div className="text-[var(--tl-muted)] mb-0.5">{new Date(p.t * 1000).toLocaleTimeString()}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-[var(--tl-text)]">
                <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: s.color }} />
                {s.label}: <b>{p[s.key] == null ? '—' : `${formatY(p[s.key])}${unit}`}</b>
              </div>
            ))}
            {refLines.map((r, i) => {
              const v = typeof r.value === 'function' ? r.value(p) : r.value;
              return v == null ? null : (
                <div key={i} className="flex items-center gap-1.5 text-[var(--tl-muted)]">
                  <span className="inline-block w-2.5 border-t border-dashed" style={{ borderColor: r.color }} />
                  {r.label}: {formatY(v)}{unit}
                </div>
              );
            })}
            {p.trig ? <div className="text-[var(--tl-text)] mt-0.5">⚡ hype triggered</div> : null}
          </div>
        );
      })()}
    </div>
  );
}
