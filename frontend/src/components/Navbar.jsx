import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Film, 
  Palette, 
  Bookmark,
  Radio, 
  Calendar, 
  Terminal, 
  Zap, 
  Share2,
  Menu,
  X,
  Flame,
  Settings,
  Loader2,
  ChevronDown,
  Camera,
  Layers,
  Sparkles
} from 'lucide-react';

export default function Navbar({ pendingCount = 0, activePipelines = [], toasts = [], onDismissToast }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pipelineDropdownOpen, setPipelineDropdownOpen] = useState(false);
  const [templatesDropdownOpen, setTemplatesDropdownOpen] = useState(false);
  const navigate = useNavigate();

  const pipelineCount = activePipelines.length;
  const primaryPipeline = activePipelines[0] || null;

  return (
    <header className="border-b border-white/[0.08] bg-[#0A0D14]/95 backdrop-blur-md sticky top-0 z-50 select-none">
      <div className="w-full px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
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

        {/* Middle: Clean Grouped Navigation */}
        <nav className="hidden lg:flex items-center justify-center gap-1.5 px-2 flex-1 max-w-4xl">
          {/* 1. Review Station */}
          <NavLink
            to="/"
            end
            className={({ isActive }) => `
              flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
          >
            <Film size={14} />
            <span>Review</span>
            {pendingCount > 0 && (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold bg-[#8FD3FF]/20 text-[#8FD3FF] border border-[#8FD3FF]/30">
                {pendingCount}
              </span>
            )}
          </NavLink>

          {/* 2. Studio (Templates & Presets) Dropdown */}
          <div 
            className="relative"
            onMouseEnter={() => setTemplatesDropdownOpen(true)}
            onMouseLeave={() => setTemplatesDropdownOpen(false)}
          >
            <button
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#8B90A0] hover:text-white hover:bg-white/[0.04] transition-all"
            >
              <Bookmark size={14} />
              <span>Studio & Presets</span>
              <ChevronDown size={11} className={`transition-transform duration-200 ${templatesDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {templatesDropdownOpen && (
              <div className="absolute top-full left-0 w-48 bg-[#0E1118]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <NavLink
                  to="/presets"
                  onClick={() => setTemplatesDropdownOpen(false)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <Bookmark size={13} className="text-[#8FD3FF]" />
                  <span>Preset Studio</span>
                </NavLink>
                <NavLink
                  to="/templates"
                  onClick={() => setTemplatesDropdownOpen(false)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <Palette size={13} className="text-violet-400" />
                  <span>Templates (Legacy)</span>
                </NavLink>
                <NavLink
                  to="/webcam-lab"
                  onClick={() => setTemplatesDropdownOpen(false)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 transition-colors border-t border-white/[0.06] mt-1 pt-1.5"
                >
                  <Camera size={13} className="text-emerald-400" />
                  <span>Webcam Detection Lab</span>
                </NavLink>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* 3. Channels & Live */}
          <NavLink
            to="/channels"
            className={({ isActive }) => `
              flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
          >
            <Radio size={14} />
            <span>Channels & Live</span>
          </NavLink>

          {/* 4. Distribution */}
          <NavLink
            to="/accounts"
            className={({ isActive }) => `
              flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
          >
            <Share2 size={14} />
            <span>Distribution</span>
          </NavLink>

          {/* 5. Drip Queue */}
          <NavLink
            to="/queue"
            className={({ isActive }) => `
              flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
          >
            <Calendar size={14} />
            <span>Drip Queue</span>
          </NavLink>

          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* 6. Pipelines */}
          <NavLink
            to="/pipelines"
            className={({ isActive }) => `
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
          >
            <Flame size={14} />
            <span>Pipelines</span>
          </NavLink>

          {/* 7. Logs */}
          <NavLink
            to="/logs"
            className={({ isActive }) => `
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
          >
            <Terminal size={14} />
            <span>Logs</span>
          </NavLink>

          {/* 8. Quick Clip */}
          <NavLink
            to="/quickclip"
            className={({ isActive }) => `
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-md shadow-[#8FD3FF]/10'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
          >
            <Zap size={14} />
            <span>Quick Clip</span>
          </NavLink>

          {/* 9. Settings */}
          <NavLink
            to="/settings"
            className={({ isActive }) => `
              p-2 rounded-xl text-xs font-semibold transition-all
              ${isActive
                ? 'bg-[#181C26] text-[#8FD3FF] border border-[#8FD3FF]/30'
                : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
              }
            `}
            title="Settings"
          >
            <Settings size={15} />
          </NavLink>
        </nav>

        {/* Right: Active Pipelines Pill & Daemon Status */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Active Pipelines Badge */}
          {pipelineCount > 0 && (
            <div
              className="relative"
              onMouseEnter={() => setPipelineDropdownOpen(true)}
              onMouseLeave={() => setPipelineDropdownOpen(false)}
            >
              <button
                className="flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3 py-1 rounded-xl text-xs transition-all shadow-lg shadow-amber-500/5 cursor-pointer"
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
                  <span className="text-[9px] font-mono text-amber-400/90 font-bold">
                    Step {primaryPipeline?.current_step || 1}/5
                  </span>
                </div>
                <ChevronDown size={12} className={`text-amber-400 transition-transform ${pipelineDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {pipelineDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-[#0E1118]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 z-50 flex flex-col gap-2">
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.06]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Active Clip Pipelines ({pipelineCount})
                    </span>
                    <button
                      onClick={() => navigate('/pipelines')}
                      className="text-[10px] text-[#8FD3FF] hover:underline"
                    >
                      View All
                    </button>
                  </div>
                  {activePipelines.map((pipe) => (
                    <div key={pipe.pipeline_id} className="p-2 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white">@{pipe.channel_id}</span>
                        <span className="text-[10px] text-amber-400 font-mono font-bold">Step {pipe.current_step}/5</span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">{pipe.step_description || 'Processing'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Daemon Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-mono font-bold">DAEMON ACTIVE</span>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl text-[#8B90A0] hover:text-white hover:bg-white/[0.04]"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#0A0D14] border-b border-white/[0.08] px-4 py-3 flex flex-col gap-1">
          <NavLink to="/" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Film size={16} /> Review ({pendingCount})
          </NavLink>
          <NavLink to="/presets" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Bookmark size={16} /> Preset Studio
          </NavLink>
          <NavLink to="/webcam-lab" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-emerald-300 hover:text-emerald-200">
            <Camera size={16} /> Webcam Detection Lab
          </NavLink>
          <NavLink to="/channels" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Radio size={16} /> Channels & Live
          </NavLink>
          <NavLink to="/accounts" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Share2 size={16} /> Distribution
          </NavLink>
          <NavLink to="/queue" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Calendar size={16} /> Drip Queue
          </NavLink>
          <NavLink to="/pipelines" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Flame size={16} /> Pipelines
          </NavLink>
          <NavLink to="/logs" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Terminal size={16} /> Logs
          </NavLink>
          <NavLink to="/settings" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 p-2 rounded-lg text-sm text-slate-300 hover:text-white">
            <Settings size={16} /> Settings
          </NavLink>
        </div>
      )}
    </header>
  );
}
