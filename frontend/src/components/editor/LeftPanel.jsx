import React, { useState, useEffect } from 'react';
import { 
  Video, 
  FileText, 
  LayoutTemplate, 
  Type, 
  Sliders, 
  Volume2, 
  Bookmark,
  Check,
  Trash2,
  Share2
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import axios from 'axios';

export default function LeftPanel() {
  const { activeTab, setActiveTab } = useEditorStore();

  const tabs = [
    { id: 'source', label: 'Source', icon: Video },
    { id: 'presets', label: 'Presets', icon: Bookmark },
    { id: 'transcript', label: 'Script', icon: FileText },
    { id: 'layout', label: 'Layout', icon: LayoutTemplate },
    { id: 'audio', label: 'Audio', icon: Volume2 },
  ];

  return (
    <div className="w-full h-full bg-[#13151A] border border-white/[0.06] rounded-2xl p-3 flex flex-col gap-3 shadow-xl select-none overflow-hidden">
      {/* Top Tab Bar Pills */}
      <div className="grid grid-cols-5 gap-1 bg-[#0A0B0E] p-1 rounded-xl border border-white/[0.04] shrink-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                isActive
                  ? 'bg-[#1A1D24] text-[#8FD3FF] shadow-sm border border-white/[0.06]'
                  : 'text-[#8B90A0] hover:text-[#E8EAF0]'
              }`}
              title={t.label}
            >
              <Icon size={12} />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Specific Content */}
      <div className="flex-1 overflow-y-auto pr-1 text-xs">
        {activeTab === 'source' && <SourceSubTab />}
        {activeTab === 'presets' && <PresetsSubTab />}
        {activeTab === 'transcript' && <TranscriptSubTab />}
        {activeTab === 'layout' && <LayoutSubTab />}
        {activeTab === 'audio' && <AudioSubTab />}
      </div>
    </div>
  );
}

function SourceSubTab() {
  const { clip, edl, updateRegion } = useEditorStore();

  const handleAutoDetect = async () => {
    try {
      const res = await fetch(`/api/clips/${clip?.id}/detect-faces`, { method: 'POST' });
      const data = await res.json();
      if (data.suggested_person) {
        updateRegion('person', data.suggested_person);
      }
    } catch (e) {
      alert('Face detection failed: ' + e.message);
    }
  };

  const handleResetToTemplate = async () => {
    try {
      const tName = clip?.template_name || edl?.layout?.preset;
      if (tName) {
        const res = await axios.get('/api/templates');
        const tpl = res.data?.find((t) => t.name === tName);
        if (tpl?.layout?.top_crop && tpl?.layout?.bottom_crop) {
          const top = tpl.layout.top_crop;
          const bot = tpl.layout.bottom_crop;
          updateRegion('person', {
            x: top.normalized_x ?? (top.source_x / 1920),
            y: top.normalized_y ?? (top.source_y / 1080),
            w: top.normalized_w ?? (top.source_w / 1920),
            h: top.normalized_h ?? (top.source_h / 1080),
          });
          updateRegion('content', {
            x: bot.normalized_x ?? (bot.source_x / 1920),
            y: bot.normalized_y ?? (bot.source_y / 1080),
            w: bot.normalized_w ?? (bot.source_w / 1920),
            h: bot.normalized_h ?? (bot.source_h / 1080),
          });
          return;
        }
      }
    } catch (e) {
      console.warn('Could not reset to template:', e);
    }
    updateRegion('person', { x: 0.0, y: 0.58, w: 0.32, h: 0.42 });
    updateRegion('content', { x: 0.20, y: 0.0, w: 0.60, h: 1.0 });
  };

  return (
    <div className="space-y-4">
      <div className="bg-[#1A1D24] p-2.5 rounded-xl border border-white/[0.06] space-y-1">
        <span className="text-[10px] uppercase font-bold text-[#8B90A0] block">Source Stream</span>
        <div className="text-white font-mono text-[11px] truncate">
          {clip?.source_video_path?.split(/[\\/]/).pop() || 'live_segment.mp4'}
        </div>
        <div className="text-[10px] text-[#8FD3FF] font-mono">
          Range: {clip?.adjusted_start?.toFixed(1)}s - {clip?.adjusted_end?.toFixed(1)}s
        </div>
      </div>

      <div className="space-y-2">
        <button
          onClick={handleAutoDetect}
          className="w-full py-2 bg-gradient-to-r from-purple-600/30 to-indigo-600/30 hover:from-purple-600/40 hover:to-indigo-600/40 border border-purple-500/30 text-[#8FD3FF] rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
        >
          Auto-Detect Facecam
        </button>

        <button
          onClick={handleResetToTemplate}
          className="w-full py-2 bg-[#1A1D24] hover:bg-[#1A1D24]/80 border border-white/[0.06] text-[#8B90A0] hover:text-white rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all"
        >
          Reset Boxes to Default
        </button>
      </div>
    </div>
  );
}

function PresetsSubTab() {
  const { clip, edl, applyPresetToEDL } = useEditorStore();
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fetchPresets = async () => {
    setLoading(true);
    try {
      const channelParam = clip?.channel_id ? `?channel_id=${clip.channel_id}` : '';
      const res = await axios.get(`/api/presets${channelParam}`);
      setPresets(res.data);
    } catch (e) {
      console.error('Error fetching presets:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPresets();
  }, [clip?.channel_id]);

  const handleApply = (preset) => {
    applyPresetToEDL(preset.data);
    setFeedback(`Applied "${preset.name}"`);
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleApplyToAll = async (presetId) => {
    if (!confirm(`Apply this preset to ALL pending clips for streamer "${clip?.channel_id}"?`)) return;
    try {
      const res = await axios.post(`/api/presets/${presetId}/apply`, {
        clip_id: clip?.id,
        apply_to_streamer: true,
      });
      alert(`Applied to ${res.data.applied_count} clips in queue!`);
    } catch (e) {
      alert('Failed applying to streamer clips: ' + e.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase text-[#8B90A0]">Saved Style Presets</span>
        {feedback && <span className="text-[10px] text-emerald-400 font-mono">{feedback}</span>}
      </div>

      {loading && <div className="text-xs text-slate-500 font-mono">Loading presets...</div>}

      <div className="space-y-2">
        {presets.map((p) => (
          <div
            key={p.id}
            className="p-2.5 rounded-xl border border-white/[0.06] bg-[#1A1D24] flex flex-col gap-2 hover:border-[#8FD3FF]/40 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-xs">{p.name}</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${p.scope === 'global' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                {p.scope}
              </span>
            </div>

            <div className="flex items-center gap-1.5 pt-1">
              <button
                onClick={() => handleApply(p)}
                className="flex-1 py-1 bg-[#8FD3FF] hover:bg-[#8FD3FF]/90 text-black font-bold text-[10px] rounded-lg transition-all"
              >
                Apply to Clip
              </button>
              {clip?.channel_id && (
                <button
                  onClick={() => handleApplyToAll(p.id)}
                  className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white text-[10px] rounded-lg border border-white/5"
                  title="Apply to all pending clips of this streamer"
                >
                  Apply to Streamer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TranscriptSubTab() {
  const { edl, currentTime, setCurrentTime, toggleWordDeleted } = useEditorStore();
  const words = edl?.words || [];

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-[#8B90A0]">
        Click word to seek. Strikethrough words are cut.
      </div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {words.map((w, idx) => {
          const isCurrent = currentTime >= w.start && currentTime <= w.end;
          return (
            <div
              key={idx}
              onClick={() => setCurrentTime(w.start)}
              onContextMenu={(e) => {
                e.preventDefault();
                toggleWordDeleted(w.id || w.start);
              }}
              className={`p-1.5 rounded-lg border text-xs flex items-center justify-between transition-all cursor-pointer ${
                w.deleted
                  ? 'bg-rose-950/20 border-rose-500/30 text-rose-400 line-through'
                  : isCurrent
                  ? 'bg-[#8FD3FF]/20 border-[#8FD3FF] text-white font-bold'
                  : 'bg-[#1A1D24]/60 border-white/[0.04] text-[#8B90A0] hover:text-white'
              }`}
            >
              <span>{w.word || w.text}</span>
              <span className="text-[10px] font-mono text-slate-500">{w.start.toFixed(1)}s</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LayoutSubTab() {
  const { edl, updateEDL } = useEditorStore();
  const currentLayout = edl?.layout?.type || 'facecam_top_gameplay_bottom';

  const presets = [
    { id: 'facecam_top_gameplay_bottom', label: 'Facecam Top (38%) + Game (62%)' },
    { id: 'split_screen_50_50', label: '50/50 Vertical Split' },
    { id: 'blurred_bg_center', label: '16:9 Center with Blurred BG' },
  ];

  return (
    <div className="space-y-3">
      <span className="text-[10px] font-bold uppercase text-[#8B90A0] block">Layout Preset</span>
      <div className="space-y-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => updateEDL((prev) => ({ ...prev, layout: { ...prev.layout, type: p.id } }))}
            className={`w-full p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
              currentLayout === p.id
                ? 'bg-[#1A1D24] border-[#8FD3FF] text-white shadow-sm'
                : 'bg-[#1A1D24]/40 border-white/5 text-[#8B90A0] hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AudioSubTab() {
  return (
    <div className="space-y-3 text-slate-400 text-xs">
      <div className="p-3 bg-[#1A1D24] rounded-xl border border-white/5 space-y-2">
        <span className="font-bold text-white block">Smart Audio Processing</span>
        <div className="flex items-center justify-between text-[11px]">
          <span>Loudness Normalization</span>
          <span className="text-[#8FD3FF] font-bold">-14 LUFS</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span>Silence Stripping</span>
          <span className="text-emerald-400 font-bold">Enabled</span>
        </div>
      </div>
    </div>
  );
}
