/** Layer kinds + starter layouts for the phone Studio. Names and colours are meaningful - never "Frame N". */

export const MAX_LAYERS = 8;

export const LAYER_KINDS = [
  { kind: 'facecam', name: 'Facecam', color: '#FFB020', src: { x: 0.05, y: 0.05, w: 0.35, h: 0.45 }, dst: { x: 0, y: 0, w: 1, h: 0.38 } },
  { kind: 'gameplay', name: 'Gameplay', color: '#00F0FF', src: { x: 0.2, y: 0, w: 0.6, h: 1 }, dst: { x: 0, y: 0.38, w: 1, h: 0.62 } },
  { kind: 'chat', name: 'Chat', color: '#A855F7', src: { x: 0.8, y: 0.2, w: 0.2, h: 0.6 }, dst: { x: 0.05, y: 0.85, w: 0.4, h: 0.12 } },
  { kind: 'custom', name: 'Custom', color: '#EC4899', src: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, dst: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 } },
];

const uid = () => `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function uniqueName(base, existing) {
  const names = new Set((existing || []).map((l) => l.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

export function makeLayer(kind, existing = [], overrides = {}) {
  const k = LAYER_KINDS.find((x) => x.kind === kind) || LAYER_KINDS[3];
  return {
    id: uid(),
    name: uniqueName(k.name, existing),
    color: k.color,
    visible: true,
    locked: false,
    aspect_lock: true,
    fit: 'cover',
    src: { ...k.src },
    dst: { ...k.dst },
    style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
    tracking: { mode: 'off', smooth: 0.8 },
    ...overrides,
  };
}

export const LAYOUT_PRESETS = [
  {
    id: 'facecam_gameplay', title: 'Facecam + gameplay', hint: 'Cam on top, game below',
    build: (existing) => {
      const g = makeLayer('gameplay', existing);
      const f = makeLayer('facecam', [...existing, g]);
      return { layers: [g, f], background: { type: 'solid', color: '#000000', blur: 0, dim: 0 } };
    },
  },
  {
    id: 'single_full', title: 'Single full crop', hint: 'One 9:16 crop fills the screen',
    build: (existing) => ({
      layers: [makeLayer('custom', existing, { name: uniqueName('Main video', existing), color: '#00F0FF', src: { x: 0.342, y: 0, w: 0.316, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 } })],
      background: { type: 'solid', color: '#000000', blur: 0, dim: 0 },
    }),
  },
  {
    id: 'blurred_backdrop', title: 'Blurred backdrop', hint: '16:9 centred over a blurred copy',
    build: (existing) => ({
      layers: [makeLayer('custom', existing, { name: uniqueName('Center stream', existing), color: '#3B82F6', src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0.342, w: 1, h: 0.316 } })],
      background: { type: 'blur', color: '#000000', blur: 40, dim: 0.4 },
    }),
  },
];

export function buildPreset(id, existing = []) {
  const p = LAYOUT_PRESETS.find((x) => x.id === id);
  return p ? p.build(existing) : null;
}
