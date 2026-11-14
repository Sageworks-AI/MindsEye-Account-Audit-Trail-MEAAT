// Impact view: a card with before / delta / after columns per row. Built
// from the merged sections that core/impact.mjs produces. Untouched rows
// are dimmed; touched rows get a delta highlighted by sign.
//
// Layout mirrors slip.mjs but with three amount columns (before, delta,
// after) and a `touched` class on the row group. Rows are the same order
// as in the card; the delta is right-aligned like an amount, with a leading
// "+" on positive values so the direction is unambiguous.

import { escapeXml, cptToPt, rect, line, text, group, svg } from './primitives.mjs';
import { textWidth, truncateWithEllipsis, amountColumnWidth } from './text.mjs';

const PAD_X = 1400n;
const PAD_Y = 1400n;
const ROW_H = 1200n;
const HEADER_H = 2600n;
const CHECK_ROW_H = 1000n;
const RULE_THICK = 40n;

function ptToCpt(pt) { return BigInt(Math.round(pt * 100)); }

function currencyInfo(card) {
  const c = card.currency || { code: 'BWP', exponent: 2, symbol: 'P' };
  return { code: c.code || 'BWP', exponent: c.exponent ?? 2, symbol: c.symbol || 'P' };
}

function formatMinor(amount, exponent) {
  if (!Number.isInteger(amount)) throw new Error(`formatMinor: ${amount}`);
  if (exponent === 0) return String(amount);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const factor = 10 ** exponent;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  return `${sign}${whole}.${String(frac).padStart(exponent, '0')}`;
}

function formatDelta(amount, exponent) {
  if (amount === 0) return formatMinor(0, exponent);
  const sign = amount > 0 ? '+' : '';
  return sign + formatMinor(amount, exponent);
}

function maxLen(a, b, c, exponent) {
  return Math.max(
    String(a).length,
    String(b).length,
    String(c).length,
  );
}

