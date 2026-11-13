import React, { useEffect, useState } from 'react';
import { Check, Heading } from 'lucide-react';
import { FONT_FAMILY } from '../lib/captionStyles';
import { useHookStyles, hookSample } from '../lib/hookStyles';

const VIDEO_H = 1920;

function keyWord(text) {
  const words = text.split(' ');
  return words.reduce((best, w) => (w.replace(/[^A-Za-z0-9]/g, '').length > best.replace(/[^A-Za-z0-9]/g, '').length ? w : best), '');
}

/** CSS twin of hook_styles.build_hook_events (same fonts, sizes, colours, shapes). */
export function HookCard({ spec, text, height, animKey }) {
  const k = height / VIDEO_H;
  const px = (v) => `${v * k}px`;
  let t = text || hookSample(spec.id);
  if (spec.quote) t = `“${t}”`;
  if (spec.upper) t = t.toUpperCase();
  const key = (spec.key_color || spec.key_bg) ? keyWord(t) : null;
  const [padX, padY] = spec.pad || [0, 0];
  const family = `${FONT_FAMILY[spec.font] || 'sans-serif'}, sans-serif`;
  const textStyle = {
    fontFamily: family,
    fontSize: px(spec.size),
    lineHeight: 1.08,
    color: spec.color,
    letterSpacing: spec.spacing ? px(spec.spacing) : undefined,
    WebkitTextStroke: spec.outline ? `${spec.outline * 2 * k}px ${spec.outline_color || '#000'}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: spec.glow
      ? `0 0 ${px(18)} ${spec.glow[0]}, 0 0 ${px(40)} ${spec.glow[0]}`
      : spec.shadow ? `${px(spec.shadow)} ${px(spec.shadow)} 0 rgba(0,0,0,.6)` : undefined,
    textAlign: spec.align === 'left' ? 'left' : 'center',
    textRendering: 'geometricPrecision',
  };
  const words = t.split(' ').map((w, i) => {
    const isKey = key && w === key;
    const s = {};
    if (isKey && spec.key_color) s.color = spec.key_color;
    if (isKey && spec.key_bg) { s.background = spec.key_bg; s.padding = `0 ${px(8)}`; }
    if (isKey && spec.glow) s.textShadow = `0 0 ${px(18)} ${spec.glow[1]}, 0 0 ${px(40)} ${spec.glow[1]}`;
    return <React.Fragment key={i}>{i > 0 && ' '}<span style={s}>{w}</span></React.Fragment>;
  });

  let body;
  if (spec.bg === 'line') {
    body = (
      <div style={{ ...textStyle, maxWidth: px(880) }}>
        <span style={{
          background: spec.bg_color, padding: `${px(padY)} ${px(padX)}`, borderRadius: px(spec.radius || 0),
          boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', lineHeight: (1.08 * spec.size + 2 * padY + (spec.line_gap || 0)) / spec.size,
        }}>{words}</span>
      </div>
    );
  } else if (spec.bg === 'block') {
    const b = spec.bg_border;
    body = (
      <div style={{
        position: 'relative', maxWidth: px((spec.max_width || 880)), padding: `${px(padY)} ${px(padX)}`,
        paddingLeft: spec.stripe ? px(padX + spec.stripe[1]) : undefined,
        background: spec.gradient ? `linear-gradient(90deg, ${spec.gradient[0]}, ${spec.gradient[1]})`
          : `${spec.bg_color}${spec.bg_alpha != null ? Math.round(spec.bg_alpha * 255).toString(16).padStart(2, '0') : ''}`,
        borderRadius: spec.radius >= 999 ? '999px' : px(spec.radius || 0),
        border: b ? `${px(b[0])} solid ${b[1]}` : undefined,
        borderLeft: spec.stripe ? `${px(spec.stripe[1])} solid ${spec.stripe[0]}` : undefined,
        boxShadow: spec.bg_shadow ? `${px(spec.bg_shadow)} ${px(spec.bg_shadow)} 0 #000` : undefined,
      }}>
        <div style={textStyle}>{words}</div>
        {spec.tail && (
          <div style={{ position: 'absolute', left: px(70), bottom: px(-62), width: 0, height: 0,
            borderLeft: `${px(8)} solid transparent`, borderRight: `${px(60)} solid transparent`, borderTop: `${px(64)} solid ${spec.bg_color}`,
            filter: `drop-shadow(${px(4)} ${px(4)} 0 #000)` }} />
        )}
        {spec.badge && (
          <div style={{ position: 'absolute', right: px(-56), top: px(-60), width: px(140), height: px(140), borderRadius: '50%',
            background: '#111', color: '#FACC15', fontFamily: "'AC Montserrat Black'", fontSize: px(100),
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</div>
        )}
      </div>
    );
  } else {
    body = <div style={{ ...textStyle, maxWidth: px(880) }}>{words}</div>;
  }

  const tag = spec.tag;
  return (
    <div style={{ transform: spec.rotate ? `rotate(${-spec.rotate}deg)` : undefined }}>
    <div key={animKey} className="flex flex-col" style={{
      alignItems: spec.align === 'left' ? 'flex-start' : 'center',
      animation: spec.gradient ? 'ac-cap-fade 250ms ease-out' : 'ac-hook-pop 260ms ease-out',
    }}>
      {tag && (
        <span style={{
          background: tag.bg, color: tag.color, fontFamily: FONT_FAMILY[tag.font], fontSize: px(tag.size),
          padding: `${px(tag.pad[1])} ${px(tag.pad[0])}`, borderRadius: tag.where === 'left' ? 0 : px(10),
          marginBottom: tag.where === 'left' ? 0 : px(14), transform: tag.rotate ? `rotate(${-tag.rotate}deg)` : undefined,
          lineHeight: 1.08, letterSpacing: px(1), textRendering: 'geometricPrecision',
        }}>{tag.text}</span>
      )}
      {body}
      {spec.underline && (
        <span style={{ width: px(spec.underline[1]), height: px(spec.underline[2]), background: spec.underline[0],
          borderRadius: px(5), marginTop: px(16) }} />
      )}
    </div>
    </div>
  );
}

