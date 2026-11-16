/** Local (this browser) save history of a template: the last 10 saves, restorable from the overflow menu. */
const key = (name) => `template_versions_${name}`;
const MAX = 10;

export function recordVersion(name, payload) {
  if (!name) return;
  try {
    const list = listVersions(name);
    list.unshift({ t: Date.now(), layers: (payload.layout?.layers || []).length, payload });
    localStorage.setItem(key(name), JSON.stringify(list.slice(0, MAX)));
  } catch { /* storage full / unavailable */ }
}

export function listVersions(name) {
  try {
    const raw = JSON.parse(localStorage.getItem(key(name)) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
