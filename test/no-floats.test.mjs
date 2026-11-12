// Walks every card value produced by the demo ledger and asserts that every
// numeric leaf (other than the version tag, the headSeq, the entry seq, and
// the monetary amounts that are checked separately) is a safe integer. Money
// paths specifically must be integers with no fractional component anywhere.
// Also asserts the money.mjs helpers reject non-integers and overflow.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildCard } from '../core/cards/index.mjs';
import { addMinor, subMinor, sumMinor, negateMinor, formatMinor } from '../core/money.mjs';
import { buildDemoLedger, DEMO_PERIOD } from './fixtures/ledger.mjs';

const AS_OF = Object.freeze({ date: '2026-03-31', seq: Number.MAX_SAFE_INTEGER });

function isInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function walk(value, path, visit) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) walk(value[k], `${path}.${k}`, visit);
    return;
  }
  visit(value, path);
}

test('no-floats: every money field in every demo card is a safe integer', () => {
  const l = buildDemoLedger();
  const view = l.view();
  const cardTypes = [
    ['trial_balance',    { asOf: AS_OF }],
    ['balance_sheet',    { asOf: AS_OF }],
    ['income_statement', { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }],
    ['cash_flow',        { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }],
    ['receipt',          { entryId: 3 }],
  ];
  for (const [type, params] of cardTypes) {
    const card = buildCard(type, view, params);
    walk(card, `${type}`, (v, path) => {
      if (typeof v !== 'number') return;
      if (/\.(version|headSeq)$/.test(path)) {
        assert.ok(Number.isInteger(v), `${path} must be integer, got ${v}`);
        return;
      }
      if (/\.period\.asOf\.seq$/.test(path)) {
        assert.ok(Number.isSafeInteger(v), `${path} must be safe integer, got ${v}`);
        return;
      }
      // Any monetary field must be a safe integer. There are no other numeric
      // leaf fields in a state card; a float here is a hard bug.
      assert.ok(Number.isSafeInteger(v),
        `${path} = ${v} is not a safe integer`);
    });
  }
});

test('no-floats: money.mjs rejects non-integer inputs', () => {
  assert.throws(() => addMinor(1.5, 2), /safe integer/);
  assert.throws(() => addMinor(1, 2.5), /safe integer/);
  assert.throws(() => subMinor(1.5, 2), /safe integer/);
  assert.throws(() => sumMinor([1, 2.5, 3]), /safe integer/);
  assert.throws(() => negateMinor(1.5), /safe integer/);
  assert.throws(() => formatMinor(1.5), /safe integer/);
});

test('no-floats: money.mjs rejects unsafe-integer operands', () => {
  assert.throws(() => addMinor(Number.MAX_SAFE_INTEGER, 1), /exceeds/);
  assert.throws(() => subMinor(Number.MIN_SAFE_INTEGER, 1), /exceeds|range/);
  assert.throws(() => negateMinor(Number.MIN_SAFE_INTEGER), /exceeds|range/);
});

test('no-floats: money.mjs sums long arrays without float drift', () => {
  const values = Array(1000).fill(1);
  assert.equal(sumMinor(values), 1000);
  const big = Array(1000).fill(100_000);
  assert.equal(sumMinor(big), 100_000_000);
});

test('no-floats: formatMinor returns a string with the right decimals', () => {
  assert.equal(formatMinor(0), '0.00');
  assert.equal(formatMinor(100), '1.00');
  assert.equal(formatMinor(12345), '123.45');
  assert.equal(formatMinor(-12345), '-123.45');
  assert.equal(formatMinor(5, { code: 'X', exponent: 0, symbol: 'X' }), '5');
});
