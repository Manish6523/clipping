/**
 * Canonical bidirectional conversion between Web CSS Hex (#RRGGBB) and ASS subtitle colors (&HAABBGGRR).
 * 
 * ASS color format: &H[AA][BB][GG][RR] where:
 * - AA is transparency (00 = fully opaque, FF = fully transparent).
 * - Colors are stored in Blue-Green-Red order.
 */

export function hexToAss(hexStr, alpha = 1.0) {
  if (!hexStr || typeof hexStr !== 'string') return '&H00FFFFFF';
  let h = hexStr.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (h.length !== 6) return '&H00FFFFFF';

  const r = h.slice(0, 2).toUpperCase();
  const g = h.slice(2, 4).toUpperCase();
  const b = h.slice(4, 6).toUpperCase();
  
  // ASS alpha is inverted (0 = 100% opaque, 255 = 100% transparent)
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const aVal = Math.round((1.0 - clampedAlpha) * 255);
  const a = aVal.toString(16).padStart(2, '0').toUpperCase();

  return `&H${a}${b}${g}${r}`;
}

export function assToHex(assStr) {
  if (!assStr || typeof assStr !== 'string') {
    return { hex: '#FFFFFF', alpha: 1.0 };
  }

  const clean = assStr.trim().toUpperCase().replace(/^&H/, '');
  // Might be BBGGRR (6 chars) or AABBGGRR (8 chars)
  let aHex = '00';
  let bHex = 'FF';
  let gHex = 'FF';
  let rHex = 'FF';

  if (clean.length === 8) {
    aHex = clean.slice(0, 2);
    bHex = clean.slice(2, 4);
    gHex = clean.slice(4, 6);
    rHex = clean.slice(6, 8);
  } else if (clean.length === 6) {
    bHex = clean.slice(0, 2);
    gHex = clean.slice(2, 4);
    rHex = clean.slice(4, 6);
  } else {
    return { hex: '#FFFFFF', alpha: 1.0 };
  }

  const alpha = Number((1.0 - parseInt(aHex, 16) / 255).toFixed(2));
  const hex = `#${rHex}${gHex}${bHex}`.toUpperCase();

  return { hex, alpha };
}
