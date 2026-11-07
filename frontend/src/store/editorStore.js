import { create } from 'zustand';
import axios from 'axios';

export const useEditorStore = create((set, get) => ({
  clipId: null,
  clip: null,
  edl: null,
  sourceInfo: null,
  loading: true,
  saving: false,
  extending: false,
  lastSaved: null,
  hasUnsavedChanges: false,

  // Player & Timeline State
  currentTime: 0,
  duration: 30,
  isPlaying: false,
  previewMode: '9:16', // '9:16' or '16:9'
  activeTab: 'layers', // layout, captions, transcript, length, audio, presets, publish
  selectedTool: 'select',

  // Bottom Sheet State for Phone / Tablet
  // snapPoint: 'closed' | 'peek' (28%) | 'half' (50%) | 'full' (90%)
  sheetSnap: 'closed',
  activePanel: null, // 'layout' | 'captions' | 'transcript' | 'length' | 'audio' | 'presets' | 'publish' | 'clip'

  // Contextual Selection state: { type: 'none' | 'layer' | 'caption' | 'word' | 'segment' | 'overlay', id: string|null, data: any }
  selection: { type: 'none', id: null },

  // Undo / Redo Stacks (Max 100)
  history: [],
  historyIndex: -1,

  // Actions
  initClip: async (clipId) => {
    set({ loading: true, clipId });
    try {
      const [clipRes, edlRes, srcRes] = await Promise.all([
        axios.get(`/api/clips/${clipId}`),
        axios.get(`/api/clips/${clipId}/edit`),
        axios.get(`/api/clips/${clipId}/source-info`).catch(() => ({ data: null })),
      ]);

      const clip = clipRes.data;
      const edl = edlRes.data;
      const sourceInfo = srcRes.data;

      // Ensure captions has modern configuration defaults
      if (!edl.captions) edl.captions = {};
      if (!edl.captions.position) {
        edl.captions.position = { x: 0.5, y: 0.76, max_width: 0.85 };
      }
      if (!edl.captions.words_per_line) edl.captions.words_per_line = 3;
      if (!edl.captions.font) edl.captions.font = 'Montserrat ExtraBold';
      if (!edl.captions.color) edl.captions.color = '#FFFFFF';
      if (!edl.captions.highlight) edl.captions.highlight = '#FACC15';
      if (!edl.captions.animation) edl.captions.animation = 'pop';

      // Migrate legacy Schema v1 layout (regions: { person, content }) to Schema v2 (layers: [...])
      if (edl.layout && !edl.layout.layers) {
        const regions = edl.layout.regions || {};
        const p = regions.person || { x: 0.05, y: 0.05, w: 0.33, h: 0.44 };
        const c = regions.content || { x: 0.16, y: 0.0, w: 0.67, h: 1.0 };
        edl.layout = {
          schema: 2,
          canvas: { w: 1080, h: 1920 },
          background: { type: 'solid', color: '#000000', blur: 0, dim: 0.0 },
          layers: [
            {
              id: 'l_game',
              name: 'Gameplay',
              color: '#00F0FF',
              visible: true,
              locked: false,
              src: { x: c.x ?? 0.20, y: c.y ?? 0.0, w: c.w ?? 0.60, h: c.h ?? 1.0 },
              dst: { x: 0.0, y: 0.38, w: 1.0, h: 0.62 },
              fit: 'cover',
              aspect_lock: true,
              style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
              tracking: { mode: 'off', smooth: 0.8 },
            },
            {
              id: 'l_facecam',
              name: 'Facecam',
              color: '#FFB020',
              visible: true,
              locked: false,
              src: { x: p.x ?? 0.0, y: p.y ?? 0.58, w: p.w ?? 0.32, h: p.h ?? 0.42 },
              dst: { x: 0.0, y: 0.0, w: 1.0, h: 0.38 },
              fit: 'cover',
              aspect_lock: true,
              style: { radius: 0, shape: 'rect', border: { w: 0, color: '#FFFFFF' }, shadow: { blur: 0, opacity: 0 }, opacity: 1.0, mirror: false },
              tracking: { mode: 'off', smooth: 0.8 },
            },
          ],
        };
      }

      // Pull transcript words from clip if missing in edl
      if ((!edl.words || !edl.words.length) && clip.transcript_words) {
        edl.words = clip.transcript_words;
      }

      const duration = (clip.adjusted_end - clip.adjusted_start) || 30;

      set({
        clip,
        edl,
        sourceInfo,
        loading: false,
        currentTime: clip.adjusted_start || 0,
        duration,
        history: [JSON.stringify(edl)],
        historyIndex: 0,
        hasUnsavedChanges: false,
        selection: { type: 'none', id: null },
      });
    } catch (err) {
      console.error('Failed to init clip editor:', err);
      set({ loading: false });
    }
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPreviewMode: (mode) => set({ previewMode: mode }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSheetSnap: (snap) => set({ sheetSnap: snap }),
  setActivePanel: (panel) => set((state) => ({ 
    activePanel: panel, 
    sheetSnap: panel ? (state.sheetSnap === 'closed' ? 'half' : state.sheetSnap) : 'closed' 
  })),
  openPanel: (panel, snap = 'half') => set({ activePanel: panel, sheetSnap: snap }),
  closeSheet: () => set({ sheetSnap: 'closed', activePanel: null }),

  // Set contextual selection for right sidebar / sheet
  setSelection: (sel) => {
    if (!sel || !sel.type) {
      set({ selection: { type: 'none', id: null } });
    } else {
      set({ selection: sel });
    }
  },

  clearSelection: () => set({ selection: { type: 'none', id: null } }),

  updateEDL: (updater) => {
    const { edl, history, historyIndex } = get();
    const newEDL = typeof updater === 'function' ? updater({ ...edl }) : { ...edl, ...updater };
    const serialized = JSON.stringify(newEDL);

    const newHistory = history.slice(0, historyIndex + 1);
    if (newHistory.length >= 100) newHistory.shift();
    newHistory.push(serialized);

    set({
      edl: newEDL,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      hasUnsavedChanges: true,
    });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const prev = JSON.parse(history[historyIndex - 1]);
      set({
        edl: prev,
        historyIndex: historyIndex - 1,
        hasUnsavedChanges: true,
      });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const next = JSON.parse(history[historyIndex + 1]);
      set({
        edl: next,
        historyIndex: historyIndex + 1,
        hasUnsavedChanges: true,
      });
    }
  },

  saveEDL: async () => {
    const { clipId, edl, saving } = get();
    if (saving || !clipId || !edl) return;

    set({ saving: true });
    try {
      await axios.put(`/api/clips/${clipId}/edit`, edl);
      set({
        saving: false,
        hasUnsavedChanges: false,
        lastSaved: new Date(),
      });
    } catch (err) {
      console.error('Autosave failed:', err);
      set({ saving: false });
    }
  },

  // Transcribe clip on demand
  transcribeClip: async () => {
    const { clipId } = get();
    if (!clipId) return;
    try {
      const res = await axios.post(`/api/clips/${clipId}/transcribe`);
      if (res.data?.words) {
        get().updateEDL((prev) => ({
          ...prev,
          words: res.data.words,
        }));
      }
    } catch (e) {
      alert('Transcription failed: ' + (e.response?.data?.error?.message || e.message));
    }
  },

  // Change clip length / boundaries (extend or shorten)
  changeClipBounds: async (newStart, newEnd) => {
    const { clipId, extending, updateEDL } = get();
    if (!clipId || extending) return;

    set({ extending: true });
    try {
      const res = await axios.post(`/api/clips/${clipId}/extend-source`, {
        start: newStart,
        end: newEnd,
      });

      if (res.data?.success) {
        const { clip, words, duration } = res.data;
        updateEDL((prev) => ({
          ...prev,
          source: { ...prev.source, start: newStart, end: newEnd },
          words: words || prev.words,
          segments: [
            { id: `seg_${Date.now()}`, src_in: newStart, src_out: newEnd }
          ]
        }));

        set({
          clip,
          duration,
          extending: false,
        });
      }
    } catch (e) {
      alert('Failed adjusting clip length: ' + (e.response?.data?.error?.message || e.message));
      set({ extending: false });
    }
  },

  // Split Segment at Current Playhead
  splitSegmentAtPlayhead: () => {
    const { edl, currentTime, updateEDL } = get();
    if (!edl || !edl.segments) return;

    const segIdx = edl.segments.findIndex(
      (s) => currentTime > s.src_in && currentTime < s.src_out
    );
    if (segIdx === -1) return;

    const targetSeg = edl.segments[segIdx];
    const seg1 = { id: `seg_${Date.now()}_1`, src_in: targetSeg.src_in, src_out: currentTime };
    const seg2 = { id: `seg_${Date.now()}_2`, src_in: currentTime, src_out: targetSeg.src_out };

    const newSegments = [...edl.segments];
    newSegments.splice(segIdx, 1, seg1, seg2);

    updateEDL((prev) => ({
      ...prev,
      segments: newSegments,
    }));
  },

  // Delete Segment (Ripple delete)
  deleteSegment: (segId) => {
    const { edl, updateEDL } = get();
    if (!edl || !edl.segments || edl.segments.length <= 1) return;

    const newSegments = edl.segments.filter((s) => s.id !== segId);
    updateEDL((prev) => ({
      ...prev,
      segments: newSegments,
    }));
  },

  // Toggle word deletion for jump cuts
  toggleWordDeleted: (wordId) => {
    const { edl, updateEDL } = get();
    if (!edl || !edl.words) return;

    const updatedWords = edl.words.map((w, idx) => {
      const match = (w.id && w.id === wordId) || (w.start === wordId) || (idx === wordId);
      if (match) {
        return { ...w, deleted: !w.deleted };
      }
      return w;
    });

    updateEDL((prev) => ({
      ...prev,
      words: updatedWords,
    }));
  },

  // Edit word text typo
  editWordText: (wordId, newText) => {
    const { edl, updateEDL } = get();
    if (!edl || !edl.words) return;

    const updatedWords = edl.words.map((w, idx) => {
      const match = (w.id && w.id === wordId) || (w.start === wordId) || (idx === wordId);
      if (match) {
        return { ...w, word: newText, text: newText };
      }
      return w;
    });

    updateEDL((prev) => ({
      ...prev,
      words: updatedWords,
    }));
  },

  // Update Caption Position & Style
  updateCaptionPos: (posUpdate) => {
    const { edl, updateEDL } = get();
    if (!edl) return;
    updateEDL((prev) => ({
      ...prev,
      captions: {
        ...prev.captions,
        position: {
          ...(prev.captions?.position || { x: 0.5, y: 0.76, max_width: 0.85 }),
          ...posUpdate,
        },
      },
    }));
  },

  // Update Caption General Settings
  updateCaptionStyle: (styleUpdate) => {
    const { edl, updateEDL } = get();
    if (!edl) return;
    updateEDL((prev) => ({
      ...prev,
      captions: {
        ...prev.captions,
        ...styleUpdate,
      },
    }));
  },

  // Apply Preset Data
  applyPresetToEDL: (presetData) => {
    const { updateEDL } = get();
    updateEDL((prev) => {
      const next = { ...prev };
      if (presetData.layout) next.layout = presetData.layout;
      if (presetData.subtitles) next.captions = presetData.subtitles;
      else if (presetData.captions) next.captions = presetData.captions;
      return next;
    });
  },
}));
