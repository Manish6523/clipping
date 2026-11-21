import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Brain, RefreshCw, RotateCcw } from 'lucide-react';
import { Button, Notice, Confirm } from './ui';

const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
const num = (v) => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
const TUNE_LABEL = {
  cold_open: (v) => `Cold open ${v ? 'on' : 'off'}`,
  ai_director: (v) => `AI director ${v ? 'on' : 'off'}`,
  sfx_words: (v) => `Word sounds ${v ? 'on' : 'off'}`,
  sfx_cuts: (v) => `Cut sounds ${v ? 'on' : 'off'}`,
  zoom_every: (v) => `1 zoom per ${Number(v).toFixed(1)} s`,
  emphasis_every: (v) => `1 key word per ${Number(v).toFixed(0)} s`,
  box_zoom_amount: (v) => `Zoom ${Math.round(v * 100)}%`,
};

/** Settings: what auto edit learned from approvals, views and your Edits-panel changes. */
export default function AutoEditLearning() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const load = () => axios.get('/api/auto-edit/learning').then((r) => setData(r.data)).catch(() => setData({}));
  useEffect(() => { load(); }, []);

  const run = async () => {
    setBusy(true);
    try { await axios.post('/api/auto-edit/learning/run', {}, { timeout: 120000 }); await load(); } finally { setBusy(false); }
  };
  const reset = async () => {
    setConfirm(false);
    setBusy(true);
    try { await axios.post('/api/auto-edit/learning/reset'); await load(); } finally { setBusy(false); }
  };

  const active = data?.active || {};
  const styles = Object.entries(data?.insights || {});
  return (
    <div className="rounded-xl bg-canvas border border-line p-3 space-y-3" data-testid="auto-edit-learning">
      <div className="flex items-center gap-2">
        <Brain size={15} className="text-accent" />
        <span className="text-[13px] font-semibold text-ink mr-auto">What auto edit learned</span>
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy} onClick={run}>Analyze now</Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => setConfirm(true)}>Reset</Button>
      </div>
      <p className="text-[11.5px] text-muted leading-relaxed">
        Every day it compares auto-edited clips you approved vs rejected, how published ones did on YouTube, and which edits you switch off in
        the Edits panel - then adjusts the style defaults. It only changes something with at least 15 clips on each side (or 10 clips you edited).
      </p>
      {data && (
        <p className="text-[11.5px] text-slate-300">
          {data.clips ?? 0} auto-edited clips · {data.decided ?? 0} approved/rejected · {data.with_views ?? 0} with views
          {data.updated ? ` · last run ${new Date(data.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        </p>
      )}
      {Object.keys(active).length > 0 ? (
        Object.entries(active).map(([style, t]) => (
          <div key={style} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-muted capitalize">{style}:</span>
            {Object.entries(t).map(([k, v]) => (
              <span key={k} className="rounded-md bg-accent/12 text-accent text-[11px] px-1.5 py-0.5">{TUNE_LABEL[k] ? TUNE_LABEL[k](v) : `${k}: ${v}`}</span>
            ))}
          </div>
        ))
      ) : (
        <Notice tone="idle">No adjustments yet - the built-in defaults are used.</Notice>
      )}
      {styles.map(([style, ins]) => (
        <details key={style} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
          <summary className="cursor-pointer text-[12px] text-ink capitalize select-none">{style} · {ins.clips} clips</summary>
          {(ins.reasons || []).length > 0 && <ul className="mt-1.5 space-y-1 text-[11.5px] text-slate-300 list-disc pl-4">{ins.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead className="text-muted"><tr><th className="text-left font-medium py-1">Feature</th><th className="text-right font-medium">Approved with / without</th><th className="text-right font-medium">Median views with / without</th></tr></thead>
              <tbody>
                {ins.comparison.map((c) => (
                  <tr key={c.feature} className="border-t border-line">
                    <td className="py-1 text-slate-200">{c.label}</td>
                    <td className="text-right text-slate-300">{pct(c.with.approval)} <span className="text-muted">({c.with.n})</span> / {pct(c.without.approval)} <span className="text-muted">({c.without.n})</span></td>
                    <td className="text-right text-slate-300">{num(c.with.views)} / {num(c.without.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ins.switched_off && (
            <p className="mt-1.5 text-[11px] text-muted">
              You switched off: zooms {pct(ins.switched_off.zooms?.rate)}, key words {pct(ins.switched_off.emphasis?.rate)}, sounds {pct(ins.switched_off.sfx?.rate)}, cold opens {pct(ins.switched_off.cold_open?.rate)}
              {' '}(over {ins.switched_off.zooms?.clips ?? 0} clips you edited)
            </p>
          )}
        </details>
      ))}
      <Confirm open={confirm} title="Reset what auto edit learned?" confirmLabel="Reset" danger
        text="The style defaults go back to the built-in values. Learning starts again from the next daily run." onConfirm={reset} onCancel={() => setConfirm(false)} />
    </div>
  );
}
