import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Film, 
  Palette, 
  Radio, 
  Calendar, 
  Terminal, 
  Zap, 
  Share2,
  Flame,
  Settings,
  Loader2,
  ChevronDown
} from 'lucide-react';

function MobileStatusPill({ status = {}, activePipelines = [] }) {
  const [open, setOpen] = useState(false);
  const running = activePipelines.length > 0;
  const primary = activePipelines[0];
  const pending = status.pending_clips_count || 0;

  let pill;
  if (running) {
    pill = (
      <span className="flex items-center gap-1.5 text-amber-300">
        <Loader2 size={13} className="animate-spin" />
        <span className="max-w-[90px] truncate">@{primary?.channel_id || 'clip'}</span>
        <span className="font-mono text-[10px] text-amber-400/80">{Math.min(5, primary?.current_step || 1)}/5</span>
      </span>
    );
  } else if (pending > 0) {
    pill = <span className="text-[#8FD3FF]">🎬 {pending} to review</span>;
  } else {
    pill = (
      <span className="flex items-center gap-1.5 text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Idle
      </span>
    );
  }

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-[11px] font-bold ${
          running ? 'border-amber-500/40 bg-amber-500/10' : pending > 0 ? 'border-[#8FD3FF]/30 bg-[#8FD3FF]/10' : 'border-emerald-500/30 bg-emerald-500/10'
        }`}
      >
        {pill}
        <ChevronDown size={12} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[min(320px,calc(100vw-24px))] z-50 rounded-2xl bg-[#0D111A]/98 backdrop-blur-xl border border-white/10 shadow-2xl p-3 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['To review', status.pending_clips_count || 0, 'text-[#8FD3FF]'],
                ['Queued', status.queued_count || 0, 'text-emerald-300'],
                ['Published', status.published_count || 0, 'text-violet-300'],
              ].map(([label, val, cls]) => (
                <div key={label} className="rounded-xl bg-white/[0.04] border border-white/[0.06] py-2">
                  <div className={`text-lg font-black ${cls}`}>{val}</div>
                  <div className="text-[10px] text-slate-400">{label}</div>
                </div>
              ))}
            </div>
            {running ? (
              <div className="space-y-2">
                {activePipelines.map((pipe) => {
                  const step = Math.min(5, Math.max(1, pipe.current_step || 1));
                  return (
                    <div key={pipe.channel_id} className="rounded-xl bg-black/40 border border-amber-500/20 p-2.5 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="font-bold text-white">@{pipe.channel_id}</span>
                        <span className="font-mono text-amber-400 text-[10px]">Step {step}/5</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-amber-400" style={{ width: `${step * 20}%` }} />
                      </div>
                      <div className="text-[11px] text-slate-400 break-words">{pipe.step_name || 'Processing…'}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center">No clip is rendering right now.</p>
            )}
            <div className="flex gap-2">
              <NavLink to="/channels" onClick={() => setOpen(false)} className="flex-1 text-center py-2 rounded-xl bg-white/[0.05] text-xs font-bold text-slate-200">
                Channels ({status.channels_count || 0})
              </NavLink>
              <NavLink to="/pipelines" onClick={() => setOpen(false)} className="flex-1 text-center py-2 rounded-xl bg-white/[0.05] text-xs font-bold text-slate-200">
                Pipelines →
              </NavLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Navbar({ pendingCount = 0, activePipelines = [], status = {} }) {
  const [pipelineDropdownOpen, setPipelineDropdownOpen] = useState(false);

  const navItems = [
    { to: '/', label: 'Review', shortLabel: 'Review', icon: Film, badge: pendingCount, end: true },
    { to: '/templates', label: 'Templates', shortLabel: 'Templates', icon: Palette },
    { to: '/channels', label: 'Channels & Live', shortLabel: 'Channels', icon: Radio },
    { to: '/accounts', label: 'Distribution', shortLabel: 'Distribution', icon: Share2 },
    { to: '/pipelines', label: 'Pipelines', shortLabel: 'Pipelines', icon: Flame },
    { to: '/queue', label: 'Drip Queue', shortLabel: 'Queue', icon: Calendar },
    { to: '/logs', label: 'Logs', shortLabel: 'Logs', icon: Terminal },
    { to: '/quickclip', label: 'Quick Clip', shortLabel: 'Clip', icon: Zap },
    { to: '/settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
  ];

  const pipelineCount = activePipelines.length;
  const primaryPipeline = activePipelines[0] || null;

  return (
    <header className="border-b border-white/[0.08] bg-[#0A0D14]/95 backdrop-blur-md sticky top-0 z-50 select-none">
      <div className="w-full px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Left: Brand Logo */}
        <div className="flex items-center shrink-0">
          <NavLink to="/" className="flex items-center gap-2.5 group">
            <img 
              src="/logo.png" 
              alt="AutoClip Logo" 
              className="w-8 h-8 rounded-xl object-cover shadow-md shadow-violet-500/20 group-hover:scale-105 transition-all border border-white/10" 
            />
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm sm:text-base tracking-tight text-white group-hover:text-[#A78BFA] transition-colors">
                AUTOCLIP
              </span>
              <span className="text-[9px] uppercase font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-[#A78BFA] hidden sm:inline-block">
                SUITE
              </span>
            </div>
          </NavLink>
        </div>

        {/* Middle: Navigation Links (Centrally Aligned) */}
        <nav className="hidden xl:flex items-center justify-center gap-1 px-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap
                  ${isActive
                    ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                    : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
                  }
                `}
              >
                <Icon size={14} />
                <span>{item.label}</span>
                {item.badge > 0 && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold bg-[#8FD3FF]/20 text-[#8FD3FF] border border-[#8FD3FF]/30">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Compact Navigation for medium screens */}
        <nav className="hidden md:flex xl:hidden items-center justify-center gap-1 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) => `
                  flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap
                  ${isActive
                    ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                    : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
                  }
                `}
              >
                <Icon size={14} />
                <span>{item.shortLabel}</span>
                {item.badge > 0 && (
                  <span className="text-[9px] px-1 py-0.2 rounded-full font-mono font-bold bg-[#8FD3FF]/20 text-[#8FD3FF]">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Right: Status Pill, Daemon Active, and Mobile Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          {/* In-Navbar Active Pipelines Pill with Hover Dropdown */}
          {pipelineCount > 0 && (
            <div
              className="relative hidden md:block"
              onMouseEnter={() => setPipelineDropdownOpen(true)}
              onMouseLeave={() => setPipelineDropdownOpen(false)}
            >
              <button
                type="button"
                onClick={() => setPipelineDropdownOpen((o) => !o)}
                className="flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3 py-1 rounded-xl text-xs transition-all shadow-lg shadow-amber-500/5 cursor-pointer group"
              >
                <div className="flex items-center gap-1.5">
                  <Loader2 size={13} className="text-amber-400 animate-spin" />
                  <span className="font-extrabold text-amber-300">
                    @{primaryPipeline?.channel_id || 'streamer'}
                  </span>
                  {pipelineCount > 1 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-400/20 text-amber-300 font-mono text-[9px] font-bold border border-amber-400/30">
                      +{pipelineCount - 1}
                    </span>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-1.5 border-l border-amber-500/20 pl-2">
                  <div className="w-12 h-1.5 bg-black/40 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-500"
                      style={{ width: `${Math.round(((primaryPipeline?.current_step || 1) / 5) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-amber-400/90 font-bold">
                    Step {primaryPipeline?.current_step || 1}/5
                  </span>
                </div>

                <ChevronDown size={12} className={`text-amber-400 transition-transform ${pipelineDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Hover Flyout Dropdown showing ALL concurrent pipelines */}
              {pipelineDropdownOpen && (
                <div className="absolute right-0 top-full pt-2 w-80 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="bg-[#0D111A]/98 backdrop-blur-2xl border border-amber-500/30 rounded-2xl p-3 shadow-2xl shadow-black/90 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between px-1 pb-1 border-b border-white/[0.06] text-[10px] uppercase font-mono font-bold text-amber-400">
                      <span>Active Rendering Pipelines ({pipelineCount})</span>
                      <span className="animate-pulse">Live</span>
                    </div>

                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto custom-scrollbar pr-0.5">
                      {activePipelines.map((pipe) => {
                        const step = Math.min(5, Math.max(1, pipe.current_step || 1));
                        const pct = Math.round((step / 5) * 100);

                        return (
                          <div
                            key={pipe.channel_id}
                            className="bg-black/40 border border-white/[0.06] rounded-xl p-2.5 flex flex-col gap-1.5"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-white flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                                @{pipe.channel_id}
                              </span>
                              <span className="text-[10px] font-mono text-amber-400 font-bold">
                                Step {step} of 5 ({pct}%)
                              </span>
                            </div>

                            <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>

                            <div className="text-[10px] text-slate-400 truncate">
                              {pipe.step_name || 'Processing clip...'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <MobileStatusPill status={status} activePipelines={activePipelines} />

          {/* Daemon Active Pill */}
          <div className="hidden md:flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span>DAEMON ACTIVE</span>
          </div>

        </div>
      </div>

    </header>
  );
}
