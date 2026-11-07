import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Film, 
  Palette, 
  Radio, 
  Calendar, 
  Terminal, 
  Zap, 
  Share2,
  Menu,
  X,
  Flame,
  Loader2,
  ChevronDown,
  Scissors,
  ArrowUpRight
} from 'lucide-react';

export default function Navbar({ pendingCount = 0, activePipelines = [], toasts = [], onDismissToast }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pipelineDropdownOpen, setPipelineDropdownOpen] = useState(false);
  const navigate = useNavigate();

  const navItems = [
    { to: '/', label: 'Review', shortLabel: 'Review', icon: Film, badge: pendingCount, end: true },
    { to: '/templates', label: 'Templates', shortLabel: 'Templates', icon: Palette },
    { to: '/channels', label: 'Channels & Live', shortLabel: 'Channels', icon: Radio },
    { to: '/accounts', label: 'YouTube & Distribution', shortLabel: 'Distribution', icon: Share2 },
    { to: '/queue', label: 'Drip Queue', shortLabel: 'Queue', icon: Calendar },
    { to: '/logs', label: 'Logs', shortLabel: 'Logs', icon: Terminal },
    { to: '/quickclip', label: 'Quick Clip', shortLabel: 'Clip', icon: Zap },
  ];

  const pipelineCount = activePipelines.length;
  const primaryPipeline = activePipelines[0] || null;

  return (
    <header className="border-b border-white/[0.08] bg-[#0A0D14]/95 backdrop-blur-md sticky top-0 z-50 select-none">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
        {/* Brand Logo */}
        <NavLink to="/" className="flex items-center gap-2 group shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#8FD3FF] to-[#A9B8FF] flex items-center justify-center text-[#0A0B0E] font-black text-xs shadow-md shadow-[#8FD3FF]/20 group-hover:scale-105 transition-all">
            M
          </div>
          <div className="flex items-center gap-1">
            <span className="font-extrabold text-xs sm:text-sm tracking-tight text-white group-hover:text-[#8FD3FF] transition-colors">
              AUTOCLIP
            </span>
            <span className="text-[9px] uppercase font-mono font-bold tracking-wider px-1 py-0.2 rounded bg-white/[0.06] border border-white/[0.08] text-[#8FD3FF] hidden xs:inline-block">
              SUITE
            </span>
          </div>
        </NavLink>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `
                  flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 whitespace-nowrap
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

        {/* Medium Screen Compact Navigation (Tablets / Laptops with smaller viewport) */}
        <nav className="hidden md:flex lg:hidden items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) => `
                  flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 whitespace-nowrap
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

        {/* Right Status Actions: IN-NAVBAR PIPELINE HOVER PILL + DAEMON STATUS */}
        <div className="flex items-center gap-2 shrink-0">
          {/* In-Navbar Active Pipelines Pill with Hover Dropdown */}
          {pipelineCount > 0 && (
            <div
              className="relative"
              onMouseEnter={() => setPipelineDropdownOpen(true)}
              onMouseLeave={() => setPipelineDropdownOpen(false)}
            >
              <button
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

          {/* Daemon Active Pill */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="hidden sm:inline">DAEMON ACTIVE</span>
            <span className="sm:hidden">LIVE</span>
          </div>

          {/* Mobile Menu Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/[0.08] bg-[#0E121B] px-4 py-3 space-y-1 animate-in slide-in-from-top-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) => `
                  flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all
                  ${isActive
                    ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30'
                    : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
                  }
                `}
              >
                <div className="flex items-center gap-2.5">
                  <Icon size={16} />
                  <span>{item.label}</span>
                </div>
                {item.badge > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-[#8FD3FF]/20 text-[#8FD3FF] border border-[#8FD3FF]/30">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      )}
    </header>
  );
}
