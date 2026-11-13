// MAX_ENTRY_LINES = 32 keeps receipts bounded so L7 (exact rows <=
// predicted rows) is provable without inspecting the ledger. This test
// proves the bound is enforced by Ledger.post (reverse uses the same
// validateBody path, so it is covered by construction).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Ledger } from '../core/ledger.mjs';
import { MAX_ENTRY_LINES } from '../core/schema.mjs';
import { DEMO_ACCOUNTS } from './fixtures/ledger.mjs';

function balancedLines(n) {
  // Alternating debit/credit on two accounts, so every entry balances for
  // even n. For odd n a three-line shape still balances (D 100, D 200, C 300).
  if (n === 2) return [
    { account: '1000', debit: 100 },
    { account: '4000', credit: 100 },
  ];
  if (n === 3) return [
    { account: '1000', debit: 100 },
    { account: '5000', debit: 200 },
    { account: '4000', credit: 300 },
  ];
  // Generic: n-1 debits of 100 each, one credit of (n-1)*100.
  const lines = [];
  for (let i = 0; i < n - 1; i++) lines.push({ account: '1000', debit: 100 });
  lines.push({ account: '4000', credit: (n - 1) * 100 });
  return lines;
}

test('MAX_ENTRY_LINES is 32', () => {
  assert.equal(MAX_ENTRY_LINES, 32);
});

test('Ledger.post accepts an entry with exactly MAX_ENTRY_LINES lines', () => {
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  const e = l.post({
    date: '2026-01-01', memo: 'big',
    lines: balancedLines(MAX_ENTRY_LINES),
  });
  assert.equal(e.lines.length, MAX_ENTRY_LINES);
});

test('Ledger.post rejects an entry with MAX_ENTRY_LINES + 1 lines', () => {
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  assert.throws(
    () => l.post({
      date: '2026-01-01', memo: 'too big',
      lines: balancedLines(MAX_ENTRY_LINES + 1),
    }),
    /too many lines: 33 > 32/);
});

test('Ledger.post rejects an entry with 2 * MAX_ENTRY_LINES lines', () => {
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  assert.throws(
    () => l.post({
      date: '2026-01-01', memo: 'way too big',
      lines: balancedLines(2 * MAX_ENTRY_LINES),
    }),
    /too many lines/);
});

test('MAX_ENTRY_LINES applies only when the entry balances (bound check runs before balance check does not matter — bound always rejects first)', () => {
  // Even an unbalanced over-bound entry fails with the max-lines message
  // because the check happens before per-line validation. This pins the
  // error precedence so a future reorder does not silently change behaviour.
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  assert.throws(
    () => l.post({
      date: '2026-01-01', memo: 'over',
      lines: new Array(MAX_ENTRY_LINES + 1).fill({ account: '1000', debit: 100 }),
    }),
    /too many lines/);
});
