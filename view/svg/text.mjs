// Self-contained text measurement for the view layer. Deliberately does NOT
// import from space/: the SVG renderers must run in the browser, and
// space/index.mjs opens files with node:fs at module load. The width table
// below is the sans advance-width table from space/reference/metrics.json,
// duplicated here for the same reason resolve/dates.mjs duplicates
// core/time.mjs (README #25 extended in S10, see #55).
//
// All lengths are BigInt cpt. Width in cpt = sum(advances) * fontSize / 1000.
// Determinism: same inputs → same BigInt output; no floats, no Intl, no DOM.

const SANS_WIDTH = Object.freeze({
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778, 'H': 722,
  'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778, 'P': 667,
  'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944, 'X': 667,
  'Y': 667, 'Z': 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333,
  'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556, 'h': 556,
  'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556, 'p': 556,
  'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722, 'x': 500,
  'y': 500, 'z': 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
});

const SANS_FALLBACK = 556;
const MONO_WIDTH = 600;
const ELLIPSIS_CHAR = '\u2026';
const WORD_BREAK = /\s+/;

export function charWidthPpm(ch, { mono = false } = {}) {
  if (mono) return MONO_WIDTH;
  return SANS_WIDTH[ch] ?? SANS_FALLBACK;
}

// Width of `content` in cpt at `fontSizeCpt`. Integer-only.
export function textWidth(content, fontSizeCpt, opts = {}) {
  if (typeof fontSizeCpt !== 'bigint' || fontSizeCpt < 0n) {
    throw new Error('textWidth: fontSizeCpt must be a non-negative BigInt');
  }
  let sum = 0n;
  for (const ch of String(content)) sum += BigInt(charWidthPpm(ch, opts));
  return (sum * fontSizeCpt) / 1000n;
}

// Truncate with an ellipsis so that the result fits `maxWidthCpt`.
// Returns the original string when it already fits.
export function truncateWithEllipsis(content, maxWidthCpt, fontSizeCpt, opts = {}) {
  const s = String(content);
  if (textWidth(s, fontSizeCpt, opts) <= maxWidthCpt) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = s.slice(0, mid) + ELLIPSIS_CHAR;
    if (textWidth(candidate, fontSizeCpt, opts) <= maxWidthCpt) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + ELLIPSIS_CHAR;
}

// Greedy word wrap; up to `maxLines`. Truncates the last line if it still
// overflows. Returns { lines, truncated, fullText } — `fullText` is what a
// caller should put in a <title> element.
export function wrap(content, maxWidthCpt, fontSizeCpt, { maxLines = 4, ...opts } = {}) {
  const s = String(content || '');
  if (!s) return { lines: [], truncated: false, fullText: '' };
  const words = s.split(WORD_BREAK).filter(Boolean);
  if (words.length === 0) return { lines: [], truncated: false, fullText: s };
  const lines = [];
  let current = '';
  const fits = (t) => textWidth(t, fontSizeCpt, opts) <= maxWidthCpt;
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (fits(candidate)) { current = candidate; continue; }
    if (current) {
      lines.push(current);
      if (lines.length === maxLines) {
        lines[lines.length - 1] = truncateWithEllipsis(current, maxWidthCpt, fontSizeCpt, opts);
        return { lines, truncated: true, fullText: s };
      }
      current = w;
    } else {
      current = truncateWithEllipsis(w, maxWidthCpt, fontSizeCpt, opts);
    }
  }
  if (current) {
    if (lines.length < maxLines) lines.push(current);
    else lines[lines.length - 1] = truncateWithEllipsis(current, maxWidthCpt, fontSizeCpt, opts);
  }
  return { lines, truncated: lines.join(' ') !== s, fullText: s };
}

// Width of a single formatted amount in a monospaced column, assuming
// digits are tabular (they are, in the mono family). Used by slip.mjs to
// size amount columns.
export function amountColumnWidth(maxFormattedLen, fontSizeCpt) {
  return (BigInt(maxFormattedLen) * BigInt(MONO_WIDTH) * fontSizeCpt) / 1000n;
}
