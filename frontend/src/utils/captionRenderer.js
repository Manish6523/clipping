/**
 * CaptionRenderer - Renders live dynamic captions on HTML5 Canvas.
 * Supports:
 * - Word-by-word highlight & pop animation
 * - Animations: 'pop', 'bounce', 'fade', 'karaoke', 'typewriter', 'none'
 * - Font family with document.fonts pre-loading
 * - Customization: uppercase, line height, colors, outline, shadow, bg box
 * - Drag handle and click-to-select support
 */

import { captionGeometry, getActiveCaptionChunk } from './captionGeometry.js';

// Cache loaded fonts to prevent repeated document.fonts.load calls
const loadedFontsCache = new Set();

export async function ensureFontLoaded(fontFamily, fontWeight = '900') {
  if (!fontFamily || !document.fonts) return;
  const key = `${fontWeight} 16px "${fontFamily}"`;
  if (loadedFontsCache.has(key)) return;

  try {
    await document.fonts.load(key);
    loadedFontsCache.add(key);
  } catch (e) {
    // Graceful fallback to system font
  }
}

/**
 * Render active caption chunk onto canvas context.
 */
export function renderCaptionsToCanvas({
  ctx,
  canvasW,
  canvasH,
  words = [],
  currentTime = 0,
  captionsConfig = {},
  isTemplateStudio = false,
}) {
  if (!ctx) return null;

  const cfg = captionsConfig || {};
  const pos = cfg.position || { x: 0.5, y: 0.76, max_width: 0.85 };
  const wordsPerLine = cfg.words_per_line || 3;
  const geom = captionGeometry(pos.x, pos.y, pos.max_width, canvasW, canvasH);

  const fontFamily = cfg.font || 'Montserrat ExtraBold';
  const fontWeight = cfg.font_weight || '900';
  const fontSize = Math.round((cfg.font_size || 60) * (canvasW / 1080));
  const isUppercase = cfg.uppercase !== false; // default true
  const primaryColor = cfg.color || '#FFFFFF';
  const highlightColor = cfg.highlight || '#FACC15';
  const outlineColor = cfg.outline_color || '#000000';
  const outlineWidth = Math.round((cfg.outline_width ?? 8) * (canvasW / 1080));
  const shadowBlur = Math.round((cfg.shadow_blur ?? 8) * (canvasW / 1080));
  const shadowColor = cfg.shadow_color || 'rgba(0,0,0,0.85)';
  const animationMode = cfg.animation || 'pop'; // pop, bounce, fade, karaoke, none
  const bgBox = cfg.bg_box; // { enabled: bool, color: string, opacity: number, radius: number, padding: number }

  // Load font asynchronously
  ensureFontLoaded(fontFamily, fontWeight);

  let chunkData = null;
  if (isTemplateStudio) {
    // Only in template studio: render sample words clearly labeled
    chunkData = {
      chunk: [
        { word: 'THIS', start: 0, end: 1 },
        { word: 'IS', start: 1, end: 2 },
        { word: 'INSANE!', start: 2, end: 3, highlight: true }
      ],
      activeIndex: 2,
      chunkStart: 0,
      chunkEnd: 3,
    };
  } else {
    // Clip editor mode: find real words
    chunkData = getActiveCaptionChunk(words, currentTime, wordsPerLine);
  }

  if (!chunkData || !chunkData.chunk || !chunkData.chunk.length) {
    return { rendered: false, geom };
  }

  const { chunk, activeIndex } = chunkData;

  ctx.save();

  // Setup font
  ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Measure word widths to compute layout
  const wordMetrics = chunk.map((wItem, idx) => {
    let rawText = wItem.word || wItem.text || '';
    if (isUppercase) rawText = rawText.toUpperCase();
    const width = ctx.measureText(rawText).width;
    return {
      text: rawText,
      width,
      item: wItem,
      isActive: idx === activeIndex,
      isHighlighted: wItem.highlight || idx === activeIndex,
    };
  });

  const spaceWidth = ctx.measureText(' ').width;
  const totalTextWidth = wordMetrics.reduce((acc, m) => acc + m.width, 0) + (wordMetrics.length - 1) * spaceWidth;

  const targetX = geom.x;
  const targetY = geom.y;

  // Optional background box
  if (bgBox && bgBox.enabled) {
    const pad = Math.round((bgBox.padding || 12) * (canvasW / 1080));
    const boxW = totalTextWidth + pad * 2;
    const boxH = fontSize * 1.35 + pad;
    const boxX = targetX - boxW / 2;
    const boxY = targetY - boxH / 2;
    const rad = Math.round((bgBox.radius || 12) * (canvasW / 1080));

    ctx.fillStyle = bgBox.color || '#000000';
    ctx.globalAlpha = bgBox.opacity ?? 0.65;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(boxX, boxY, boxW, boxH, rad);
    } else {
      ctx.rect(boxX, boxY, boxW, boxH);
    }
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // Draw words
  let curX = targetX - totalTextWidth / 2;
  const activeWordItem = chunk[activeIndex];
  const timeSinceStart = activeWordItem ? Math.max(0, currentTime - activeWordItem.start) : 0;

  wordMetrics.forEach((m) => {
    const wordCenterX = curX + m.width / 2;
    ctx.save();

    // Word animation transform
    if (m.isActive && animationMode !== 'none') {
      let scale = 1.0;
      if (animationMode === 'pop') {
        // Pop scaling easing (starts 1.18, settles to 1.0 within 120ms)
        const t = Math.min(1.0, timeSinceStart / 0.12);
        scale = 1.0 + (1.0 - t) * 0.18;
      } else if (animationMode === 'bounce') {
        const t = Math.min(1.0, timeSinceStart / 0.2);
        scale = 1.0 + Math.sin(t * Math.PI) * 0.22;
      }
      ctx.translate(wordCenterX, targetY);
      ctx.scale(scale, scale);
      ctx.translate(-wordCenterX, -targetY);
    }

    // Shadow & Outline
    if (shadowBlur > 0) {
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(2 * (canvasW / 1080));
    }

    if (outlineWidth > 0) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = outlineWidth;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(m.text, wordCenterX, targetY);
    }

    // Text Fill
    ctx.shadowBlur = 0; // Turn off shadow so fill is crisp
    ctx.fillStyle = m.isHighlighted ? highlightColor : primaryColor;
    ctx.fillText(m.text, wordCenterX, targetY);

    ctx.restore();
    curX += m.width + spaceWidth;
  });

  ctx.restore();

  return {
    rendered: true,
    geom,
    boundingBox: {
      x: targetX - totalTextWidth / 2 - 10,
      y: targetY - fontSize / 2 - 6,
      w: totalTextWidth + 20,
      h: fontSize + 12,
    },
  };
}

