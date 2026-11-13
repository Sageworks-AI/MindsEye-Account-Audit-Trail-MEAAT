// Plain frozen data describing the shape of each card type. No imports.
// Lives under core/ so the type list is a property of the ledger brain, but
// because it is pure data — no ledger, no functions — bridge/schema.mjs can
// re-export it as the single allowed file-level bridge into core/. That
// lets resolve/ use the type list without violating the "resolve imports
// only space and bridge" boundary.
//
// S6 adds MAX_ENTRY_LINES. The receipt card's row upper bound is
// MAX_ENTRY_LINES, which keeps L7 (exact <= predicted) provable: a receipt
// never has more lines than the ledger allows.
export const MAX_ENTRY_LINES = 32;

export const CARD_TYPES = Object.freeze({
  trial_balance:    Object.freeze({ period: 'instant', minTier: 'summary' }),
  balance_sheet:    Object.freeze({ period: 'instant', minTier: 'summary' }),
  income_statement: Object.freeze({ period: 'range',   minTier: 'summary' }),
  cash_flow:        Object.freeze({ period: 'range',   minTier: 'summary' }),
  receipt:          Object.freeze({ period: 'entry',   minTier: 'standard' }),
});

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

export const COLUMN_KEYS = Object.freeze({
  trial_balance:    Object.freeze(['code', 'label', 'debit', 'credit']),
  balance_sheet:    Object.freeze(['label', 'amount']),
  income_statement: Object.freeze(['label', 'amount']),
  cash_flow:        Object.freeze(['label', 'amount']),
  receipt:          Object.freeze(['code', 'label', 'debit', 'credit']),
});
