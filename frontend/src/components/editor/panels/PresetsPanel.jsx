import React, { useState, useEffect } from 'react';
import { Bookmark, Sparkles, Check, Trash2 } from 'lucide-react';
import { useEditorStore } from '../../../store/editorStore';
import { PRESET_STARTERS } from '../../LayoutBuilder';
import { getTemplates } from '../../../api';

export default function PresetsPanel({ isCompact = false }) {
  const { clip, edl, updateEDL } = useEditorStore();
  const [customPresets, setCustomPresets] = useState([]);
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    getTemplates().then(setTemplates).catch(() => {});
  }, []);

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
      <div>
        <label className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider block mb-1.5">
          Standard Starter Layouts
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.values(PRESET_STARTERS).map((starter) => (
            <button
              key={starter.id}
              onClick={() => applyStarter(starter.id)}
              className="p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-[#8FD3FF]/30 transition-all text-left flex flex-col gap-1"
            >
              <span className="font-bold text-white text-xs">{starter.label}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {starter.layers.length} visual frame{starter.layers.length > 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {templates.length > 0 && (
        <div className="pt-2 border-t border-white/[0.06]">
          <label className="text-[10px] uppercase font-bold text-[#8B90A0] tracking-wider block mb-1.5">
            Streamer Templates
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
            {templates.map((tpl) => (
              <button
                key={tpl.name}
                onClick={() => applyTemplate(tpl)}
                className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-amber-400/30 transition-all text-left"
              >
                <div className="font-bold text-amber-300 text-xs truncate">{tpl.name}</div>
                <div className="text-[10px] text-slate-400 truncate">{tpl.description || 'Custom template'}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

