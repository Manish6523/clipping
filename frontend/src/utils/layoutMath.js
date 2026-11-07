/**
 * Shared Layout Geometry Engine (JavaScript / Frontend Twin).
 * Computes exact pixel rectangles for Schema v2 layers.
 * Strict parity with Python layout_math.py.
 */

export function toEven(val, allowZero = true) {
  let rounded = Math.round(val);
  if (rounded % 2 !== 0) {
    rounded += val >= rounded ? 1 : -1;
  }
  if (allowZero) {
    return Math.max(0, rounded);
  }
  return Math.max(2, rounded);
}

export function clamp(val, minVal, maxVal) {
  return Math.max(minVal, Math.min(maxVal, val));
}

/**
 * Calculates pixel dimensions and scaling behavior for a layer.
 * @param {Object} layer - Layer schema v2 definition
 * @param {number} srcW - Source stream width in pixels (e.g. 1920)
 * @param {number} srcH - Source stream height in pixels (e.g. 1080)
 * @param {number} canvasW - Canvas output width (default 1080)
 * @param {number} canvasH - Canvas output height (default 1920)
 */
export function calculateLayerGeometry(
  layer,
  srcW,
  srcH,
  canvasW = 1080,
  canvasH = 1920
) {
  const src = layer.src || { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
  const dst = layer.dst || { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
  const fit = (layer.fit || 'cover').toLowerCase();

  // 1. Source Crop
  const sxNorm = clamp(src.x ?? 0.0, 0.0, 1.0);
  const syNorm = clamp(src.y ?? 0.0, 0.0, 1.0);
  const swNorm = clamp(src.w ?? 1.0, 0.02, 1.0 - sxNorm);
  const shNorm = clamp(src.h ?? 1.0, 0.02, 1.0 - syNorm);

  let cropX = toEven(sxNorm * srcW, true);
  let cropY = toEven(syNorm * srcH, true);
  let cropW = toEven(swNorm * srcW, false);
  let cropH = toEven(shNorm * srcH, false);

  if (cropX + cropW > srcW) cropW = toEven(srcW - cropX, false);
  if (cropY + cropH > srcH) cropH = toEven(srcH - cropY, false);

  // 2. Destination Placement
  const dxNorm = clamp(dst.x ?? 0.0, 0.0, 1.0);
  const dyNorm = clamp(dst.y ?? 0.0, 0.0, 1.0);
  const dwNorm = clamp(dst.w ?? 1.0, 0.02, 1.0 - dxNorm);
  const dhNorm = clamp(dst.h ?? 1.0, 0.02, 1.0 - dyNorm);

  let dstX = toEven(dxNorm * canvasW, true);
  let dstY = toEven(dyNorm * canvasH, true);
  let dstW = toEven(dwNorm * canvasW, false);
  let dstH = toEven(dhNorm * canvasH, false);

  if (dstX + dstW > canvasW) dstW = toEven(canvasW - dstX, false);
  if (dstY + dstH > canvasH) dstH = toEven(canvasH - dstY, false);

  // 3. Aspect & Fit
  const cropAspect = cropH > 0 ? cropW / cropH : 1.0;
  const dstAspect = dstH > 0 ? dstW / dstH : 1.0;

  const res = {
    src_crop: { x: cropX, y: cropY, w: cropW, h: cropH },
    dst_rect: { x: dstX, y: dstY, w: dstW, h: dstH },
    fit,
  };

  if (fit === 'stretch') {
    res.scale_size = { w: dstW, h: dstH };
    res.scaled_size = { w: dstW, h: dstH };
    res.src_rect = { x: cropX, y: cropY, w: cropW, h: cropH };
  } else if (fit === 'contain') {
    let scaleW, scaleH;
    if (cropAspect > dstAspect) {
      scaleW = dstW;
      scaleH = toEven(dstW / cropAspect);
    } else {
      scaleH = dstH;
      scaleW = toEven(dstH * cropAspect);
    }
    const offX = toEven((dstW - scaleW) / 2);
    const offY = toEven((dstH - scaleH) / 2);

    res.scale_size = { w: scaleW, h: scaleH };
    res.scaled_size = { w: scaleW, h: scaleH };
    res.letterbox_offset = { dx: offX, dy: offY };
    res.src_rect = { x: cropX, y: cropY, w: cropW, h: cropH };
  } else {
    // cover (default)
    let scaleW, scaleH;
    if (cropAspect > dstAspect) {
      scaleH = dstH;
      scaleW = toEven(dstH * cropAspect);
    } else {
      scaleW = dstW;
      scaleH = toEven(dstW / cropAspect);
    }
    const innerX = toEven((scaleW - dstW) / 2);
    const innerY = toEven((scaleH - dstH) / 2);

    res.scale_size = { w: scaleW, h: scaleH };
    res.scaled_size = { w: scaleW, h: scaleH };
    res.inner_crop = { x: innerX, y: innerY, w: dstW, h: dstH };
    res.src_rect = { x: cropX, y: cropY, w: cropW, h: cropH };
  }

  return res;
}
