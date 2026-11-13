// The Measure Contract: the only place the two brains meet. Imports only
// bridge/schema.mjs and space/index.mjs. Enforced by
// scripts/check-boundaries.mjs (bridge may only import core/schema.mjs
// from core, and only via bridge/schema.mjs).
//
// Three responsibilities:
//   premeasure(request, chartOfAccounts, viewportCpt, opts)
//     — synchronous, never touches a journal. The chart of accounts is
//       plain data (or null). When non-null, per-card row bounds are
//       derived from the account types present; when null, from
//       DEFAULT_ROWS. Passes rowsUpper per pane to space.solve, returns
//       the frame in cpt, shape class, tier, scale, predictedRows and
//       pagination per card. L7 (exact <= predicted) is the caller's
//       responsibility (see test/space/premeasure.test.mjs).
//   reconcile(plan, exactCards)
//     — takes exact row counts (or built cards) and checks them against
//       predictedRows. When exact > predicted, returns an error and a
//       space.violation draft; otherwise returns ok and space.reconciled
//       drafts. L8 (no other pane moves) is guaranteed because this
//       function never touches a rect.
//   pxFromCpt(rectCpt)
//     — the sole px derivation. left=floor(x/75), right=floor((x+w)/75),
//       w=right-left, so px rects are disjoint and inside the viewport
//       even when cpt coordinates leave a sub-pixel remainder.
//
// Event drafts are returned as plain objects (type, lane, ref, tags, note)
// so this module never imports sequencer. The caller marshals them through
// sequencer.events.eventFromDraft.

import { CARD_TYPES, MAX_ENTRY_LINES } from './schema.mjs';
import {
  solve, loadDocuments, MIN_BODY_CPT, DEFAULT_GUTTER_CPT,
  weightsForMode,
} from '../space/index.mjs';

const PT_PER_PX = 75n;

// Archetype per card type. receipt uses receipt_roll (80mm slip) because
// MAX_ENTRY_LINES = 32 does not fit on the journal_voucher FULL page (27
// rows). Documented in contract.md.
const ARCHETYPE_BY_CARD = Object.freeze({
  trial_balance:    'trial_balance',
  balance_sheet:    'balance_sheet_report_form',
  income_statement: 'income_statement',
  cash_flow:        'cash_flow_statement',
  receipt:          'receipt_roll',
});

// Fallback row bounds when no chart of accounts is supplied. Matches each
// archetype's maxRows field where sensible; the cash-flow maximum is 7
// (4 cf classes + net change + opening + closing) and is stated here rather
// than the archetype's typicalRows. Documented in contract.md.
const DEFAULT_ROWS = Object.freeze({
  trial_balance:    60,
  balance_sheet:    40,
  income_statement: 30,
  cash_flow:        7,
  receipt:          MAX_ENTRY_LINES,
});

function countByType(accounts) {
  const out = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };
  if (!accounts || !Array.isArray(accounts.list)) return out;
  for (const a of accounts.list) out[a.type] = (out[a.type] || 0) + 1;
  return out;
}

// Upper bound on rows for a card. Called for each card in a request; the
// result is passed to space.solve as rowsUpper. Documented in contract.md;
// the fuzz test in test/space/premeasure.test.mjs verifies L7 against these
// bounds.
export function predictedRowsFor(cardType, chartOfAccounts) {
  if (!CARD_TYPES[cardType]) throw new Error(`unknown card type: ${cardType}`);
  if (!chartOfAccounts) return DEFAULT_ROWS[cardType];
  const c = countByType(chartOfAccounts);
  switch (cardType) {
    case 'trial_balance':
      return (chartOfAccounts.list || []).length;
    case 'balance_sheet':
      return c.asset + c.liability + c.equity + 1; // +1 accumulated earnings
    case 'income_statement':
      return c.revenue + c.expense + 1; // +1 net profit row
    case 'cash_flow':
      return 4 + 3; // 4 cf classes (each 0 or 1 row) + change + opening + closing
    case 'receipt':
      return MAX_ENTRY_LINES;
    default:
      return DEFAULT_ROWS[cardType];
  }
}

