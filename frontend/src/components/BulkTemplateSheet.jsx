import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, Ban, RefreshCw } from 'lucide-react';
import { Sheet, Button, Notice, Progress, Spinner } from './ui';
import TemplateMini from './TemplateMini';
import { getTemplates, bulkRetemplate, getBulkRetemplate, cancelBulkRetemplate } from '../api';

const POLL_MS = 1500;
const CONFIRM_ABOVE = 10;

const STATUS = {
  queued: { icon: Clock, cls: 'text-muted', label: 'Queued' },
  rendering: { icon: Loader2, cls: 'text-accent animate-spin', label: 'Rendering' },
  done: { icon: CheckCircle2, cls: 'text-good', label: 'Done' },
  failed: { icon: XCircle, cls: 'text-bad', label: 'Failed' },
  cancelled: { icon: Ban, cls: 'text-faint', label: 'Cancelled' },
};

/**
 * Change the template of many clips at once. Pick a template -> (confirm if many) -> background batch with a
 * per-clip checklist, cancel for queued clips and retry for failed ones. Works the same on phone and desktop.
 */
export default function BulkTemplateSheet({ open, clipIds, onClose, onFinished }) {
  const [templates, setTemplates] = useState(null);
  const [picked, setPicked] = useState(null);
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const timer = useRef(0);
  const finishedOnce = useRef('');

  useEffect(() => {
    if (!open) return;
    setPicked(null); setBatch(null); setError(''); finishedOnce.current = '';
    let live = true;
    getTemplates().then((t) => { if (live) setTemplates(Array.isArray(t) ? t : []); }).catch(() => live && setTemplates([]));
    return () => { live = false; clearTimeout(timer.current); };
  }, [open]);

  const poll = (id) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const b = await getBulkRetemplate(id);
        setBatch(b);
        if (b.finished) {
          if (finishedOnce.current !== id) { finishedOnce.current = id; onFinished?.(b); }
        } else poll(id);
      } catch { poll(id); }   // transient network error: keep polling
    }, POLL_MS);
  };

  const start = async (ids) => {
    if (!picked || starting) return;
    setStarting(true); setError('');
    try {
      const b = await bulkRetemplate(ids, picked);
      setBatch(b);
      finishedOnce.current = '';
      poll(b.batch_id);
    } catch (e) {
      setError(e.response?.data?.error?.message || e.message);
    } finally { setStarting(false); }
  };

  const cancel = async () => { if (batch) { try { setBatch(await cancelBulkRetemplate(batch.batch_id)); } catch { /* ignore */ } } };
  const retryFailed = () => {
    const failed = batch.items.filter((i) => i.status === 'failed').map((i) => i.clip_id);
    setBatch(null);
    start(failed);
  };

  const done = batch ? batch.counts.done + batch.counts.failed + batch.counts.cancelled : 0;
  const many = clipIds.length > CONFIRM_ABOVE;
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setConfirm(false); }, [picked, open]);

  return (
    <Sheet open={open} onClose={onClose} wide title={batch ? `Re-rendering with ${batch.template}` : `Change template · ${clipIds.length} clip${clipIds.length === 1 ? '' : 's'}`}>
      {!batch && (
        <div className="space-y-3">
          {templates === null ? <div className="flex justify-center py-8"><Spinner /></div> : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-[50dvh] overflow-y-auto pr-0.5" role="radiogroup" aria-label="Template">
              {templates.map((t) => {
                const on = picked === t.name;
                return (
                  <button key={t.name} type="button" role="radio" aria-checked={on} onClick={() => setPicked(t.name)}
                    className={`rounded-xl border p-1.5 text-left ${on ? 'border-accent bg-accent/10' : 'border-line bg-raised'}`}>
                    <TemplateMini layout={t.layout} captionY={t.subtitles?.position?.y} />
                    <span className="mt-1 block truncate text-[11.5px] font-medium text-ink">{t.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
          <p className="text-[11.5px] text-muted">Each clip is re-rendered with its existing words, bleeps and trims. The old video stays until the new one passes validation.</p>
          {many && picked && confirm && <Notice tone="warn">This will re-render {clipIds.length} clips and may take a while. Tap again to confirm.</Notice>}
          <Button block variant="primary" disabled={!picked || starting} onClick={() => (many && !confirm ? setConfirm(true) : start(clipIds))}>
            {starting ? 'Starting…' : picked ? `Re-render ${clipIds.length} with ${picked}` : 'Pick a template'}
          </Button>
        </div>
      )}

      {batch && (
        <div className="space-y-3" data-testid="bulk-progress">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-ink font-semibold tabular-nums">{done} / {batch.total}</span>
            <span className="text-muted">{batch.finished ? (batch.counts.failed ? `${batch.counts.failed} failed` : 'All done') : 'Rendering…'}</span>
          </div>
          <Progress value={batch.total ? (done / batch.total) * 100 : 0} tone={batch.counts.failed ? 'warn' : 'accent'} />
          <ul className="max-h-[42dvh] space-y-1 overflow-y-auto">
            {batch.items.map((i) => {
              const s = STATUS[i.status] || STATUS.queued;
              const Icon = s.icon;
              return (
                <li key={i.clip_id} className="flex min-h-11 items-center gap-2.5 rounded-xl bg-raised px-3 py-1.5" data-status={i.status}>
                  <Icon size={16} className={`shrink-0 ${s.cls}`} />
                  <span className="text-[13px] font-medium text-ink">Clip #{i.clip_id}</span>
                  <span className="ml-auto min-w-0 truncate text-[11.5px] text-muted">{i.error || s.label}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            {!batch.finished && <Button block onClick={cancel} disabled={batch.cancelled}>{batch.cancelled ? 'Cancelling…' : 'Cancel queued'}</Button>}
            {batch.finished && batch.counts.failed > 0 && <Button block icon={RefreshCw} onClick={retryFailed}>Retry failed</Button>}
            {batch.finished && <Button block variant="primary" onClick={onClose}>Done</Button>}
          </div>
        </div>
      )}
    </Sheet>
  );
}
