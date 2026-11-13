// Line validation accepts the stored shape (one side 0) and still rejects
// ambiguous or malformed lines. Invariant: a line has exactly one non-zero,
// non-negative safe-integer side.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Ledger } from '../core/ledger.mjs';
import { buildDemoLedger, DEMO_ACCOUNTS } from './fixtures/ledger.mjs';

const MINI = [
  { code: '1000', name: 'Cash', type: 'asset', cash: true },
  { code: '3000', name: 'Capital', type: 'equity' },
];

function mini() {
  return new Ledger({ accounts: MINI });
}

function post(l, lines) {
  return l.post({ date: '2026-01-05', memo: 'm', lines });
}

test('re-posting an existing entry\'s stored lines succeeds', () => {
  const src = buildDemoLedger();
  const target = new Ledger({ accounts: DEMO_ACCOUNTS });
  for (const e of src.entries()) {
    if (e.reverses !== undefined) continue;
    const posted = target.post({ date: e.date, memo: e.memo, lines: e.lines });
    assert.deepEqual(
      posted.lines.map((x) => ({ ...x })),
      e.lines.map((x) => ({ ...x })),
    );
  }
});

test('both sides non-zero is rejected', () => {
  const l = mini();
  assert.throws(() => post(l, [
    { account: '1000', debit: 5, credit: 5 },
    { account: '3000', credit: 5 },
  ]), /exactly one of debit\/credit/);
});

test('debit 0 and credit 0 is rejected', () => {
  const l = mini();
  assert.throws(() => post(l, [
    { account: '1000', debit: 0, credit: 0 },
    { account: '3000', credit: 5 },
  ]), /need debit or credit/);
});

test('a lone zero debit is rejected', () => {
  const l = mini();
  assert.throws(() => post(l, [
    { account: '1000', debit: 0 },
    { account: '3000', credit: 5 },
  ]), /need debit or credit/);
});

test('negative amounts are rejected', () => {
  const l = mini();
  assert.throws(() => post(l, [
    { account: '1000', debit: -1 },
    { account: '3000', credit: 1 },
  ]));
});

test('fractional amounts are rejected', () => {
  const l = mini();
  assert.throws(() => post(l, [
    { account: '1000', debit: 1.5 },
    { account: '3000', credit: 1.5 },
  ]));
});
