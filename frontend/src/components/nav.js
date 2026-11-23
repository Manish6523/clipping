import { Film, Zap, Activity, Calendar, Radio, Palette, Flame, Terminal, Settings, FlaskConical } from 'lucide-react';

/** Every destination in the app. `phoneTab` ones sit in the bottom bar, the rest live under "More". */
export const NAV = [
  { to: '/', label: 'Clips', icon: Film, end: true, badge: true, phoneTab: true },
  { to: '/quickclip', label: 'Quick Clip', short: 'Clip', icon: Zap, phoneTab: true },
  { to: '/telemetry', label: 'Live Pulse', short: 'Pulse', icon: Activity, phoneTab: true },
  { to: '/queue', label: 'Queue', icon: Calendar, phoneTab: true },
  { to: '/channels', label: 'Streamers', icon: Radio, hint: 'Who to watch & where clips post' },
  { to: '/templates', label: 'Templates', icon: Palette, hint: 'Layouts & caption styles' },
  { to: '/pipelines', label: 'Pipelines', icon: Flame, hint: 'Moments & rejections' },
  { to: '/lab', label: 'Lab', icon: FlaskConical, hint: 'Test every clip feature on a video' },
  { to: '/logs', label: 'Logs', icon: Terminal, hint: 'Live server log' },
  { to: '/settings', label: 'Settings', icon: Settings, hint: 'AI, storage, alerts' },
];
