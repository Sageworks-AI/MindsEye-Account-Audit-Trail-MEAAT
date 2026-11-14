// Trail flowchart. Time on the horizontal axis (real calendar dates), lanes
// on the vertical axis (account type). Node size and label encode the
// amount; edges are SVG paths, derived links solid, drawn links dashed.
//
// Layout is deterministic: dates are placed at evenly spaced x positions in
// their (date, seq) order (not by calendar distance — that would push a
// single far-future date to the edge and squash every other node). Lanes
// are ordered by the first appearance of the account kind in the trail.
//
// Nodes are rectangles; label inside is the amount formatted from the
// node's own data (the view never computes money — the trail's node amount
// came from the ledger, S1). Truncation uses the same estimator as the
// slip.
//
// `refs` on nodes are what makes drill-down possible from the SVG; each
// node carries data-node-id so a click handler in S13 can map back.

import { escapeXml, cptToPt, rect, line, path, text, group, svg } from './primitives.mjs';
import { textWidth, truncateWithEllipsis } from './text.mjs';

const PAD_X = 1400n;
const PAD_Y = 1400n;
const AXIS_H = 1600n;
const LANE_GAP = 600n;
const NODE_W = 9000n;   // 90 pt
const NODE_H = 3000n;   // 30 pt
const FONT_BODY = 1000n;
const FONT_CAPTION = 800n;

const KIND_LABEL = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expenses',
};

function formatMinor(amount, exponent) {
  if (!Number.isInteger(amount)) throw new Error(`formatMinor: ${amount}`);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const factor = 10 ** exponent;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  if (exponent === 0) return String(amount);
  return `${sign}${whole}.${String(frac).padStart(exponent, '0')}`;
}

// Build the layout from the trail. Deterministic; no floating point; no DOM.
function buildLayout(trail, inner) {
  // Sort nodes by (date, seq, lineIndex) — this is the horizontal order.
  const sorted = [...trail.nodes].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.lineIndex - b.lineIndex;
  });

  const uniqueDates = [];
  const seenDates = new Set();
  for (const n of sorted) {
    if (!seenDates.has(n.date)) { seenDates.add(n.date); uniqueDates.push(n.date); }
  }

  // Account-kind lane order: first appearance in the trail.
  const laneOrder = [];
  const laneIndex = {};
  for (const n of trail.nodes) {
    if (!(n.account in laneIndex)) {
      laneIndex[n.account] = laneOrder.length;
      laneOrder.push(n.account);
    }
  }

  // x position per date, evenly spaced.
  const nDates = uniqueDates.length;
  const usableW = inner.w - NODE_W;
  const xForDate = {};
  if (nDates === 1) {
    xForDate[uniqueDates[0]] = inner.x + usableW / 2n;
  } else {
    for (let i = 0; i < nDates; i++) {
      xForDate[uniqueDates[i]] = inner.x + (usableW * BigInt(i)) / BigInt(nDates - 1);
    }
  }

  // y position per lane.
  const nLanes = laneOrder.length;
  const laneH = nLanes > 0 ? (inner.h - AXIS_H) / BigInt(nLanes) : 0n;
  const yForAccount = {};
  for (let i = 0; i < nLanes; i++) {
    yForAccount[laneOrder[i]] = inner.y + AXIS_H + laneH * BigInt(i) + (laneH - NODE_H) / 2n;
  }

  // Node positions.
  const nodePos = {};
  for (const n of sorted) {
    // If two nodes share a tick, offset the later ones downward within the
    // lane so they do not overlap. The offset is bounded by NODE_H/4 and
    // accumulates; deterministic.
    let offset = 0n;
    for (const other of Object.keys(nodePos)) {
      const op = nodePos[other];
      if (op.date === n.date && op.account === n.account && op.y === yForAccount[n.account] + offset) {
        offset += NODE_H / 4n;
        break;
      }
    }
    nodePos[n.id] = {
      x: xForDate[n.date],
      y: yForAccount[n.account] + offset,
      account: n.account,
      date: n.date,
      amount: n.amount,
      side: n.side,
    };
  }

  return { sorted, uniqueDates, laneOrder, xForDate, yForAccount, nodePos };
}

