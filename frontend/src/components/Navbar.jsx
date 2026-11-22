import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Loader2, ChevronDown } from 'lucide-react';
import { NAV } from './nav';
import { Dot, Progress, Stat } from './ui';

const STEPS = 5;

function PipelineList({ pipes }) {
  return (
    <div className="space-y-2">
      {pipes.map((p) => {
        const step = Math.min(STEPS, Math.max(1, p.current_step || 1));
        return (
          <div key={p.channel_id} className="rounded-xl bg-white/[0.04] p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="font-semibold text-ink truncate">@{p.channel_id}</span>
              <span className="text-[10.5px] text-warn tabular-nums shrink-0">Step {step}/{STEPS}</span>
            </div>
            <Progress value={(step / STEPS) * 100} tone="warn" />
            <p className="text-[11px] text-muted break-words">{p.step_name || 'Processing…'}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Right side of the top bar: what the daemon is doing right now. Click/tap for details. */
function StatusPill({ status, pipes }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const running = pipes.length > 0;
  const primary = pipes[0];
  const pending = status.pending_clips_count || 0;
  const tone = running ? 'warn' : 'good';

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        className="flex items-center gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-[11.5px] sm:text-xs text-ink transition-all shadow-sm active:scale-95 max-w-[180px] sm:max-w-none">
        {running ? <Loader2 size={13} className="animate-spin text-warn shrink-0" /> : <Dot tone={tone} live />}
        <span className="truncate font-medium">
          {running ? `@${primary?.channel_id || 'clip'}` : pending > 0 ? `${pending} to review` : 'Daemon active'}
        </span>
        {running && <span className="text-warn tabular-nums text-[10.5px] hidden sm:inline">{Math.min(STEPS, primary?.current_step || 1)}/{STEPS}</span>}
        {running && pipes.length > 1 && <span className="text-[10px] rounded-full bg-warn/20 text-warn px-1.5 font-bold">+{pipes.length - 1}</span>}
        <ChevronDown size={12} className={`text-muted transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="dialog" className="ds-fade absolute right-0 top-full mt-2 w-[min(340px,calc(100vw-24px))] z-50 rounded-2xl bg-surface border border-line-strong shadow-2xl p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="To review" value={status.pending_clips_count || 0} />
            <Stat label="Queued" value={status.queued_count || 0} />
            <Stat label="Published" value={status.published_count || 0} />
          </div>
          {running ? <PipelineList pipes={pipes} /> : <p className="text-xs text-muted text-center py-1">Nothing is rendering right now.</p>}
          <div className="flex gap-2">
            <NavLink to="/channels" className="flex-1 text-center py-2 rounded-xl bg-white/[0.06] text-xs font-semibold text-ink hover:bg-white/[0.1]">Channels ({status.channels_count || 0})</NavLink>
            <NavLink to="/pipelines" className="flex-1 text-center py-2 rounded-xl bg-white/[0.06] text-xs font-semibold text-ink hover:bg-white/[0.1]">Pipelines →</NavLink>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Navbar({ pendingCount = 0, activePipelines = [], status = {} }) {
  return (
    <header className="sticky top-0 z-50 h-14 border-b border-line bg-canvas/90 backdrop-blur-md select-none">
      <div className="h-full w-full px-3 sm:px-5 flex items-center gap-3">
        <NavLink to="/" className="flex min-h-[44px] min-w-[44px] items-center gap-2.5 shrink-0" aria-label="AutoClip home">
          <img src="/logo.png" alt="" className="w-8 h-8 rounded-xl object-cover border border-line-strong" />
          <span className="font-bold text-[15px] tracking-tight text-ink hidden min-[400px]:inline">AutoClip</span>
        </NavLink>

        {/* Desktop navigation: icons + labels on wide screens, icons (active shows its label) in between */}
        <nav aria-label="Main" className="hidden md:flex items-center gap-0.5 mx-auto min-w-0 overflow-x-auto no-scrollbar">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.end} title={item.label}
                className={({ isActive }) => `relative shrink-0 flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-[12.5px] font-medium transition-colors ${
                  isActive ? 'bg-white/[0.09] text-ink' : 'text-muted hover:text-ink hover:bg-white/[0.05]'}`}>
                {({ isActive }) => (
                  <>
                    <Icon size={15} className={isActive ? 'text-accent' : ''} />
                    <span className={isActive ? 'inline' : 'hidden xl:inline'}>{item.label}</span>
                    {item.to === '/channels' && (status.live_channels_count > 0 || status.channels_count > 0) && (
                      <span className={`inline-flex items-center gap-1 min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold leading-none tabular-nums shadow-sm ${
                        status.live_channels_count > 0 ? 'bg-red-500 text-white animate-pulse' : 'bg-white/10 text-slate-300'
                      }`}>
                        {status.live_channels_count > 0 && <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />}
                        {status.live_channels_count > 0 ? `${status.live_channels_count} live` : (status.channels_count || 0)}
                      </span>
                    )}
                    {item.badge && pendingCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent-strong text-white text-[10px] font-bold leading-[18px] text-center tabular-nums">{pendingCount > 99 ? '99+' : pendingCount}</span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto md:ml-0 shrink-0">
          <StatusPill status={status} pipes={activePipelines} />
        </div>
      </div>
    </header>
  );
}
