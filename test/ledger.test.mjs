// Core ledger invariants: validation, hash chain, reversal rules, view
// composition. Tampering detection is proven at the hash level here (the
// entries are frozen and the internal array is private); end-to-end tamper
// detection via the file adapter lives in S2's persistence test.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Ledger } from '../core/ledger.mjs';
import { hashEntryBody, GENESIS_HASH } from '../core/hash.mjs';
import { buildDemoLedger, DEMO_ACCOUNTS } from './fixtures/ledger.mjs';

const MINI_ACCOUNTS = [
  { code: '1000', name: 'Cash', type: 'asset', cash: true },
  { code: '3000', name: 'Capital', type: 'equity' },
  { code: '4000', name: 'Revenue', type: 'revenue' },
  { code: '5000', name: 'Expense', type: 'expense' },
];

function newLedger() {
  return new Ledger({ accounts: MINI_ACCOUNTS });
}

function postCapital(ledger, amount = 1000, date = '2026-01-01') {
  return ledger.post({
    date, memo: 'capital', lines: [
      { account: '1000', debit: amount },
      { account: '3000', credit: amount },
    ],
  });
}

test('ledger: post returns a frozen entry with seq 1 and genesis prevHash', () => {
  const l = newLedger();
  const e = postCapital(l);
  assert.equal(e.seq, 1);
  assert.ok(Object.isFrozen(e));
  assert.equal(e.prevHash, GENESIS_HASH);
  assert.match(e.id, /^[0-9a-f]{64}$/);
});

test('ledger: rejects unbalanced entry', () => {
  const l = newLedger();
  assert.throws(() => l.post({
    date: '2026-01-01', memo: 'bad',
    lines: [
      { account: '1000', debit: 1000 },
      { account: '3000', credit: 999 },
    ],
  }), /unbalanced/);
});

test('ledger: rejects non-integer amount', () => {
  const l = newLedger();
  assert.throws(() => l.post({
    date: '2026-01-01', memo: 'bad',
    lines: [
      { account: '1000', debit: 10.5 },
      { account: '3000', credit: 10.5 },
    ],
  }), /safe integer/);
});

test('ledger: rejects unsafe integer amount', () => {
  const l = newLedger();
  const big = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => l.post({
    date: '2026-01-01', memo: 'bad',
    lines: [
      { account: '1000', debit: big },
      { account: '3000', credit: big },
    ],
  }), /safe integer/);
});

test('ledger: rejects running total that overflows', () => {
  const l = newLedger();
  const big = Number.MAX_SAFE_INTEGER;
  assert.throws(() => l.post({
    date: '2026-01-01', memo: 'overflow',
    lines: [
      { account: '1000', debit: big },
      { account: '3000', credit: big },
      { account: '1000', debit: 1 },
      { account: '3000', credit: 1 },
    ],
  }), /exceeds/);
});

test('ledger: rejects unknown account', () => {
  const l = newLedger();
  assert.throws(() => l.post({
    date: '2026-01-01', memo: 'bad',
    lines: [
      { account: '9999', debit: 1000 },
      { account: '3000', credit: 1000 },
    ],
  }), /unknown account/);
});

test('ledger: rejects fake calendar date 2026-02-31', () => {
  const l = newLedger();
  assert.throws(() => l.post({
    date: '2026-02-31', memo: 'bad',
    lines: [
      { account: '1000', debit: 1000 },
      { account: '3000', credit: 1000 },
    ],
  }), /real calendar date/);
});

test('ledger: rejects single-line entry', () => {
  const l = newLedger();
  assert.throws(() => l.post({
    date: '2026-01-01', memo: 'bad',
    lines: [{ account: '1000', debit: 1000 }],
  }), /at least 2 lines/);
});

test('ledger: rejects negative amount', () => {
  const l = newLedger();
  assert.throws(() => l.post({
    date: '2026-01-01', memo: 'bad',
    lines: [
      { account: '1000', debit: -1000 },
      { account: '3000', credit: -1000 },
    ],
  }), /negative|safe integer/);
});

test('ledger: hash chain verifies on a demo ledger', () => {
  const l = buildDemoLedger();
  const v = l.verify();
  assert.equal(v.ok, true);
  assert.equal(v.head.seq, l.head().seq);
  assert.equal(v.head.hash, l.head().hash);
});

