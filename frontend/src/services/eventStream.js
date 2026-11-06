/**
 * Global Real-Time Event Stream Listener
 * Listens for events: clip_created, clip_updated, job_progress, channel_status, daemon_status
 */

class EventStreamManager {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.reconnectTimer = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected to live pipeline event stream');
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.listeners.forEach((cb) => cb(payload));
        } catch (e) {
          // Ignore non-json (e.g. pong)
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected. Reconnecting in 3s...');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (err) => {
        console.debug('[WS] Error:', err);
      };
    } catch (e) {
      this.reconnectTimer = setTimeout(() => this.connect(), 4000);
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    this.connect();
    return () => {
      this.listeners.delete(callback);
    };
  }
}

export const eventStream = new EventStreamManager();

