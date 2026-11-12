// Deterministic demo chart of accounts and entries for S1 tests. The S11
// demo/demo.ledger.mjs reuses this chart and pattern, then adds report
// generation. Fixed dates in Q1 2026 keep every expected number round.
import { Ledger } from '../../core/ledger.mjs';

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

// Seven entries plus one reversal. Numbers picked so every balance-sheet and
// cash-flow total is easily hand-checked in the report:
//   100000-30000+8000-2000+50000-50000 = 76000 cash
//   8000 sale - 2000 rent = 6000 net profit
//   0 opening + 76000 net change = 76000 closing
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

export const DEMO_PERIOD = Object.freeze({ from: '2026-01-01', to: '2026-03-31' });
