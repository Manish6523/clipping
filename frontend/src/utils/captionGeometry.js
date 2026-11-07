/**
 * Pure caption layout and geometry calculation (JS twin of caption_geometry.py).
 */

export const QUICK_PLACEMENTS = {
  top: { x: 0.5, y: 0.15 },
  upper_third: { x: 0.5, y: 0.33 },
  middle: { x: 0.5, y: 0.50 },
  lower_third: { x: 0.5, y: 0.67 },
  bottom: { x: 0.5, y: 0.82 },
  on_seam: { x: 0.5, y: 0.38 },
};

export function captionGeometry(
  posX = 0.5,
  posY = 0.76,
  maxW = 0.85,
  canvasW = 1080,
  canvasH = 1920
) {
  const px = Math.max(0.0, Math.min(1.0, Number(posX) || 0.5));
  const py = Math.max(0.0, Math.min(1.0, Number(posY) || 0.76));
  const pw = Math.max(0.2, Math.min(1.0, Number(maxW) || 0.85));

  const centerX = Math.round(px * canvasW);
  const centerY = Math.round(py * canvasH);
  const maxPxWidth = Math.round(pw * canvasW);

  const halfW = Math.floor(maxPxWidth / 2);
  const x1 = Math.max(0, centerX - halfW);
  const x2 = Math.min(canvasW, centerX + halfW);

  const marginL = x1;
  const marginR = canvasW - x2;

  return {
    x: centerX,
    y: centerY,
    max_width: maxPxWidth,
    margin_l: marginL,
    margin_r: marginR,
    clip_x1: x1,
    clip_y1: Math.max(0, centerY - 200),
    clip_x2: x2,
    clip_y2: Math.min(canvasH, centerY + 200),
  };
}

/**
 * Format a group of words for kinetic rendering.
 * @param {Array} words - Array of { word, start, end, deleted, highlight, ... }
 * @param {number} currentTime - video currentTime
 * @param {number} wordsPerLine - max words per screen/chunk (default 3)
 */
export function getActiveCaptionChunk(words = [], currentTime = 0, wordsPerLine = 3) {
  if (!words || !words.length) return null;

  // Filter out deleted words
  const validWords = words.filter((w) => !w.deleted);
  if (!validWords.length) return null;

  // Group into chunks of size wordsPerLine
  const chunks = [];
  let cur = [];
  for (const w of validWords) {
    cur.push(w);
    if (cur.length >= wordsPerLine) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) chunks.push(cur);

  // Find chunk containing currentTime or nearest chunk
  for (const chunk of chunks) {
    const chunkStart = chunk[0].start;
    const chunkEnd = chunk[chunk.length - 1].end;
    // Add small buffer to chunkEnd so trailing text stays visible slightly
    if (currentTime >= chunkStart && currentTime <= chunkEnd + 0.15) {
      // Find which word inside chunk is active
      let activeIndex = -1;
      for (let i = 0; i < chunk.length; i++) {
        if (currentTime >= chunk[i].start && currentTime <= chunk[i].end) {
          activeIndex = i;
          break;
        }
      }
      if (activeIndex === -1) {
        // Find closest preceding word in chunk
        for (let i = chunk.length - 1; i >= 0; i--) {
          if (currentTime >= chunk[i].start) {
            activeIndex = i;
            break;
          }
        }
      }
      if (activeIndex === -1) activeIndex = 0;

      return {
        chunk,
        activeIndex,
        chunkStart,
        chunkEnd,
      };
    }
  }

  return null;
}

