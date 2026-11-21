import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { queueClip, discardClip, updateClip, withToken } from '../../api';

// Approve / reject wait this long before reaching the server, so Undo is a real undo
// (reject deletes the clip and its files for good).
export const UNDO_MS = { approve: 4000, reject: 5000 };

const vibrate = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
const errText = (e) => e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || 'failed';

/**
 * Every clip action of the Clips page, shared by the grid and the reels view:
 * approve / reject (deferred, undoable, with an optional reason), save details, change
 * template / captions / hook (re-render), download, and toasts.
 */
export function useClipActions() {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState(() => new Set());       // acted on: out of the list until the server agrees
  const [pending, setPending] = useState(null);                 // { type, clip, reason }
  const [toast, setToast] = useState(null);
  const [applying, setApplying] = useState({});                 // clip id -> what is re-rendering
  const [videoOverride, setVideoOverride] = useState({});       // clip id -> fresh video url after a re-render
  const [undone, setUndone] = useState(null);                   // { id, at } of the last undone clip (views re-focus it)
  const pendingRef = useRef(null);
  const timerRef = useRef(0);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['clips'] }), [queryClient]);

  const flash = useCallback((msg, tone = 'info') => {
    setToast({ msg, tone, at: Date.now() });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), tone === 'error' ? 5000 : 2600);
  }, []);

  const unhide = (id) => setHidden((prev) => { const n = new Set(prev); n.delete(id); return n; });

  const commit = useCallback(async (action) => {
    try {
      if (action.type === 'reject') await discardClip(action.clip.id, action.reason || null);
      if (action.type === 'approve') await queueClip(action.clip.id);
    } catch (e) {
      unhide(action.clip.id);                                   // nothing silently lost
      flash(`Couldn't ${action.type} #${action.clip.id}: ${errText(e)}`, 'error');
    } finally {
      refresh();
    }
  }, [flash, refresh]);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p) commit(p);
  }, [commit]);

  // Leaving the page or backgrounding the app sends whatever is waiting
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const start = useCallback((type, clip) => {
    if (!clip) return;
    flush();
    vibrate(type === 'reject' ? 18 : 10);
    setHidden((prev) => new Set(prev).add(clip.id));
    const action = { type, clip, reason: null };
    pendingRef.current = action;
    setPending(action);
    timerRef.current = setTimeout(flush, UNDO_MS[type]);
  }, [flush]);

  const approve = useCallback((clip) => start('approve', clip), [start]);
  const reject = useCallback((clip) => start('reject', clip), [start]);

  const undo = useCallback(() => {
    clearTimeout(timerRef.current);
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p) { unhide(p.clip.id); setUndone({ id: p.clip.id, at: Date.now() }); }
  }, []);

  const setReason = useCallback((code) => {
    if (!pendingRef.current) return;
    pendingRef.current = { ...pendingRef.current, reason: code };
    flush();
    flash('Thanks - the AI learns from this', 'ok');
  }, [flush, flash]);

  /** Title / description / hashtags. Updates every cached list right away. */
  const save = useCallback(async (clip, fields) => {
    const body = { title: fields.title ?? clip.title, description: fields.description ?? clip.description ?? '',
      hashtags: fields.hashtags ?? clip.hashtags ?? '' };
    queryClient.setQueriesData({ queryKey: ['clips', 'feed'] }, (data) => data && ({
      ...data,
      pages: data.pages.map((p) => ({ ...p, clips: (p.clips || []).map((c) => (c.id === clip.id ? { ...c, ...body } : c)) })),
    }));
    try {
      await updateClip(clip.id, body);
      return true;
    } catch (e) {
      flash(`Couldn't save #${clip.id}: ${errText(e)}`, 'error');
      refresh();
      return false;
    }
  }, [queryClient, flash, refresh]);

  /** kind: 'template' | 'caption' | 'hook' - re-renders the clip. */
  const restyle = useCallback(async (clip, kind, value, label) => {
    if (!clip || applying[clip.id]) return;
    const url = { template: 'retemplate', caption: 'caption-style', hook: 'hook-style' }[kind];
    const body = kind === 'template' ? { template: value } : { style: value };
    setApplying((a) => ({ ...a, [clip.id]: label || value }));
    try {
      const res = await axios.post(`/api/clips/${clip.id}/${url}`, body, { timeout: 600000 });
      if (res.data?.video_url) setVideoOverride((v) => ({ ...v, [clip.id]: res.data.video_url }));
      flash(`Clip #${clip.id} updated (${label || value})`, 'ok');
      refresh();
    } catch (e) {
      flash(`Change failed: ${errText(e)}`, 'error');
    } finally {
      setApplying((a) => { const n = { ...a }; delete n[clip.id]; return n; });
    }
  }, [applying, flash, refresh]);

  const download = useCallback((clip) => {
    if (!clip?.download_url) { flash('This clip has no rendered video yet', 'error'); return; }
    const a = document.createElement('a');
    a.href = withToken(clip.download_url);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    flash('Download started', 'ok');
  }, [flash]);

  const videoFor = useCallback((clip) => withToken(videoOverride[clip?.id] || clip?.video_url), [videoOverride]);

  return { hidden, pending, toast, undone, applying, approve, reject, undo, setReason, flush, save, restyle, download,
    videoFor, flash, refresh };
}
