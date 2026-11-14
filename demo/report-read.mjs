// Read, impact and trail section builders for the report. Each returns
// { html, json, checks, allPassed }. The report.mjs orchestrator composes
// their output.
//
// All three sections use the layout solver through bridge/measure.premeasure
// (read mode) or a fixed deterministic frame (impact, trail). Card content
// comes from core/cards/*; the renderer is view/svg/*. Nothing here computes
// money — the number shown is always the card builder's own value.
import {
  premeasure, pxFromCpt,
} from '../bridge/measure.mjs';
import { solve } from '../space/index.mjs';
import { buildCard } from '../core/cards/index.mjs';
import { computeImpact } from '../core/impact.mjs';
import {
  createTrail, addNode, addLink, setTarget, makeNode, validateTrail,
} from '../core/trail.mjs';
import { buildStrip } from '../sequencer/strip.mjs';
import { renderCard } from '../view/svg/slip.mjs';
import { renderImpact } from '../view/svg/impact.mjs';
import { renderTrail } from '../view/svg/trail.mjs';
import { renderStrip } from '../view/svg/strip.mjs';
import { getTheme } from '../view/svg/theme.mjs';
import { cptToPt } from '../view/svg/primitives.mjs';

const THEME = getTheme('light');
const VIEWPORT_PX = { w: 1280, h: 900 };
const VIEWPORT_CPT = { w: BigInt(VIEWPORT_PX.w) * 75n, h: BigInt(VIEWPORT_PX.h) * 75n };
const STRIP_CPT = { x: 0n, y: 0n, w: BigInt(1280) * 75n, h: 8000n };

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function stripOuterSvg(svgString) {
  return svgString.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

// Compose several rendered cards (each sized to its own frame) into one
// outer SVG with the viewport as its viewBox. Frames come from the space
// solver, so the outer SVG is exactly what the solver produced.
function wrapInViewport(innerSvgs, frames, viewportCpt) {
  const children = [];
  for (let i = 0; i < innerSvgs.length; i++) {
    const inner = stripOuterSvg(innerSvgs[i]);
    const frame = frames[i];
    children.push(
      `<g transform="translate(${cptToPt(frame.x)},${cptToPt(frame.y)})">${inner}</g>`);
  }
  const wPt = cptToPt(viewportCpt.w);
  const hPt = cptToPt(viewportCpt.h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wPt}pt" height="${hPt}pt" viewBox="0 0 ${wPt} ${hPt}">${children.join('')}</svg>`;
}

function checksFromCard(card, source) {
  return (card.checks || []).map((c) => ({
    source, name: c.name, pass: c.pass, detail: c.detail,
  }));
}

function errorSection(message, source) {
  return {
    html: `<p class="fail">${esc(message)}</p>`,
    json: { error: message },
    checks: [{ source, name: `${source} failed`, pass: false, detail: message }],
    allPassed: false,
  };
}

// ---------------------------------------------------------------------------
// Read mode: balance sheet, income statement, cash flow.
// ---------------------------------------------------------------------------
export function buildReadSection({ ledger, view, cache, events, period, asOf, head }) {
  const request = {
    cards: [
      { type: 'balance_sheet', params: { asOf } },
      { type: 'income_statement', params: { from: period.from, to: period.to } },
      { type: 'cash_flow', params: { from: period.from, to: period.to } },
    ],
    period,
    mode: 'read',
  };

  const result = premeasure(request, view.accounts, VIEWPORT_CPT, {});
  if (result.error) return errorSection(`layout solver: ${result.error}`, 'space');

  const cards = [];
  const frames = [];
  const checks = [];

  for (let i = 0; i < request.cards.length; i++) {
    const spec = request.cards[i];
    const frame = result.cards[i];
    const card = buildCard(spec.type, view, spec.params);
    cards.push(card);
    frames.push(frame.frameCpt);
    checks.push(...checksFromCard(card, `card:${spec.type}`));
  }

  const innerSvgs = cards.map((card, i) =>
    renderCard(card, frames[i], result.cards[i].tier, THEME));
  const outerSvg = wrapInViewport(innerSvgs, frames, VIEWPORT_CPT);

  const html = `
<p class="muted">Layout solver: 3 cards, 60 / 40 split (wide), focal on the left.
See the Space section for the exact rectangles, scale factors and tiers.</p>
<div class="card">${outerSvg}</div>`;

  const json = {
    cards: cards.map((card, i) => ({
      type: card.type,
      hash: card.hash,
      ok: card.ok,
      tier: result.cards[i].tier,
      shapeClass: result.cards[i].shapeClass,
      frameCpt: {
        x: frames[i].x.toString(),
        y: frames[i].y.toString(),
        w: frames[i].w.toString(),
        h: frames[i].h.toString(),
      },
    })),
  };

  return { html, json, checks, allPassed: cards.every((c) => c.ok) };
}

// ---------------------------------------------------------------------------
// Impact: receipt for entry 4 (INV-1 collection) beside the balance sheet.
// ---------------------------------------------------------------------------
export function buildImpactSection({ ledger, view, period, asOf, head }) {
  const ENTRY_ID = 4;
  let impactCard;
  try {
    impactCard = computeImpact(
      (v, p) => buildCard('balance_sheet', v, p), view, { asOf }, ENTRY_ID);
  } catch (e) {
    return errorSection(`impact computation: ${e.message}`, 'impact');
  }

  // Receipt for the same entry.
  const receiptCard = buildCard('receipt', view, { entryId: ENTRY_ID });

  // Fixed deterministic frames: 1/3 for the receipt, 2/3 for the impact card.
  const gutter = 600n;
  const totalW = VIEWPORT_CPT.w - gutter;
  const leftW = totalW / 3n;
  const rightW = totalW - leftW;
  const receiptFrame = { x: 0n, y: 0n, w: leftW, h: VIEWPORT_CPT.h };
  const impactFrame = { x: leftW + gutter, y: 0n, w: rightW, h: VIEWPORT_CPT.h };

  const receiptSvg = renderCard(receiptCard, receiptFrame, 'standard', THEME);
  const impactSvg = renderImpact(impactCard, impactFrame, 'standard', THEME);
  const outerSvg = wrapInViewport([receiptSvg, impactSvg],
    [receiptFrame, impactFrame], VIEWPORT_CPT);

  // Sequence strip: for each line of the focused entry, in order, the
  // affected account's running balance before and after.
  const entry = view.getEntry(ENTRY_ID);
  const figures = [];
  for (const line of entry.lines) {
    const acct = view.accounts.byCode[line.account];
    const row = impactCard.sections.flatMap((s) => s.rows)
      .find((r) => r.code === line.account);
    if (row) {
      figures.push({
        label: acct.name,
        opening: row.before,
        change: row.delta,
        closing: row.after,
      });
    }
  }
  const stripData = buildStrip({
    request: {
      mode: 'read',
      cards: [{ type: 'receipt' }, { type: 'balance_sheet' }],
      period,
      focus: { entryId: ENTRY_ID },
    },
    head,
    cacheStates: { receipt: 'hit', balance_sheet: 'hit' },
    figures,
  });
  const stripSvg = renderStrip(stripData, STRIP_CPT, THEME, { currency: ledger.currency });

  const checks = checksFromCard(impactCard, `impact:entry${ENTRY_ID}`);

  const html = `
<p class="muted">Receipt #${ENTRY_ID} (INV-1 collection) open beside the balance sheet.
Delta shows the entry's natural-signed effect; untouched rows are dimmed.</p>
<div class="card">${outerSvg}</div>
<div class="card" style="margin-top:12px">${stripSvg}</div>`;

  const json = {
    entryId: ENTRY_ID,
    impactHash: impactCard.hash,
    impactOk: impactCard.ok,
    outsidePeriod: impactCard.impact.outsidePeriod,
    figures,
  };

  return { html, json, checks, allPassed: impactCard.ok };
}

// ---------------------------------------------------------------------------
// Trail: from the credit sale (entry 3) through the cash collection (entry 4).
// ---------------------------------------------------------------------------
export function buildTrailSection({ ledger, view, head }) {
  const e3 = view.getEntry(3);
  const e4 = view.getEntry(4);
  let trail = createTrail({ id: 'inv1-chain', name: 'INV-1 sale to cash' });
  trail = addNode(trail, makeNode(e3, 0)); // AR debit 8000
  trail = addNode(trail, makeNode(e3, 1)); // Revenue credit 8000
  trail = addNode(trail, makeNode(e4, 0)); // Cash debit 8000
  trail = addNode(trail, makeNode(e4, 1)); // AR credit 8000
  trail = addLink(trail, {
    from: 'n_3_0', to: 'n_3_1', kind: 'derived', basis: 'same_entry',
  });
  trail = addLink(trail, {
    from: 'n_3_0', to: 'n_4_1', kind: 'derived', basis: 'same_account', note: '1100',
  });
  trail = addLink(trail, {
    from: 'n_4_0', to: 'n_4_1', kind: 'derived', basis: 'same_entry',
  });
  trail = setTarget(trail, -8000);
  trail = { ...trail, currency: { ...ledger.currency } };

  const validation = validateTrail(trail, view);
  const svg = renderTrail(trail, VIEWPORT_CPT, THEME);

  const html = `
<p class="muted">Four nodes, three derived links. Time runs left to right;
AR moves +8000 from the sale, then &minus;8000 from the collection.
Terminal sum reconciles to the target.</p>
<div class="card">${svg}</div>`;

  const json = {
    id: trail.id, name: trail.name, target: trail.target,
    nodeCount: trail.nodes.length, linkCount: trail.links.length,
    reconciled: validation.ok,
  };

  const checks = (validation.checks || []).map((c) => ({
    source: 'trail:inv1-chain', name: c.name, pass: c.pass, detail: c.detail,
  }));

  return { html, json, checks, allPassed: validation.ok };
}
