// Impact view: for a chosen entry, every touched row shows before/delta/after,
// untouched rows are dimmed (delta 0), and the impact card's checks prove the
// deltas match the entry's own effect. The excludedSeq view must not mutate
// the ledger: balance sheet with-exclusion equals balance sheet built before
// the entry was posted.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeImpact } from '../core/impact.mjs';
import { build as buildBalanceSheet } from '../core/cards/balanceSheet.mjs';
import { build as buildIncomeStatement } from '../core/cards/incomeStatement.mjs';
import { build as buildCashFlow } from '../core/cards/cashFlow.mjs';
import { Ledger } from '../core/ledger.mjs';
import { buildDemoLedger, DEMO_PERIOD, DEMO_ACCOUNTS } from './fixtures/ledger.mjs';

const AS_OF = Object.freeze({ date: '2026-03-31', seq: Number.MAX_SAFE_INTEGER });

test('impact: entry 4 (cash collection) touches Cash + Receivables on balance sheet', () => {
  const l = buildDemoLedger();
  const card = computeImpact(buildBalanceSheet, l.view(), { asOf: AS_OF }, 4);
  assert.equal(card.ok, true, JSON.stringify(card.checks));
  const cashRow = card.sections.find((s) => s.id === 'assets').rows.find((r) => r.code === '1000');
  const arRow   = card.sections.find((s) => s.id === 'assets').rows.find((r) => r.code === '1100');
  assert.equal(cashRow.touched, true);
  assert.equal(cashRow.delta, 8000);
  assert.equal(arRow.touched, true);
  assert.equal(arRow.delta, -8000);
});

test('impact: untouched rows have delta 0 and touched=false', () => {
  const l = buildDemoLedger();
  const card = computeImpact(buildBalanceSheet, l.view(), { asOf: AS_OF }, 4);
  const eq = card.sections.find((s) => s.id === 'equity');
  const capital = eq.rows.find((r) => r.code === '3000');
  assert.equal(capital.touched, false);
  assert.equal(capital.delta, 0);
});

test('impact: sum of natural-signed deltas across entry lines is zero', () => {
  const l = buildDemoLedger();
  const card = computeImpact(buildBalanceSheet, l.view(), { asOf: AS_OF }, 4);
  const touchedRows = card.sections.flatMap((s) => s.rows).filter((r) => r.touched && r.code);
  const sum = touchedRows.reduce((a, r) => a + r.delta, 0);
  // Cash +8000 (debit normal) + Receivables -8000 (asset, credit reduces) = 0
  assert.equal(sum, 0);
});

test('impact: excludeSeq does not mutate the ledger', () => {
  const l = buildDemoLedger();
  const before = l.size;
  const headHash = l.head().hash;
  computeImpact(buildBalanceSheet, l.view(), { asOf: AS_OF }, 4);
  assert.equal(l.size, before);
  assert.equal(l.head().hash, headHash);
});

test('impact: balance sheet delta equation holds for entry 4', () => {
  const l = buildDemoLedger();
  const card = computeImpact(buildBalanceSheet, l.view(), { asOf: AS_OF }, 4);
  const A  = card.sections.find((s) => s.id === 'assets').total.delta;
  const L  = card.sections.find((s) => s.id === 'liabilities').total.delta;
  const Eq = card.sections.find((s) => s.id === 'equity').total.delta;
  assert.equal(A, L + Eq);
});

test('impact: entry outside period produces zero deltas', () => {
  const l = buildDemoLedger();
  const narrow = { from: '2026-04-01', to: '2026-04-30' };
  const card = computeImpact(buildIncomeStatement, l.view(), narrow, 3);
  assert.equal(card.impact.outsidePeriod, true);
  const allZero = card.sections.every((s) => s.total.delta === 0);
  assert.equal(allZero, true);
  assert.equal(card.ok, true);
});

test('impact: income statement for the credit sale (entry 3) shows +8000 revenue', () => {
  const l = buildDemoLedger();
  const card = computeImpact(buildIncomeStatement, l.view(), DEMO_PERIOD, 3);
  const revenue = card.sections.find((s) => s.id === 'revenue');
  assert.equal(revenue.total.delta, 8000);
  const net = card.sections.find((s) => s.id === 'net');
  assert.equal(net.total.delta, 8000);
});

test('impact: cash flow for entry 4 shows +8000 operating delta', () => {
  const l = buildDemoLedger();
  const card = computeImpact(buildCashFlow, l.view(), DEMO_PERIOD, 4);
  const op = card.sections.find((s) => s.id === 'cf_operating');
  assert.ok(op);
  assert.equal(op.total.delta, 8000);
  assert.equal(card.ok, true, JSON.stringify(card.checks));
});

test('impact: accumulated-earnings row flips sign for expense accounts', () => {
  const l = buildDemoLedger();
  // Entry 5 is rent (expense 2000, credit cash). Accumulated earnings delta
  // must be -2000 because expense reduces accumulated earnings.
  const card = computeImpact(buildBalanceSheet, l.view(), { asOf: AS_OF }, 5);
  const accum = card.sections.find((s) => s.id === 'equity').rows
    .find((r) => r.id === 'accumulated_earnings');
  assert.equal(accum.delta, -2000);
  assert.equal(card.ok, true, JSON.stringify(card.checks));
});

test('impact: rejects card types that do not support impact', () => {
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  const card = l.post({
    date: '2026-01-01', memo: 'x',
    lines: [
      { account: '1000', debit: 100 },
      { account: '3000', credit: 100 },
    ],
  });
  assert.throws(() => computeImpact((v) => v, l.view(), {}, card.seq),
    /impact not supported/);
});
