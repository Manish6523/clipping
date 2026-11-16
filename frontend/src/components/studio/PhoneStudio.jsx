import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Download, Upload, Copy, History, Trash2, Keyboard, X, AlertTriangle, Wand2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTemplateEditorStore } from '../../store/templateEditorStore';
import { migrateTemplate, saveTemplate, deleteTemplate, uploadWatermark } from '../../api';
import ContextualInspector from '../editor/ContextualInspector';
import { Sheet, Confirm, Button, Input, EmptyState } from '../ui';
import StageStack from './PhoneStage';
import SnapSheet from './SnapSheet';
import PeekControls, { NudgePad } from './PeekControls';
import PhoneLayersSheet from './PhoneLayersSheet';
import { PhoneTopBar, PhoneDock } from './PhoneChrome';
import { useViewportBox } from './useViewportBox';
import { useMedia, useImage } from './useMedia';
import { DOCK_PX, TOP_BAR_PX, computeStudioLayout, sheetHeightPx, shouldCollapseSource } from './geometry';
import { buildPreset } from './layoutPresets';
import { listVersions } from './versionHistory';

const PREF_KEY = 'studio_source_pref';
const readPref = () => { try { return localStorage.getItem(PREF_KEY) === 'collapsed' ? 'collapsed' : null; } catch { return null; } };

/**
 * Phone Template Studio shell ("focus mode"): one 48dp top bar, a stage region that always sits ABOVE the sheet, a
 * snapping bottom sheet and a single 56dp dock. Replaces the old overlaying sheet + swap-view stage.
 */
