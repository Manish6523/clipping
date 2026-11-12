import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, ArrowDown } from 'lucide-react';
import { getLogs } from '../api';

export default function LogStreamer() {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 1500);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async () => {
    try {
      const newLogs = await getLogs(lastIdRef.current);
      if (newLogs && newLogs.length > 0) {
        setLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const fresh = newLogs.filter((l) => !existingIds.has(l.id));
          return [...prev, ...fresh];
        });
        lastIdRef.current = Math.max(...newLogs.map((l) => l.id), lastIdRef.current);
        if (autoScroll && bottomRef.current) {
          bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } catch (err) {
      console.error('Failed to stream logs:', err);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const getBadgeColor = (component) => {
    switch (component) {
      case 'LIVE': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'AI': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'RENDER': return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
      case 'BOT': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'PUBLISH': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default: return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Terminal className="text-indigo-400" /> Live Logs
          </h2>
          <p className="hidden sm:block text-xs text-slate-400 mt-1">
            Real-time output from faster-whisper, Gemini AI, Streamlink, and FFmpeg render pipelines.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400 font-semibold cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-indigo-600 rounded"
            />
            Auto-scroll
          </label>
          <button
            onClick={clearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/10"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>

      <div className="bg-black/90 border border-white/10 rounded-xl p-3 sm:p-4 font-mono text-xs shadow-2xl h-[calc(100vh-210px)] min-h-[400px] overflow-y-auto flex flex-col gap-1.5 custom-scrollbar">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic text-center py-20">
            Waiting for daemon engine logs...
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={`${log.id}-${index}`} className="flex items-baseline gap-2.5 leading-relaxed">
              <span className="text-slate-600 shrink-0 font-mono text-[11px]">{log.time}</span>
              <span className={`px-1.5 py-0.2 rounded border text-[10px] font-bold tracking-wider shrink-0 ${getBadgeColor(log.component)}`}>
                {log.component}
              </span>
              <span className={`text-[11px] break-all ${
                log.level === 'ERROR' ? 'text-rose-400 font-bold' : log.level === 'WARNING' ? 'text-amber-400' : 'text-slate-300'
              }`}>
                [{log.level}] {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

