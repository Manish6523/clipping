import { create } from 'zustand';

export const useTemplateEditorStore = create((set, get) => ({
  // Active template metadata
  templateName: '',
  description: '',
  minScore: 65,
  isDirty: false,
  feedback: null,

  // Layout schema v2
  layout: {
    schema: 2,
    canvas: { w: 1080, h: 1920 },
    background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 },
    layers: []
  },

  // Selection model: { type: 'layer' | 'captions' | 'hook' | 'watermark' | 'background' | 'template', id: string | null }
  selection: { type: 'template', id: null },

  // Typography & Subtitles
  subtitles: {
    font_name: 'Montserrat',
    font_size: 72,
    primary_color: '&H00FFFFFF',
    highlight_color: '&H0000FFFF',
    outline_color: '&H00000000',
    back_color: '&H80000000',
    outline: 8,
    shadow: 8,
    animation: 'pop',
    uppercase: true,
    position: { x: 0.5, y: 0.76, max_width: 0.85 }
  },
  sampleText: 'THIS IS INSANE!',
  defaultCaptionStyle: 'template',
  defaultHookStyle: 'classic',

  // Watermark
  watermark: {
    enabled: false,
    path: '',
    url: '',
    position: 'top_right',
    x: null,
    y: null,
    opacity: 0.85,
    width: 220
  },

  // Preview Media
  previewSource: 'live', // 'live' | 'clip' | 'vod' | 'custom'
  previewMediaUrl: null,
  selectedChannel: '',

  // Test Render State
  testRenderOpen: false,
  testingSample: false,
  sampleVideoUrl: null,
  testRenderError: null,

  // History Stack (40 states)
  history: [],
  redoStack: [],

  // Mobile Bottom Sheet
  sheetSnap: 'closed', // 'closed' | 'peek' | 'half' | 'full'
  sheetView: 'layers', // 'layers' | 'inspector'
  mobileCropActive: false,

  // Old-format templates are converted by the server; the original is kept so "Repair from legacy fields" can restore it
  legacyLayout: null,
  migratedFromLegacy: false,

  // Actions
  setSelection: (selection) => set({ selection }),
  setTemplateName: (templateName) => set({ templateName, isDirty: true }),
  setDescription: (description) => set({ description, isDirty: true }),
  setSampleText: (sampleText) => set({ sampleText }),
  setPreviewMediaUrl: (previewMediaUrl) => set({ previewMediaUrl }),
  setSelectedChannel: (selectedChannel) => set({ selectedChannel }),
  setTestRenderOpen: (testRenderOpen) => set({ testRenderOpen }),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  setSheetView: (sheetView) => set({ sheetView }),
  setMobileCropActive: (mobileCropActive) => set({ mobileCropActive }),

  pushHistory: () => {
    const state = get();
    const snapshot = {
      layout: JSON.parse(JSON.stringify(state.layout)),
      subtitles: JSON.parse(JSON.stringify(state.subtitles)),
      watermark: JSON.parse(JSON.stringify(state.watermark)),
      defaultCaptionStyle: state.defaultCaptionStyle,
      defaultHookStyle: state.defaultHookStyle,
    };
    set((s) => ({
      history: [...s.history.slice(-39), snapshot],
      redoStack: [],
      isDirty: true
    }));
  },

  undo: () => {
    const { history, layout, subtitles, watermark, defaultCaptionStyle, defaultHookStyle } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    const current = {
      layout: JSON.parse(JSON.stringify(layout)),
      subtitles: JSON.parse(JSON.stringify(subtitles)),
      watermark: JSON.parse(JSON.stringify(watermark)),
      defaultCaptionStyle,
      defaultHookStyle,
    };
    set({
      layout: prev.layout,
      subtitles: prev.subtitles,
      watermark: prev.watermark,
      defaultCaptionStyle: prev.defaultCaptionStyle,
      defaultHookStyle: prev.defaultHookStyle,
      history: history.slice(0, history.length - 1),
      redoStack: [...get().redoStack, current],
      isDirty: true
    });
  },

  redo: () => {
    const { redoStack, history, layout, subtitles, watermark, defaultCaptionStyle, defaultHookStyle } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const current = {
      layout: JSON.parse(JSON.stringify(layout)),
      subtitles: JSON.parse(JSON.stringify(subtitles)),
      watermark: JSON.parse(JSON.stringify(watermark)),
      defaultCaptionStyle,
      defaultHookStyle,
    };
    set({
      layout: next.layout,
      subtitles: next.subtitles,
      watermark: next.watermark,
      defaultCaptionStyle: next.defaultCaptionStyle,
      defaultHookStyle: next.defaultHookStyle,
      history: [...history, current],
      redoStack: redoStack.slice(0, redoStack.length - 1),
      isDirty: true
    });
  },

  updateLayer: (id, updates, recordHistory = true) => {
    if (recordHistory) get().pushHistory();
    set((s) => ({
      layout: {
        ...s.layout,
        layers: (s.layout.layers || []).map((l) =>
          l.id === id ? { ...l, ...updates } : l
        )
      },
      isDirty: true
    }));
  },

  addLayer: (layer) => {
    get().pushHistory();
    set((s) => ({
      layout: {
        ...s.layout,
        layers: [...(s.layout.layers || []), layer]
      },
      selection: { type: 'layer', id: layer.id },
      isDirty: true
    }));
  },

  deleteLayer: (id) => {
    const layers = get().layout.layers || [];
    if (layers.length <= 1) return false;
    get().pushHistory();
    set((s) => ({
      layout: {
        ...s.layout,
        layers: s.layout.layers.filter((l) => l.id !== id)
      },
      selection: { type: 'template', id: null },
      isDirty: true
    }));
    return true;
  },

  reorderLayers: (newLayers) => {
    get().pushHistory();
    set((s) => ({
      layout: {
        ...s.layout,
        layers: newLayers
      },
      isDirty: true
    }));
  },

  // --- Gesture API: call beginGesture() once, then patch*() as often as needed (no history entries), => ONE undo step.
  beginGesture: () => get().pushHistory(),
  patchLayer: (id, updates) => set((s) => ({
    layout: { ...s.layout, layers: (s.layout.layers || []).map((l) => (l.id === id ? { ...l, ...updates } : l)) },
    isDirty: true,
  })),
  patchSubtitles: (updates) => set((s) => ({ subtitles: { ...s.subtitles, ...updates }, isDirty: true })),
  patchWatermark: (updates) => set((s) => ({ watermark: { ...s.watermark, ...updates }, isDirty: true })),
  patchBackground: (updates) => set((s) => ({
    layout: { ...s.layout, background: { ...s.layout.background, ...updates } }, isDirty: true,
  })),

  /** Add several layers at once (presets) and optionally set the background - one undo step. */
  addLayers: (layers, background) => {
    get().pushHistory();
    set((s) => ({
      layout: {
        ...s.layout,
        background: background ? { ...s.layout.background, ...background } : s.layout.background,
        layers: [...(s.layout.layers || []), ...layers],
      },
      selection: layers.length ? { type: 'layer', id: layers[layers.length - 1].id } : s.selection,
      isDirty: true,
    }));
  },

  /** Replace the whole layout (repair / import) - one undo step. */
  replaceLayout: (layout) => {
    get().pushHistory();
    set({ layout, selection: { type: 'template', id: null }, isDirty: true });
  },

  updateSubtitles: (updates) => {
    get().pushHistory();
    set((s) => ({
      subtitles: { ...s.subtitles, ...updates },
      isDirty: true
    }));
  },

  updateWatermark: (updates) => {
    get().pushHistory();
    set((s) => ({
      watermark: { ...s.watermark, ...updates },
      isDirty: true
    }));
  },

  updateBackground: (updates) => {
    get().pushHistory();
    set((s) => ({
      layout: {
        ...s.layout,
        background: { ...s.layout.background, ...updates }
      },
      isDirty: true
    }));
  },

  loadTemplate: (data) => {
    const layout = data.layout && data.layout.layers ? data.layout : {
      schema: 2,
      canvas: { w: 1080, h: 1920 },
      background: { type: 'solid', color: '#000000' },
      layers: []
    };
    const wm = data.watermark || data.anti_shadowban || {};
    const subs = data.subtitles || {};

    set({
      templateName: data.name || 'custom_layout',
      description: data.description || '',
      minScore: data.min_virality_score || 65,
      layout,
      subtitles: {
        font_name: subs.font_name || 'Montserrat',
        font_size: subs.font_size || 72,
        primary_color: subs.primary_color || '&H00FFFFFF',
        highlight_color: subs.highlight_color || '&H0000FFFF',
        outline_color: subs.outline_color || '&H00000000',
        back_color: subs.back_color || '&H80000000',
        outline: subs.outline || 8,
        shadow: subs.shadow || 8,
        animation: subs.animation || 'pop',
        uppercase: subs.uppercase !== false,
        position: subs.position || { x: 0.5, y: 0.76, max_width: 0.85 }
      },
      watermark: {
        enabled: Boolean(wm.watermark_path),
        path: wm.watermark_path || '',
        url: wm.watermark_path ? (wm.watermark_path.startsWith('http') ? wm.watermark_path : `/${wm.watermark_path.replace(/\\/g, '/')}`) : '',
        position: wm.watermark_position || 'top_right',
        x: typeof wm.watermark_x === 'number' ? wm.watermark_x : null,
        y: typeof wm.watermark_y === 'number' ? wm.watermark_y : null,
        opacity: wm.watermark_opacity ?? 0.85,
        width: wm.watermark_width || 220
      },
      defaultCaptionStyle: data.caption_style || 'template',
      defaultHookStyle: data.hook_style || 'classic',
      selection: { type: 'template', id: null },
      legacyLayout: data.legacy_layout || null,
      migratedFromLegacy: Boolean(data._migrated_from_legacy),
      history: [],
      redoStack: [],
      isDirty: false
    });
  }
}));
