import React, { useEffect, useMemo, useState } from 'react';
import { Type, Heading, Wand2, Check, Sparkles } from 'lucide-react';
import { CAPTION_STYLES, styleById } from '../lib/captionStyles';
import { CaptionLine } from './CaptionStylePicker';
import { HookCard } from './HookStylePicker';
import { useHookStyles, hookSample } from '../lib/hookStyles';
import AutoEditOptions from './AutoEditOptions';

const SAMPLE_WORDS = 'bro he did not just do that no way'.split(' ');
const VIDEO_H = 1920;

function chunksFor(style, words = SAMPLE_WORDS) {
  const out = [];
  for (let i = 0; i < words.length; i += style.words) out.push(words.slice(i, i + style.words));
  return out;
}

export default function CombinedStyleStudio({
  captionStyle,
  onCaptionChange,
  hookStyle,
  onHookChange,
  autoEdit,
  onAutoEditChange,
  templateDefaultCaption,
  templateDefaultHook = 'classic',
}) {
  const [activeTab, setActiveTab] = useState('captions'); // 'captions' | 'hook'
  const hookStylesList = useHookStyles() || [];
  const hookMap = useMemo(() => Object.fromEntries(hookStylesList.map((s) => [s.id, s])), [hookStylesList]);

  // Caption animation ticker
  const [capTick, setCapTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCapTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, [captionStyle]);

  // Hook card ticker
  const [hookTick, setHookTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHookTick((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, [hookStyle]);

  // Resolve actual style specs
  const resolvedCapId = captionStyle === 'template' && templateDefaultCaption && templateDefaultCaption !== 'template'
    ? templateDefaultCaption
    : captionStyle;
  const currentCaptionSpec = styleById(resolvedCapId);
  const capChunks = useMemo(() => chunksFor(currentCaptionSpec), [currentCaptionSpec]);

  const totalCapWords = SAMPLE_WORDS.length;
  const capPos = capTick % (totalCapWords + 2);
  const wordIdx = Math.min(capPos, totalCapWords - 1);
  const chunkIdx = Math.floor(wordIdx / currentCaptionSpec.words);
  const capActiveWord = capPos >= totalCapWords ? -1 : wordIdx - chunkIdx * currentCaptionSpec.words;

  const resolvedHookId = hookStyle === 'template' ? templateDefaultHook : hookStyle;
  const currentHookSpec = hookMap[resolvedHookId] || hookMap['classic'] || hookStylesList[0];

  const hasHookCard = autoEdit?.enabled && autoEdit?.overrides?.hook_card !== false;

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-sm space-y-4">
      {/* Top Header / Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/5">
        <div className="flex items-center gap-1 p-1 bg-slate-950/80 border border-white/10 rounded-xl overflow-x-auto no-scrollbar max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('captions')}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
              activeTab === 'captions'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Type size={13} className="text-pink-300" /> Kinetic Captions
          </button>
          {hasHookCard && (
            <button
              type="button"
              onClick={() => setActiveTab('hook')}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                activeTab === 'hook'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Heading size={13} className="text-amber-300" /> Hook Title Card
            </button>
          )}
        </div>

        <span className="hidden md:inline-block text-[10px] uppercase font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full shrink-0">
          Live Phone Preview
        </span>
      </div>

      {/* Unified Single Preview Canvas & Details */}
      <div className="flex gap-4 items-center">
        {/* Single Phone Screen 9:16 Canvas displaying both or currently selected mode */}
        <div
          className="relative overflow-hidden rounded-2xl border border-white/15 shadow-2xl shrink-0"
          style={{
            width: 152,
            height: 270,
            background: 'linear-gradient(160deg,#1e3a5f 0%,#3b2a5a 45%,#0f172a 100%)',
          }}
        >
          {/* Subtle Ambient Glow */}
          <div
            className="absolute inset-0 opacity-40 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 50% 35%, rgba(255,255,255,.35) 0, transparent 32%), radial-gradient(circle at 20% 80%, rgba(56,189,248,.35) 0, transparent 35%)',
            }}
          />

          {/* Hook Card Placement (Top / Upper Third) */}
          {hasHookCard && currentHookSpec && (activeTab === 'hook' || activeTab === 'captions') && (
            <div
              className={`absolute inset-x-0 flex justify-center px-[4%] transition-opacity duration-300 ${
                activeTab === 'hook' ? 'opacity-100 scale-100 ring-1 ring-amber-400/40 rounded-lg py-1' : 'opacity-85'
              }`}
              style={{
                top: '20%',
                justifyContent: currentHookSpec.align === 'left' ? 'flex-start' : 'center',
                paddingLeft: currentHookSpec.align === 'left' ? `${(60 / 1080) * 100}%` : undefined,
              }}
            >
              <HookCard
                spec={currentHookSpec}
                height={270 * 0.95}
                animKey={hookTick}
              />
            </div>
          )}

          {/* Caption Line Placement (Lower Center) */}
          <div
            className={`absolute inset-x-0 px-[4%] transition-opacity duration-300 ${
              activeTab === 'captions' ? 'opacity-100' : 'opacity-85'
            }`}
            style={{ top: '70%', transform: 'translateY(-50%)' }}
          >
            <CaptionLine
              style={currentCaptionSpec}
              words={capChunks[chunkIdx] || []}
              active={capActiveWord}
              height={270 * 1.05}
              animKey={capTick}
            />
          </div>

          {/* Mini active badge inside preview corner */}
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-black/60 text-white/80 border border-white/10 backdrop-blur-sm pointer-events-none">
            {activeTab === 'captions' ? 'CAPTIONS' : 'HOOK CARD'}
          </span>
        </div>

        {/* Selected Spec Info & Mode Details */}
        <div className="min-w-0 flex-1 space-y-2">
          {activeTab === 'captions' ? (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <Type size={14} className="text-pink-300" /> {currentCaptionSpec.label}
              </div>
              <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                {captionStyle === 'template' && templateDefaultCaption && templateDefaultCaption !== 'template'
                  ? `Uses template's preset font (${currentCaptionSpec.label})`
                  : currentCaptionSpec.hint}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Dynamic karaoke words animated in sync with speaker voice.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <Heading size={14} className="text-amber-300" /> {currentHookSpec?.label || 'Hook Card'}
              </div>
              <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                {currentHookSpec?.hint || 'First 2s visual hook title card.'}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Shown for the first ~2.4s to grab viewer retention on TikTok/Shorts.
              </p>
            </div>
          )}

          <div className="pt-2 border-t border-white/5 flex items-center gap-2">
            <span className="text-[10px] text-slate-400 font-medium">Quick switch:</span>
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'captions' ? 'hook' : 'captions')}
              className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            >
              {activeTab === 'captions' ? 'Configure Hook Card →' : 'Configure Subtitles →'}
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal Carousel Options for Currently Active Tab */}
      <div>
        <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
          {activeTab === 'captions' ? 'Choose Subtitle Style' : 'Choose Hook Card Style'}
        </span>

        {activeTab === 'captions' ? (
          <div className="flex gap-2 overflow-x-auto pb-1.5 px-0.5 snap-x no-scrollbar" role="radiogroup" aria-label="Caption style">
            {CAPTION_STYLES.map((s) => {
              const on = s.id === captionStyle;
              const resolved = s.id === 'template' && templateDefaultCaption && templateDefaultCaption !== 'template'
                ? templateDefaultCaption
                : s.id;
              const spec = styleById(resolved);
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onCaptionChange(s.id)}
                  className={`snap-start shrink-0 rounded-xl border p-1 text-left transition-all ${
                    on ? 'border-pink-500 bg-pink-500/10 shadow-sm' : 'border-white/10 hover:border-white/20 bg-slate-950/40'
                  }`}
                >
                  <div
                    className="relative rounded-lg overflow-hidden flex items-center justify-center p-1"
                    style={{ width: 72, height: 110, background: 'linear-gradient(160deg,#1e3a5f 0%,#3b2a5a 45%,#0f172a 100%)' }}
                  >
                    <div className="px-1 scale-90">
                      <CaptionLine
                        style={spec}
                        words={['BRO', 'HE', 'DID']}
                        active={1}
                        height={110 * 1.8}
                        animKey={1}
                      />
                    </div>
                    {on && (
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-pink-500 text-white flex items-center justify-center shadow">
                        <Check size={10} />
                      </span>
                    )}
                  </div>
                  <span className="block text-[10px] font-bold text-slate-200 truncate mt-1 w-[72px] text-center">
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1.5 px-0.5 snap-x no-scrollbar" role="radiogroup" aria-label="Hook card style">
            <button
              type="button"
              role="radio"
              aria-checked={hookStyle === 'template'}
              onClick={() => onHookChange('template')}
              className={`snap-start shrink-0 rounded-xl border p-1 text-left transition-all ${
                hookStyle === 'template' ? 'border-amber-400 bg-amber-500/10 shadow-sm' : 'border-white/10 hover:border-white/20 bg-slate-950/40'
              }`}
            >
              <div
                className="relative rounded-lg overflow-hidden flex items-center justify-center p-1"
                style={{ width: 72, height: 110, background: 'linear-gradient(160deg,#1e3a5f 0%,#3b2a5a 45%,#0f172a 100%)' }}
              >
                {hookMap[templateDefaultHook] && (
                  <HookCard spec={hookMap[templateDefaultHook]} height={110 * 1.5} animKey={1} />
                )}
                {hookStyle === 'template' && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center shadow">
                    <Check size={10} />
                  </span>
                )}
              </div>
              <span className="block text-[10px] font-bold text-slate-200 truncate mt-1 w-[72px] text-center">
                Template
              </span>
            </button>

            {hookStylesList.map((h) => {
              const on = h.id === hookStyle;
              return (
                <button
                  key={h.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onHookChange(h.id)}
                  className={`snap-start shrink-0 rounded-xl border p-1 text-left transition-all ${
                    on ? 'border-amber-400 bg-amber-500/10 shadow-sm' : 'border-white/10 hover:border-white/20 bg-slate-950/40'
                  }`}
                >
                  <div
                    className="relative rounded-lg overflow-hidden flex items-center justify-center p-1"
                    style={{ width: 72, height: 110, background: 'linear-gradient(160deg,#1e3a5f 0%,#3b2a5a 45%,#0f172a 100%)' }}
                  >
                    <HookCard spec={h} height={110 * 1.5} animKey={1} />
                    {on && (
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center shadow">
                        <Check size={10} />
                      </span>
                    )}
                  </div>
                  <span className="block text-[10px] font-bold text-slate-200 truncate mt-1 w-[72px] text-center">
                    {h.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Integrated Auto-Edit Engine (Cuts, Zooms, Pacing) */}
      <div className="pt-2 border-t border-white/5">
        <AutoEditOptions value={autoEdit} onChange={onAutoEditChange} />
      </div>
    </div>
  );
}

