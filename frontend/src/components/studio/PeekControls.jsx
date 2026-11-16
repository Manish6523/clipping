import React, { useRef } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ChevronUp, Upload, ScanFace } from 'lucide-react';
import { useTemplateEditorStore } from '../../store/templateEditorStore';
import { CAPTION_STYLES } from '../../lib/captionStyles';
import { useHookStyles } from '../../lib/hookStyles';
import { hexToAss } from '../../utils/colorConversions';

/**
 * Peek-sheet controls: the 3 most-used controls for the current selection in two 44dp rows. Continuous controls
 * (sliders) open ONE undo step on touch and patch the store without further history entries.
 */

const cx = (...c) => c.filter(Boolean).join(' ');

function Btn({ children, onClick, label, active, className = '', disabled }) {
  return (
    <button
      type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={cx('flex h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl px-2.5 text-[13px] font-semibold',
        active ? 'bg-accent-strong text-white' : 'bg-white/[0.07] text-slate-100 active:bg-white/[0.14]', disabled && 'opacity-35', className)}
    >
      {children}
    </button>
  );
}

/** Range input whose whole drag is ONE history step. */
export function GSlider({ value, min, max, step = 1, onBegin, onChange, label, className = '' }) {
  const began = useRef(false);
  const begin = () => { if (!began.current) { began.current = true; onBegin(); } };
  const end = () => { began.current = false; };
  return (
    <input
      type="range" aria-label={label} min={min} max={max} step={step} value={value}
      onPointerDown={begin} onKeyDown={begin} onPointerUp={end} onPointerCancel={end} onBlur={end} onKeyUp={end}
      onChange={(e) => { begin(); onChange(Number(e.target.value)); }}
      className={cx('h-[44px] min-w-0 flex-1 accent-[#3987e5]', className)}
      style={{ touchAction: 'pan-x' }}
    />
  );
}

/** ±1 / ±10 px nudges of the selected layer's position on the 1080×1920 output. */
export function NudgePad({ layer, compact = false }) {
  const [step, setStep] = React.useState(10);
  const nudge = (dxPx, dyPx) => {
    const s = useTemplateEditorStore.getState();
    const l = (s.layout.layers || []).find((x) => x.id === layer.id);
    if (!l || l.locked) return;
    const d = l.dst || { x: 0, y: 0, w: 1, h: 1 };
    s.beginGesture();
    s.patchLayer(l.id, { dst: { ...d, x: Math.round(Math.max(0, Math.min(1 - d.w, d.x + dxPx / 1080)) * 10000) / 10000, y: Math.round(Math.max(0, Math.min(1 - d.h, d.y + dyPx / 1920)) * 10000) / 10000 } });
  };
  const steps = [1, 10];
  return (
    <div className={cx('flex items-center gap-1.5', compact ? '' : 'justify-between')} data-testid="nudge-pad">
      <div className="flex gap-1.5">
        <Btn label="Nudge left" onClick={() => nudge(-step, 0)} disabled={layer.locked}><ArrowLeft size={18} /></Btn>
        <Btn label="Nudge right" onClick={() => nudge(step, 0)} disabled={layer.locked}><ArrowRight size={18} /></Btn>
        <Btn label="Nudge up" onClick={() => nudge(0, -step)} disabled={layer.locked}><ArrowUp size={18} /></Btn>
        <Btn label="Nudge down" onClick={() => nudge(0, step)} disabled={layer.locked}><ArrowDown size={18} /></Btn>
      </div>
      <div className="flex gap-1.5" role="group" aria-label="Nudge step">
        {steps.map((n) => <Btn key={n} label={`${n} pixel steps`} active={step === n} onClick={() => setStep(n)}>±{n}</Btn>)}
      </div>
    </div>
  );
}

function MoreBtn({ onMore }) {
  return <Btn label="More options" onClick={onMore} className="gap-1"><ChevronUp size={16} /> More</Btn>;
}

function Strip({ children }) {
  return <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto no-scrollbar">{children}</div>;
}

