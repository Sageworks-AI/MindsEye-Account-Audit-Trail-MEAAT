// Text measurement with the bundled advance-width tables. Widths are in
// cpt: sum(charWidth[i] * fontSize) / 1000, integer arithmetic only. Digits
// are tabular so amount-column widths depend only on the maximum formatted
// length in characters, plus a small pad.
//
// Wrap is greedy on word boundaries (no hyphenation). Truncation adds an
// ellipsis and reports the full text for a title element.
import { check, mul, floorDiv } from './fixed.mjs';

const ELLIPSIS_CHAR = '\u2026';
const WORD_BREAK = /\s+/;

export function charWidthPpm(metrics, char, family = 'sans') {
  const familyDef = metrics[family];
  if (!familyDef) throw new Error(`metrics: unknown font family "${family}"`);
  const w = familyDef.charWidths[char];
  return typeof w === 'number' ? w : familyDef.fallback;
}

// fontSizeCpt is an int64 BigInt. Sum of advances is exact; the single
// multiply is the only place where we leave int64 and come back.
export function textWidth(text, fontSizeCpt, metrics, family = 'sans') {
  check(fontSizeCpt, 'fontSizeCpt');
  let sum = 0n;
  for (let i = 0; i < text.length; i++) {
    sum += BigInt(charWidthPpm(metrics, text[i], family));
  }
  return floorDiv(mul(sum, fontSizeCpt, 'text width numerator'), 1000n, 'text width divisor');
}

export function maxFormattedLength(samples, { displayMax = 12 } = {}) {
  let m = 0;
  for (const s of samples) m = Math.max(m, s.length);
  return Math.min(m, displayMax);
}

// Greedy word wrap on spaces. Returns at most maxLines lines; the last line
// is truncated with an ellipsis if it still overflows. Caller supplies
// `measure(text) -> width`. No hyphenation; a single very long word is
// truncated on the character boundary.
export function wrap(text, maxWidthCpt, { maxLines = 4, measure }) {
  if (!text) return { lines: [], truncated: false, fullText: text || '' };
  const words = text.split(WORD_BREAK).filter(Boolean);
  if (words.length === 0) return { lines: [], truncated: false, fullText: text };
  const lines = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (measure(candidate) <= maxWidthCpt) {
      current = candidate;
    } else if (current) {
      lines.push(current);
      if (lines.length === maxLines) {
        const last = truncateWithEllipsis(current, maxWidthCpt, measure);
        lines[lines.length - 1] = last;
        return { lines, truncated: true, fullText: text };
      }
      current = w;
    } else {
      current = truncateWithEllipsis(w, maxWidthCpt, measure);
    }
  }
  if (current) {
    if (lines.length < maxLines) lines.push(current);
    else lines[lines.length - 1] = truncateWithEllipsis(current, maxWidthCpt, measure);
  }
  return { lines, truncated: lines.join(' ') !== text, fullText: text };
}

export function truncateWithEllipsis(text, maxWidthCpt, measure) {
  if (measure(text) <= maxWidthCpt) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ELLIPSIS_CHAR;
    if (measure(candidate) <= maxWidthCpt) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ELLIPSIS_CHAR;
}

// Amount columns: width = maxFormattedLen * digitAdvance(fontSize) + pad.
// The digit advance is the same for every digit in tabular families.
export function amountColumnWidth(maxFormattedLen, fontSizeCpt, metrics, family, padCpt) {
  const digitWidth = BigInt(charWidthPpm(metrics, '0', family));
  const perDigit = floorDiv(mul(digitWidth, fontSizeCpt, 'digit advance'), 1000n);
  return BigInt(maxFormattedLen) * perDigit + padCpt;
}
