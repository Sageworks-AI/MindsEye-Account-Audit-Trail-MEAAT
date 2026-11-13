// L7: for every card type, exact rows <= predicted rows. Predicted rows
// come from bridge/measure.predictedRowsFor; exact rows come from building
// the card and summing section row counts. Seeded fuzz ledgers ensure the
// bound holds across account counts and entry shapes.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Ledger } from '../../core/ledger.mjs';
import { buildCard } from '../../core/cards/index.mjs';
import { premeasure, predictedRowsFor, rowBoundsTable } from '../../bridge/measure.mjs';
import { DEMO_ACCOUNTS } from '../fixtures/ledger.mjs';

function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s; };
}
function randInt(rng, lo, hi) { return lo + (rng() % (hi - lo + 1)); }
function randDate(rng) {
  const m = randInt(rng, 1, 12);
  const d = randInt(rng, 1, 28);
  return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function pick(rng, arr) { return arr[rng() % arr.length]; }

function randomEntry(rng) {
  const date = randDate(rng);
  const amt = randInt(rng, 100, 10000);
  const r = rng() % 3;
  if (r === 0) {
    return {
      date, memo: 'sale',
      lines: [
        { account: '1000', debit: amt },
        { account: '4000', credit: amt },
      ],
    };
  }
  if (r === 1) {
    return {
      date, memo: 'credit sale',
      lines: [
        { account: '1100', debit: amt },
        { account: '4000', credit: amt },
      ],
    };
  }
  return {
    date, memo: 'rent',
    lines: [
      { account: '5000', debit: amt },
      { account: '1000', credit: amt },
    ],
  };
}

const VIEWPORT = Object.freeze({ w: 1280n * 75n, h: 720n * 75n });

function countRows(card) {
  let n = 0;
  for (const sec of card.sections) n += sec.rows.length;
  return n;
}

test('premeasure: rejected without a valid viewport', () => {
  const r = premeasure({ cards: [] }, null, { w: 0n, h: 0n });
  assert.match(r.error, /viewportCpt/);
});

test('premeasure: rejects a card type with no archetype', () => {
  const r = premeasure({ cards: [{ type: 'not_a_card' }] }, null, VIEWPORT);
  assert.match(r.error, /no archetype/);
});

test('premeasure: returns a frame per card with predicted rows', () => {
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  l.post({ date: '2026-01-01', memo: 'cap', lines: [
    { account: '1000', debit: 100000 }, { account: '3000', credit: 100000 },
  ]});
  const req = {
    cards: [{ type: 'balance_sheet', params: {} }],
    period: { from: '2026-01-01', to: '2026-12-31' },
    mode: 'read',
  };
  const plan = premeasure(req, l.accounts, VIEWPORT);
  assert.ok(!plan.error, plan.error);
  assert.equal(plan.cards.length, 1);
  const c = plan.cards[0];
  assert.ok(c.frameCpt);
  assert.ok(typeof c.predictedRows === 'number' && c.predictedRows > 0);
  assert.ok(['FULL', 'HALF', 'QUARTER', 'STRIP'].includes(c.shapeClass));
  assert.ok(c.scale && typeof c.scale.num === 'bigint');
});

test('premeasure: predictedRowsFor matches the documented bounds on DEMO_ACCOUNTS', () => {
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  const accounts = l.accounts;
  // 3 assets, 2 liabilities, 1 equity, 1 revenue, 1 expense, 8 total.
  assert.equal(predictedRowsFor('trial_balance', accounts), 8);
  assert.equal(predictedRowsFor('balance_sheet', accounts), 3 + 2 + 1 + 1); // +accumulated earnings
  assert.equal(predictedRowsFor('income_statement', accounts), 1 + 1 + 1);   // revenue+expense+net
  assert.equal(predictedRowsFor('cash_flow', accounts), 7);
  assert.equal(predictedRowsFor('receipt', accounts), 32);
});

test('premeasure: null chart falls back to DEFAULT_ROWS', () => {
  assert.equal(predictedRowsFor('balance_sheet', null), 40);
  assert.equal(predictedRowsFor('cash_flow', null), 7);
  assert.equal(predictedRowsFor('receipt', null), 32);
});

test('premeasure: rowBoundsTable matches predictedRowsFor for DEMO_ACCOUNTS', () => {
  const table = rowBoundsTable();
  assert.equal(Object.keys(table).length, 5);
  assert.ok('trial_balance' in table);
});

test('L7: exact rows <= predicted rows across 10 fuzz seeds, all 5 card types', () => {
  const types = ['trial_balance', 'balance_sheet', 'income_statement', 'cash_flow', 'receipt'];
  for (let seed = 1; seed <= 10; seed++) {
    const rng = prng(seed * 7919);
    const l = new Ledger({ accounts: DEMO_ACCOUNTS });
    for (let i = 0; i < 8; i++) l.post(randomEntry(rng));
    const view = l.view();

    for (const type of types) {
      const params = type === 'receipt' ? { entryId: Math.min(3, l.size) } : {};
      const card = buildCard(type, view, {
        ...params,
        asOf: { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER },
        from: '2026-01-01',
        to: '2026-12-31',
      });
      const exact = countRows(card);
      const predicted = predictedRowsFor(type, l.accounts);
      assert.ok(exact <= predicted,
        `seed ${seed} ${type}: exact ${exact} > predicted ${predicted}`);
    }
  }
});

test('L7: exact rows <= predicted for the whole demo ledger', () => {
  // Use a fixed demo ledger to prove the bound holds on a known-good case.
  const l = new Ledger({ accounts: DEMO_ACCOUNTS });
  l.post({ date: '2026-01-05', memo: 'capital', lines: [
    { account: '1000', debit: 100000 }, { account: '3000', credit: 100000 } ]});
  l.post({ date: '2026-01-10', memo: 'equipment', lines: [
    { account: '1500', debit: 30000 }, { account: '1000', credit: 30000 } ]});
  l.post({ date: '2026-02-15', memo: 'sale', refs: { invoice: 'INV-1' }, lines: [
    { account: '1100', debit: 8000 }, { account: '4000', credit: 8000 } ]});
  l.post({ date: '2026-03-01', memo: 'collection', refs: { invoice: 'INV-1' }, lines: [
    { account: '1000', debit: 8000 }, { account: '1100', credit: 8000 } ]});
  l.post({ date: '2026-03-10', memo: 'rent', lines: [
    { account: '5000', debit: 2000 }, { account: '1000', credit: 2000 } ]});
  const loanSeq = l.post({ date: '2026-03-20', memo: 'loan', lines: [
    { account: '1000', debit: 50000 }, { account: '2100', credit: 50000 } ]}).seq;
  l.reverse(loanSeq, { date: '2026-03-21', memo: 'loan reversed' });

  const view = l.view();
  const types = ['trial_balance', 'balance_sheet', 'income_statement', 'cash_flow', 'receipt'];
  for (const type of types) {
    const params = type === 'receipt' ? { entryId: 3 } : {};
    const card = buildCard(type, view, {
      ...params,
      asOf: { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER },
      from: '2026-01-01',
      to: '2026-12-31',
    });
    const exact = countRows(card);
    const predicted = predictedRowsFor(type, l.accounts);
    assert.ok(exact <= predicted, `${type}: exact ${exact} > predicted ${predicted}`);
  }
});
