import React, { useState } from 'react';
import { Wand2, ChevronDown, Zap, Sparkles, Scissors } from 'lucide-react';
import { Toggle } from './ui';

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
    <div className={`rounded-xl border p-3 space-y-3 transition-colors ${value.enabled ? 'border-accent/30 bg-accent/[0.05]' : 'border-line bg-canvas'}`}>
      <Toggle checked={value.enabled} onChange={(v) => update({ ...value, enabled: v })}
        label={<span className="flex items-center gap-2 font-semibold"><Wand2 size={15} className="text-accent shrink-0" /> Auto edit</span>}
        hint="Cuts dead air, adds a hook card, zooms and polishes the audio." />

      {value.enabled && (
        <>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Edit style">
            {Object.entries(AUTO_EDIT_STYLES).map(([id, st]) => {
              const Icon = st.icon;
              const active = value.style === id;
              return (
                <button key={id} type="button" role="radio" aria-checked={active} onClick={() => update({ ...value, style: id, overrides: {} })}
                  className={`p-2 rounded-xl border text-left transition-colors ${active ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-slate-300 hover:bg-white/[0.04]'}`}>
                  <span className="flex items-center gap-1 text-xs font-semibold"><Icon size={13} className={active ? 'text-accent' : ''} /> {st.label}</span>
                  <span className="block text-[10.5px] text-muted leading-tight mt-0.5">{st.hint}</span>
                </button>
              );
            })}
          </div>

          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="w-full flex items-center justify-between text-[11.5px] font-semibold text-slate-300">
            <span>Customize{changed ? ` · ${changed} changed` : ''}</span>
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="divide-y divide-line">
              {FEATURES.map(([key, label]) => (
                <div key={key} className="py-2.5">
                  <Toggle checked={!!effective[key]} label={<span className="text-xs">{label}</span>}
                    onChange={(on) => {
                      const overrides = { ...value.overrides };
                      if (on === preset.features[key]) delete overrides[key];
                      else overrides[key] = on;
                      update({ ...value, overrides });
                    }} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
