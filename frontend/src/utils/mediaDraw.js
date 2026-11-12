/**
 * Layout geometry is computed in a fixed 1920x1080 "canvas source" space (see layoutMath.js),
 * and the FFmpeg renderer scales any other source size into that space first
 * (scale=...:force_original_aspect_ratio=decrease + centred pad). Previews must do the same
 * mapping, otherwise a 1280x720 (or 4:3, or vertical) source shows the wrong region.
 */

export const SRC_W = 1920;
export const SRC_H = 1080;

export function mediaSize(media) {
  if (!media) return null;
  const w = media.videoWidth || media.naturalWidth || media.width || 0;
  const h = media.videoHeight || media.naturalHeight || media.height || 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Maps a rect in 1920x1080 space to the media's real pixel space (same as the renderer's pad). */
export function toMediaRect(rect, size) {
  const k = Math.min(SRC_W / size.w, SRC_H / size.h);
  const ox = (SRC_W - size.w * k) / 2;
  const oy = (SRC_H - size.h * k) / 2;
  return { x: (rect.x - ox) / k, y: (rect.y - oy) / k, w: rect.w / k, h: rect.h / k };
}

/**
 * Draw the `src` rect (1920x1080 space) of `media` into the destination rect.
 * Parts of the source outside the real frame (the renderer's black padding) are clipped
 * and the destination shrinks proportionally — Safari draws nothing for out-of-bounds sources.
 */
export function drawSourceRegion(ctx, media, src, dx, dy, dw, dh) {
  const size = mediaSize(media);
  if (!size || !src || src.w <= 0 || src.h <= 0) return;
  const m = toMediaRect(src, size);
  const x0 = Math.max(0, m.x);
  const y0 = Math.max(0, m.y);
  const x1 = Math.min(size.w, m.x + m.w);
  const y1 = Math.min(size.h, m.y + m.h);
  if (x1 <= x0 || y1 <= y0) return;
  const sx = dw / m.w;
  const sy = dh / m.h;
  try {
    ctx.drawImage(
      media,
      x0, y0, x1 - x0, y1 - y0,
      dx + (x0 - m.x) * sx, dy + (y0 - m.y) * sy, (x1 - x0) * sx, (y1 - y0) * sy,
    );
  } catch {
    // frame not decodable yet
  }
}
