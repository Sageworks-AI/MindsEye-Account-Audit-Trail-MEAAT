// Parameter registry: for each request parameter, a pure integer function
// from the parameter value to a SpaceClaim. Used by the bridge (S6) to
// pre-measure before the card is built; the solver never touches it.
//
// The claim returned here is a hint. The bridge composes it with the card
// type's base claim and the row-count upper bound.
import { makeClaim } from './claim.mjs';

// Base claims per archetype key, in cpt. These are the sizes that a page of
// the given archetype wants to occupy for the panel to be comfortable.
const BASE = Object.freeze({
  balance_sheet_report_form: { prefW: 50000n, prefH: 70000n, minW: 30000n, minH: 40000n },
  balance_sheet_t_form:      { prefW: 70000n, prefH: 50000n, minW: 40000n, minH: 30000n },
  income_statement:          { prefW: 50000n, prefH: 60000n, minW: 30000n, minH: 35000n },
  cash_flow_statement:       { prefW: 50000n, prefH: 60000n, minW: 30000n, minH: 35000n },
  trial_balance:             { prefW: 50000n, prefH: 70000n, minW: 30000n, minH: 40000n },
  journal_voucher:           { prefW: 60000n, prefH: 30000n, minW: 35000n, minH: 20000n },
  receipt_roll:              { prefW: 20000n, prefH: 50000n, minW: 15000n, minH: 20000n },
  small_business_flowchart:  { prefW: 70000n, prefH: 50000n, minW: 40000n, minH: 30000n },
  sequence_strip:            { prefW: 70000n, prefH: 3000n,  minW: 40000n, minH: 3000n  },
});

export function baseClaimForArchetype(archetypeId) {
  const base = BASE[archetypeId];
  if (!base) throw new Error(`params: unknown archetype "${archetypeId}"`);
  return makeClaim(base);
}

// Card type -> archetype id. A card type not in the map falls back to the
// nearest sensible archetype; the "add a card type = add one file" rule from
// the base spec is preserved by requiring future card types to be added here.
const ARCHETYPE_BY_CARD = Object.freeze({
  balance_sheet:    'balance_sheet_report_form',
  income_statement: 'income_statement',
  cash_flow:        'cash_flow_statement',
  trial_balance:    'trial_balance',
  receipt:          'journal_voucher',
});

export function archetypeForCardType(cardType) {
  const arch = ARCHETYPE_BY_CARD[cardType];
  if (!arch) throw new Error(`params: unknown card type "${cardType}"`);
  return arch;
}

// Tier -> column set and rows.
export function tierEffect(claim, tier) {
  const shapes = tier === 'summary' ? ['QUARTER', 'STRIP']
    : tier === 'standard' ? ['HALF', 'QUARTER', 'STRIP']
    : ['FULL', 'HALF', 'QUARTER', 'STRIP'];
  return makeClaim({ ...claim, allowedShapeClasses: shapes });
}

// Compare adds one amount column; minimum width rises accordingly.
export function compareEffect(claim, baseAmountWidth, extraAmountWidth) {
  return makeClaim({
    ...claim,
    minW: claim.minW + extraAmountWidth,
    prefW: claim.prefW + extraAmountWidth,
    maxW: claim.maxW + extraAmountWidth,
  });
}

// Focus (impact view) replaces one amount column with before/delta/after;
// net width grows by roughly two columns' worth.
export function focusEffect(claim, amountColumnWidth) {
  return makeClaim({
    ...claim,
    minW: claim.minW + amountColumnWidth * 2n,
    prefW: claim.prefW + amountColumnWidth * 2n,
    maxW: claim.maxW + amountColumnWidth * 2n,
  });
}

// Drill depth adds an indented reference column.
export function drillDepthEffect(claim, refColumnWidth) {
  return makeClaim({
    ...claim,
    minW: claim.minW + refColumnWidth,
    prefW: claim.prefW + refColumnWidth,
    maxW: claim.maxW + refColumnWidth,
  });
}

// Mode selects which panes exist and their weights. The solver only sees
// the resulting pane list; this function is a convenience for the bridge.
export function weightsForMode(mode, n) {
  if (mode === 'input') {
    // The form takes the central, large slot; cards shrink.
    if (n === 1) return [3];
    if (n === 2) return [3, 1];
    if (n === 3) return [3, 1, 1];
    if (n === 4) return [2, 1, 1, 1];
  }
  // read and trail: equal weight unless the caller overrides.
  return new Array(n).fill(1);
}

// Currency exponent: amount string length grows by 1 + exponent characters.
export function currencyEffect(claim, exponent, baseColumnWidth, perCharWidth) {
  const added = BigInt(exponent + 1) * perCharWidth;
  return makeClaim({
    ...claim,
    minW: claim.minW + added,
    prefW: claim.prefW + added,
    maxW: claim.maxW + added,
  });
}

// Viewport and zoom only affect scale bounds; they are consumed by the
// solver directly and do not produce a claim.
