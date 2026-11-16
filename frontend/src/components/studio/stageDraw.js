import { calculateLayerGeometry } from '../../utils/layoutMath';
import { drawSourceRegion } from '../../utils/mediaDraw';
import { renderCaptionsToCanvas } from '../../utils/captionRenderer';

/** Backing-store sizes. CSS scales them, so resizing the stage (sheet drag, zoom) never re-allocates a canvas. */
export const OUT_W = 540;
export const OUT_H = 960;
export const SRC_CW = 960;
export const SRC_CH = 540;
const SRC_W = 1920;
const SRC_H = 1080;

export function isVideoUrl(url) {
  return Boolean(url) && /\.(mp4|webm|mov|m4v|mkv)(\?.*)?$/i.test(url);
}

/** Watermark rectangle in normalised output coordinates (matches the desktop canvas + the renderer's named positions). */
export function watermarkRectNorm(wm, imgAspect = 1) {
  if (!wm) return null;
  const wPx = wm.width || 220;                          // 1080-space pixels
  const hPx = wPx * (imgAspect || 1);
  const pos = (wm.position || 'top_right').toLowerCase();
  let x = 1080 - wPx - 40;
  let y = 50;
  if (typeof wm.x === 'number' && typeof wm.y === 'number') { x = wm.x * 1080; y = wm.y * 1920; }
  else if (pos === 'top_left') { x = 40; y = 50; }
  else if (pos === 'top_center') { x = (1080 - wPx) / 2; y = 50; }
  else if (pos === 'bottom_left') { x = 40; y = 1920 - hPx - 60; }
  else if (pos === 'bottom_right') { x = 1080 - wPx - 40; y = 1920 - hPx - 60; }
  else if (pos === 'bottom_center') { x = (1080 - wPx) / 2; y = 1920 - hPx - 60; }
  return { x: x / 1080, y: y / 1920, w: wPx / 1080, h: hPx / 1920 };
}

function paintBackground(ctx, cw, ch, bg, media) {
  const b = bg || { type: 'solid', color: '#000000' };
  if (b.type === 'blur' && media) {
    ctx.fillStyle = b.color || '#000000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.filter = `blur(${Math.min(60, b.blur || 30)}px)`;
    ctx.drawImage(media, -cw * 0.5, 0, cw * 2.0, ch);
    ctx.restore();
    if ((b.dim ?? 0) > 0) { ctx.fillStyle = `rgba(0,0,0,${b.dim})`; ctx.fillRect(0, 0, cw, ch); }
  } else {
    ctx.fillStyle = b.color || '#000000';
    ctx.fillRect(0, 0, cw, ch);
  }
}

/** The 9:16 composite: background, every visible layer, live captions, watermark. */
export function drawOutput(canvas, { layout, media, captionsConfig, watermark, watermarkImg }) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  paintBackground(ctx, cw, ch, layout?.background, media);

  for (const layer of layout?.layers || []) {
    if (layer.visible === false || !media) continue;
    const geo = calculateLayerGeometry(layer, SRC_W, SRC_H, cw, ch);
    const dr = geo.dst_rect;
    const sc = geo.src_crop || geo.src_rect;
    const sz = geo.scale_size || geo.scaled_size;
    if (!sc || !dr || !sz) continue;
    ctx.save();
    ctx.globalAlpha = layer.style?.opacity ?? 1.0;
    ctx.beginPath();
    if (layer.style?.shape === 'circle') ctx.arc(dr.x + dr.w / 2, dr.y + dr.h / 2, Math.min(dr.w, dr.h) / 2, 0, Math.PI * 2);
    else ctx.rect(dr.x, dr.y, dr.w, dr.h);
    ctx.clip();
    if (geo.fit === 'contain' && geo.letterbox_offset) drawSourceRegion(ctx, media, sc, dr.x + geo.letterbox_offset.dx, dr.y + geo.letterbox_offset.dy, sz.w, sz.h);
    else if (geo.fit === 'cover' && geo.inner_crop) drawSourceRegion(ctx, media, sc, dr.x - geo.inner_crop.x, dr.y - geo.inner_crop.y, sz.w, sz.h);
    else drawSourceRegion(ctx, media, sc, dr.x, dr.y, dr.w, dr.h);
    ctx.restore();
  }

  renderCaptionsToCanvas({ ctx, canvasW: cw, canvasH: ch, words: [], currentTime: 0, captionsConfig, isTemplateStudio: true });

  if (watermark?.enabled && watermarkImg && watermarkImg.complete && watermarkImg.naturalWidth > 0) {
    const r = watermarkRectNorm(watermark, watermarkImg.naturalHeight / watermarkImg.naturalWidth);
    ctx.save();
    ctx.globalAlpha = typeof watermark.opacity === 'number' ? watermark.opacity : 0.85;
    ctx.drawImage(watermarkImg, r.x * cw, r.y * ch, r.w * cw, r.h * ch);
    ctx.restore();
  }
}

/** The 16:9 source frame (crop boxes are DOM overlays, so they stay sharp and touchable). */
export function drawSource(canvas, media) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (media) {
    try { ctx.drawImage(media, 0, 0, canvas.width, canvas.height); } catch { /* frame not decoded yet */ }
  }
}