export function premeasure(request, chartOfAccounts, viewportCpt, opts = {}) {
  if (!request || !Array.isArray(request.cards)) {
    return { error: 'premeasure: request.cards required' };
  }
  if (!viewportCpt || typeof viewportCpt.w !== 'bigint' || typeof viewportCpt.h !== 'bigint' ||
      viewportCpt.w <= 0n || viewportCpt.h <= 0n) {
    return { error: 'premeasure: viewportCpt must be { w: BigInt > 0, h: BigInt > 0 }' };
  }
  const docs = opts.documents || loadDocuments();
  const archetypes = docs.archetypes;

  const panes = [];
  for (let i = 0; i < request.cards.length; i++) {
    const c = request.cards[i];
    const archetypeId = ARCHETYPE_BY_CARD[c.type];
    if (!archetypeId) return { error: `premeasure: no archetype for card type "${c.type}"` };
    panes.push({
      archetypeId,
      isBar: false,
      rowsUpper: predictedRowsFor(c.type, chartOfAccounts),
      weight: 1,
    });
  }

  const weights = opts.weights || weightsForMode(request.mode || 'read', panes.length);
  if (weights.length !== panes.length) {
    return { error: `premeasure: weights length ${weights.length} != card count ${panes.length}` };
  }
  for (let i = 0; i < panes.length; i++) panes[i].weight = weights[i] || 1;

  const solveOpts = {
    archetypes,
    gutter: opts.gutter !== undefined ? opts.gutter : DEFAULT_GUTTER_CPT,
    minBodyCpt: opts.minBodyCpt !== undefined ? opts.minBodyCpt : MIN_BODY_CPT,
    focalIndex: opts.focalIndex !== undefined ? opts.focalIndex : 0,
  };
  const result = solve(viewportCpt, panes, solveOpts);
  if (result.error) return { error: result.error, law: result.law };

  const cards = [];
  for (let i = 0; i < request.cards.length; i++) {
    const c = request.cards[i];
    const pane = result.panes.find((p) => p.originalIndex === i);
    if (!pane) return { error: `premeasure: no pane ${i} in solve result` };
    cards.push({
      type: c.type,
      params: c.params || {},
      section: c.section,
      frameCpt: pane.rect,
      shapeClass: pane.shapeClass,
      tier: pane.tier,
      scale: pane.scale,
      predictedRows: pane.rowsUpperBound,
      pagination: pane.pagination,
    });
  }

  return { cards, focalIndex: result.focalIndex, viewportCpt };
}

// Px derivation rule from README §px rects. Never rounds independently for
// x/w and y/h; always floors the two edges. Guarantees px rects are disjoint
// (left_i >= right_{i-1} when the cpt rects were) and inside the viewport.
export function pxFromCpt(rectCpt) {
  const left = Number(rectCpt.x / PT_PER_PX);
  const top = Number(rectCpt.y / PT_PER_PX);
  const right = Number((rectCpt.x + rectCpt.w) / PT_PER_PX);
  const bottom = Number((rectCpt.y + rectCpt.h) / PT_PER_PX);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function countCardRows(card) {
  if (!card || !Array.isArray(card.sections)) return 0;
  let n = 0;
  for (const sec of card.sections) n += sec.rows.length;
  return n;
}

// L8: reconcile never moves a rect. It only compares exact rows to the
// prediction; when exact > predicted, returns an error and a
// space.violation draft. When all fit, returns ok with space.reconciled
// drafts. The plan's frameCpt values are returned unchanged for the caller
// to reuse (page compaction happens inside the frame at render time in S10).
export function reconcile(plan, exactCards) {
  if (!plan || !Array.isArray(plan.cards)) {
    return { error: 'reconcile: plan.cards required' };
  }
  const exact = Array.isArray(exactCards) ? exactCards : [];
  const violations = [];
  for (let i = 0; i < plan.cards.length; i++) {
    const card = plan.cards[i];
    const e = exact[i];
    if (!e) continue;
    const rows = e.rows !== undefined ? e.rows : countCardRows(e.card);
    if (!Number.isInteger(rows) || rows < 0) {
      return { error: `reconcile: exact rows for card ${i} must be a non-negative integer` };
    }
    if (rows > card.predictedRows) {
      violations.push({
        index: i,
        type: card.type,
        exactRows: rows,
        predictedRows: card.predictedRows,
      });
    }
  }
  if (violations.length > 0) {
    return {
      error: `reconcile: exact rows exceed prediction for ${violations.length} card(s)`,
      violations,
      drafts: violations.map((v) => ({
        type: 'space.violation',
        lane: 'space',
        ref: {},
        tags: [v.type],
        note: `${v.type}: exact ${v.exactRows} > predicted ${v.predictedRows}`,
      })),
    };
  }
  return {
    ok: true,
    drafts: plan.cards.map((c) => ({
      type: 'space.reconciled',
      lane: 'space',
      ref: {},
      tags: [c.type],
    })),
  };
}

export function draftPremeasured(plan) {
  if (!plan || !Array.isArray(plan.cards)) {
    throw new Error('draftPremeasured: plan.cards required');
  }
  return {
    type: 'space.premeasured',
    lane: 'space',
    ref: {},
    tags: plan.cards.map((c) => c.type),
  };
}

export function draftLaidOut(plan) {
  if (!plan || !Array.isArray(plan.cards)) {
    throw new Error('draftLaidOut: plan.cards required');
  }
  return {
    type: 'space.laid_out',
    lane: 'space',
    ref: {},
    tags: [`focal=${plan.focalIndex}`],
  };
}

// Row-bound table surfaced for contract.md generation and future callers.
export function rowBoundsTable() {
  return Object.freeze({
    trial_balance:    'count(accounts)',
    balance_sheet:    'assets + liabilities + equity + 1',
    income_statement: 'revenue + expense + 1',
    cash_flow:        '7 (4 cf classes + change + opening + closing)',
    receipt:          String(MAX_ENTRY_LINES),
  });
}
