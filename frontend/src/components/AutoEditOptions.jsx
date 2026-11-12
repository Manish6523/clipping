import React, { useState } from 'react';
import { Wand2, ChevronDown, Zap, Sparkles, Scissors } from 'lucide-react';

// Mirrors STYLES in src/compositor/auto_edit.py
export const AUTO_EDIT_STYLES = {
  punchy: {
    label: 'Punchy', icon: Zap, hint: 'Fast cuts, zoom punch-ins, SFX',
    features: { tighten: true, jump_cuts: true, remove_fillers: true, hook_card: true, zooms: true, sfx: true, word_pop: true, loudnorm: true },
  },
  clean: {
    label: 'Clean', icon: Sparkles, hint: 'Tight cuts, gentle zooms',
    features: { tighten: true, jump_cuts: true, remove_fillers: true, hook_card: true, zooms: true, sfx: false, word_pop: true, loudnorm: true },
  },
  minimal: {
    label: 'Minimal', icon: Scissors, hint: 'Only trims dead air',
    features: { tighten: true, jump_cuts: true, remove_fillers: false, hook_card: false, zooms: false, sfx: false, word_pop: false, loudnorm: true },
  },
};

const FEATURES = [
  ['tighten', 'Start on the hook, end on the payoff'],
  ['jump_cuts', 'Cut silent pauses (keeps loud action)'],
  ['remove_fillers', 'Remove “um” / “uh”'],
  ['hook_card', 'Hook title card (first 2s)'],
  ['zooms', 'Zoom punch-ins on hype moments'],
  ['sfx', 'Sound effects (whoosh, boom)'],
  ['word_pop', 'Colour hype words in captions'],
  ['loudnorm', 'Loudness for Shorts (−14 LUFS)'],
];

const STORE_KEY = 'autoclip_auto_edit';

export function loadAutoEdit() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (v && AUTO_EDIT_STYLES[v.style]) return { enabled: v.enabled !== false, style: v.style, overrides: v.overrides || {} };
  } catch { /* storage unavailable */ }
  return { enabled: true, style: 'punchy', overrides: {} };
}

/** Request payload for the API (only explicit overrides are sent). */
export function autoEditPayload(value) {
  if (!value?.enabled) return undefined;
  return { enabled: true, style: value.style, ...value.overrides };
}

export default function AutoEditOptions({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const preset = AUTO_EDIT_STYLES[value.style] || AUTO_EDIT_STYLES.punchy;
  const effective = { ...preset.features, ...value.overrides };
  const changed = Object.keys(value.overrides || {}).length;

  const update = (next) => {
    onChange(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  return (
    <div className={`rounded-xl border p-3 space-y-3 transition-colors ${value.enabled ? 'border-fuchsia-500/40 bg-fuchsia-500/[0.06]' : 'border-white/[0.08] bg-slate-950/60'}`}>
      <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
        <span className="flex items-center gap-2 min-w-0">
          <Wand2 size={16} className="text-fuchsia-300 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-white">Auto edit</span>
            <span className="block text-[11px] text-slate-400 leading-snug">Cuts dead air, adds a hook card, zooms &amp; polished audio.</span>
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          onClick={() => update({ ...value, enabled: !value.enabled })}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${value.enabled ? 'bg-fuchsia-500' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {value.enabled && (
        <>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Edit style">
            {Object.entries(AUTO_EDIT_STYLES).map(([id, st]) => {
              const Icon = st.icon;
              const active = value.style === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => update({ ...value, style: id, overrides: {} })}
                  className={`p-2 rounded-lg border text-left ${active ? 'border-fuchsia-400 bg-fuchsia-500/15 text-white' : 'border-white/10 text-slate-300'}`}
                >
                  <span className="flex items-center gap-1 text-xs font-bold"><Icon size={13} /> {st.label}</span>
                  <span className="block text-[10px] text-slate-400 leading-tight mt-0.5">{st.hint}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between text-[11px] font-bold text-slate-300"
            aria-expanded={open}
          >
            <span>Customize{changed ? ` · ${changed} changed` : ''}</span>
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="divide-y divide-white/[0.06]">
              {FEATURES.map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 py-2 cursor-pointer">
                  <span className="text-xs text-slate-200">{label}</span>
                  <input
                    type="checkbox"
                    checked={!!effective[key]}
                    onChange={(e) => {
                      const overrides = { ...value.overrides };
                      if (e.target.checked === preset.features[key]) delete overrides[key];
                      else overrides[key] = e.target.checked;
                      update({ ...value, overrides });
                    }}
                    className="w-5 h-5 accent-fuchsia-500 shrink-0"
                  />
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
