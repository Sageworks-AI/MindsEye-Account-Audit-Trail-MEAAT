// Plain frozen data describing the shape of each card type. No imports.
// Lives under core/ so the type list is a property of the ledger brain, but
// because it is pure data — no ledger, no functions — bridge/schema.mjs can
// re-export it as the single allowed file-level bridge into core/. That
// lets resolve/ use the type list without violating the "resolve imports
// only space and bridge" boundary. A test (test/schema.test.mjs) checks
// that CARD_TYPES matches core/cards/index.mjs REGISTRY on period and
// minTier, so the two representations cannot drift.

export const CARD_TYPES = Object.freeze({
  trial_balance:    Object.freeze({ period: 'instant', minTier: 'summary' }),
  balance_sheet:    Object.freeze({ period: 'instant', minTier: 'summary' }),
  income_statement: Object.freeze({ period: 'range',   minTier: 'summary' }),
  cash_flow:        Object.freeze({ period: 'range',   minTier: 'summary' }),
  receipt:          Object.freeze({ period: 'entry',   minTier: 'standard' }),
});

// SECTION_IDS[type] is a superset of the sections a built card of that type
// can produce. Cash-flow section ids are dynamic (only cf classes with
// entries appear); this list declares every id the builder can emit.
export const SECTION_IDS = Object.freeze({
  trial_balance:    Object.freeze(['accounts']),
  balance_sheet:    Object.freeze(['assets', 'liabilities', 'equity']),
  income_statement: Object.freeze(['revenue', 'expenses', 'net']),
  cash_flow: Object.freeze([
    'cf_operating', 'cf_investing', 'cf_financing', 'cf_unclassified',
    'cf_change', 'cf_opening', 'cf_closing',
  ]),
  receipt:          Object.freeze(['lines']),
});

// COLUMN_KEYS[type] lists every column key the builder can emit for that
// type. The renderer uses this to decide alignment, formatting and width.
export const COLUMN_KEYS = Object.freeze({
  trial_balance:    Object.freeze(['code', 'label', 'debit', 'credit']),
  balance_sheet:    Object.freeze(['label', 'amount']),
  income_statement: Object.freeze(['label', 'amount']),
  cash_flow:        Object.freeze(['label', 'amount']),
  receipt:          Object.freeze(['code', 'label', 'debit', 'credit']),
});
