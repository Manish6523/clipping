import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, Save, EllipsisVertical, Check, Loader2, Layers, Type, Sparkles, Stamp, Palette, LayoutTemplate,
} from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');

/** The only bar at the top of the phone Studio: back, name (tap to rename), undo, redo, Save, overflow. */
export function PhoneTopBar({ name, dirty, saved, canUndo, canRedo, onBack, onRename, onUndo, onRedo, onSave, menu }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== name) onRename(v); else setDraft(name); };
  const IconBtn = ({ label, onClick, disabled, children }) => (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-200 active:bg-white/10 disabled:opacity-30">{children}</button>
  );

  return (
    <header data-testid="studio-topbar" className="relative z-40 flex h-[48px] shrink-0 items-center gap-0.5 border-b border-white/10 bg-surface px-1">
      <IconBtn label="Back to templates" onClick={onBack}><ArrowLeft size={19} /></IconBtn>
      <div className="min-w-0 flex-1 px-1">
        {editing ? (
          <input
            ref={inputRef} value={draft} aria-label="Template name" onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(name); } }}
            className="h-[36px] w-full rounded-lg border border-accent/50 bg-canvas px-2 font-mono text-[14px] font-semibold text-ink outline-none"
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)} aria-label={`Rename template ${name}`} className="flex h-[44px] w-full min-w-0 items-center gap-1.5 text-left">
            <span className="min-w-0 truncate font-mono text-[14px] font-semibold text-ink">{name || 'Untitled'}</span>
            {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-warn" title="Unsaved changes" aria-label="Unsaved changes" />}
          </button>
        )}
      </div>
      <IconBtn label="Undo" onClick={onUndo} disabled={!canUndo}><Undo2 size={18} /></IconBtn>
      <IconBtn label="Redo" onClick={onRedo} disabled={!canRedo}><Redo2 size={18} /></IconBtn>
      <button
        type="button" onClick={onSave} data-testid="save-button"
        className="mx-0.5 flex h-[44px] min-w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent-strong px-3 text-[13px] font-semibold text-white active:bg-[#256abf]"
      >
        {saved ? <Check size={15} /> : <Save size={15} />}{saved ? 'Saved' : 'Save'}
      </button>
      <IconBtn label="More actions" onClick={() => setOpen(!open)}><EllipsisVertical size={18} /></IconBtn>

      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" data-testid="overflow-menu" className="absolute right-1 top-[46px] z-50 w-64 rounded-2xl border border-white/15 bg-[#0e1118] p-1 shadow-2xl">
            {menu.map((m, i) => (
              <React.Fragment key={m.label}>
                {m.divider && i > 0 && <div className="my-1 h-px bg-white/10" />}
                <button
                  type="button" role="menuitem" disabled={m.disabled}
                  onClick={() => { setOpen(false); m.run(); }}
                  className={cx('flex h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-[13.5px] font-medium active:bg-white/10 disabled:opacity-40', m.danger ? 'text-bad' : 'text-slate-100')}
                >
                  {m.loading ? <Loader2 size={16} className="animate-spin" /> : <m.icon size={16} />}{m.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </header>
  );
}

export const DOCK_ITEMS = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'captions', label: 'Captions', icon: Type },
  { id: 'hook', label: 'Hook', icon: Sparkles },
  { id: 'watermark', label: 'Watermark', icon: Stamp },
  { id: 'background', label: 'Background', icon: Palette },
  { id: 'template', label: 'Template', icon: LayoutTemplate },
];

/** The single fixed bottom element: horizontal dock (portrait) or vertical rail (landscape). */
export function PhoneDock({ active, onPick, landscape = false }) {
  return (
    <nav
      data-testid="studio-dock" aria-label="Studio tools"
      className={cx(
        'relative z-40 flex shrink-0 overflow-auto border-white/10 bg-surface no-scrollbar',
        landscape ? 'w-[56px] flex-col border-r' : 'h-[56px] flex-row border-t',
      )}
      style={landscape ? undefined : { paddingBottom: 'env(safe-area-inset-bottom)', height: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      {DOCK_ITEMS.map((d) => {
        const on = active === d.id;
        return (
          <button
            key={d.id} type="button" onClick={() => onPick(d.id)} aria-pressed={on} aria-label={d.label}
            className={cx('flex shrink-0 flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold transition-colors',
              landscape ? 'h-[56px] w-[56px]' : 'h-[56px] min-w-[56px] flex-1', on ? 'text-accent' : 'text-muted active:text-ink')}
          >
            <span className={cx('flex h-6 w-[44px] items-center justify-center rounded-full', on && 'bg-accent/15')}><d.icon size={18} /></span>
            {d.label}
          </button>
        );
      })}
    </nav>
  );
}
