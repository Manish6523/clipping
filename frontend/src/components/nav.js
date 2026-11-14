import { Film, Zap, Activity, Calendar, Radio, Palette, Share2, Flame, Terminal, Settings } from 'lucide-react';

/** Every destination in the app. `phoneTab` ones sit in the bottom bar, the rest live under "More". */
export const NAV = [
  { to: '/', label: 'Review', icon: Film, end: true, badge: true, phoneTab: true },
  { to: '/quickclip', label: 'Quick Clip', short: 'Clip', icon: Zap, phoneTab: true },
  { to: '/telemetry', label: 'Live Pulse', short: 'Pulse', icon: Activity, phoneTab: true },
  { to: '/queue', label: 'Queue', icon: Calendar, phoneTab: true },
  { to: '/channels', label: 'Channels', icon: Radio, hint: 'Streamers & live watching' },
  { to: '/templates', label: 'Templates', icon: Palette, hint: 'Layouts & caption styles' },
  { to: '/accounts', label: 'Distribution', icon: Share2, hint: 'YouTube accounts' },
  { to: '/pipelines', label: 'Pipelines', icon: Flame, hint: 'Moments & rejections' },
  { to: '/logs', label: 'Logs', icon: Terminal, hint: 'Live server log' },
  { to: '/settings', label: 'Settings', icon: Settings, hint: 'AI, storage, alerts' },
];