export function HookPreview({ spec, height = 300, background, captionY = 0.7, playing = true, textScale = 1 }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, [playing]);
  const width = height * 9 / 16;
  const top = (captionY >= 0.4 ? 300 : 1250) / VIDEO_H;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 shrink-0"
      style={{ width, height, background: background ? `center/cover no-repeat url(${background})` : 'linear-gradient(160deg,#1e3a5f 0%,#3b2a5a 45%,#0f172a 100%)' }}>
      {!background && (
        <div className="absolute inset-0 opacity-40"
          style={{ background: 'radial-gradient(circle at 50% 60%, rgba(255,255,255,.3) 0, transparent 32%)' }} />
      )}
      {spec && (
        <div className="absolute inset-x-0 flex justify-center px-[3%]"
          style={{ top: `${top * 100}%`, justifyContent: spec.align === 'left' ? 'flex-start' : 'center', paddingLeft: spec.align === 'left' ? `${(60 / 1080) * 100}%` : undefined }}>
          <HookCard spec={spec} height={height * textScale} animKey={tick} />
        </div>
      )}
    </div>
  );
}

/**
 * Hook card style chooser. `allowTemplate` adds a "Template default" option (value "template").
 * `templateDefault` is the id that option resolves to, shown in its preview.
 */
export default function HookStylePicker({ value, onChange, allowTemplate = true, templateDefault = 'classic', compact = false }) {
  const styles = useHookStyles();
  if (!styles) return <div className="h-40 rounded-xl bg-white/[0.03] animate-pulse" />;
  const byId = Object.fromEntries(styles.map((s) => [s.id, s]));
  const options = [
    ...(allowTemplate ? [{ id: 'template', label: 'Template default', hint: `Uses the template's hook style (${byId[templateDefault]?.label || 'Classic'})`, preview: templateDefault }] : []),
    ...styles.map((s) => ({ id: s.id, label: s.label, hint: s.hint, preview: s.id })),
  ];
  const current = options.find((o) => o.id === value) || options[0];
  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center">
        <HookPreview spec={byId[current.preview]} height={compact ? 220 : 260} />
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-white"><Heading size={14} className="text-amber-300" /> {current.label}</div>
          <p className="text-[11px] text-slate-400 leading-snug">{current.hint}</p>
          <p className="text-[10px] text-slate-500 leading-snug">Shown for the first ~2.4 s. Text comes from the clip's best line or AI title.</p>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x" role="radiogroup" aria-label="Hook card style">
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
              className={`snap-start shrink-0 rounded-xl border p-1 text-left transition ${on ? 'border-amber-400 bg-amber-500/10' : 'border-white/10 active:bg-white/[0.05]'}`}>
              <div className="relative">
                <HookPreview spec={byId[o.preview]} height={124} playing={false} textScale={1.6} />
                {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center"><Check size={12} /></span>}
              </div>
              <span className="block text-[10px] font-bold text-slate-200 truncate mt-1 w-[70px]">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
