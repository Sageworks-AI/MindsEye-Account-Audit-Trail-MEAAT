// Maps an attention state to a space-solver pane request and returns the
// combined layout plan. This is the second bridge file (the first is
// bridge/measure.mjs) and it obeys the same discipline: it imports only
// ./schema.mjs (which re-exports core/schema.mjs), ../space/index.mjs, and
// ../core/schema.mjs (the sole file bridge/ may import directly from core;
// enforced by scripts/check-boundaries.mjs).
//
// The input is (state, cardMap, viewportCpt, opts). `cardMap` maps an actor
// id (which the client uses for its pane identity) to the card spec that
// produced it, { type, params }. The output is
//   { panes: [{ actorId, card, rect, tier, shapeClass, scale, effectiveBodyCpt, pagination }],
//     focalIndex, viewportCpt, error? }
// with panes in ring-doc order (focal first), so index 0 in the output is
// always the focal pane. The space solver is told focalIndex = 0 for the
// same reason.
//
// Deliberately does NOT call view/: the renderer is invoked by the caller
// (PagesLayer). This module is pure geometry + attention introspection.
import { docsInOrder } from '../attention/index.mjs';
import { solve, loadDocuments, DEFAULT_GUTTER_CPT, MIN_BODY_CPT } from '../space/index.mjs';
import { MAX_ENTRY_LINES } from '../core/schema.mjs';

// Same archetype map as bridge/measure.mjs. Kept here as its own constant
// so a change to one does not silently change the other; a test
// (test/app-static.test.mjs) checks they agree.
const ARCHETYPE_BY_CARD = Object.freeze({
  trial_balance:    'trial_balance',
  balance_sheet:    'balance_sheet_report_form',
  income_statement: 'income_statement',
  cash_flow:        'cash_flow_statement',
  receipt:          'receipt_roll',
});

// Row bound for a card type. Mirrors the table in bridge/measure.mjs, which
// is what the server uses when premeasuring. Kept independent so the two
// can be compared; a test asserts equality with the server's numbers for
// the demo chart.
const DEFAULT_ROWS = Object.freeze({
  trial_balance:    60,
  balance_sheet:    40,
  income_statement: 30,
  cash_flow:        7,
  receipt:          MAX_ENTRY_LINES,
});

export function predictedRowsFor(cardType) {
  if (!(cardType in DEFAULT_ROWS)) {
    throw new Error(`bridge/attention: unknown card type "${cardType}"`);
  }
  return DEFAULT_ROWS[cardType];
}

export function planFromAttention(state, cardMap, viewportCpt, opts = {}) {
  if (!state || !Array.isArray(state.ring)) {
    return { error: 'planFromAttention: state.ring required' };
  }
  if (!viewportCpt || typeof viewportCpt.w !== 'bigint' || typeof viewportCpt.h !== 'bigint') {
    return { error: 'planFromAttention: viewportCpt must be { w: BigInt, h: BigInt }' };
  }
  if (!cardMap || typeof cardMap !== 'object') {
    return { error: 'planFromAttention: cardMap required' };
  }
  const docs = docsInOrder(state.ring);
  if (docs.length > 4) {
    return { error: `cannot lay out ${docs.length} geometry panes (max 4)` };
  }
  if (docs.length === 0) {
    return { panes: [], focalIndex: -1, viewportCpt, actorIds: [] };
  }
  const panes = [];
  for (let i = 0; i < docs.length; i++) {
    const actor = docs[i];
    const card = cardMap[actor.id];
    if (!card) {
      return { error: `planFromAttention: no card in request for actor "${actor.id}"` };
    }
    const archetypeId = ARCHETYPE_BY_CARD[card.type];
    if (!archetypeId) {
      return { error: `planFromAttention: unknown card type "${card.type}"` };
    }
    const rowsUpper = opts.rowsUpperFor
      ? opts.rowsUpperFor(card.type)
      : predictedRowsFor(card.type);
    panes.push({
      archetypeId,
      isBar: false,
      weight: (opts.weights && opts.weights[i]) || 1,
      // space.solve reads p.claim.rowsUpperBound when present; otherwise it
      // falls back to the archetype's typicalRows. Supplying a claim makes
      // the tier and pagination decisions match what the server premeasured
      // (bridge/measure.mjs returns the same numbers).
      claim: { rowsUpperBound: rowsUpper },
    });
  }
  const docs_ = loadDocuments();
  const result = solve(viewportCpt, panes, {
    archetypes: docs_.archetypes,
    gutter: opts.gutter !== undefined ? opts.gutter : DEFAULT_GUTTER_CPT,
    minBodyCpt: opts.minBodyCpt !== undefined ? opts.minBodyCpt : MIN_BODY_CPT,
    focalIndex: 0,
  });
  if (result.error) {
    return { error: result.error, law: result.law };
  }
  const out = [];
  for (let k = 0; k < docs.length; k++) {
    const actor = docs[k];
    const card = cardMap[actor.id];
    const pane = result.panes[k];
    out.push({
      actorId: actor.id,
      card,
      originalIndex: pane.originalIndex,
      rect: pane.rect,
      tier: pane.tier,
      shapeClass: pane.shapeClass,
      scale: pane.scale,
      effectiveBodyCpt: pane.effectiveBodyCpt,
      pagination: pane.pagination,
    });
  }
  return {
    panes: out,
    focalIndex: 0,
    viewportCpt,
    actorIds: docs.map((a) => a.id),
  };
}

export { ARCHETYPE_BY_CARD, DEFAULT_ROWS };
