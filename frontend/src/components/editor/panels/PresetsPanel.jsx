import React, { useState, useEffect } from 'react';
import { Bookmark, Sparkles, Check, Trash2, LayoutTemplate } from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';
import { PRESET_STARTERS } from '../../LayoutBuilder';
import { getTemplates, getPresets } from '../../../api';

export default function PresetsPanel({ isCompact = false }) {
  const { clip, edl, updateEDL } = useEditorStore();
  const [customPresets, setCustomPresets] = useState([]);
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    getTemplates().then(setTemplates).catch(() => {});
    getPresets(clip?.channel_id).then(setCustomPresets).catch(() => {});
  }, [clip?.channel_id]);

  const applyStarter = (presetKey) => {
    const starter = PRESET_STARTERS[presetKey];
    if (!starter) return;
    updateEDL((prev) => ({
      ...prev,
      layout: {
        schema: 2,
        canvas: { w: 1080, h: 1920 },
        background: { ...starter.background },
        layers: starter.layers.map((l) => ({ ...l, id: `l_${Date.now()}_${l.name.toLowerCase()}` }))
      }
    }));
  };

  const applyCustomPreset = (preset) => {
    if (!preset?.data) return;
    updateEDL((prev) => ({
      ...prev,
      layout: preset.data.layout || prev.layout,
      captions: {
        ...(prev.captions || {}),
        font: preset.data.captions?.font || preset.data.subtitles?.font_name || prev.captions?.font,
        size: preset.data.captions?.size || preset.data.subtitles?.font_size || prev.captions?.size,
        animation: preset.data.captions?.animation || preset.data.subtitles?.animation || prev.captions?.animation,
        color: preset.data.captions?.color || preset.data.subtitles?.primary_color || prev.captions?.color,
        highlight: preset.data.captions?.highlight || preset.data.subtitles?.highlight_color || prev.captions?.highlight,
      }
    }));
  };

  const applyTemplate = (tpl) => {
    if (!tpl?.layout) return;
    updateEDL((prev) => ({
      ...prev,
      layout: tpl.layout,
      captions: {
        ...(prev.captions || {}),
        font: tpl.subtitles?.font_name || prev.captions?.font || 'Montserrat ExtraBold',
        size: tpl.subtitles?.font_size || prev.captions?.size || 72,
        animation: tpl.subtitles?.animation || prev.captions?.animation || 'pop',
      }
    }));
  };

  return (
    <div className="flex flex-col gap-3 text-xs select-none">
      {/* Saved Presets */}
      {customPresets.length > 0 && (
        <div>
          <label className="text-[11px] uppercase font-bold text-accent tracking-wider block mb-1.5 flex items-center gap-1">
            <Bookmark size={11} /> Saved Presets ({customPresets.length})
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar">
            {customPresets.map((p) => (
              <button
                key={p.id}
                onClick={() => applyCustomPreset(p)}
                className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-accent/20 hover:border-accent transition-all text-left flex flex-col gap-0.5"
              >
                <div className="font-bold text-white text-xs truncate">{p.name}</div>
                <div className="text-[11px] text-slate-400 capitalize">{p.scope} • {p.data?.layout?.layers?.length || 2} layers</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Streamer Templates */}
      {templates.length > 0 && (
        <div className="pt-1 border-t border-white/[0.06]">
          <label className="text-[11px] uppercase font-bold text-amber-400 tracking-wider block mb-1.5 flex items-center gap-1">
            <LayoutTemplate size={11} /> Streamer Templates ({templates.length})
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
            {templates.map((tpl) => (
              <button
                key={tpl.name}
                onClick={() => applyTemplate(tpl)}
                className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-amber-400/50 transition-all text-left"
              >
                <div className="font-bold text-amber-300 text-xs truncate">{tpl.name}</div>
                <div className="text-[11px] text-slate-400 truncate">{tpl.description || 'Layout template'}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Standard Starter Layouts */}
      <div className="pt-1 border-t border-white/[0.06]">
        <label className="text-[11px] uppercase font-bold text-muted tracking-wider block mb-1.5">
          Standard Layout Starters
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.values(PRESET_STARTERS).map((starter) => (
            <button
              key={starter.id}
              onClick={() => applyStarter(starter.id)}
              className="p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-accent/30 transition-all text-left flex flex-col gap-1"
            >
              <span className="font-bold text-white text-xs">{starter.label}</span>
              <span className="text-[11px] text-slate-400 font-mono">
                {starter.layers.length} visual frame{starter.layers.length > 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