test('ledger: tampering with a stored line changes the recomputed hash', () => {
  const l = newLedger();
  const e = postCapital(l, 1000);
  // Reconstruct the entry body and flip a single unit on the debit line.
  const tampered = {
    seq: e.seq, prevHash: e.prevHash, date: e.date, memo: e.memo,
    lines: [
      { account: '1000', debit: 1001, credit: 0 },
      { account: '3000', debit: 0, credit: 1001 },
    ],
  };
  const tamperedId = hashEntryBody(tampered);
  assert.notEqual(tamperedId, e.id);
});

test('ledger: reversal posts a mirror and nets balances to zero', () => {
  const l = newLedger();
  const e = postCapital(l, 1000);
  const r = l.reverse(e.seq, { date: '2026-01-02', memo: 'reverse it' });
  assert.equal(r.seq, 2);
  assert.equal(r.reverses, 1);
  assert.equal(r.prevHash, e.id);
  const bals = l.view().balancesAt({ date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER });
  assert.equal(bals['1000'].balance, 0);
  assert.equal(bals['3000'].balance, 0);
});

test('ledger: cannot reverse an entry twice', () => {
  const l = newLedger();
  const e = postCapital(l, 1000);
  l.reverse(e.seq, { date: '2026-01-02', memo: 'reverse' });
  assert.throws(() => l.reverse(e.seq, { date: '2026-01-03', memo: 'again' }),
    /already reversed/);
});

test('ledger: cannot reverse a reversal', () => {
  const l = newLedger();
  const e = postCapital(l, 1000);
  const r = l.reverse(e.seq, { date: '2026-01-02', memo: 'reverse' });
  assert.throws(() => l.reverse(r.seq, { date: '2026-01-03', memo: 'again' }),
    /cannot reverse a reversal/);
});

test('ledger: reversal date cannot precede the original', () => {
  const l = newLedger();
  const e = postCapital(l, 1000, '2026-01-10');
  assert.throws(() => l.reverse(e.seq, { date: '2026-01-09', memo: 'too early' }),
    /cannot precede/);
});

test('ledger: asOfSeq(N) equals a ledger rebuilt from the first N entries', () => {
  const full = buildDemoLedger();
  const all = full.entries();
  const N = 4;
  const rebuilt = new Ledger({ accounts: DEMO_ACCOUNTS });
  for (let i = 0; i < N; i++) {
    const e = all[i];
    rebuilt.post({
      date: e.date, memo: e.memo, lines: e.lines,
      ...(e.refs ? { refs: e.refs } : {}),
    });
  }
  const rebuiltEntries = rebuilt.entries();
  assert.equal(rebuiltEntries.length, N);
  for (let i = 0; i < N; i++) assert.equal(rebuiltEntries[i].id, all[i].id);
  const view = full.view({ asOfSeq: N });
  assert.equal(view.entries().length, N);
  for (let i = 0; i < N; i++) assert.equal(view.entries()[i].id, all[i].id);
});

test('ledger: view.exclude does not mutate the parent ledger', () => {
  const l = buildDemoLedger();
  const sizeBefore = l.size;
  const headBefore = l.head().hash;
  const view = l.view().exclude(3);
  view.entries();
  assert.equal(l.size, sizeBefore);
  assert.equal(l.head().hash, headBefore);
  assert.ok(!view.entries().some((e) => e.seq === 3));
});

test('ledger: view.overlay appends an unposted draft with a synthetic seq', () => {
  const l = newLedger();
  postCapital(l, 1000);
  const draft = {
    date: '2026-01-02', memo: 'pending',
    lines: [
      { account: '1000', debit: 500 },
      { account: '4000', credit: 500 },
    ],
  };
  const view = l.view({ overlay: draft });
  const entries = view.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[1].seq, 2);
  assert.equal(entries[1].memo, 'pending');
  assert.equal(l.size, 1);
});

test('ledger: entries() returns a frozen array', () => {
  const l = newLedger();
  postCapital(l, 1000);
  const a = l.entries();
  assert.ok(Object.isFrozen(a));
});

test('ledger: head() advances on every post and equals last entry id', () => {
  const l = buildDemoLedger();
  const entries = l.entries();
  const last = entries[entries.length - 1];
  assert.equal(l.head().seq, last.seq);
  assert.equal(l.head().hash, last.id);
});
