import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal, Download, Bell, BellOff } from 'lucide-react';
import { NAV } from './nav';
import { Button, Sheet } from './ui';
import {
  onInstallAvailable, promptInstall, isStandalone, canUseNotifications, requestNotificationPermission,
} from '../services/pwa';

const TABS = NAV.filter((n) => n.phoneTab);
const MORE = NAV.filter((n) => !n.phoneTab);

function Tab({ item, badge }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end}
      className={({ isActive }) => `relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-14 text-[10.5px] font-semibold transition-colors ${
        isActive ? 'text-accent' : 'text-muted active:text-ink'}`}>
      {({ isActive }) => (
        <>
          <span className={`relative flex items-center justify-center w-12 h-7 rounded-full transition-colors ${isActive ? 'bg-accent/15' : ''}`}>
            <Icon size={20} />
            {badge > 0 && (
              <span className="absolute -top-1 right-0 min-w-[17px] h-[17px] px-1 rounded-full bg-bad text-white text-[10px] font-bold leading-[17px] text-center tabular-nums">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span className="truncate max-w-full">{item.short || item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function MobileTabBar({ pendingCount = 0 }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [notifPerm, setNotifPerm] = useState(() => (canUseNotifications() ? Notification.permission : 'unsupported'));
  const location = useLocation();

  useEffect(() => onInstallAvailable(setCanInstall), []);
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const moreActive = MORE.some((i) => location.pathname.startsWith(i.to));
  const enableNotifications = async () => setNotifPerm(await requestNotificationPermission());

  return (
    <>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="grid grid-cols-2 gap-2">
          {MORE.map(({ to, label, icon: Icon, hint }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => `flex items-center gap-3 rounded-2xl border p-3 transition-colors ${
                isActive ? 'bg-accent/10 border-accent/40 text-accent' : 'bg-white/[0.03] border-line text-ink active:bg-white/[0.07]'}`}>
              <Icon size={20} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold truncate">{label}</span>
                <span className="block text-[10.5px] text-muted truncate">{hint}</span>
              </span>
            </NavLink>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {canInstall && !isStandalone() && <Button block variant="primary" icon={Download} onClick={promptInstall}>Install AutoClip app</Button>}
          {notifPerm === 'default' && <Button block icon={Bell} onClick={enableNotifications}>Notify me when clips are ready</Button>}
          {notifPerm === 'denied' && <p className="flex items-center gap-2 text-[11px] text-faint justify-center"><BellOff size={13} /> Notifications are blocked in browser settings</p>}
          {!window.isSecureContext && <p className="text-[11px] text-faint text-center leading-snug">Install &amp; notifications need HTTPS - open the dashboard through an https:// address.</p>}
        </div>
      </Sheet>

      <nav aria-label="Main" className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-canvas/95 backdrop-blur-md border-t border-line px-1 flex items-stretch select-none"
        style={{ paddingBottom: 'var(--safe-bottom)' }}>
        {TABS.map((t) => <Tab key={t.to} item={t} badge={t.badge ? pendingCount : 0} />)}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-14 text-[10.5px] font-semibold transition-colors ${moreActive || moreOpen ? 'text-accent' : 'text-muted'}`}>
          <span className={`flex items-center justify-center w-12 h-7 rounded-full ${moreActive || moreOpen ? 'bg-accent/15' : ''}`}><MoreHorizontal size={20} /></span>
          More
        </button>
      </nav>
    </>
  );
}