export function renderImpact(card, rectCpt, tier, theme) {
  if (!card || !card.impact) {
    throw new Error('renderImpact: card.impact missing');
  }
  const cur = currencyInfo(card);
  const font = theme.font;
  const metrics = theme.metrics;
  const fontSizeBody = ptToCpt(metrics.bodyPt);
  const fontSizeCaption = ptToCpt(metrics.captionPt);
  const fontSizeHeading = ptToCpt(metrics.headingPt);
  const fontSizeTitle = ptToCpt(metrics.titlePt);

  const inner = {
    x: PAD_X, y: PAD_Y,
    w: rectCpt.w - 2n * PAD_X,
    h: rectCpt.h - 2n * PAD_Y,
  };

  // Amount column width: max of (before, delta, after) formatted lengths.
  let maxAmountChars = 1;
  for (const section of card.sections) {
    for (const row of section.rows) {
      const before = formatMinor(row.before ?? 0, cur.exponent).length;
      const delta = formatDelta(row.delta ?? 0, cur.exponent).length;
      const after = formatMinor(row.after ?? 0, cur.exponent).length;
      maxAmountChars = Math.max(maxAmountChars, before, delta, after);
    }
  }
  const amountW = amountColumnWidth(maxAmountChars, fontSizeBody) + 200n;
  const labelW = inner.w - amountW * 3n - PAD_X;

  const colX = {
    label: inner.x,
    before: inner.x + labelW,
    delta: inner.x + labelW + amountW,
    after: inner.x + labelW + amountW * 2n,
  };

  const children = [];

  // Header.
  children.push(text({
    x: inner.x, y: inner.y + fontSizeTitle,
    content: card.title,
    attrs: {
      'font-family': font.family,
      'font-size': `${cptToPt(fontSizeTitle)}pt`,
      'font-weight': '700',
      fill: theme.fg,
    },
  }));
  const periodText = card.impact.outsidePeriod
    ? `entry ${card.impact.entrySeq} is outside this period`
    : `impact of entry ${card.impact.entrySeq}`;
  children.push(text({
    x: inner.x, y: inner.y + fontSizeTitle + fontSizeCaption * 2n,
    content: periodText,
    attrs: {
      'font-family': font.family,
      'font-size': `${cptToPt(fontSizeCaption)}pt`,
      fill: card.impact.outsidePeriod ? theme.warning : theme.muted,
    },
  }));
  children.push(text({
    x: inner.x, y: inner.y + fontSizeTitle + fontSizeCaption * 3n,
    content: `head seq ${card.headSeq} · ${cur.symbol}${cur.code}`,
    attrs: {
      'font-family': font.family,
      'font-size': `${cptToPt(fontSizeCaption)}pt`,
      fill: theme.muted,
    },
  }));

  // Column headers (right-aligned for amounts).
  const headerY = inner.y + HEADER_H;
  children.push(text({
    x: colX.label, y: headerY,
    content: 'Account',
    attrs: {
      'font-family': font.family,
      'font-size': `${cptToPt(fontSizeCaption)}pt`,
      fill: theme.muted,
    },
  }));
  for (const [col, label] of [['before', 'Before'], ['delta', 'Delta'], ['after', 'After']]) {
    children.push(text({
      x: colX[col] + amountW - textWidth(label, fontSizeCaption, { mono: true }),
      y: headerY,
      content: label,
      attrs: {
        'font-family': font.monospace,
        'font-size': `${cptToPt(fontSizeCaption)}pt`,
        'text-anchor': 'start',
        fill: theme.muted,
      },
    }));
  }
  children.push(line({
    x1: inner.x, y1: headerY + RULE_THICK * 2n,
    x2: inner.x + inner.w, y2: headerY + RULE_THICK * 2n,
    attrs: { stroke: theme.rule, 'stroke-width': cptToPt(RULE_THICK) },
  }));

  // Rows.
  let y = headerY + fontSizeCaption + ROW_H * 2n;
  for (const section of card.sections) {
    children.push(text({
      x: inner.x, y,
      content: section.label,
      attrs: {
        'font-family': font.family,
        'font-size': `${cptToPt(fontSizeHeading)}pt`,
        'font-weight': '600',
        fill: theme.fg,
      },
    }));
    y += ROW_H;
    for (const row of section.rows) {
      const dim = row.touched ? theme.fg : theme.muted;
      const label = row.label || row.code || '';
      const display = truncateWithEllipsis(label, labelW - 200n, fontSizeBody);
      const titleText = display !== label ? label : undefined;
      children.push(text({
        x: colX.label, y,
        content: display,
        attrs: {
          'font-family': font.family,
          'font-size': `${cptToPt(fontSizeBody)}pt`,
          fill: dim,
        },
        title: titleText,
      }));
      const before = formatMinor(row.before ?? 0, cur.exponent);
      const delta = formatDelta(row.delta ?? 0, cur.exponent);
      const after = formatMinor(row.after ?? 0, cur.exponent);
      children.push(text({
        x: colX.before + amountW - textWidth(before, fontSizeBody, { mono: true }),
        y, content: before,
        attrs: { 'font-family': font.monospace,
                 'font-size': `${cptToPt(fontSizeBody)}pt`,
                 fill: dim },
      }));
      children.push(text({
        x: colX.delta + amountW - textWidth(delta, fontSizeBody, { mono: true }),
        y, content: delta,
        attrs: { 'font-family': font.monospace,
                 'font-size': `${cptToPt(fontSizeBody)}pt`,
                 'font-weight': row.touched ? '600' : '400',
                 fill: row.touched
                   ? (row.delta > 0 ? theme.positive : row.delta < 0 ? theme.danger : theme.fg)
                   : theme.muted },
      }));
      children.push(text({
        x: colX.after + amountW - textWidth(after, fontSizeBody, { mono: true }),
        y, content: after,
        attrs: { 'font-family': font.monospace,
                 'font-size': `${cptToPt(fontSizeBody)}pt`,
                 fill: dim },
      }));
      y += ROW_H;
    }
    children.push(line({
      x1: inner.x, y1: y - RULE_THICK, x2: inner.x + inner.w, y2: y - RULE_THICK,
      attrs: { stroke: theme.rule, 'stroke-width': cptToPt(RULE_THICK) },
    }));
    children.push(text({
      x: colX.label, y,
      content: 'Total',
      attrs: {
        'font-family': font.family,
        'font-size': `${cptToPt(fontSizeBody)}pt`,
        'font-weight': '600',
        fill: theme.fg,
      },
    }));
    const total = section.total;
    const bStr = formatMinor(total.before ?? 0, cur.exponent);
    const dStr = formatDelta(total.delta ?? 0, cur.exponent);
    const aStr = formatMinor(total.after ?? 0, cur.exponent);
    children.push(text({
      x: colX.before + amountW - textWidth(bStr, fontSizeBody, { mono: true }),
      y, content: bStr,
      attrs: { 'font-family': font.monospace,
               'font-size': `${cptToPt(fontSizeBody)}pt`,
               'font-weight': '600', fill: theme.fg },
    }));
    children.push(text({
      x: colX.delta + amountW - textWidth(dStr, fontSizeBody, { mono: true }),
      y, content: dStr,
      attrs: { 'font-family': font.monospace,
               'font-size': `${cptToPt(fontSizeBody)}pt`,
               'font-weight': '600',
               fill: (total.delta ?? 0) > 0 ? theme.positive
                 : (total.delta ?? 0) < 0 ? theme.danger : theme.fg },
    }));
    children.push(text({
      x: colX.after + amountW - textWidth(aStr, fontSizeBody, { mono: true }),
      y, content: aStr,
      attrs: { 'font-family': font.monospace,
               'font-size': `${cptToPt(fontSizeBody)}pt`,
               'font-weight': '600', fill: theme.fg },
    }));
    y += ROW_H + ROW_H / 2n;
  }

  // Checks footer.
  const footerY = inner.y + inner.h - CHECK_ROW_H;
  children.push(line({
    x1: inner.x, y1: footerY, x2: inner.x + inner.w, y2: footerY,
    attrs: { stroke: theme.rule, 'stroke-width': cptToPt(RULE_THICK) },
  }));
  let checkX = inner.x;
  const checkY = footerY + fontSizeCaption * 2n;
  for (const check of card.checks || []) {
    const marker = check.pass ? '✓' : '✗';
    const t = `${marker} ${check.name}`;
    children.push(text({
      x: checkX, y: checkY,
      content: truncateWithEllipsis(t, inner.w / 2n, fontSizeCaption),
      attrs: {
        'font-family': font.family,
        'font-size': `${cptToPt(fontSizeCaption)}pt`,
        fill: check.pass ? theme.positive : theme.danger,
      },
      title: check.detail ? `${t} — ${check.detail}` : t,
    }));
    checkX += inner.w / 2n;
  }

  return svg({
    widthCpt: rectCpt.w,
    heightCpt: rectCpt.h,
    children,
    attrs: {
      role: 'img',
      'aria-label': `Impact card: ${card.title}`,
      'data-card-type': card.type,
      'data-tier': tier,
      'data-mode': 'impact',
      'data-hash': card.hash,
      'data-ok': card.ok ? 'true' : 'false',
      'data-entry-seq': String(card.impact.entrySeq),
    },
  });
}