export default function PhoneStudio({
  channels, previewMediaUrl, saveSuccess, onSave, getPayload, onTestRender, testingSample, testRenderOpen, setTestRenderOpen,
  sampleVideoUrl, testRenderError,
}) {
  const navigate = useNavigate();
  const store = useTemplateEditorStore();
  const { layout, subtitles, watermark, selection, sheetSnap: snap, sheetView, templateName, isDirty, history, redoStack, legacyLayout } = store;
  const layers = layout.layers || [];

  const box = useViewportBox();
  const { w: vw, h: vh, safeBottom, landscape } = box;
  const media = useMedia(previewMediaUrl);
  const wmUrl = watermark?.enabled ? (watermark.url || (watermark.path ? `/data/watermarks/${watermark.path.split(/[/\\]/).pop()}` : '')) : '';
  const wm = useImage(wmUrl);
  const wmAspect = wm.img && wm.img.naturalWidth ? wm.img.naturalHeight / wm.img.naturalWidth : 1;

  const [sourcePref, setSourcePrefState] = useState(readPref);                  // 'collapsed' persists, 'expanded' is one-shot
  const [dragPx, setDragPx] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(null);                                      // 'versions' | 'duplicate' | 'delete' | 'shortcuts' | 'leave'
  const [dupName, setDupName] = useState('');
  const fileRef = useRef(null);
  const logoRef = useRef(null);
  const noticeTimer = useRef(0);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const flash = useCallback((msg) => { setNotice(msg); clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(''), 3500); }, []);

  const setSourcePref = (p) => {
    setSourcePrefState(p);
    try { if (p === 'collapsed') localStorage.setItem(PREF_KEY, 'collapsed'); else localStorage.removeItem(PREF_KEY); } catch { /* storage unavailable */ }
  };

  // ---- sheet geometry
  const dockPx = landscape ? 0 : DOCK_PX + safeBottom;
  const avail = landscape ? vh - TOP_BAR_PX : vh - TOP_BAR_PX - dockPx;
  const sheetPx = landscape ? 0 : (dragPx ?? sheetHeightPx(snap, avail));
  const info = useMemo(
    () => computeStudioLayout({ viewportW: vw, viewportH: vh, sheetPx, sourcePref, landscape, safeBottom }),
    [vw, vh, sheetPx, sourcePref, landscape, safeBottom],
  );

  const setSnap = useCallback((s) => {
    store.setSheetSnap(s);
    if (s === 'half' || s === 'full') setSourcePrefState((p) => (p === 'collapsed' ? p : null));     // "expanded" ends once the sheet grows
  }, [store]);

  // ---- focus mode: no page scroll / overscroll while the Studio is open
  useEffect(() => {
    const b = document.body;
    const prev = { o: b.style.overflow, ob: b.style.overscrollBehavior };
    b.style.overflow = 'hidden';
    b.style.overscrollBehavior = 'none';
    return () => { b.style.overflow = prev.o; b.style.overscrollBehavior = prev.ob; };
  }, []);

  // ---- Android back gesture closes the sheet before leaving the page
  const pushed = useRef(false);
  useEffect(() => {
    if (snap !== 'closed' && !pushed.current) {
      window.history.pushState({ ...(window.history.state || {}), studioSheet: true }, '');
      pushed.current = true;
    } else if (snap === 'closed' && pushed.current) {
      pushed.current = false;
      if (window.history.state?.studioSheet) window.history.back();
    }
  }, [snap]);
  useEffect(() => {
    const onPop = () => {
      if (pushed.current) { pushed.current = false; useTemplateEditorStore.getState().setSheetSnap('closed'); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---- on-screen keyboard: an input in the sheet gets the room (sheet -> full), and is scrolled into view
  const restoreSnap = useRef(null);
  const onSheetFocus = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.type === 'range') return;
    if (snap !== 'full') { restoreSnap.current = snap; store.setSheetSnap('full'); }
    setTimeout(() => t.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 250);
  };
  const onSheetBlur = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.type === 'range') return;
    if (restoreSnap.current) { const s = restoreSnap.current; restoreSnap.current = null; setTimeout(() => store.setSheetSnap(s), 60); }
  };

  // ---- actions shared with the stage / sheet
  const actions = useMemo(() => ({
    ...useTemplateEditorStore.getState(),
    applyPreset: (id) => {
      const r = buildPreset(id, useTemplateEditorStore.getState().layout.layers || []);
      if (r) useTemplateEditorStore.getState().addLayers(r.layers, r.background);
    },
    repairFromLegacy: async () => {
      const leg = useTemplateEditorStore.getState().legacyLayout;
      if (!leg) return;
      try {
        const res = await migrateTemplate({ layout: leg });
        if (res?.layout?.layers?.length) { useTemplateEditorStore.getState().replaceLayout(res.layout); flash('Restored the layers from the old layout fields'); }
        else flash('The old layout fields have no usable layers');
      } catch (e) { flash(`Repair failed: ${e.response?.data?.error?.message || e.message}`); }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [flash]);
  const storeView = { layout, subtitles, watermark, selection, legacyLayout, captionStyle: store.defaultCaptionStyle, actions };

  const onSelected = useCallback((sel) => {
    const s = useTemplateEditorStore.getState();
    if (sel.type === 'template') { if (s.sheetSnap === 'peek') setSnap('closed'); return; }
    if (s.sheetSnap === 'closed') { s.setSheetView('inspector'); setSnap('peek'); }
    else if (s.sheetSnap === 'peek') s.setSheetView('inspector');
  }, [setSnap]);

  const onCrop = useCallback(() => {
    setSourcePrefState('expanded');
    const s = useTemplateEditorStore.getState();
    if (s.sheetSnap === 'half' || s.sheetSnap === 'full') setSnap('peek');          // make room for the source
  }, [setSnap]);

  const onToggleSource = useCallback(() => {
    if (info.source.collapsed) onCrop();
    else setSourcePref('collapsed');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.source.collapsed, onCrop]);
  // a persisted "collapsed" choice is dropped when the user expands again
  useEffect(() => { if (sourcePref === 'expanded' && shouldCollapseSource({ sheetPx: 0, freeHeight: 9999, sourceHeight: 0, pref: null })) setSourcePref(null); }, [sourcePref]);

  // ---- dock
  const open = snap !== 'closed';
  const activeDock = !open ? null : sheetView === 'layers' ? 'layers' : (selection.type === 'layer' ? 'layers' : selection.type);
  const pickDock = (id) => {
    if (id === 'layers') {
      if (open && sheetView === 'layers') { setSnap('closed'); return; }
      store.setSheetView('layers');
      setSnap(open && snap !== 'peek' ? snap : 'half');
      return;
    }
    if (open && sheetView === 'inspector' && selection.type === id) { setSnap('closed'); return; }
    store.setSelection({ type: id, id: null });
    store.setSheetView('inspector');
    setSnap(open ? (snap === 'peek' ? 'half' : snap) : 'half');
  };

  // ---- overflow menu
  const downloadJson = () => {
    const data = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(getPayload(), null, 2));
    const a = document.createElement('a');
    a.href = data; a.download = `${templateName || 'template'}.autoclip.json`; a.click();
  };
  const importFile = async (file) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const t = raw.template && typeof raw.template === 'object' ? raw.template : raw;
      let nextLayout = t.layout;
      if (!nextLayout || !Array.isArray(nextLayout.layers)) {
        const res = await migrateTemplate({ layout: nextLayout || {} });
        nextLayout = res.layout;
      }
      store.loadTemplate({ ...t, name: templateName, layout: nextLayout });
      useTemplateEditorStore.setState({ isDirty: true });
      flash(`Imported ${(nextLayout.layers || []).length} layer(s) - review, then Save`);
    } catch (e) { flash(`Import failed: ${e.message}`); }
  };
  const menu = [
    { label: 'Test render', icon: Play, run: onTestRender, loading: testingSample, disabled: testingSample },
    { label: 'Export (.autoclip.json)', icon: Download, run: downloadJson },
    { label: 'Import', icon: Upload, run: () => fileRef.current?.click() },
    { label: 'Duplicate', icon: Copy, run: () => { setDupName(`${templateName}_copy`); setPanel('duplicate'); } },
    { label: 'Version history', icon: History, run: () => setPanel('versions') },
    { label: 'Shortcuts', icon: Keyboard, run: () => setPanel('shortcuts') },
    { label: 'Delete template', icon: Trash2, run: () => setPanel('delete'), danger: true, divider: true },
  ];

  const doDuplicate = async () => {
    const name = dupName.trim();
    if (!name || name === templateName) return;
    try {
      await saveTemplate({ ...getPayload(), name });
      setPanel(null);
      navigate(`/templates/${encodeURIComponent(name)}`);
    } catch (e) { flash(`Duplicate failed: ${e.response?.data?.error?.message || e.message}`); }
  };
  const doDelete = async () => {
    setPanel(null);
    try { await deleteTemplate(templateName); navigate('/templates'); } catch (e) { flash(`Delete failed: ${e.message}`); }
  };
  const pickLogo = () => logoRef.current?.click();
  const onLogoFile = async (file) => {
    if (!file) return;
    try {
      const form = new FormData();
      form.append('watermark', file);
      const res = await uploadWatermark(form);
      if (res?.success && res.watermark_path) store.updateWatermark({ enabled: true, path: res.watermark_path, url: res.url, position: watermark.position || 'top_right' });
      else flash('Upload finished but no file path came back');
    } catch (e) { flash(`Logo upload failed: ${e.response?.data?.error?.message || e.message}`); }
  };

  const goBack = () => { if (isDirty) setPanel('leave'); else navigate('/templates'); };

  // ---- sheet title + content
  const selLayer = selection.type === 'layer' ? layers.find((l) => l.id === selection.id) : null;
  const titles = { captions: 'Captions & subtitles', hook: 'Hook title card', watermark: 'Channel watermark', background: 'Canvas background', template: 'Template' };
  const title = sheetView === 'layers' ? 'Layers' : selLayer ? `Layer · ${selLayer.name}` : (titles[selection.type] || 'Properties');

  let sheetBody;
  if (sheetView === 'layers') {
    sheetBody = (
      <PhoneLayersSheet
        mediaUrl={previewMediaUrl} addOpen={addOpen} setAddOpen={setAddOpen} onPreset={actions.applyPreset}
        onProperties={(id) => { store.setSelection({ type: 'layer', id }); store.setSheetView('inspector'); setSnap('half'); }}
        onPinned={(type) => { store.setSelection({ type, id: null }); store.setSheetView('inspector'); setSnap(snap === 'peek' ? 'half' : snap); }}
      />
    );
  } else if (snap === 'peek') {
    sheetBody = <PeekControls channels={channels} onMore={() => setSnap('half')} onPickLogo={pickLogo} />;
  } else {
    sheetBody = (
      <div className="flex h-full flex-col">
        {selLayer && <div className="shrink-0 border-b border-white/10 px-3 py-2"><NudgePad layer={selLayer} /></div>}
        <div className="min-h-0 flex-1"><ContextualInspector channels={channels} /></div>
      </div>
    );
  }

  const sheetRight = !landscape && open ? (
    <button type="button" aria-label="Close panel" onClick={() => setSnap('closed')} className="flex h-[44px] w-[44px] items-center justify-center rounded-xl text-slate-300 active:bg-white/10"><X size={18} /></button>
  ) : null;

  const emptyBanner = layers.length === 0 && (
    <div data-testid="empty-banner" className="absolute inset-x-2 top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-[#1a1608]/95 px-3 py-2 text-[12.5px] text-warn">
      <AlertTriangle size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 font-semibold">This template has no layers</span>
      <button type="button" onClick={() => { store.setSheetView('layers'); setAddOpen(true); setSnap('half'); }} className="flex h-[44px] items-center rounded-lg px-2 font-semibold text-accent">Add layers</button>
      {legacyLayout && <button type="button" onClick={actions.repairFromLegacy} className="flex h-[44px] items-center rounded-lg px-2 font-semibold text-accent">Repair from legacy fields</button>}
    </div>
  );

  const stage = (
    <StageStack
      info={info} store={storeView} media={media.mediaRef} mediaVersion={media.version} wmImg={wm.img} wmAspect={wmAspect} tick={wm.version}
      sourcePref={sourcePref} onToggleSource={onToggleSource} onCrop={onCrop} onSelected={onSelected}
      onAddLayerMenu={() => { store.setSheetView('layers'); setAddOpen(true); setSnap('half'); }}
    />
  );

  const sheet = (
    <SnapSheet
      snap={snap} heightPx={sheetPx} avail={avail} landscape={landscape} bottomOffset={dockPx} title={title} right={sheetRight}
      onDrag={setDragPx} onSnap={(s) => { setDragPx(null); setSnap(s); }}
    >
      <div onFocusCapture={onSheetFocus} onBlurCapture={onSheetBlur} className="h-full">{sheetBody}</div>
    </SnapSheet>
  );

  return (
    <div
      data-testid="phone-studio" data-orientation={landscape ? 'landscape' : 'portrait'}
      className="fixed left-0 top-0 z-[60] flex w-full select-none flex-col bg-canvas text-ink"
      style={{ height: vh, overscrollBehavior: 'none' }}
    >
      <PhoneTopBar
        name={templateName} dirty={isDirty} saved={saveSuccess} canUndo={history.length > 0} canRedo={redoStack.length > 0}
        onBack={goBack} onRename={(v) => store.setTemplateName(v)} onUndo={store.undo} onRedo={store.redo} onSave={onSave} menu={menu}
      />

      {landscape ? (
        <div className="flex min-h-0 flex-1">
          <PhoneDock active={activeDock} onPick={pickDock} landscape />
          <div className="relative min-w-0 flex-1" data-testid="stage-area">
            {stage}{emptyBanner}{sheet}
          </div>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1" style={{ marginBottom: sheetPx }} data-testid="stage-area">
            {stage}{emptyBanner}
          </div>
          {sheet}
          <PhoneDock active={activeDock} onPick={pickDock} />
        </>
      )}

      {notice && (
        <div role="status" className="pointer-events-none absolute inset-x-3 top-14 z-50 rounded-xl bg-raised px-3 py-2 text-center text-[12.5px] font-medium text-ink shadow-2xl">{notice}</div>
      )}

      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { onLogoFile(e.target.files?.[0]); e.target.value = ''; }} />

      <Confirm open={panel === 'leave'} title="Leave without saving?" text="You have unsaved changes. A draft is kept on this device for 24 hours." confirmLabel="Leave" danger
        onCancel={() => setPanel(null)} onConfirm={() => { setPanel(null); navigate('/templates'); }} />
      <Confirm open={panel === 'delete'} title={`Delete "${templateName}"?`} text="This removes the template file. Streamers using it fall back to a default layout." confirmLabel="Delete" danger
        onCancel={() => setPanel(null)} onConfirm={doDelete} />

      <Sheet open={panel === 'duplicate'} onClose={() => setPanel(null)} title="Duplicate template">
        <p className="mb-3 text-xs text-muted">Saves the current state (including unsaved edits) under a new name and opens it.</p>
        <Input value={dupName} onChange={(e) => setDupName(e.target.value)} aria-label="New template name" className="mb-3" />
        <Button block variant="primary" onClick={doDuplicate} disabled={!dupName.trim() || dupName.trim() === templateName}>Duplicate</Button>
      </Sheet>

      <Sheet open={panel === 'versions'} onClose={() => setPanel(null)} title="Version history">
        {(() => {
          const versions = listVersions(templateName);
          if (!versions.length) return <EmptyState title="No saved versions yet" text="Every successful Save on this device is kept here (last 10)." />;
          return (
            <ul className="space-y-1.5">
              {versions.map((v, i) => (
                <li key={v.t} className="flex min-h-[48px] items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">{new Date(v.t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{i === 0 ? ' · latest' : ''}</div>
                    <div className="text-[11px] text-muted">{v.layers} layer{v.layers === 1 ? '' : 's'}</div>
                  </div>
                  <Button size="sm" onClick={() => { store.loadTemplate(v.payload); useTemplateEditorStore.setState({ isDirty: true }); setPanel(null); flash('Version restored - Save to keep it'); }}>Restore</Button>
                </li>
              ))}
            </ul>
          );
        })()}
      </Sheet>

      <Sheet open={panel === 'shortcuts'} onClose={() => setPanel(null)} title="Touch gestures">
        <ul className="space-y-2 text-[13px] text-slate-200">
          {[
            ['Tap an object', 'Select it - tap again to reach the one underneath'],
            ['Drag / corner handles', 'Move or resize the selected object'],
            ['Pinch / two-finger drag', 'Zoom and pan a stage for precision'],
            ['Double-tap empty space', 'Reset the zoom'],
            ['Hold ⋮⋮ then drag', 'Reorder layers'],
            ['Drag the sheet handle', 'Peek / half / full - or swipe down to close'],
            ['Android Back', 'Closes the sheet first'],
          ].map(([k, v]) => <li key={k} className="flex flex-col rounded-xl bg-white/[0.04] px-3 py-2"><span className="font-semibold text-ink">{k}</span><span className="text-[12px] text-muted">{v}</span></li>)}
        </ul>
      </Sheet>

      <Sheet open={testRenderOpen} onClose={() => setTestRenderOpen(false)} title="Test render" wide>
        <div className="flex min-h-[220px] items-center justify-center rounded-xl bg-black/40 p-2">
          {testingSample ? (
            <div className="flex flex-col items-center gap-2 p-4 text-center"><Wand2 size={22} className="animate-pulse text-warn" /><span className="text-[13px] font-semibold text-ink">Rendering a 3-second sample…</span><span className="text-[11.5px] text-muted">Layers, captions and watermark through FFmpeg</span></div>
          ) : testRenderError ? (
            <p className="p-3 text-center text-[12.5px] text-bad">{testRenderError}</p>
          ) : sampleVideoUrl ? (
            <video src={sampleVideoUrl} controls autoPlay loop playsInline className="aspect-[9/16] max-h-[60dvh] rounded-lg" />
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
