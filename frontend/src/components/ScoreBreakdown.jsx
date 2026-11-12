import React from 'react';

const ORDER = ['hook', 'flow', 'value', 'trend'];
const LABEL = { hook: 'Hook', flow: 'Flow', value: 'Value', trend: 'Trend' };

/** Parses a clip's score_breakdown (JSON string or object) into displayable parts. */
export function parseBreakdown(raw) {
  let b = raw;
  if (typeof raw === 'string') {
    try { b = JSON.parse(raw); } catch { return null; }
  }
  if (!b || typeof b !== 'object') return null;
  const hfvt = ORDER.filter((k) => typeof b[k] === 'number');
  if (hfvt.length === ORDER.length) {
    return { kind: 'hfvt', items: ORDER.map((k) => ({ key: k, label: LABEL[k], value: b[k], max: 100 })), hook: b.hook_summary, payoff: b.punchline_summary };
  }
  // legacy calibrated rubric: numeric 1-5 values only
  const items = Object.entries(b)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => ({ key: k, label: k.replace(/_/g, ' '), value: v, max: v <= 5 ? 5 : 100 }));
  return items.length ? { kind: 'rubric', items } : null;
}

export default function ScoreBreakdown({ raw, compact = false }) {
  const parsed = parseBreakdown(raw);
  if (!parsed) return null;
  if (compact) {
    return (
      <div className="flex gap-1.5">
        {parsed.items.map((it) => {
          const pct = Math.round((it.value / it.max) * 100);
          return (
            <div key={it.key} className="flex-1 min-w-0" title={`${it.label}: ${it.value}/${it.max}`}>
              <div className="h-1 rounded-full bg-white/15 overflow-hidden">
                <div className={`h-full ${pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[9px] text-slate-300 mt-0.5 truncate">{it.label} {it.value}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
        {parsed.kind === 'hfvt' ? 'Score breakdown' : 'Calibrated rubric sub-scores'}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {parsed.items.map((it) => (
          <div key={it.key} className="bg-white/[0.03] p-2 rounded-lg border border-white/[0.04]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 capitalize">{it.label}</span>
              <span className="font-extrabold text-white font-mono">{it.value}/{it.max}</span>
            </div>
            <div className="h-1 mt-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-indigo-400" style={{ width: `${Math.round((it.value / it.max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {parsed.hook && <p className="text-[11px] text-slate-400"><b className="text-slate-200">Hook:</b> {parsed.hook}</p>}
      {parsed.payoff && <p className="text-[11px] text-slate-400"><b className="text-slate-200">Payoff:</b> {parsed.payoff}</p>}
    </div>
  );
}
