import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Film, Zap, Calendar, MoreHorizontal, Palette, Radio, Share2, Flame, Terminal, Settings,
  Download, Bell, BellOff, X,
} from 'lucide-react';
import {
  onInstallAvailable, promptInstall, isStandalone, canUseNotifications, requestNotificationPermission,
} from '../services/pwa';

const MORE_ITEMS = [
  { to: '/channels', label: 'Channels & Live', icon: Radio },
  { to: '/templates', label: 'Templates', icon: Palette },
  { to: '/accounts', label: 'Distribution', icon: Share2 },
  { to: '/pipelines', label: 'Pipelines', icon: Flame },
  { to: '/logs', label: 'Logs', icon: Terminal },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Tab({ to, label, icon: Icon, badge, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl text-[10px] font-bold ${
        isActive ? 'text-[#8FD3FF]' : 'text-slate-400 active:text-white'
      }`}
    >
      <span className="relative">
        <Icon size={20} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black leading-[18px] text-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="truncate max-w-full">{label}</span>
    </NavLink>
  );
}

export default function MobileTabBar({ pendingCount = 0 }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [notifPerm, setNotifPerm] = useState(() => (canUseNotifications() ? Notification.permission : 'unsupported'));
  const location = useLocation();

  useEffect(() => onInstallAvailable(setCanInstall), []);

  const moreActive = MORE_ITEMS.some((i) => location.pathname.startsWith(i.to));

  const enableNotifications = async () => {
    const res = await requestNotificationPermission();
    setNotifPerm(res);
  };

  return (
    <>
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-[#0E121B] border-t border-white/10 p-4 pt-3"
            style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative h-9 mb-2 flex items-center justify-center">
              <div className="w-10 h-1.5 rounded-full bg-white/15" />
              <button type="button" onClick={() => setMoreOpen(false)} className="absolute right-0 top-0 p-1.5 text-slate-400" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MORE_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => `flex flex-col items-center justify-center gap-1.5 h-20 rounded-2xl border text-[11px] font-bold text-center px-1 ${
                    isActive ? 'bg-[#181C26] border-[#8FD3FF]/40 text-[#8FD3FF]' : 'bg-white/[0.03] border-white/[0.06] text-slate-300'
                  }`}
                >
                  <Icon size={20} />
                  {label}
                </NavLink>
              ))}
            </div>

            <div className="mt-3 space-y-2">
              {canInstall && !isStandalone() && (
                <button type="button" onClick={promptInstall}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-indigo-600 text-white text-sm font-bold">
                  <Download size={16} /> Install AutoClip app
                </button>
              )}
              {notifPerm === 'default' && (
                <button type="button" onClick={enableNotifications}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm font-bold">
                  <Bell size={16} /> Notify me when clips are ready
                </button>
              )}
              {notifPerm === 'denied' && (
                <p className="flex items-center gap-2 text-[11px] text-slate-500 justify-center"><BellOff size={13} /> Notifications blocked in browser settings</p>
              )}
              {!window.isSecureContext && (
                <p className="text-[11px] text-slate-500 text-center leading-snug">
                  Install &amp; notifications need HTTPS — open the dashboard through an https:// address.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-[#0A0D14]/95 backdrop-blur-md border-t border-white/[0.08] px-2 flex items-stretch select-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Tab to="/" end label="Review" icon={Film} badge={pendingCount} />
        <Tab to="/quickclip" label="Quick Clip" icon={Zap} />
        <Tab to="/queue" label="Queue" icon={Calendar} />
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-14 text-[10px] font-bold ${moreActive || moreOpen ? 'text-[#8FD3FF]' : 'text-slate-400'}`}
          aria-expanded={moreOpen}
        >
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>
    </>
  );
}
