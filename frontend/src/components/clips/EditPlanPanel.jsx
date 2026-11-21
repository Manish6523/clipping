import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Loader2, Plus, Trash2, Undo2, RotateCcw, Wand2, ZoomIn, Music2, Type, Rewind, Sparkles } from 'lucide-react';
import { Button, Toggle, Select, Input, Notice, Confirm } from '../ui';

const STRENGTHS = [
  { value: 0.1, label: 'Subtle' }, { value: 0.18, label: 'Medium' }, { value: 0.25, label: 'Strong' }, { value: 0.35, label: 'Max' },
];
const CATS = [
  { value: 'hit', label: 'Hit / boom' }, { value: 'pop', label: 'Pop' }, { value: 'ding', label: 'Ding' },
  { value: 'whoosh', label: 'Whoosh' }, { value: 'swish', label: 'Swish' }, { value: 'rewind', label: 'Rewind' }, { value: 'riser', label: 'Riser' },
];
const VOLS = [0.12, 0.2, 0.3, 0.45, 0.6, 0.8];
const errText = (e) => e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || 'failed';
const nearest = (opts, v) => opts.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const fmt = (s) => {
  const t = Math.max(0, s);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
};
const newId = (p) => `${p}u${Date.now().toString(36)}`;

function Section({ icon: Icon, title, count, children, action }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Icon size={13} className="text-accent shrink-0" />
        <h4 className="text-[12px] font-semibold text-ink">{title}</h4>
        {count != null && <span className="text-[11px] text-muted">{count}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

function Row({ item, onToggle, time, onSeek, children, onDelete }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 ${item.on === false ? 'opacity-50' : ''} bg-white/[0.03]`} data-testid="plan-row">
      <Toggle checked={item.on !== false} onChange={onToggle} />
      <button type="button" onClick={onSeek} className="font-mono text-[11.5px] text-accent tabular-nums min-w-[48px] h-9 text-left hover:underline" title="Jump here">
        {time}
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">{children}</div>
      {item.by === 'user' && onDelete && (
        <button type="button" onClick={onDelete} aria-label="Remove" className="w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:text-bad hover:bg-bad/10">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Every auto-edit decision of a clip - zooms, emphasised words, sound effects, cold open, hook -
 * each can be switched off (per-edit undo), changed, or added at the playhead; "Apply" re-renders.
 *
 * getTime(): playhead in the clip's SOURCE time (the plan's timeline); seek(t): jump there.
 */
export default function EditPlanPanel({ clipId, getTime, seek, onRendered, compact = false }) {
  const [data, setData] = useState(null);        // server response
  const [plan, setPlan] = useState(null);        // working copy
  const [history, setHistory] = useState([]);    // previous working copies (local undo)
  const [words, setWords] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [newCat, setNewCat] = useState('pop');

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, w] = await Promise.all([axios.get(`/api/clips/${clipId}/edit-plan`), axios.get(`/api/clips/${clipId}/words`).catch(() => ({ data: { words: [] } }))]);
      setData(p.data);
      setPlan(p.data.plan ? JSON.parse(JSON.stringify(p.data.plan)) : null);
      setHistory([]);
      setWords(w.data?.words || []);
    } catch (e) {
      setError(errText(e));
    }
  }, [clipId]);
  useEffect(() => { load(); }, [load]);

  const start = Number(data?.start || 0);
  const end = Number(data?.end || 0);
  // how the RENDERED video maps to source time (it reflects the saved plan): sped up, cold open first
  const savedCo = data?.plan?.cold_open || {};
  const ctx = { start, end, speed: Number(data?.speed || 1), lead: savedCo.on ? Number(savedCo.end) - Number(savedCo.start) : 0 };
  const clipT = (t) => fmt(Number(t) - start);
  const dirty = useMemo(() => data && plan && JSON.stringify(plan) !== JSON.stringify(data.plan), [data, plan]);

  const change = (fn) => setPlan((prev) => {
    setHistory((h) => [...h.slice(-30), prev]);
    const next = JSON.parse(JSON.stringify(prev));
    fn(next);
    return next;
  });
  const undo = () => setHistory((h) => {
    if (!h.length) return h;
    setPlan(h[h.length - 1]);
    return h.slice(0, -1);
  });
  const playhead = () => {
    const t = Number(getTime?.(ctx) ?? start);
    return Math.min(end, Math.max(start, Number.isFinite(t) ? t : start));
  };
  const seekTo = (t) => seek?.(Number(t), ctx);
  const setItem = (key, id, patch) => change((p) => { p[key] = p[key].map((x) => (x.id === id ? { ...x, ...patch } : x)); });
  const removeItem = (key, id) => change((p) => { p[key] = p[key].filter((x) => x.id !== id); });
  const addItem = (key, item) => change((p) => { p[key] = [...(p[key] || []), item].sort((a, b) => a.t - b.t); });

  const apply = async (regenerate = false) => {
    setBusy(regenerate ? 'Rebuilding the automatic edit…' : 'Re-rendering with your changes…');
    setError('');
    try {
      const res = regenerate
        ? await axios.post(`/api/clips/${clipId}/edit-plan/regenerate`, {}, { timeout: 900000 })
        : await axios.put(`/api/clips/${clipId}/edit-plan`, { plan }, { timeout: 900000 });
      await load();
      onRendered?.(res.data);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
      setConfirmReset(false);
    }
  };

  if (error && !data) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-muted" /></div>;

  if (!plan) {
    return (
      <div className="space-y-2.5" data-testid="edit-plan">
        <p className="text-[12.5px] text-muted leading-relaxed">
          {data.auto_edited ? "This clip was auto-edited before edits were saved, so there's nothing to change yet."
            : 'This clip has no auto edit.'} Build one to get zooms on the facecam, emphasised words, sound effects and a cold open - each one you can switch off or change.
        </p>
        {!data.source_available && <Notice tone="warn">The source footage was deleted, so this clip can't be re-rendered.</Notice>}
        <Button block variant="primary" icon={Wand2} loading={!!busy} disabled={!data.source_available} onClick={() => apply(true)}>
          {data.auto_edited ? 'Build edit list' : 'Add auto edit'}
        </Button>
        {busy && <p className="text-xs text-muted text-center">{busy} This takes about a minute.</p>}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    );
  }

  const zooms = plan.zooms || [];
  const emph = plan.emphasis || [];
  const sfx = plan.sfx || [];
  const co = plan.cold_open || { on: false };
  const hook = plan.hook || { on: false, text: '' };
  const lib = data.sfx_library || {};

  return (
    <div className={`space-y-4 ${compact ? 'text-[12px]' : ''}`} data-testid="edit-plan">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-muted">Switch any edit off to undo it, or add your own at the playhead.</span>
        {plan.by === 'ai' && <span className="inline-flex items-center gap-1 text-[11px] text-accent"><Sparkles size={11} />AI director</span>}
      </div>

      <Section icon={Type} title="Hook card">
        <div className="flex items-center gap-2">
          <Toggle checked={!!hook.on} onChange={(v) => change((p) => { p.hook = { ...hook, on: v }; })} />
          <Input value={hook.text || ''} maxLength={120} placeholder="Short title shown at the start"
            onChange={(e) => { const v = e.target.value; setPlan((p) => ({ ...p, hook: { ...hook, text: v } })); }}
            onKeyDown={(e) => e.stopPropagation()} className="!h-9 !text-[12.5px] flex-1" aria-label="Hook text" />
        </div>
      </Section>

      <Section icon={Rewind} title="Cold open" action={
        <Toggle checked={!!co.on} onChange={(v) => change((p) => {
          const t = playhead();
          p.cold_open = v ? { on: true, start: co.start ?? Math.max(start, t - 0.5), end: co.end ?? Math.min(end, t + 1.3), by: co.by || 'user' } : { ...co, on: false };
        })} />}>
        <p className="text-[11.5px] text-muted">Plays the payoff first, then rewinds to the start.</p>
        {co.start != null && (
          <div className="flex items-center gap-1.5 flex-wrap text-[11.5px]">
            <button type="button" className="font-mono text-accent hover:underline h-9" onClick={() => seekTo(co.start)}>{clipT(co.start)}</button>
            <span className="text-muted">→</span>
            <button type="button" className="font-mono text-accent hover:underline h-9" onClick={() => seekTo(co.end)}>{clipT(co.end)}</button>
            <span className="text-muted">({(co.end - co.start).toFixed(1)}s)</span>
            <Button size="sm" variant="ghost" onClick={() => change((p) => { const t = playhead(); p.cold_open = { ...co, on: true, start: t, end: Math.min(end, Math.max(t + 0.8, co.end ?? t + 1.8)), by: 'user' }; })}>Start here</Button>
            <Button size="sm" variant="ghost" onClick={() => change((p) => { const t = playhead(); p.cold_open = { ...co, on: true, end: t, start: Math.min(co.start ?? t - 1.8, t - 0.8), by: 'user' }; })}>End here</Button>
          </div>
        )}
      </Section>

      <Section icon={ZoomIn} title="Zooms" count={`${zooms.filter((z) => z.on !== false).length}/${zooms.length}`}
        action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => addItem('zooms', { id: newId('z'), t: +playhead().toFixed(3), amount: 0.22, on: true, by: 'user' })}>At playhead</Button>}>
        <Select value={plan.zoom_target?.layer || '__frame'} aria-label="What zooms" className="!h-9 !text-[12px]"
          onChange={(e) => change((p) => {
            const l = (data.layers || []).find((x) => x.id === e.target.value);
            p.zoom_target = l ? { layer: l.id, name: l.name } : null;
          })}>
          {(data.layers || []).map((l) => <option key={l.id} value={l.id}>Zoom the {l.name} box</option>)}
          <option value="__frame">Zoom the whole frame</option>
        </Select>
        {zooms.map((z) => (
          <Row key={z.id} item={z} time={clipT(z.t)} onSeek={() => seekTo(z.t)} onToggle={(v) => setItem('zooms', z.id, { on: v })} onDelete={() => removeItem('zooms', z.id)}>
            <Select value={String(nearest(STRENGTHS.map((s) => s.value), Number(z.amount || 0.2)))} aria-label="Zoom strength" className="!h-8 !w-auto !text-[11.5px]"
              onChange={(e) => setItem('zooms', z.id, { amount: Number(e.target.value) })}>
              {STRENGTHS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            {z.by === 'ai' && <Sparkles size={11} className="text-accent" />}
          </Row>
        ))}
      </Section>

      <Section icon={Type} title="Emphasised words" count={`${emph.filter((x) => x.on !== false).length}/${emph.length}`}
        action={<Button size="sm" variant="ghost" icon={Plus} disabled={!words.length} onClick={() => {
          const t = playhead();
          const w = words.reduce((best, x) => (Math.abs(x.start - t) < Math.abs((best?.start ?? 1e9) - t) ? x : best), null);
          if (w && Math.abs(w.start - t) < 1.5 && !emph.some((e) => Math.abs(e.t - w.start) < 0.05)) {
            addItem('emphasis', { id: newId('e'), t: +Number(w.start).toFixed(3), word: (w.word || '').trim(), on: true, by: 'user' });
          }
        }}>Word at playhead</Button>}>
        {emph.length === 0 && <p className="text-[11.5px] text-muted">No key words. Move the playhead onto a word and add it.</p>}
        {emph.map((e) => (
          <Row key={e.id} item={e} time={clipT(e.t)} onSeek={() => seekTo(e.t)} onToggle={(v) => setItem('emphasis', e.id, { on: v })} onDelete={() => removeItem('emphasis', e.id)}>
            <span className="text-[12.5px] font-bold text-[#FF3B5C] truncate">{(e.word || '').toUpperCase()}</span>
          </Row>
        ))}
      </Section>

      <Section icon={Music2} title="Sound effects" count={`${sfx.filter((x) => x.on !== false).length}/${sfx.length}`}
        action={(
          <div className="flex items-center gap-1">
            <Select value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="New sound type" className="!h-8 !w-auto !text-[11.5px]">
              {CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => addItem('sfx', { id: newId('s'), t: +playhead().toFixed(3), cat: newCat, vol: 0.3, on: true, by: 'user' })}>Add</Button>
          </div>
        )}>
        {sfx.length === 0 && <p className="text-[11.5px] text-muted">No sound effects.</p>}
        {sfx.map((s) => (
          <Row key={s.id} item={s} time={clipT(s.t)} onSeek={() => seekTo(s.t)} onToggle={(v) => setItem('sfx', s.id, { on: v })} onDelete={() => removeItem('sfx', s.id)}>
            <Select value={s.cat} aria-label="Sound type" className="!h-8 !w-auto !text-[11.5px]" onChange={(e) => setItem('sfx', s.id, { cat: e.target.value, file: undefined })}>
              {CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            {(lib[s.cat] || []).length > 1 && (
              <Select value={s.file || ''} aria-label="Sound file" className="!h-8 !w-auto !max-w-[120px] !text-[11.5px]" onChange={(e) => setItem('sfx', s.id, { file: e.target.value || undefined })}>
                <option value="">Any</option>
                {lib[s.cat].map((f) => <option key={f} value={f}>{f.split('/').pop()}</option>)}
              </Select>
            )}
            <Select value={String(nearest(VOLS, Number(s.vol || 0.3)))} aria-label="Volume" className="!h-8 !w-auto !text-[11.5px]" onChange={(e) => setItem('sfx', s.id, { vol: Number(e.target.value) })}>
              {VOLS.map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
            </Select>
            {(lib[s.cat] || []).length === 0 && <span className="text-[10.5px] text-warn">no {s.cat} sounds uploaded</span>}
          </Row>
        ))}
      </Section>

      {error && <Notice tone="bad">{error}</Notice>}
      {busy && <Notice tone="accent" icon={Loader2}>{busy} This takes about a minute.</Notice>}
      <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 bg-surface/95 backdrop-blur flex items-center gap-2 border-t border-line">
        <Button size="sm" variant="ghost" icon={Undo2} disabled={!history.length || !!busy} onClick={undo}>Undo</Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!!busy || !data.source_available} onClick={() => setConfirmReset(true)}>Reset</Button>
        <Button className="ml-auto" variant="primary" icon={Wand2} loading={!!busy} disabled={!dirty || !data.source_available} onClick={() => apply(false)} data-testid="apply-plan">
          {dirty ? 'Apply changes' : 'No changes'}
        </Button>
      </div>
      <Confirm open={confirmReset} title="Reset to the automatic edit?" confirmLabel="Reset" danger
        text="Your changes to this clip's zooms, words, sounds and cold open are replaced by a fresh automatic edit."
        onConfirm={() => apply(true)} onCancel={() => setConfirmReset(false)} />
    </div>
  );
}