export default function PeekControls({ channels = [], onMore, onPickLogo }) {
  const s = useTemplateEditorStore();
  const hookStyles = useHookStyles() || [];
  const sel = s.selection;
  const row = 'flex items-center gap-1.5';
  const wrap = 'flex flex-col gap-1.5 px-3 pb-2 pt-0.5';

  if (sel.type === 'layer') {
    const layer = (s.layout.layers || []).find((l) => l.id === sel.id);
    if (!layer) return <div className={wrap}><p className="py-3 text-[12px] text-muted">Select a layer on the stage.</p></div>;
    return (
      <div className={wrap} data-testid="peek-layer">
        <div className={row}>
          <div className="flex flex-1 gap-1.5" role="group" aria-label="Fit">
            {['cover', 'contain'].map((f) => (
              <Btn key={f} label={`Fit: ${f}`} active={(layer.fit || 'cover') === f} onClick={() => s.updateLayer(layer.id, { fit: f })} className="flex-1 capitalize">{f}</Btn>
            ))}
          </div>
          <Btn
            label="Follow face" active={layer.tracking?.mode === 'face'}
            onClick={() => s.updateLayer(layer.id, { tracking: { smooth: 0.8, ...(layer.tracking || {}), mode: layer.tracking?.mode === 'face' ? 'off' : 'face' } })}
            className="gap-1.5"
          ><ScanFace size={16} />Follow face</Btn>
        </div>
        <div className={row}>
          <Btn label="Keep proportions when resizing" active={layer.aspect_lock !== false} onClick={() => s.updateLayer(layer.id, { aspect_lock: layer.aspect_lock === false })} className="flex-1">
            {layer.aspect_lock !== false ? 'Proportions locked' : 'Free resize'}
          </Btn>
          <MoreBtn onMore={onMore} />
        </div>
      </div>
    );
  }

  if (sel.type === 'captions') {
    const presets = CAPTION_STYLES.filter((x) => x.id !== 'template');
    const apply = (p) => {
      s.beginGesture();
      s.patchSubtitles({
        font_name: p.font || p.family?.replace(/['"]/g, '') || s.subtitles.font_name,
        font_size: p.size || s.subtitles.font_size,
        primary_color: hexToAss(p.color || '#FFFFFF'), highlight_color: hexToAss(p.highlight || '#FACC15'), outline_color: hexToAss(p.outline || '#000000'),
        outline: p.outlineWidth ?? s.subtitles.outline, shadow: p.shadow ?? s.subtitles.shadow, animation: p.anim || s.subtitles.animation, uppercase: p.upper !== false,
      });
      useTemplateEditorStore.setState({ defaultCaptionStyle: p.id, isDirty: true });
    };
    const size = Number(s.subtitles.font_size) || 72;
    const setSize = (v) => { s.beginGesture(); s.patchSubtitles({ font_size: Math.max(20, Math.min(160, v)) }); useTemplateEditorStore.setState({ defaultCaptionStyle: 'template' }); };
    return (
      <div className={wrap} data-testid="peek-captions">
        <div className={row}>
          <Strip>
            {presets.map((p) => (
              <Btn key={p.id} label={`Caption style ${p.label}`} active={s.defaultCaptionStyle === p.id} onClick={() => apply(p)}>{p.label}</Btn>
            ))}
          </Strip>
        </div>
        <div className={row}>
          <Btn label="Smaller text" onClick={() => setSize(size - 4)}>−</Btn>
          <span className="w-[36px] shrink-0 text-center text-[12px] font-semibold tabular-nums text-ink">{size}</span>
          <Btn label="Larger text" onClick={() => setSize(size + 4)}>+</Btn>
          <GSlider label="Caption position (vertical)" min={8} max={92} value={Math.round((s.subtitles.position?.y ?? 0.76) * 100)}
            onBegin={s.beginGesture} onChange={(v) => s.patchSubtitles({ position: { ...s.subtitles.position, y: v / 100 } })} />
          <MoreBtn onMore={onMore} />
        </div>
      </div>
    );
  }

  if (sel.type === 'hook') {
    return (
      <div className={wrap} data-testid="peek-hook">
        <div className={row}>
          <Strip>
            {hookStyles.map((h) => (
              <Btn key={h.id} label={`Hook style ${h.label || h.id}`} active={s.defaultHookStyle === h.id}
                onClick={() => useTemplateEditorStore.setState({ defaultHookStyle: h.id, isDirty: true })}>{h.label || h.name || h.id}</Btn>
            ))}
          </Strip>
        </div>
        <div className={row}>
          <p className="min-w-0 flex-1 truncate text-[11.5px] text-muted">Title card for the first 1.5 s of every clip</p>
          <MoreBtn onMore={onMore} />
        </div>
      </div>
    );
  }

  if (sel.type === 'watermark') {
    const wm = s.watermark;
    if (!wm.enabled || !wm.url) {
      return (
        <div className={wrap} data-testid="peek-watermark">
          <div className={row}><Btn label="Add your logo" onClick={onPickLogo} className="flex-1 gap-2"><Upload size={16} /> Add your logo</Btn></div>
          <div className={row}><p className="min-w-0 flex-1 truncate text-[11.5px] text-muted">PNG with transparency works best</p><MoreBtn onMore={onMore} /></div>
        </div>
      );
    }
    return (
      <div className={wrap} data-testid="peek-watermark">
        <div className={row}>
          <span className="w-16 shrink-0 text-[11.5px] text-muted">Opacity</span>
          <GSlider label="Watermark opacity" min={5} max={100} value={Math.round((wm.opacity ?? 0.85) * 100)} onBegin={s.beginGesture} onChange={(v) => s.patchWatermark({ opacity: v / 100 })} />
        </div>
        <div className={row}>
          <span className="w-16 shrink-0 text-[11.5px] text-muted">Width</span>
          <GSlider label="Watermark width" min={60} max={600} step={5} value={wm.width || 220} onBegin={s.beginGesture} onChange={(v) => s.patchWatermark({ width: v })} />
          <MoreBtn onMore={onMore} />
        </div>
      </div>
    );
  }

  if (sel.type === 'background') {
    const bg = s.layout.background || { type: 'solid', blur: 0 };
    return (
      <div className={wrap} data-testid="peek-background">
        <div className={row}>
          <div className="flex flex-1 gap-1.5" role="group" aria-label="Background mode">
            {[['solid', 'Solid'], ['blur', 'Blur']].map(([m, label]) => (
              <Btn key={m} label={`Background ${label}`} active={bg.type === m} className="flex-1"
                onClick={() => s.updateBackground(m === 'blur' ? { type: 'blur', blur: bg.blur || 40, dim: bg.dim ?? 0.4 } : { type: 'solid' })}>{label}</Btn>
            ))}
          </div>
        </div>
        <div className={row}>
          <span className="w-16 shrink-0 text-[11.5px] text-muted">Blur</span>
          <GSlider label="Background blur" min={0} max={80} value={bg.blur || 0} onBegin={s.beginGesture} onChange={(v) => s.patchBackground({ blur: v, type: 'blur' })} />
          <MoreBtn onMore={onMore} />
        </div>
      </div>
    );
  }

  // template
  const assigned = channels.filter((c) => c.template_name === s.templateName);
  return (
    <div className={wrap} data-testid="peek-template">
      <div className={row}>
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{s.templateName || 'Untitled template'}</p>
        <span className="shrink-0 text-[11.5px] text-muted">{(s.layout.layers || []).length} layer{(s.layout.layers || []).length === 1 ? '' : 's'}</span>
      </div>
      <div className={row}>
        <p className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
          {assigned.length ? `Used by ${assigned.map((c) => c.channel_id_or_handle).slice(0, 2).join(', ')}${assigned.length > 2 ? ` +${assigned.length - 2}` : ''}` : 'Not assigned to a streamer yet'}
        </p>
        <MoreBtn onMore={onMore} />
      </div>
    </div>
  );
}