export function renderTrail(trail, rectCpt, theme) {
  if (!trail || !Array.isArray(trail.nodes) || !Array.isArray(trail.links)) {
    throw new Error('renderTrail: trail.nodes and trail.links required');
  }
  const font = theme.font;
  const cur = trail.currency || { code: 'BWP', exponent: 2, symbol: 'P' };

  const inner = {
    x: PAD_X, y: PAD_Y,
    w: rectCpt.w - 2n * PAD_X,
    h: rectCpt.h - 2n * PAD_Y,
  };

  if (trail.nodes.length === 0) {
    return svg({
      widthCpt: rectCpt.w, heightCpt: rectCpt.h,
      children: [text({
        x: inner.x, y: inner.y + FONT_BODY,
        content: 'Empty trail',
        attrs: { 'font-family': font.family, 'font-size': `${cptToPt(FONT_BODY)}pt`, fill: theme.muted },
      })],
      attrs: {
        role: 'img', 'aria-label': `Trail: ${trail.name}`,
        'data-trail-id': trail.id,
      },
    });
  }

  const layout = buildLayout(trail, inner);
  const children = [];

  // ---- Header ----
  children.push(text({
    x: inner.x, y: inner.y + FONT_BODY * 2n,
    content: `Trail: ${trail.name}`,
    attrs: {
      'font-family': font.family,
      'font-size': `${cptToPt(FONT_BODY * 2n)}pt`,
      'font-weight': '700',
      fill: theme.fg,
    },
  }));
  if (trail.target !== undefined) {
    children.push(text({
      x: inner.x, y: inner.y + FONT_BODY * 4n,
      content: `target ${formatMinor(trail.target, cur.exponent)} ${cur.code}`,
      attrs: {
        'font-family': font.family,
        'font-size': `${cptToPt(FONT_CAPTION)}pt`,
        fill: theme.muted,
      },
    }));
  }

  // ---- Time axis (dates) ----
  const axisY = inner.y + AXIS_H - FONT_CAPTION;
  children.push(line({
    x1: inner.x, y1: axisY + FONT_CAPTION,
    x2: inner.x + inner.w, y2: axisY + FONT_CAPTION,
    attrs: { stroke: theme.rule, 'stroke-width': '0.02' },
  }));
  for (const d of layout.uniqueDates) {
    const x = layout.xForDate[d];
    children.push(text({
      x, y: axisY,
      content: d,
      attrs: {
        'font-family': font.monospace,
        'font-size': `${cptToPt(FONT_CAPTION)}pt`,
        fill: theme.muted,
      },
    }));
    children.push(line({
      x1: x + NODE_W / 2n, y1: axisY + FONT_CAPTION * 2n,
      x2: x + NODE_W / 2n, y2: inner.y + inner.h,
      attrs: { stroke: theme.rule, 'stroke-dasharray': '1 3', 'stroke-width': '0.01' },
    }));
  }

  // ---- Lane labels ----
  for (let i = 0; i < layout.laneOrder.length; i++) {
    const acct = layout.laneOrder[i];
    const y = layout.yForAccount[acct];
    children.push(text({
      x: inner.x, y: y - 200n,
      content: acct,
      attrs: {
        'font-family': font.monospace,
        'font-size': `${cptToPt(FONT_CAPTION)}pt`,
        fill: theme.muted,
      },
    }));
  }

  // ---- Edges (draw before nodes so nodes render on top) ----
  for (const link of trail.links) {
    const from = layout.nodePos[link.from];
    const to = layout.nodePos[link.to];
    if (!from || !to) continue;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2n;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2n;
    const midX = (x1 + x2) / 2n;
    // Simple cubic Bézier with a horizontal control handle.
    const d = `M ${cptToPt(x1)} ${cptToPt(y1)} ` +
              `C ${cptToPt(midX)} ${cptToPt(y1)}, ${cptToPt(midX)} ${cptToPt(y2)}, ` +
              `${cptToPt(x2)} ${cptToPt(y2)}`;
    const isDrawn = link.kind === 'drawn';
    children.push(path({
      d,
      attrs: {
        fill: 'none',
        stroke: isDrawn ? theme.accent : theme.muted,
        'stroke-width': '0.02',
        'stroke-dasharray': isDrawn ? '2 2' : undefined,
        'data-link-from': link.from,
        'data-link-to': link.to,
        'data-link-kind': link.kind,
        'data-link-basis': link.basis,
      },
    }));
  }

  // ---- Nodes ----
  for (const node of layout.sorted) {
    const pos = layout.nodePos[node.id];
    const amtStr = formatMinor(node.amount, cur.exponent);
    const label = `${amtStr} ${node.side === 'debit' ? 'Dr' : 'Cr'}`;
    const clip = truncateWithEllipsis(label, NODE_W - 200n, FONT_BODY);
    const titleText = clip !== label ? label : undefined;
    children.push(rect({
      x: pos.x, y: pos.y, w: NODE_W, h: NODE_H,
      attrs: {
        rx: '0.1',
        fill: theme.paper,
        stroke: theme.fg,
        'stroke-width': '0.02',
        'data-node-id': node.id,
        'data-node-seq': String(node.seq),
        'data-node-account': node.account,
      },
    }));
    children.push(text({
      x: pos.x + 200n, y: pos.y + NODE_H / 2n + FONT_BODY / 3n,
      content: clip,
      attrs: {
        'font-family': font.monospace,
        'font-size': `${cptToPt(FONT_BODY)}pt`,
        fill: theme.fg,
      },
      title: titleText,
    }));
  }

  return svg({
    widthCpt: rectCpt.w, heightCpt: rectCpt.h,
    children,
    attrs: {
      role: 'img',
      'aria-label': `Trail: ${trail.name}`,
      'data-trail-id': trail.id,
      'data-node-count': String(trail.nodes.length),
      'data-link-count': String(trail.links.length),
    },
  });
}
