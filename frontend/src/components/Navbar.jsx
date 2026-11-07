import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Film, 
  Palette, 
  Radio, 
  Calendar, 
  Terminal, 
  Zap, 
  Flame,
  Share2
} from 'lucide-react';

export default function Navbar({ pendingCount = 0 }) {
  const navItems = [
    { to: '/', label: 'Review Station', icon: Film, badge: pendingCount, end: true },
    { to: '/templates', label: 'Template Studio', icon: Palette },
    { to: '/channels', label: 'Channels & Live', icon: Radio },
    { to: '/accounts', label: 'YouTube & Distribution', icon: Share2 },
    { to: '/queue', label: 'Drip Queue', icon: Calendar },
    { to: '/logs', label: 'Live Logs', icon: Terminal },
    { to: '/quickclip', label: 'Quick Clip', icon: Zap },
  ];

  return (
    <header className="border-b border-white/[0.08] bg-[#0A0D14]/90 backdrop-blur-md sticky top-0 z-50 select-none">
      <div className="max-w-7xl mx-auto px-4 h-15 flex items-center justify-between">
        {/* Brand Logo */}
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#8FD3FF] to-[#A9B8FF] flex items-center justify-center text-[#0A0B0E] font-black text-sm shadow-md shadow-[#8FD3FF]/20 group-hover:scale-105 transition-all">
            M
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-sm tracking-tight text-white group-hover:text-[#8FD3FF] transition-colors">
              AUTOCLIP
            </span>
            <span className="text-[10px] uppercase font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[#8FD3FF]">
              SUITE
            </span>
          </div>
        </NavLink>

        {/* Dedicated URL Links for every Navbar Item */}
        <nav className="flex items-center gap-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `
                  flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all relative
                  ${isActive
                    ? 'bg-[#1A1D26] text-[#8FD3FF] border border-[#8FD3FF]/30 shadow-lg shadow-[#8FD3FF]/10'
                    : 'text-[#8B90A0] hover:text-white hover:bg-white/[0.04]'
                  }
                `}
              >
                <Icon size={15} />
                <span>{item.label}</span>
                {item.badge > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold bg-[#8FD3FF]/20 text-[#8FD3FF] border border-[#8FD3FF]/30">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Daemon Active Status Pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            DAEMON ACTIVE
          </div>
        </div>
      </div>
    </header>
  );
}
