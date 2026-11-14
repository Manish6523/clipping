import React, { useEffect, useId, useRef } from 'react';
import { Loader2, X, Check } from 'lucide-react';

/**
 * AutoClip "Pulse" design system - the building blocks every page uses.
 * Tokens live in index.css (@theme): canvas, surface, raised, line, ink, muted, accent, good, warn, bad, idle.
 */

export const TONES = {
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  bad: 'var(--color-bad)',
  idle: 'var(--color-idle)',
  accent: 'var(--color-accent)',
};

const cx = (...c) => c.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ layout */

export function Page({ title, icon: Icon, subtitle, actions, children, className = '', narrow = false }) {
  return (
    <div className={cx('mx-auto w-full px-3 sm:px-5 pt-4 pb-8 space-y-3', narrow ? 'max-w-3xl' : 'max-w-[1500px]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-[18px] sm:text-[20px] font-bold text-ink flex items-center gap-2 leading-tight">
              {Icon && <Icon size={20} className="text-accent shrink-0" />}
              <span className="truncate">{title}</span>
            </h1>
            {subtitle && <p className="text-[11.5px] sm:text-xs text-muted mt-0.5 max-w-2xl">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  );
}

export function Panel({ title, icon: Icon, right, children, className = '', pad = true, tone, id, ...rest }) {
  return (
    <section id={id} {...rest}
      className={cx('rounded-2xl border bg-surface', tone === 'bad' ? 'border-bad/40' : tone === 'warn' ? 'border-warn/30' : tone === 'accent' ? 'border-accent/30' : 'border-line',
        pad && 'p-3.5 sm:p-4', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 mb-3 min-h-[24px]">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink min-w-0">
            {Icon && <Icon size={15} className="text-muted shrink-0" />}
            <span className="truncate">{title}</span>
          </h2>
          {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Divider({ className = '' }) {
  return <div className={cx('h-px bg-line', className)} />;
}

/* ------------------------------------------------------------------ status */

export function Dot({ tone = 'idle', live = false, className = '' }) {
  return (
    <span className={cx('inline-block w-1.5 h-1.5 rounded-full shrink-0', live && 'ds-live-dot', className)}
      style={{ background: TONES[tone] || tone }} />
  );
}

export function Pill({ tone = 'idle', children, dot = true, className = '', title }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-ink whitespace-nowrap', className)}>
      {dot && <Dot tone={tone} />}
      {children}
    </span>
  );
}

export function Badge({ tone = 'accent', children, className = '' }) {
  const color = TONES[tone] || tone;
  return (
    <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums', className)}
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone, icon: Icon, className = '' }) {
  return (
    <div className={cx('rounded-xl border border-line bg-surface px-3 py-2.5 min-w-0', className)}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {Icon && <Icon size={13} className="shrink-0" />}
        <span className="truncate">{label}</span>
        {tone && <span className="ml-auto"><Dot tone={tone} /></span>}
      </div>
      <div className="text-[17px] font-semibold text-ink tabular-nums leading-tight mt-0.5 truncate">{value}</div>
      {sub != null && <div className="text-[10.5px] text-muted truncate">{sub}</div>}
    </div>
  );
}

export function Meter({ label, value = 0, max = 1, mark, display, hint, tone }) {
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  const reached = mark != null && value >= mark;
  const color = tone ? TONES[tone] : reached ? TONES.warn : TONES.accent;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px] mb-1 gap-2">
        <span className="text-muted">{label}</span>
        <span className="text-ink font-semibold tabular-nums">{display}</span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: color }} />
        {mark != null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-white/70 rounded" style={{ left: `calc(${Math.min(1, mark / (max || 1)) * 100}% - 1px)` }} />}
      </div>
      {hint && <p className="text-[10.5px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

export function Progress({ value = 0, tone = 'accent', className = '' }) {
  return (
    <div className={cx('h-1.5 rounded-full bg-white/[0.07] overflow-hidden', className)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: TONES[tone] }} />
    </div>
  );
}

/* ------------------------------------------------------------------ controls */

const BTN = {
  primary: 'bg-accent-strong text-white hover:bg-[#3987e5] active:bg-[#256abf]',
  secondary: 'bg-white/[0.07] text-ink hover:bg-white/[0.11] active:bg-white/[0.14]',
  ghost: 'text-muted hover:text-ink hover:bg-white/[0.06]',
  danger: 'bg-bad/15 text-bad hover:bg-bad/25',
  good: 'bg-good/15 text-good hover:bg-good/25',
  warn: 'bg-warn/15 text-warn hover:bg-warn/25',
};
const BTN_SIZE = { sm: 'h-8 px-2.5 text-xs gap-1.5', md: 'h-10 px-3.5 text-[13px] gap-2', lg: 'h-12 px-5 text-sm gap-2' };

export const Button = React.forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading = false, block = false, className = '', children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center rounded-xl font-semibold transition-colors select-none disabled:opacity-45',
        BTN[variant], BTN_SIZE[size], block && 'w-full', className)} {...rest}>
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 13 : 15} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', className = '', ...rest }) {
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  return (
    <button type="button" aria-label={label} title={label}
      className={cx('inline-flex items-center justify-center rounded-xl transition-colors disabled:opacity-45', dim, BTN[variant], className)} {...rest}>
      <Icon size={size === 'sm' ? 15 : 17} />
    </button>
  );
}

/** Segmented control / filter tabs. options: [{ value, label, icon?, count? }] */
export function Segmented({ value, onChange, options, size = 'md', className = '', ariaLabel, scroll = true }) {
  return (
    <div role="tablist" aria-label={ariaLabel}
      className={cx('inline-flex rounded-xl bg-white/[0.05] p-0.5 max-w-full', scroll && 'overflow-x-auto no-scrollbar', className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button key={String(o.value)} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={cx('shrink-0 inline-flex items-center gap-1.5 rounded-[10px] font-semibold transition-colors whitespace-nowrap',
              size === 'sm' ? 'h-7 px-2.5 text-[11.5px]' : 'h-9 px-3 text-xs',
              on ? 'bg-white/[0.12] text-ink shadow-sm' : 'text-muted hover:text-ink')}>
            {Icon && <Icon size={13} />}
            {o.label}
            {o.count != null && <span className={cx('tabular-nums text-[10.5px] rounded-full px-1.5', on ? 'bg-white/10' : 'bg-white/[0.05]')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

const FIELD_BASE = 'w-full rounded-xl border border-line bg-canvas text-ink placeholder:text-faint px-3 transition-colors focus:border-accent/60 focus:outline-none disabled:opacity-50';

export const Input = React.forwardRef(function Input({ className = '', mono = false, ...rest }, ref) {
  return <input ref={ref} className={cx(FIELD_BASE, 'h-10', mono && 'font-mono', className)} {...rest} />;
});

export const Select = React.forwardRef(function Select({ className = '', children, ...rest }, ref) {
  return <select ref={ref} className={cx(FIELD_BASE, 'h-10 pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%277%27 fill=%27none%27%3E%3Cpath d=%27M1 1l5 5 5-5%27 stroke=%27%239b9a92%27 stroke-width=%271.6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_12px_center]', className)} {...rest}>{children}</select>;
});

export const Textarea = React.forwardRef(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={cx(FIELD_BASE, 'py-2.5 min-h-[88px] resize-y', className)} {...rest} />;
});

export function Field({ label, hint, error, children, className = '', right }) {
  const id = useId();
  const child = React.isValidElement(children) && !children.props.id ? React.cloneElement(children, { id }) : children;
  return (
    <div className={cx('space-y-1.5', className)}>
      {(label || right) && (
        <div className="flex items-center justify-between gap-2">
          {label && <label htmlFor={id} className="text-xs font-semibold text-slate-300">{label}</label>}
          {right}
        </div>
      )}
      {child}
      {error ? <p className="text-[11px] text-bad">{error}</p> : hint ? <p className="text-[11px] text-muted leading-snug">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={cx('flex items-center justify-between gap-3 select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] text-ink">{label}</span>}
          {hint && <span className="block text-[11px] text-muted leading-snug">{hint}</span>}
        </span>
      )}
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative shrink-0 w-11 h-6 rounded-full transition-colors', checked ? 'bg-accent-strong' : 'bg-white/[0.14]')}>
        <span className={cx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className = '' }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)}
      className={cx('inline-flex items-center gap-2 text-[13px] text-ink', className)}>
      <span className={cx('w-4.5 h-4.5 w-[18px] h-[18px] rounded-md border flex items-center justify-center', checked ? 'bg-accent-strong border-accent-strong' : 'border-line-strong bg-canvas')}>
        {checked && <Check size={12} className="text-white" />}
      </span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ feedback */

export function EmptyState({ icon: Icon, title, text, action, className = '' }) {
  return (
    <div className={cx('py-10 px-4 text-center space-y-2', className)}>
      {Icon && <Icon size={28} className="mx-auto text-faint" />}
      {title && <p className="text-[13px] font-semibold text-ink">{title}</p>}
      {text && <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">{text}</p>}
      {action && <div className="pt-1 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 20, className = '' }) {
  return <Loader2 size={size} className={cx('animate-spin text-muted', className)} />;
}

export function Skeleton({ className = '' }) {
  return <div className={cx('rounded-xl bg-white/[0.04] animate-pulse', className)} />;
}

export function Notice({ tone = 'accent', icon: Icon, children, className = '' }) {
  const color = TONES[tone] || tone;
  return (
    <div className={cx('flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-snug', className)}
      style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, color: 'var(--color-ink)', border: `1px solid color-mix(in srgb, ${color} 25%, transparent)` }}>
      {Icon && <Icon size={14} className="shrink-0 mt-px" style={{ color }} />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({ open, onClose, title, children, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm ds-fade flex items-end sm:items-center justify-center" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => e.stopPropagation()}
        className={cx('ds-sheet w-full bg-surface border border-line-strong shadow-2xl outline-none flex flex-col max-h-[88dvh]',
          'rounded-t-3xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="sm:hidden mx-auto mt-2 mb-1 w-10 h-1.5 rounded-full bg-white/15 shrink-0" />
        {title && (
          <div className="flex items-center justify-between gap-2 px-4 pt-2 sm:pt-4 pb-2 shrink-0">
            <h3 className="text-[15px] font-semibold text-ink truncate">{title}</h3>
            <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
          </div>
        )}
        <div className="overflow-y-auto px-4 pb-4 flex-1 min-h-0">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-line shrink-0" style={{ paddingBottom: 'calc(12px + var(--safe-bottom))' }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Simple confirm dialog (replaces window.confirm so it works in installed apps). */
export function Confirm({ open, title, text, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      {text && <p className="text-[13px] text-muted leading-relaxed mb-4">{text}</p>}
      <div className="flex gap-2">
        <Button block onClick={onCancel}>Cancel</Button>
        <Button block variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ formatting helpers */

export const fmtDur = (s) => {
  if (s == null || Number.isNaN(s)) return '—';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
export const timeAgo = (iso) => {
  if (!iso) return '—';
  const t = typeof iso === 'number' ? iso : Date.parse(String(iso).includes('T') || String(iso).includes('Z') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
