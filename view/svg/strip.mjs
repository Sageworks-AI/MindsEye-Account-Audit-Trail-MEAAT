// Sequence strip: read-only "moving numbers" beneath the cards at the
// junction where the request side and the data side meet. Rendered as
// monospaced, aligned, read-only numbers. It cannot be edited or acted on.
//
// Layout: one row per figure (opening, change, closing), plus a request
// summary at the top (mode, cards, period, head). All numbers come from
// `strip.figures`, already computed by card builders; this module never
// computes money. The layout is deterministic given the strip data.

import { cptToPt, rect, line, text, group, svg } from './primitives.mjs';
import { textWidth, truncateWithEllipsis } from './text.mjs';

const PAD_X = 800n;
const PAD_Y = 400n;
const ROW_H = 1100n;
const FONT = 900n;

function formatMinor(amount, exponent) {
  if (amount === null || amount === undefined) return '';
  if (!Number.isInteger(amount)) throw new Error(`formatMinor: ${amount}`);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const factor = 10 ** exponent;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  if (exponent === 0) return String(amount);
  return `${sign}${whole}.${String(frac).padStart(exponent, '0')}`;
}

function formatDelta(amount, exponent) {
  if (amount === 0) return formatMinor(0, exponent);
  const sign = amount > 0 ? '+' : '';
  return sign + formatMinor(amount, exponent);
}

// The strip's request summary is rendered as a single monospaced line.
function requestLine(strip) {
  const r = strip.request;
  const cards = (r.cards || []).map((c) => `${c.type}:${c.cacheState}`).join(' ');
  const period = r.period
    ? (r.period.from && r.period.to
        ? `${r.period.from}..${r.period.to}`
        : (r.period.asOf ? `@${typeof r.period.asOf === 'string' ? r.period.asOf : r.period.asOf.date}` : ''))
    : '';
  const parts = [
    r.mode,
    cards,
    period,
    `head ${r.head.seq}:${r.head.shortHash}`,
  ].filter(Boolean);
  if (r.focus) parts.push(`focus ${r.focus.entryId}`);
  return parts.join(' · ');
}

export function renderStrip(strip, rectCpt, theme, { currency } = {}) {
  if (!strip || !strip.request) {
    throw new Error('renderStrip: strip.request required');
  }
  const exponent = (currency && currency.exponent) ?? 2;
  const font = theme.font;
  const inner = { x: PAD_X, y: PAD_Y, w: rectCpt.w - 2n * PAD_X };

  const children = [];

  // Background band so the strip reads as a distinct layer.
  children.push(rect({
    x: 0n, y: 0n, w: rectCpt.w, h: rectCpt.h,
    attrs: { fill: theme.paper, stroke: theme.rule, 'stroke-width': '0.01' },
  }));

  // Request line.
  const line1 = requestLine(strip);
  const clip1 = truncateWithEllipsis(line1, inner.w, FONT, { mono: true });
  children.push(text({
    x: inner.x, y: inner.y + FONT,
    content: clip1,
    attrs: {
      'font-family': font.monospace,
      'font-size': `${cptToPt(FONT)}pt`,
      fill: theme.muted,
    },
    title: clip1 !== line1 ? line1 : undefined,
  }));

  // Figures.
  let y = inner.y + FONT + ROW_H;
  if (strip.figures && strip.figures.length > 0) {
    // Compute the amount column widths from the maximum formatted length.
    let maxOpening = 1, maxChange = 1, maxClosing = 1;
    for (const f of strip.figures) {
      maxOpening = Math.max(maxOpening, formatMinor(f.opening ?? 0, exponent).length);
      maxChange  = Math.max(maxChange,  formatDelta(f.change ?? 0, exponent).length);
      maxClosing = Math.max(maxClosing, formatMinor(f.closing ?? 0, exponent).length);
    }
    const charW = (BigInt(600) * FONT) / 1000n; // mono 600 ppm
    const colW1 = BigInt(maxOpening) * charW + 400n;
    const colW2 = BigInt(maxChange) * charW + 400n;
    const colW3 = BigInt(maxClosing) * charW + 400n;
    const labelW = inner.w - colW1 - colW2 - colW3 - 800n;
    const xOpening = inner.x + labelW;
    const xChange = xOpening + colW1;
    const xClosing = xChange + colW2;

    // Column headers.
    children.push(text({
      x: inner.x, y,
      content: 'Account',
      attrs: {
        'font-family': font.monospace,
        'font-size': `${cptToPt(FONT)}pt`,
        fill: theme.muted,
      },
    }));
    for (const [x, w, label] of [
      [xOpening, colW1, 'opening'],
      [xChange, colW2, 'change'],
      [xClosing, colW3, 'closing'],
    ]) {
      children.push(text({
        x: x + w - textWidth(label, FONT, { mono: true }),
        y,
        content: label,
        attrs: {
          'font-family': font.monospace,
          'font-size': `${cptToPt(FONT)}pt`,
          fill: theme.muted,
        },
      }));
    }
    y += ROW_H;
    children.push(line({
      x1: inner.x, y1: y - 200n, x2: inner.x + inner.w, y2: y - 200n,
      attrs: { stroke: theme.rule, 'stroke-width': '0.01' },
    }));

    for (const f of strip.figures) {
      const label = truncateWithEllipsis(f.label, labelW - 200n, FONT, { mono: true });
      children.push(text({
        x: inner.x, y,
        content: label,
        attrs: {
          'font-family': font.monospace,
          'font-size': `${cptToPt(FONT)}pt`,
          fill: theme.fg,
        },
        title: label !== f.label ? f.label : undefined,
      }));
      const op = formatMinor(f.opening ?? 0, exponent);
      const ch = formatDelta(f.change ?? 0, exponent);
      const cl = formatMinor(f.closing ?? 0, exponent);
      children.push(text({
        x: xOpening + colW1 - textWidth(op, FONT, { mono: true }),
        y, content: op,
        attrs: { 'font-family': font.monospace, 'font-size': `${cptToPt(FONT)}pt`, fill: theme.fg },
      }));
      children.push(text({
        x: xChange + colW2 - textWidth(ch, FONT, { mono: true }),
        y, content: ch,
        attrs: {
          'font-family': font.monospace, 'font-size': `${cptToPt(FONT)}pt`,
          fill: (f.change ?? 0) > 0 ? theme.positive
            : (f.change ?? 0) < 0 ? theme.danger : theme.fg,
        },
      }));
      children.push(text({
        x: xClosing + colW3 - textWidth(cl, FONT, { mono: true }),
        y, content: cl,
        attrs: { 'font-family': font.monospace, 'font-size': `${cptToPt(FONT)}pt`, fill: theme.fg },
      }));
      y += ROW_H;
    }
  }

  return svg({
    widthCpt: rectCpt.w, heightCpt: rectCpt.h,
    children,
    attrs: {
      role: 'img',
      'aria-label': 'Sequence strip (read-only)',
      'data-mode': strip.request.mode,
      'data-head-seq': String(strip.request.head.seq),
    },
  });
}
