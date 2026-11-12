// Property tests with a seeded xorshift32 PRNG. Every ledger built here is
// checked against the three invariants that matter at card level:
// trial balance debits equal credits; assets = liabilities + equity; opening
// cash + net change = closing cash. Seeds are fixed, so a failure reproduces
// exactly and the reported seed pinpoints the input.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Ledger } from '../core/ledger.mjs';
import { buildCard } from '../core/cards/index.mjs';

const ACCOUNTS = [
  { code: '1000', name: 'Cash', type: 'asset', cash: true },
  { code: '1100', name: 'Receivables', type: 'asset', cf: 'operating' },
  { code: '1500', name: 'Equipment', type: 'asset', cf: 'investing' },
  { code: '2100', name: 'Loan', type: 'liability', cf: 'financing' },
  { code: '3000', name: 'Capital', type: 'equity' },
  { code: '4000', name: 'Sales', type: 'revenue', cf: 'operating' },
  { code: '5000', name: 'Rent', type: 'expense', cf: 'operating' },
];

function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s;
  };
}
function randInt(rng, lo, hi) { return lo + (rng() % (hi - lo + 1)); }
function pick(rng, arr) { return arr[rng() % arr.length]; }
function randDate(rng) {
  const m = randInt(rng, 1, 12);
  const d = randInt(rng, 1, 28);
  return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function randomEntry(rng) {
  const date = randDate(rng);
  const amt = randInt(rng, 100, 10000);
  if (rng() % 2 === 0) {
    return {
      date, memo: 'random',
      lines: [
        { account: '1000', debit: amt },
        { account: pick(rng, ['3000', '4000', '2100']), credit: amt },
      ],
    };
  }
  const amt2 = randInt(rng, 100, 10000);
  return {
    date, memo: 'random',
    lines: [
      { account: '1000', debit: amt },
      { account: '5000', debit: amt2 },
      { account: '4000', credit: amt + amt2 },
    ],
  };
}

test('property: trial balance debits = credits for 20 random ledgers', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = prng(seed * 7919);
    const l = new Ledger({ accounts: ACCOUNTS });
    for (let i = 0; i < 10; i++) l.post(randomEntry(rng));
    const card = buildCard('trial_balance', l.view(),
      { asOf: { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER } });
    assert.equal(card.sections[0].total.debit, card.sections[0].total.credit,
      `seed ${seed}`);
    assert.equal(card.ok, true, `seed ${seed} checks failed`);
  }
});

test('property: assets = liabilities + equity for 20 random ledgers', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = prng(seed * 1311);
    const l = new Ledger({ accounts: ACCOUNTS });
    for (let i = 0; i < 10; i++) l.post(randomEntry(rng));
    const card = buildCard('balance_sheet', l.view(),
      { asOf: { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER } });
    assert.equal(card.ok, true, `seed ${seed} checks failed`);
    const A  = card.sections.find((s) => s.id === 'assets').total;
    const L  = card.sections.find((s) => s.id === 'liabilities').total;
    const Eq = card.sections.find((s) => s.id === 'equity').total;
    assert.equal(A, L + Eq, `seed ${seed}`);
  }
});

test('property: opening + net change = closing for 20 random ledgers', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = prng(seed * 3571);
    const l = new Ledger({ accounts: ACCOUNTS });
    for (let i = 0; i < 10; i++) l.post(randomEntry(rng));
    const card = buildCard('cash_flow', l.view(),
      { from: '2026-01-01', to: '2026-12-31' });
    assert.equal(card.ok, true, `seed ${seed} checks failed`);
    const opening = card.sections.find((s) => s.id === 'cf_opening').total;
    const change  = card.sections.find((s) => s.id === 'cf_change').total;
    const closing = card.sections.find((s) => s.id === 'cf_closing').total;
    assert.equal(opening + change, closing, `seed ${seed}`);
  }
});
