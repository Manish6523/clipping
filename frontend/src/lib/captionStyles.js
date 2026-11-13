// Mirrors STYLES in src/compositor/caption_styles.py (sizes are in the 1080x1920 video space).
// tests/test_caption_styles.py checks the ids stay in sync.
export const CAPTION_STYLES = [
  { id: 'template', label: 'Template default', hint: 'Whatever the template uses', font: 'Montserrat ExtraBold', family: "'AC Montserrat XB'", size: 60, color: '#FFFFFF', highlight: '#FACC15', outline: '#000000', outlineWidth: 5, shadow: 2, upper: true, words: 3, mode: 'highlight', anim: 'pop' },
  { id: 'bold_pop', label: 'Bold Pop', hint: 'Big uppercase, yellow active word', family: "'AC Montserrat Black'", size: 82, color: '#FFFFFF', highlight: '#FACC15', outline: '#000000', outlineWidth: 9, shadow: 3, upper: true, words: 3, mode: 'highlight', anim: 'pop' },
  { id: 'karaoke', label: 'Karaoke', hint: 'Words fill green as they’re spoken', family: "'AC Montserrat XB'", size: 64, color: '#FFFFFF', highlight: '#4ADE80', outline: '#000000', outlineWidth: 7, shadow: 2, upper: true, words: 5, mode: 'progressive', anim: 'none' },
  { id: 'boxed', label: 'Boxed', hint: 'Purple box behind the active word', family: "'AC Montserrat Black'", size: 76, color: '#FFFFFF', highlight: '#FFFFFF', outline: '#000000', outlineWidth: 6, shadow: 2, upper: true, words: 3, mode: 'box', box: '#7C3AED', anim: 'none' },
  { id: 'neon', label: 'Neon Gaming', hint: 'Cyan glow, pink active word', family: "'AC Russo One'", size: 78, color: '#E0FFFF', highlight: '#FFE4F3', outline: '#05202A', outlineWidth: 3, shadow: 0, upper: true, words: 3, mode: 'glow', glow: '#22D3EE', activeGlow: '#EC4899', anim: 'pop' },
  { id: 'beast', label: 'Beast', hint: 'Chunky comic font, green pop', family: "'AC Luckiest Guy'", size: 88, color: '#FFFFFF', highlight: '#22C55E', outline: '#000000', outlineWidth: 8, shadow: 6, upper: true, words: 2, mode: 'highlight', anim: 'bounce' },
  { id: 'one_word', label: 'One Word', hint: 'One huge word at a time', family: "'AC Anton'", size: 128, color: '#FFFFFF', highlight: '#FFFFFF', outline: '#000000', outlineWidth: 9, shadow: 4, upper: true, words: 1, mode: 'highlight', anim: 'pop' },
  { id: 'comic', label: 'Comic', hint: 'Yellow comic letters, red active', family: "'AC Bangers'", size: 92, color: '#FDE047', highlight: '#EF4444', outline: '#000000', outlineWidth: 7, shadow: 5, upper: true, words: 3, mode: 'highlight', anim: 'bounce', spacing: 2 },
  { id: 'red_alert', label: 'Red Alert', hint: 'Red box on the active word', family: "'AC Poppins XB'", size: 70, color: '#FFFFFF', highlight: '#FFFFFF', outline: '#000000', outlineWidth: 6, shadow: 2, upper: true, words: 3, mode: 'box', box: '#E11D48', anim: 'pop' },
  { id: 'clean', label: 'Clean', hint: 'Sentence case, soft shadow', family: "'AC Inter'", size: 54, color: '#FFFFFF', highlight: '#FDE68A', outline: '#000000', outlineWidth: 2.5, shadow: 3, upper: false, words: 6, mode: 'highlight', anim: 'none' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Tall condensed, calm', family: "'AC Bebas Neue'", size: 84, color: '#F5F5F4', highlight: '#FFFFFF', outline: '#000000', outlineWidth: 3, shadow: 4, upper: true, words: 4, mode: 'progressive', anim: 'none', spacing: 4 },
  { id: 'marker', label: 'Marker', hint: 'Hand-drawn, orange active word', family: "'AC Permanent Marker'", size: 72, color: '#FFFFFF', highlight: '#FB923C', outline: '#000000', outlineWidth: 6, shadow: 3, upper: false, words: 3, mode: 'highlight', anim: 'pop' },
];

export const styleById = (id) => CAPTION_STYLES.find((s) => s.id === id) || CAPTION_STYLES[0];

const STORE_KEY = 'autoclip_caption_style';
export function loadCaptionStyle() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return CAPTION_STYLES.some((s) => s.id === v) ? v : 'bold_pop';
  } catch {
    return 'bold_pop';
  }
}
export function saveCaptionStyle(id) {
  try { localStorage.setItem(STORE_KEY, id); } catch { /* private mode */ }
}

/** Font name used by the renderer -> the @font-face family loaded from /fonts. */
export const FONT_FAMILY = {
  'Montserrat Black': "'AC Montserrat Black'",
  'Montserrat ExtraBold': "'AC Montserrat XB'",
  Anton: "'AC Anton'",
  Bangers: "'AC Bangers'",
  'Bebas Neue': "'AC Bebas Neue'",
  Inter: "'AC Inter'",
  'Poppins ExtraBold': "'AC Poppins XB'",
  'Russo One': "'AC Russo One'",
  'Luckiest Guy': "'AC Luckiest Guy'",
  'Permanent Marker': "'AC Permanent Marker'",
};
