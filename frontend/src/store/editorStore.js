import { create } from 'zustand';
import axios from 'axios';

export const useEditorStore = create((set, get) => ({
  clipId: null,
  clip: null,
  edl: null,
  loading: true,
  saving: false,
  lastSaved: null,
  hasUnsavedChanges: false,

  // Player & Timeline State
  currentTime: 0,
  duration: 30,
  isPlaying: false,
  previewMode: '9:16', // '9:16' or '16:9'
  activeTab: 'source', // source, transcript, layout, captions, audio, publish
  selectedTool: 'select', // select, text, layers, bookmark

  // Undo / Redo Stacks (Max 100)
  history: [],
  historyIndex: -1,

  // Actions
  initClip: async (clipId) => {
    set({ loading: true, clipId });
    try {
      const [clipRes, edlRes] = await Promise.all([
        axios.get(`/api/clips/${clipId}`),
        axios.get(`/api/clips/${clipId}/edit`)
      ]);

      const clip = clipRes.data;
      const edl = edlRes.data;

      // Ensure captions has position defaults
      if (!edl.captions) edl.captions = {};
      if (!edl.captions.position) {
        edl.captions.position = { x: 0.5, y: 0.76, max_width: 0.85 };
      }
      if (!edl.captions.words_per_line) edl.captions.words_per_line = 3;

      const duration = (clip.adjusted_end - clip.adjusted_start) || 30;

      set({
        clip,
        edl,
        loading: false,
        currentTime: clip.adjusted_start || 0,
        duration,
        history: [JSON.stringify(edl)],
        historyIndex: 0,
        hasUnsavedChanges: false,
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

  updateEDL: (updater) => {
    const { edl, history, historyIndex } = get();
    const newEDL = typeof updater === 'function' ? updater({ ...edl }) : { ...edl, ...updater };
    const serialized = JSON.stringify(newEDL);

    // Slice history at historyIndex and append
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

  // Toggle word deletion for Descript-style jump cuts
  toggleWordDeleted: (wordId) => {
    const { edl, updateEDL } = get();
    if (!edl || !edl.words) return;

    const updatedWords = edl.words.map((w) => {
      if (w.id === wordId || w.start === wordId) {
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

    const updatedWords = edl.words.map((w) => {
      if (w.id === wordId || w.start === wordId) {
        return { ...w, word: newText, text: newText };
      }
      return w;
    });

    updateEDL((prev) => ({
      ...prev,
      words: updatedWords,
    }));
  },

  // Update Region crop percentages
  updateRegion: (regionKey, box) => {
    const { edl, updateEDL } = get();
    if (!edl || !edl.layout || !edl.layout.regions) return;

    updateEDL((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        regions: {
          ...prev.layout.regions,
          [regionKey]: {
            ...prev.layout.regions[regionKey],
            ...box,
          },
        },
      },
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

