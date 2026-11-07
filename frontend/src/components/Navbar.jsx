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
  Menu,
  X
} from 'lucide-react';

export default function Navbar({ pendingCount = 0 }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { to: '/', label: 'Review', shortLabel: 'Review', icon: Film, badge: pendingCount, end: true },
    { to: '/templates', label: 'Templates', shortLabel: 'Templates', icon: Palette },
    { to: '/channels', label: 'Channels & Live', shortLabel: 'Channels', icon: Radio },
    { to: '/accounts', label: 'YouTube & Distribution', shortLabel: 'Distribution', icon: Share2 },
    { to: '/queue', label: 'Drip Queue', shortLabel: 'Queue', icon: Calendar },
    { to: '/logs', label: 'Logs', shortLabel: 'Logs', icon: Terminal },
    { to: '/quickclip', label: 'Quick Clip', shortLabel: 'Clip', icon: Zap },
  ];

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

        {/* Right Status Indicator & Mobile Toggle */}
        <div className="flex items-center gap-2 shrink-0">
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
