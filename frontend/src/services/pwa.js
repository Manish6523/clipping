/**
 * PWA helpers: service worker registration, install prompt, and "clip ready" notifications.
 * Install + notifications need a secure origin (https:// or http://localhost).
 */

let deferredInstallPrompt = null;
const listeners = new Set();

export function canUseNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('SW registration failed', e));
  });
}

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    listeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    listeners.forEach((fn) => fn(false));
  });
}

export function onInstallAvailable(fn) {
  listeners.add(fn);
  fn(Boolean(deferredInstallPrompt));
  return () => listeners.delete(fn);
}

export async function promptInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  listeners.forEach((fn) => fn(false));
  return outcome === 'accepted';
}

export async function requestNotificationPermission() {
  if (!canUseNotifications()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

/** Show a system notification for a new clip (only when the app isn't in the foreground). */
export async function notifyClipReady({ clipId, title, score }) {
  if (!canUseNotifications() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  const body = `${score ? `🔥 ${score} · ` : ''}${title || 'New highlight ready to review'}`;
  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `clip-${clipId}`,
    data: { url: '/' },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification('Clip ready', options);
    else new Notification('Clip ready', options);
  } catch {
    // ignore: notifications are best-effort
  }
}
