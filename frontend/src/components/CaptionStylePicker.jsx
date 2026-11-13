import React, { useEffect, useMemo, useState } from 'react';
import { Type, Check } from 'lucide-react';
import { CAPTION_STYLES, styleById } from '../lib/captionStyles';

const SAMPLE = 'bro he did not just do that no way'.split(' ');
const VIDEO_H = 1920;

/** Words of `sample` split the way the renderer chunks them (style.words per screen). */
function chunksFor(style, words = SAMPLE) {
  const out = [];
  for (let i = 0; i < words.length; i += style.words) out.push(words.slice(i, i + style.words));
  return out;
}

/**
 * CSS twin of the libass captions: same fonts, colours, outline, box/glow/karaoke modes,
 * scaled from the 1920px-tall video to the preview's height.
 */
export function CaptionLine({ style, words, active, height, animKey }) {
  const k = height / VIDEO_H;
  const stroke = Math.max(1, style.outlineWidth * 2 * k);
  const base = {
    fontFamily: `${style.family}, Impact, sans-serif`,
    fontSize: `${style.size * k}px`,
    lineHeight: 1.15,
    letterSpacing: style.spacing ? `${style.spacing * k}px` : undefined,
    textTransform: style.upper ? 'uppercase' : 'none',
    color: style.color,
    WebkitTextStroke: style.mode === 'glow' ? `${stroke}px ${style.outline}` : `${stroke}px ${style.outline}`,
    paintOrder: 'stroke fill',
    textShadow: style.mode === 'glow'
      ? `0 0 ${6 * k * 3}px ${style.glow}, 0 0 ${14 * k * 3}px ${style.glow}`
      : style.shadow ? `${style.shadow * k * 1.5}px ${style.shadow * k * 1.5}px 0 rgba(0,0,0,.85)` : undefined,
    fontWeight: 400,
  };
  const anim = style.anim === 'pop' ? 'ac-cap-pop 220ms ease-out' : style.anim === 'bounce' ? 'ac-cap-bounce 260ms ease-out'
    : style.anim === 'fade' ? 'ac-cap-fade 200ms ease-out' : undefined;
  return (
    <div style={base} className="text-center break-words">
      {words.map((w, i) => {
        const isActive = i === active;
        const spoken = style.mode === 'progressive' && i < active;
        const s = { display: 'inline-block', margin: `0 ${8 * k}px` };
        if (isActive || spoken) s.color = style.highlight;
        if (isActive && style.mode === 'box') {
          Object.assign(s, {
            background: style.box, borderRadius: `${10 * k}px`, padding: `0 ${14 * k}px`,
            WebkitTextStroke: '0px transparent', textShadow: 'none',
          });
        }
        if (isActive && style.mode === 'glow') {
          s.textShadow = `0 0 ${18 * k}px ${style.activeGlow}, 0 0 ${42 * k}px ${style.activeGlow}`;
        }
        if (isActive && anim) s.animation = anim;
        return <span key={`${animKey}-${i}-${isActive}`} style={s}>{w}</span>;
      })}
    </div>
  );
}

/** Phone-shaped live preview: plays the sample sentence word by word in the chosen style. */
export function CaptionPreview({ styleId, height = 300, background, captionY = 0.68, playing = true, textScale = 1 }) {
  const style = styleById(styleId);
  const chunks = useMemo(() => chunksFor(style), [style]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (!playing) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, [styleId, playing]);
  const total = SAMPLE.length;
  const pos = playing ? tick % (total + 2) : 2;           // short pause at the end of the sentence
  const wordIdx = Math.min(pos, total - 1);
  const chunkIdx = Math.floor(wordIdx / style.words);
  const active = pos >= total ? -1 : wordIdx - chunkIdx * style.words;
  const width = height * 9 / 16;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 shrink-0"
      style={{ width, height, background: background ? `center/cover no-repeat url(${background})` : 'linear-gradient(160deg,#1e3a5f 0%,#3b2a5a 45%,#0f172a 100%)' }}>
      {!background && (
        <div className="absolute inset-0 opacity-40"
          style={{ background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,.35) 0, transparent 30%), radial-gradient(circle at 20% 80%, rgba(56,189,248,.35) 0, transparent 35%)' }} />
      )}
      <div className="absolute inset-x-0 px-[4%]" style={{ top: `${captionY * 100}%`, transform: 'translateY(-50%)' }}>
        <CaptionLine style={style} words={chunks[chunkIdx] || []} active={active} height={height * textScale} animKey={tick} />
      </div>
    </div>
  );
}

/** Style chooser: big live preview + scrollable chips, each with its own mini preview. */
export default function CaptionStylePicker({ value, onChange, background, captionY, compact = false }) {
  const current = styleById(value);
  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center">
        <CaptionPreview styleId={value} height={compact ? 220 : 260} background={background} captionY={captionY} />
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-white"><Type size={14} className="text-pink-300" /> {current.label}</div>
          <p className="text-[11px] text-slate-400 leading-snug">{current.hint}</p>
          <p className="text-[10px] text-slate-500 leading-snug">Live preview. The video uses the same fonts and colours.</p>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x" role="radiogroup" aria-label="Caption style">
        {CAPTION_STYLES.map((s) => {
          const on = s.id === value;
          return (
            <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(s.id)}
              className={`snap-start shrink-0 rounded-xl border p-1 text-left transition ${on ? 'border-pink-400 bg-pink-500/10' : 'border-white/10 active:bg-white/[0.05]'}`}>
              <div className="relative">
                <CaptionPreview styleId={s.id} height={124} playing={false} background={background} captionY={0.55} textScale={2.1} />
                {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center"><Check size={12} /></span>}
              </div>
              <span className="block text-[10px] font-bold text-slate-200 truncate mt-1 w-[70px]">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
