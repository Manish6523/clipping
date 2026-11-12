/**
 * Client-side mirror of src/compositor/profanity.py masking, used for the live
 * caption preview. Detection itself happens on the server (words arrive with
 * `profanity` + `censored`); a user override lives in `word.censor` (true/false).
 */

const VOWELS = new Set('aeiouAEIOU'.split(''));

export function isWordCensored(w) {
  if (!w) return false;
  if (typeof w.censor === 'boolean') return w.censor;
  return Boolean(w.censored);
}

export function maskWord(text, style = 'vowels') {
  if (!text || style === 'none') return text;
  const m = text.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9*]*)$/s);
  const lead = m ? m[1] : '';
  const core = m ? m[2] : text;
  const trail = m ? m[3] : '';
  if (!core || core.includes('*')) return text;

  const n = core.length;
  let masked;
  if (style === 'full') masked = '*'.repeat(n);
  else if (style === 'grawlix') masked = '#$@!'.repeat(Math.floor(n / 4) + 1).slice(0, Math.max(n, 4));
  else if (style === 'first') masked = core[0] + '*'.repeat(n - 1);
  else if (style === 'middle') masked = n <= 2 ? core : core[0] + '*'.repeat(n - 2) + core[n - 1];
  else {
    const chars = core.split('');
    let changed = false;
    for (let i = 1; i < n; i += 1) {
      if (VOWELS.has(chars[i])) { chars[i] = '*'; changed = true; }
    }
    if (!changed) return lead + maskWord(core, 'middle') + trail;
    masked = chars.join('');
  }
  return lead + masked + trail;
}

/** Returns { text, color } for a caption word given the effective censor config. */
export function censorDisplay(word, text, censorCfg) {
  if (!censorCfg || censorCfg.enabled === false || !isWordCensored(word)) {
    return { text, color: null };
  }
  const style = censorCfg.caption_style || 'vowels';
  return {
    text: style === 'none' ? text : maskWord(text, style),
    color: censorCfg.highlight_censored !== false ? (censorCfg.censored_color || '#FF3B3B') : null,
  };
}

/** Reads the profanity flags a clip carries ({ count, slur } or null). */
export function censorFlagInfo(flagsRaw) {
  if (!flagsRaw) return null;
  let flags = flagsRaw;
  if (typeof flagsRaw === 'string') {
    try { flags = JSON.parse(flagsRaw); } catch { return null; }
  }
  if (!Array.isArray(flags)) return null;
  const censored = flags.find((f) => f && f.type === 'profanity_censored');
  const slur = flags.some((f) => f && f.type === 'slur_detected');
  if (!censored && !slur) return null;
  return { count: censored?.count || 0, slur };
}
