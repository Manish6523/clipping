import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Terminal, Trash2, ArrowDown, Search, Pause, Play } from 'lucide-react';
import { getLogs } from '../api';
import { Page, Panel, Button, Segmented, Input, Toggle, EmptyState } from './ui';

const COMP_COLOR = {
  LIVE: '#f87171', AI: '#9085e9', RENDER: '#2a78d6', BOT: '#34d399', PUBLISH: '#fbbf24', VOD: '#e87ba4', WEB: '#9b9a92', CORE: '#9b9a92',
};
const LEVELS = [
  { value: 'ALL', label: 'All' },
  { value: 'WARNING', label: 'Warnings' },
  { value: 'ERROR', label: 'Errors' },
];
const MAX_LINES = 1500;

export default function LogStreamer() {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState('ALL');
  const [component, setComponent] = useState('ALL');
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);
  const lastIdRef = useRef(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    let alive = true;
    const fetchLogs = async () => {
      if (pausedRef.current) return;
      try {
        const newLogs = await getLogs(lastIdRef.current);
        if (!alive || !newLogs?.length) return;
        lastIdRef.current = Math.max(...newLogs.map((l) => l.id), lastIdRef.current);
        setLogs((prev) => {
          const seen = new Set(prev.map((l) => l.id));
          const merged = [...prev, ...newLogs.filter((l) => !seen.has(l.id))];
          return merged.length > MAX_LINES ? merged.slice(-MAX_LINES) : merged;
        });
      } catch (err) {
        console.error('Failed to stream logs:', err);
      }
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 1500);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  const components = useMemo(() => ['ALL', ...Array.from(new Set(logs.map((l) => l.component))).sort()], [logs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => (level === 'ALL' || (level === 'ERROR' ? l.level === 'ERROR' : l.level === 'WARNING' || l.level === 'ERROR'))
      && (component === 'ALL' || l.component === component)
      && (!q || l.message.toLowerCase().includes(q)));
  }, [logs, level, component, query]);

  useEffect(() => {
    const el = boxRef.current;
    if (autoScroll && el) el.scrollTop = el.scrollHeight;
  }, [shown, autoScroll]);

  const counts = useMemo(() => ({
    errors: logs.filter((l) => l.level === 'ERROR').length,
    warnings: logs.filter((l) => l.level === 'WARNING').length,
  }), [logs]);

  return (
    <Page title="Live logs" icon={Terminal}
      subtitle="Real-time output from Whisper, Gemini, the stream recorder and FFmpeg."
      actions={(
        <>
          <Button size="sm" icon={paused ? Play : Pause} onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="sm" icon={Trash2} onClick={() => setLogs([])}>Clear</Button>
        </>
      )}>
      <Panel pad={false} className="overflow-hidden">
        <div className="p-3 border-b border-line flex flex-wrap items-center gap-2">
          <Segmented size="sm" value={level} onChange={setLevel} ariaLabel="Level"
            options={LEVELS.map((l) => ({ ...l, count: l.value === 'ERROR' ? counts.errors : l.value === 'WARNING' ? counts.warnings : undefined }))} />
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the log…" className="!h-8 !pl-8 text-[13px]" aria-label="Search logs" />
          </div>
          <div className="w-full sm:w-auto"><Toggle checked={autoScroll} onChange={setAutoScroll} label="Follow" /></div>
        </div>
        <div className="px-3 py-2 border-b border-line flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Component">
          {components.map((c) => (
            <button key={c} type="button" onClick={() => setComponent(c)} aria-pressed={component === c}
              className={`shrink-0 rounded-md px-2 h-6 text-[10.5px] font-semibold ${component === c ? 'bg-white/[0.14] text-ink' : 'bg-white/[0.04] text-muted hover:text-ink'}`}>
              {c !== 'ALL' && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: COMP_COLOR[c] || '#9b9a92' }} />}
              {c === 'ALL' ? 'All sources' : c}
            </button>
          ))}
        </div>

        <div ref={boxRef} onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight > 80 && autoScroll) setAutoScroll(false); }}
          className="relative bg-canvas font-mono text-[11.5px] h-[calc(100dvh-330px)] sm:h-[calc(100dvh-300px)] min-h-[320px] overflow-y-auto p-3 space-y-1">
          {shown.length === 0 ? (
            <EmptyState icon={Terminal} title={logs.length ? 'No lines match' : 'Waiting for logs…'} text={logs.length ? 'Try another level or clear the search.' : 'The daemon will print here as soon as something happens.'} />
          ) : shown.map((log) => (
            <div key={log.id} className="flex items-baseline gap-2 leading-relaxed">
              <span className="text-faint shrink-0 tabular-nums text-[10.5px]">{log.time}</span>
              <span className="shrink-0 w-[52px] text-[10px] font-semibold tracking-wide" style={{ color: COMP_COLOR[log.component] || '#9b9a92' }}>{log.component}</span>
              <span className={`break-words min-w-0 ${log.level === 'ERROR' ? 'text-bad font-semibold' : log.level === 'WARNING' ? 'text-warn' : 'text-slate-300'}`}>{log.message}</span>
            </div>
          ))}
          {!autoScroll && shown.length > 0 && (
            <button type="button" onClick={() => setAutoScroll(true)}
              className="sticky bottom-0 ml-auto flex items-center gap-1 rounded-full bg-accent-strong text-white text-[11px] font-semibold px-3 h-8 shadow-lg">
              <ArrowDown size={13} /> Jump to latest
            </button>
          )}
        </div>
      </Panel>
    </Page>
  );
}
