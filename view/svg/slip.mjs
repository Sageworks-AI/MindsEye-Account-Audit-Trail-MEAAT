// Renders a card (from core/cards/*) as a paper slip. Pure: (card, rect,
// tier, theme) -> SVG string. No DOM, no React, no ledger imports.
//
// Layout: header (title, period, currency), body (sections + rows with a
// rule above each section total), footer (check row, red when a check
// fails). Amount columns are right-aligned with tabular digits; the amount
// column width is derived from the longest formatted amount in the card.
//
// Tier slicing is done here (not in the builder) so the full card is
// always the input: `summary` drops rows and shows only section totals,
// `standard` shows rows, `full` additionally shows codes and a drill hint.
// The page is drawn into a fixed logical page (rect in cpt); the SVG
// viewBox equals the rect so proportions are exact and no scaling is
// applied to the text (that is the pane's job in the browser).

import { escapeXml, cptToPt, rect, line, text, group, svg } from './primitives.mjs';
import { textWidth, wrap, truncateWithEllipsis, amountColumnWidth } from './text.mjs';

const PAD_X = 1400n;       // 14 pt
const PAD_Y = 1400n;
const ROW_H = 1200n;       // 12 pt
const HEADER_H = 2000n;
const CHECK_ROW_H = 1000n;
const RULE_THICK = 40n;    // 0.4 pt

function ptToCpt(pt) { return BigInt(Math.round(pt * 100)); }

function tierIncludesRows(tier) {
  return tier === 'standard' || tier === 'full';
}
function tierIncludesCodes(tier) {
  return tier === 'full';
}

// Compute the maximum length of any formatted amount in the card. Formatted
// strings are already produced by core (the view never formats money). We
// just scan them for the widest one.
function maxAmountLength(card) {
  let max = 0;
  for (const section of card.sections || []) {
    const total = section.total;
    if (typeof total === 'number') {
      const len = String(total).length;
      if (len > max) max = len;
    } else if (total && typeof total === 'object') {
      for (const k of ['debit', 'credit']) {
        if (typeof total[k] === 'number') {
          const len = String(total[k]).length;
          if (len > max) max = len;
        }
      }
    }
    for (const row of section.rows || []) {
      for (const k of ['amount', 'debit', 'credit']) {
        if (typeof row[k] === 'number') {
          const len = String(row[k]).length;
          if (len > max) max = len;
        }
      }
    }
  }
  return max || 1;
}

// The card builder already formats amounts as integers, but the *display*
// uses the currency from the card. We import nothing from core; instead, we
// call the same integer formatting the money path uses, inline, so a
// receipt can be rendered without a runtime dependency on core/money.mjs.
// (core/money.mjs is node-only because it uses a BigInt-free path, but
// view/ must run in the browser; the arithmetic is identical.)
function formatMinor(amount, exponent) {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new Error(`formatMinor: amount must be integer, got ${amount}`);
  }
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) {
    throw new Error(`formatMinor: bad exponent ${exponent}`);
  }
  if (exponent === 0) return String(amount);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const factor = 10 ** exponent;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  return `${sign}${whole}.${String(frac).padStart(exponent, '0')}`;
}

function currencyInfo(card) {
  const c = card.currency || { code: 'BWP', exponent: 2, symbol: 'P' };
  return { code: c.code || 'BWP', exponent: c.exponent ?? 2, symbol: c.symbol || 'P' };
}

function headerLine(card, theme) {
  const cur = currencyInfo(card);
  const periodBits = [];
  if (card.period && card.period.from && card.period.to) {
    periodBits.push(`${card.period.from} to ${card.period.to}`);
  } else if (card.period && card.period.asOf) {
    const asOf = card.period.asOf;
    if (typeof asOf === 'string') periodBits.push(`as at ${asOf}`);
    else periodBits.push(`as at ${asOf.date} (seq ${asOf.seq})`);
  } else if (card.period && card.period.entryId) {
    periodBits.push(`entry ${card.period.entryId}`);
  }
  periodBits.push(`currency ${cur.code}`);
  return { period: periodBits.join(' · ') };
}

function columnOrder(card) {
  // Cards declare their columns; we honour that order. When a card has no
  // columns (should not happen in v2), fall back to [label, amount].
  const keys = (card.columns || []).map((c) => c.key);
  if (keys.length === 0) return ['label', 'amount'];
  return keys;
}

