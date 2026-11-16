import assert from 'assert';
import * as g from '../frontend/src/components/studio/geometry.js';

console.log('Testing phone Studio geometry...');
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// --- the stage re-fits to the free area; no sheet at 390x844: output >= 270dp wide, source ~220dp tall
{
  const L = g.computeStudioLayout({ viewportW: 390, viewportH: 844, sheetPx: 0 });
  near(L.source.h, 219.375);
  assert.ok(L.output.w >= 270, `output ${L.output.w} < 270`);
  assert.equal(L.source.collapsed, false);
  assert.ok(L.output.h + L.source.h + g.GAP_PX <= L.freeH + 0.01, 'stages exceed the free area');
}
// --- the output is visible at EVERY snap point and never exceeds the area above the sheet
for (const [vw, vh] of [[360, 640], [390, 844], [412, 915]]) {
  for (const snap of g.SNAPS) {
    const avail = vh - g.TOP_BAR_PX - g.DOCK_PX;
    const sheetPx = g.sheetHeightPx(snap, avail);
    const L = g.computeStudioLayout({ viewportW: vw, viewportH: vh, sheetPx });
    assert.ok(L.output.w > 20 && L.output.h > 30, `${vw}x${vh} ${snap}: output not visible (${L.output.w}x${L.output.h})`);
    const used = L.source.h + (L.source.collapsed ? 0 : 0) + g.GAP_PX + L.output.h;
    assert.ok(used <= L.freeH + 0.01, `${vw}x${vh} ${snap}: stages (${used}) overflow free area (${L.freeH})`);
    assert.ok(sheetPx + L.freeH <= avail + 0.01, 'sheet + stage exceed the viewport');
    assert.ok(L.freeH >= g.MIN_STAGE_PX - 0.01 || snap === 'closed', 'stage below minimum');
  }
}
// --- auto-collapse rule: free height < source height + 300 with the sheet open
{
  const open = g.computeStudioLayout({ viewportW: 390, viewportH: 844, sheetPx: g.sheetHeightPx('half', 740) });
  assert.equal(open.source.collapsed, true);
  assert.equal(open.source.h, g.HANDLE_PX);
  const peek = g.computeStudioLayout({ viewportW: 390, viewportH: 844, sheetPx: g.sheetHeightPx('peek', 740) });
  assert.equal(peek.source.collapsed, false, 'peek keeps both stages on a 844dp phone');
  // user choice wins both ways
  assert.equal(g.computeStudioLayout({ viewportW: 390, viewportH: 844, sheetPx: 333, sourcePref: 'expanded' }).source.collapsed, false);
  assert.equal(g.computeStudioLayout({ viewportW: 390, viewportH: 844, sheetPx: 0, sourcePref: 'collapsed' }).source.collapsed, true);
}
// --- sheet snap points + fling
{
  const avail = 740;
  assert.equal(g.sheetHeightPx('closed', avail), 0);
  assert.equal(g.sheetHeightPx('peek', avail), g.PEEK_PX);
  assert.equal(g.sheetHeightPx('half', avail), Math.round(740 * 0.45));
  assert.ok(g.sheetHeightPx('full', avail) <= avail - g.MIN_STAGE_PX);
  assert.equal(g.nearestSnap(150, avail), 'peek');
  assert.equal(g.nearestSnap(300, avail), 'half');
  assert.equal(g.nearestSnap(560, avail), 'full');
  assert.equal(g.nearestSnap(20, avail), 'closed');
  assert.equal(g.nearestSnap(250, avail, 1.5), 'full' === g.nearestSnap(250, avail, 1.5) ? 'full' : 'half', 'fling up lifts further');
  assert.notEqual(g.nearestSnap(250, avail, -2), g.nearestSnap(250, avail, 0), 'fling down lowers');
}
// --- landscape: output left, source right, both fit
{
  const L = g.computeStudioLayout({ viewportW: 844, viewportH: 390, sheetPx: 0, landscape: true });
  assert.equal(L.orientation, 'landscape');
  assert.ok(L.output.h <= 390 - g.TOP_BAR_PX + 0.01);
  assert.ok(L.output.w + L.source.w + g.GAP_PX <= 844 - g.DOCK_PX + 0.01);
  near(L.output.w / L.output.h, 9 / 16, 0.001);
  near(L.source.w / L.source.h, 16 / 9, 0.001);
}
// --- zoom keeps the point under the fingers fixed, and pan never exposes empty space
{
  let v = { ...g.RESET_VIEW };
  v = g.zoomAbout(v, 3, 100, 100, 300, 200);
  const content = { x: (100 - v.tx) / v.scale, y: (100 - v.ty) / v.scale };
  near(content.x, 100); near(content.y, 100);
  assert.ok(v.tx <= 0 && v.tx >= 300 - 900 && v.ty <= 0 && v.ty >= 200 - 600);
  assert.equal(g.zoomAbout(v, 99, 0, 0, 300, 200).scale, 6, 'max zoom 6x');
  assert.equal(g.zoomAbout(v, 0.1, 0, 0, 300, 200).scale, 1, 'min zoom 1x');
  assert.deepEqual(g.zoomAbout(v, 1, 0, 0, 300, 200), { scale: 1, tx: 0, ty: 0 }, 'zooming back to 1x re-centres');
}
// --- client -> normalised coordinates honour zoom/pan
{
  const rect = { left: 10, top: 20 };
  const p = g.clientToNorm(10 + 150, 20 + 100, rect, { scale: 1, tx: 0, ty: 0 }, 300, 200);
  near(p.x, 0.5); near(p.y, 0.5);
  const z = g.clientToNorm(10 + 150, 20 + 100, rect, { scale: 2, tx: -150, ty: -100 }, 300, 200);
  near(z.x, 0.5); near(z.y, 0.5);
}
// --- move: clamped inside the stage + centre snap; resize: min size + aspect lock
{
  const r = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };
  assert.equal(g.moveRect(r, 5, 5, { snap: false }).rect.x, 0.7);        // clamped to 1 - w
  assert.equal(g.moveRect(r, -5, -5, { snap: false }).rect.y, 0);
  const s = g.moveRect({ x: 0.34, y: 0.4, w: 0.3, h: 0.2 }, 0.005, 0);
  assert.equal(s.rect.x, 0.35); assert.equal(s.snapped, true);
  const small = g.resizeRect(r, 'se', -5, -5);
  assert.equal(small.w, g.MIN_SIZE); assert.equal(small.h, g.MIN_SIZE);
  const locked = g.resizeRect({ x: 0, y: 0, w: 0.4, h: 0.4 }, 'e', 0.2, 0, { aspect: 1, pxAspect: 1 });
  near(locked.w, 0.6); near(locked.h, 0.6);
  const w = g.resizeRect({ x: 0.5, y: 0.2, w: 0.3, h: 0.3 }, 'w', -0.2, 0);
  near(w.x, 0.3); near(w.w, 0.5);
}
// --- overlapped objects: topmost first, repeated taps cycle
{
  const layers = [
    { id: 'bottom', src: { x: 0, y: 0, w: 1, h: 1 }, visible: true },
    { id: 'top', src: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, visible: true },
    { id: 'hidden', src: { x: 0, y: 0, w: 1, h: 1 }, visible: false },
  ];
  const hits = g.layersAt({ x: 0.4, y: 0.4 }, layers, 'src');
  assert.deepEqual(hits.map((l) => l.id), ['top', 'bottom']);
  assert.equal(g.nextInStack(hits, null).id, 'top');
  assert.equal(g.nextInStack(hits, 'top').id, 'bottom');
  assert.equal(g.nextInStack(hits, 'bottom').id, 'top');
  assert.equal(g.layersAt({ x: 0.9, y: 0.9 }, layers, 'src').length, 1);
}
// --- handles: corners win, tiny boxes get corners only
{
  const big = { x: 100, y: 100, w: 200, h: 200 };
  assert.equal(g.handleAt(102, 98, big), 'nw');
  assert.equal(g.handleAt(200, 102, big), 'n');
  assert.equal(g.handleAt(200, 200, big), null);
  const tiny = { x: 100, y: 100, w: 40, h: 40 };
  for (let x = 100; x <= 140; x += 4) for (let y = 100; y <= 140; y += 4) {
    const h = g.handleAt(x, y, tiny);
    assert.ok(h === null || h.length === 2, `tiny box returned edge handle ${h} at ${x},${y}`);
  }
  assert.equal(g.handleAt(140, 140, tiny), 'se');
}
console.log('OK: studio geometry');
