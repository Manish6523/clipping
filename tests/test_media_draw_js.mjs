// Preview <-> render parity for non-1080p sources (run: node tests/test_media_draw_js.mjs)
import assert from 'node:assert/strict';
import { toMediaRect, drawSourceRegion } from '../frontend/src/utils/mediaDraw.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// 1280x720: plain scale by 1.5
let r = toMediaRect({ x: 656, y: 0, w: 608, h: 1080 }, { w: 1280, h: 720 });
close(r.x, 437.333); close(r.y, 0); close(r.w, 405.333); close(r.h, 720);

// 1440x1080 (4:3): renderer pads 240px each side -> x=240 in 1920-space is media x=0
r = toMediaRect({ x: 240, y: 0, w: 1440, h: 1080 }, { w: 1440, h: 1080 });
close(r.x, 0); close(r.w, 1440);

// drawSourceRegion clips the padded part and shrinks the destination proportionally
const calls = [];
const ctx = { drawImage: (...a) => calls.push(a) };
const media = { videoWidth: 1440, videoHeight: 1080 };
drawSourceRegion(ctx, media, { x: 0, y: 0, w: 960, h: 1080 }, 0, 0, 100, 200); // left half incl. 240px pad
assert.equal(calls.length, 1);
const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls[0];
close(sx, 0); close(sy, 0); close(sw, 720); close(sh, 1080);
close(dx, 25); close(dy, 0); close(dw, 75); close(dh, 200);  // first 240/960 = 25% of dest is padding

// fully outside the frame -> nothing drawn (Safari would otherwise draw nothing/throw)
calls.length = 0;
drawSourceRegion(ctx, media, { x: 0, y: 0, w: 200, h: 1080 }, 0, 0, 10, 10);
assert.equal(calls.length, 0);

// 1920x1080 source: identity
r = toMediaRect({ x: 10, y: 20, w: 30, h: 40 }, { w: 1920, h: 1080 });
assert.deepEqual(r, { x: 10, y: 20, w: 30, h: 40 });

console.log('All JS media-draw parity tests passed!');
