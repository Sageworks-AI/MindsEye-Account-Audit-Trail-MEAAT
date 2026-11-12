// Card registry and the open() entry point from the base spec. Adding a card
// type means adding one file and one line here; no other module changes.
// Card shape version 2 is uniform across builders: every row carries a stable
// id and refs { entries, accounts } so drill-down works from any row.

import { build as buildTrialBalance } from './trialBalance.mjs';
import { build as buildIncomeStatement } from './incomeStatement.mjs';
import { build as buildBalanceSheet } from './balanceSheet.mjs';
import { build as buildCashFlow } from './cashFlow.mjs';
import { build as buildReceipt } from './receipt.mjs';

export const REGISTRY = Object.freeze({
  trial_balance:    { period: 'instant', build: buildTrialBalance,    minTier: 'summary' },
  balance_sheet:    { period: 'instant', build: buildBalanceSheet,    minTier: 'summary' },
  income_statement: { period: 'range',   build: buildIncomeStatement, minTier: 'summary' },
  cash_flow:        { period: 'range',   build: buildCashFlow,        minTier: 'summary' },
  receipt:          { period: 'entry',   build: buildReceipt,         minTier: 'standard' },
});

export function buildCard(type, view, params) {
  const entry = REGISTRY[type];
  if (!entry) throw new Error(`unknown card type: ${type}`);
  return entry.build(view, params);
}

// open(view, [{ type, ...params }], period) per the base spec's corrections.
// Params win over period so `{ type: 'receipt', entryId: 3 }` works without a
// separate period argument, and `{ type: 'balance_sheet' }` with period
// `{ asOf: tick }` works without a params argument.
export function open(view, cards, period) {
  if (!Array.isArray(cards)) throw new Error('open(): cards must be an array');
  return cards.map((spec) => {
    if (!spec || typeof spec !== 'object') throw new Error('open(): each card must be an object');
    const { type, ...params } = spec;
    return buildCard(type, view, { ...(period || {}), ...params });
  });
}
