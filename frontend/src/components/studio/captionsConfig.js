import { assToHex } from '../../utils/colorConversions';
import { CAPTION_STYLES } from '../../lib/captionStyles';

/**
 * Store subtitles (ASS colours) -> canvas caption renderer config. When a caption STYLE preset is the template default,
 * its mode (box / glow / karaoke), word count and glow colours are applied too - exactly what the video renderer does.
 */
export function buildCaptionsConfig(subtitles, styleId = 'template') {
  const s = subtitles || {};
  const hex = (v, fallback) => (typeof v === 'string' && v.startsWith('&H') ? assToHex(v).hex : (fallback || v));
  const cfg = {
    ...s,
    font: s.font_name || s.font,
    color: hex(s.primary_color, s.color || '#FFFFFF'),
    highlight: hex(s.highlight_color, s.highlight || '#FACC15'),
    outline_color: hex(s.outline_color, '#000000'),
    outline_width: s.outline,
    shadow_blur: s.shadow,
  };
  const style = styleId && styleId !== 'template' ? CAPTION_STYLES.find((x) => x.id === styleId) : null;
  if (style) {
    cfg.mode = style.mode;
    cfg.words_per_line = style.words;
    if (style.glow) cfg.glow_color = style.glow;
    if (style.activeGlow) cfg.active_glow_color = style.activeGlow;
    if (style.mode === 'box' && style.box) cfg.bg_box = { enabled: true, color: style.box, opacity: 1, radius: 12, padding: 14 };
  }
  return cfg;
}
