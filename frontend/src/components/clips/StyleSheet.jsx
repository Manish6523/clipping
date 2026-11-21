import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { Sheet, Button, Segmented, EmptyState } from '../ui';
import CaptionStylePicker from '../CaptionStylePicker';
import HookStylePicker from '../HookStylePicker';
import { styleById } from '../../lib/captionStyles';

/** Mini 9:16 drawing of a template's layer boxes + caption line. */
function TemplatePreview({ layout, captionY }) {
  const layers = (layout?.layers || []).filter((l) => l.visible !== false && l.dst);
  return (
    <svg viewBox="0 0 90 160" className="w-full aspect-[9/16] rounded-lg bg-black">
      {layers.map((l, i) => (
        <rect key={l.id || i} x={(l.dst.x || 0) * 90} y={(l.dst.y || 0) * 160} width={(l.dst.w || 1) * 90} height={(l.dst.h || 1) * 160}
          rx={l.style?.shape === 'circle' ? 45 : 2} fill={l.color || '#334155'} fillOpacity="0.35" stroke={l.color || '#64748b'} strokeWidth="1.5" />
      ))}
      {layers.length === 0 && <rect x="0" y="0" width="90" height="160" fill="#334155" fillOpacity="0.35" />}
      <rect x="18" y={(captionY ?? 0.76) * 160 - 3} width="54" height="6" rx="3" fill="#FACC15" />
    </svg>
  );
}

let templatesCache = null;

/** Change a clip's layout, caption style or hook card (each re-renders the clip). */
export default function StyleSheet({ clip, onClose, actions }) {
  const [tab, setTab] = useState('template');
  const [templates, setTemplates] = useState(templatesCache);
  const [caption, setCaption] = useState('template');
  const [hook, setHook] = useState('template');

  useEffect(() => {
    if (!clip) return;
    setCaption(clip.caption_style || 'template');
    setHook(clip.hook_style || 'template');
    if (!templatesCache) {
      axios.get('/api/templates').then((r) => { templatesCache = Array.isArray(r.data) ? r.data : []; setTemplates(templatesCache); })
        .catch(() => setTemplates([]));
    }
  }, [clip]);

  if (!clip) return null;
  const apply = (kind, value, label) => { onClose(); actions.restyle(clip, kind, value, label); };
  const footer = tab === 'caption' ? (
    <Button block size="lg" variant="primary" disabled={caption === (clip.caption_style || 'template')}
      onClick={() => apply('caption', caption, `${styleById(caption).label} captions`)}>
      {caption === (clip.caption_style || 'template') ? 'Current style' : `Apply ${styleById(caption).label}`}
    </Button>
  ) : tab === 'hook' ? (
    <Button block size="lg" variant="primary" disabled={hook === (clip.hook_style || 'template')} onClick={() => apply('hook', hook, 'hook card')}>
      {hook === (clip.hook_style || 'template') ? 'Current style' : 'Apply hook style'}
    </Button>
  ) : null;

  return (
    <Sheet open={!!clip} onClose={onClose} title={`Style · clip #${clip.id}`} wide footer={footer}>
      <Segmented value={tab} onChange={setTab} ariaLabel="What to change" className="w-full mb-3 [&>button]:flex-1 [&>button]:justify-center"
        options={[{ value: 'template', label: 'Layout' }, { value: 'caption', label: 'Captions' }, { value: 'hook', label: 'Hook card' }]} />
      <p className="text-xs text-muted mb-3">The clip is re-rendered with the same cut and bleeps - takes a minute.</p>
      {tab === 'template' && (
        <>
          {!templates && <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-muted" /></div>}
          {templates && templates.length === 0 && <EmptyState title="No templates found" className="!py-6" />}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {(templates || []).map((t) => {
              const current = t.name === clip.template_name;
              return (
                <button key={t.name} type="button" onClick={() => !current && apply('template', t.name, t.name)}
                  className={`rounded-xl border p-1.5 text-left transition-colors ${current ? 'border-accent bg-accent/10' : 'border-line hover:bg-white/[0.05]'}`}>
                  <TemplatePreview layout={t.layout} captionY={t.subtitles?.position?.y} />
                  <span className="block text-[10.5px] font-semibold text-slate-200 truncate mt-1">{t.name}</span>
                  {current && <span className="block text-[9.5px] text-accent font-semibold">CURRENT</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      {tab === 'caption' && <CaptionStylePicker value={caption} onChange={setCaption} compact />}
      {tab === 'hook' && (
        <HookStylePicker value={hook} onChange={setHook} compact
          templateDefault={(templates || []).find((t) => t.name === clip.template_name)?.hook_style || 'classic'} />
      )}
    </Sheet>
  );
}
