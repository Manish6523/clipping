import React from 'react';
import { Undo2 } from 'lucide-react';
import { REASONS } from './model';

/** Undo for the last approve / reject (+ optional reject reason), and short toasts. Sits above the phone tab bar. */
export default function UndoBar({ actions }) {
  const { pending, toast, undo, setReason } = actions;
  const bottom = { bottom: 'calc(76px + var(--safe-bottom))' };
  if (pending) {
    return (
      <div role="status" data-testid="undo-bar"
        className="fixed inset-x-3 md:left-auto md:right-6 md:bottom-6 md:w-[420px] z-[70] rounded-2xl bg-surface/95 backdrop-blur border border-line-strong shadow-2xl p-3 ds-sheet"
        style={window.matchMedia?.('(min-width: 768px)').matches ? undefined : bottom}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-ink font-semibold min-w-0 truncate">
            {pending.type === 'reject' ? 'Rejected' : 'Approved'} #{pending.clip.id} · {pending.clip.title}
          </span>
          <button type="button" onClick={undo} className="flex items-center gap-1 px-3 h-10 rounded-xl bg-white/10 text-ink text-xs font-semibold shrink-0">
            <Undo2 size={14} /> Undo
          </button>
        </div>
        {pending.type === 'reject' && (
          <div className="mt-2">
            <p className="text-[11px] text-muted mb-1.5">Why? (optional - teaches the AI)</p>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r.code} type="button" onClick={() => setReason(r.code)}
                  className="px-3 h-9 rounded-xl bg-white/[0.07] text-xs text-slate-200 hover:bg-bad/25 active:bg-bad/30">{r.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  if (!toast) return null;
  return (
    <div role="status" className={`fixed inset-x-6 md:left-auto md:right-6 md:bottom-6 md:w-[380px] z-[70] rounded-xl px-3 py-2 text-sm text-center shadow-xl ${
      toast.tone === 'error' ? 'bg-bad text-canvas font-semibold' : toast.tone === 'ok' ? 'bg-good text-canvas font-semibold' : 'bg-raised text-ink border border-line-strong'}`}
      style={window.matchMedia?.('(min-width: 768px)').matches ? undefined : bottom}>
      {toast.msg}
    </div>
  );
}