function pickDisplay(columns, tier) {
  const keys = columnOrder({ columns });
  if (!tierIncludesCodes(tier)) {
    return keys.filter((k) => k !== 'code');
  }
  return keys;
}

function rowAmounts(row, columns) {
  const out = {};
  for (const k of columns) out[k] = row[k];
  return out;
}

// Approximate column widths in cpt, based on max characters and font size.
// Numeric columns are width-driven; text columns take the remaining room.
function computeColumnWidths(columns, maxAmountLen, fontSizeCpt) {
  const widths = {};
  for (const k of columns) {
    if (k === 'amount' || k === 'debit' || k === 'credit') {
      widths[k] = amountColumnWidth(maxAmountLen, fontSizeCpt) + 200n;
    } else if (k === 'code') {
      widths[k] = 4000n; // 40 pt for a 4-char code
    }
  }
  return widths;
}

export function renderCard(card, rectCpt, tier, theme) {
  if (!card || card.kind !== 'state_card') {
    throw new Error('renderCard: not a state card');
  }
  const isFull = tier === 'full';
  const showRows = tierIncludesRows(tier);
  const cur = currencyInfo(card);
  const font = theme.font;
  const metrics = theme.metrics;

  const fontSizeBody = ptToCpt(metrics.bodyPt);
  const fontSizeCaption = ptToCpt(metrics.captionPt);
  const fontSizeHeading = ptToCpt(metrics.headingPt);
  const fontSizeTitle = ptToCpt(metrics.titlePt);

  const inner = {
    x: PAD_X,
    y: PAD_Y,
    w: rectCpt.w - 2n * PAD_X,
    h: rectCpt.h - 2n * PAD_Y,
  };

  const columns = pickDisplay(card.columns || [], tier);
  const maxAmountLen = maxAmountLength(card);
  const colWidths = computeColumnWidths(columns, maxAmountLen, fontSizeBody);

  // Text column width is the remaining room.
  const nonTextWidth = columns.reduce((sum, k) => sum + (colWidths[k] || 0n), 0n);
  const textCols = columns.filter((k) => !colWidths[k]);
  const textColWidth = textCols.length > 0
    ? (inner.w - nonTextWidth) / BigInt(textCols.length)
    : 0n;
  for (const k of textCols) colWidths[k] = textColWidth;

  // Column x positions.
  const colX = {};
  let cursor = inner.x;
  for (const k of columns) {
    colX[k] = cursor;
    cursor += colWidths[k];
  }

  const children = [];

  // ---- Header ----
  children.push(rect({
    x: inner.x, y: inner.y, w: inner.w, h: HEADER_H,
    attrs: { fill: 'transparent' },
  }));
  children.push(text({
    x: inner.x, y: inner.y + fontSizeTitle,
    content: card.title,
    attrs: {
      'font-family': font.family,
      'font-size': `${cptToPt(fontSizeTitle)}pt`,
      'font-weight': '700',
      fill: theme.fg,
    },
    title: card.title,
  }));
  const header = headerLine(card, theme);
  children.push(text({
    x: inner.x, y: inner.y + fontSizeTitle + fontSizeCaption * 2n,
    content: header.period,
    attrs: {
      'font-family': font.family,
      'font-size': `${cptToPt(fontSizeCaption)}pt`,
      fill: theme.muted,
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

  // ---- Sections ----
  let y = inner.y + HEADER_H + fontSizeHeading;
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
      title: section.label,
    }));
    y += ROW_H;

    if (showRows) {
      for (const row of section.rows) {
        const label = row.label || row.code || '';
        const wrapText = isFull ? wrap(label, colWidths.label || colWidths.name || inner.w, fontSizeBody, { maxLines: 2 }) : null;
        const display = wrapText ? wrapText.lines[0] || '' : truncateWithEllipsis(label, colWidths.label || colWidths.name || inner.w, fontSizeBody);
        const titleText = wrapText && wrapText.truncated ? wrapText.fullText : display;
        if (tierIncludesCodes(tier) && row.code) {
          children.push(text({
            x: colX.code, y,
            content: row.code,
            attrs: {
              'font-family': font.monospace,
              'font-size': `${cptToPt(fontSizeBody)}pt`,
              fill: theme.muted,
            },
          }));
        }
        const labelCol = columns.includes('label') ? 'label' : 'name';
        children.push(text({
          x: colX[labelCol], y,
          content: display,
          attrs: {
            'font-family': font.family,
            'font-size': `${cptToPt(fontSizeBody)}pt`,
            fill: theme.fg,
          },
          title: titleText,
        }));
        for (const k of columns) {
          if (k === 'label' || k === 'name' || k === 'code') continue;
          const amt = row[k];
          const isNumeric = typeof amt === 'number';
          const content = isNumeric ? formatMinor(amt, cur.exponent) : '';
          children.push(text({
            x: colX[k] + colWidths[k] - textWidth(content, fontSizeBody, { mono: true }),
            y,
            content,
            attrs: {
              'font-family': font.monospace,
              'font-size': `${cptToPt(fontSizeBody)}pt`,
              'text-anchor': 'start',
              fill: theme.fg,
            },
          }));
        }
        y += ROW_H;
      }
    }

    // Rule above the total.
    children.push(line({
      x1: inner.x, y1: y - RULE_THICK, x2: inner.x + inner.w, y2: y - RULE_THICK,
      attrs: { stroke: theme.rule, 'stroke-width': cptToPt(RULE_THICK * 2n) },
    }));

    // Total row.
    const totalLabel = 'Total';
    children.push(text({
      x: colX.label || colX.name || inner.x, y,
      content: totalLabel,
      attrs: {
        'font-family': font.family,
        'font-size': `${cptToPt(fontSizeBody)}pt`,
        'font-weight': '600',
        fill: theme.fg,
      },
    }));
    const totalObj = section.total;
    if (typeof totalObj === 'number') {
      const content = formatMinor(totalObj, cur.exponent);
      children.push(text({
        x: colX.amount + colWidths.amount - textWidth(content, fontSizeBody, { mono: true }),
        y,
        content,
        attrs: {
          'font-family': font.monospace,
          'font-size': `${cptToPt(fontSizeBody)}pt`,
          'font-weight': '600',
          fill: theme.fg,
        },
      }));
    } else if (totalObj && typeof totalObj === 'object') {
      for (const k of ['debit', 'credit']) {
        if (typeof totalObj[k] === 'number') {
          const content = formatMinor(totalObj[k], cur.exponent);
          children.push(text({
            x: colX[k] + colWidths[k] - textWidth(content, fontSizeBody, { mono: true }),
            y,
            content,
            attrs: {
              'font-family': font.monospace,
              'font-size': `${cptToPt(fontSizeBody)}pt`,
              'font-weight': '600',
              fill: theme.fg,
            },
          }));
        }
      }
    }
    y += ROW_H + ROW_H / 2n;
  }

  // ---- Checks footer ----
  const footerY = inner.y + inner.h - CHECK_ROW_H;
  children.push(line({
    x1: inner.x, y1: footerY, x2: inner.x + inner.w, y2: footerY,
    attrs: { stroke: theme.rule, 'stroke-width': cptToPt(RULE_THICK) },
  }));
  let checkX = inner.x;
  const checkY = footerY + fontSizeCaption * 2n;
  for (const check of card.checks || []) {
    const marker = check.pass ? '✓' : '✗';
    const text_ = `${marker} ${check.name}`;
    const clip = truncateWithEllipsis(text_, inner.w / 2n, fontSizeCaption);
    children.push(text({
      x: checkX, y: checkY,
      content: clip,
      attrs: {
        'font-family': font.family,
        'font-size': `${cptToPt(fontSizeCaption)}pt`,
        fill: check.pass ? theme.positive : theme.danger,
      },
      title: check.detail ? `${text_} — ${check.detail}` : text_,
    }));
    checkX += inner.w / 2n;
  }

  return svg({
    widthCpt: rectCpt.w,
    heightCpt: rectCpt.h,
    children,
    attrs: {
      role: 'img',
      'aria-label': `Card: ${card.title}`,
      'data-card-type': card.type,
      'data-tier': tier,
      'data-hash': card.hash,
      'data-ok': card.ok ? 'true' : 'false',
    },
  });
}
