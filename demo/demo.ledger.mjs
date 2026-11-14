// Self-contained demo chart of accounts and entries. Deliberately does NOT
// import from test/fixtures/ledger.mjs: the boundary checker only allows
// demo/ to import from core, store, sequencer, resolve, view, space,
// attention and bridge (README #63). The ledger setup here mirrors that
// fixture exactly; test/demo-consistency.test.mjs asserts both produce the
// same entry ids so drift is caught.
//
// The demo includes: owner capital, equipment purchase, credit sale INV-1,
// cash collection INV-1 (shared refs so trail derivation links them), rent,
// loan drawdown, and a reversal of the loan drawdown. Numbers are round so
// every total is easily hand-checked in the report.
import { pathToFileURL } from 'node:url';
import { Ledger } from '../core/ledger.mjs';
import { buildCard } from '../core/cards/index.mjs';

export const DEMO_ACCOUNTS = Object.freeze([
  { code: '1000', name: 'Cash', type: 'asset', cash: true },
  { code: '1100', name: 'Receivables', type: 'asset', cf: 'operating' },
  { code: '1500', name: 'Equipment', type: 'asset', cf: 'investing' },
  { code: '2000', name: 'Payables', type: 'liability', cf: 'operating' },
  { code: '2100', name: 'Loan', type: 'liability', cf: 'financing' },
  { code: '3000', name: 'Capital', type: 'equity', cf: 'financing' },
  { code: '4000', name: 'Sales', type: 'revenue', cf: 'operating' },
  { code: '5000', name: 'Rent', type: 'expense', cf: 'operating' },
]);

export const DEMO_PERIOD = Object.freeze({ from: '2026-01-01', to: '2026-03-31' });

export function buildDemoLedger() {
  const ledger = new Ledger({ accounts: DEMO_ACCOUNTS });
  ledger.post({ date: '2026-01-05', memo: 'Owner capital', lines: [
    { account: '1000', debit: 100000 },
    { account: '3000', credit: 100000 },
  ]});
  ledger.post({ date: '2026-01-10', memo: 'Equipment bought for cash', lines: [
    { account: '1500', debit: 30000 },
    { account: '1000', credit: 30000 },
  ]});
  ledger.post({ date: '2026-02-15', memo: 'Credit sale INV-1',
    refs: { invoice: 'INV-1' }, lines: [
      { account: '1100', debit: 8000 },
      { account: '4000', credit: 8000 },
    ]});
  ledger.post({ date: '2026-03-01', memo: 'Cash collection INV-1',
    refs: { invoice: 'INV-1' }, lines: [
      { account: '1000', debit: 8000 },
      { account: '1100', credit: 8000 },
    ]});
  ledger.post({ date: '2026-03-10', memo: 'Rent paid', lines: [
    { account: '5000', debit: 2000 },
    { account: '1000', credit: 2000 },
  ]});
  const loanSeq = ledger.post({ date: '2026-03-20', memo: 'Loan drawdown', lines: [
    { account: '1000', debit: 50000 },
    { account: '2100', credit: 50000 },
  ]}).seq;
  ledger.reverse(loanSeq, { date: '2026-03-21', memo: 'Loan drawn in error' });
  return ledger;
}

// Prints a one-line summary per card kind. Used by `npm run demo`.
// Uses card builder output only, so every number is honest.
export function printCardSummaries(ledger) {
  const view = ledger.view();
  const asOf = { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER };
  const cards = [
    buildCard('trial_balance',    view, { asOf }),
    buildCard('balance_sheet',    view, { asOf }),
    buildCard('income_statement', view, { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }),
    buildCard('cash_flow',        view, { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }),
    buildCard('receipt',          view, { entryId: 3 }),
  ];
  for (const c of cards) {
    const totals = c.sections.map((s) => {
      const t = s.total;
      const rendered = typeof t === 'number' ? t : JSON.stringify(t);
      return `${s.id}=${rendered}`;
    }).join(' ');
    console.log(`${c.type.padEnd(16)} ok=${c.ok ? 'yes' : 'NO '} hash=${c.hash} ${totals}`);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  printCardSummaries(buildDemoLedger());
}
