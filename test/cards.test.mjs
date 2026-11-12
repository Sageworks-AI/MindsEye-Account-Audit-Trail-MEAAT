// Card builder contracts: every card on the demo ledger passes its own
// checks; hashes are stable across re-runs; card shape matches version 2.
// One failing check here means a builder bug or an invariant regression.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildCard, open, REGISTRY } from '../core/cards/index.mjs';
import { buildDemoLedger, DEMO_PERIOD } from './fixtures/ledger.mjs';

const AS_OF = Object.freeze({ date: '2026-03-31', seq: Number.MAX_SAFE_INTEGER });

function ledger() { return buildDemoLedger(); }

test('cards: registry declares period shapes for every card type', () => {
  for (const [type, entry] of Object.entries(REGISTRY)) {
    assert.ok(['instant', 'range', 'entry'].includes(entry.period), type);
    assert.equal(typeof entry.build, 'function', type);
  }
});

test('cards: every card on the demo ledger has ok=true and passes every check', () => {
  const l = ledger();
  const view = l.view();
  const specs = [
    { type: 'trial_balance',    params: { asOf: AS_OF } },
    { type: 'balance_sheet',    params: { asOf: AS_OF } },
    { type: 'income_statement', params: { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to } },
    { type: 'cash_flow',        params: { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to } },
    { type: 'receipt',          params: { entryId: 3 } },
  ];
  for (const spec of specs) {
    const card = buildCard(spec.type, view, spec.params);
    assert.equal(card.ok, true, `${spec.type} checks failed: ${JSON.stringify(card.checks)}`);
    for (const c of card.checks) assert.equal(c.pass, true, `${spec.type}: ${c.name} — ${c.detail || ''}`);
  }
});

test('cards: version 2 shape with required fields', () => {
  const card = buildCard('balance_sheet', ledger().view(), { asOf: AS_OF });
  assert.equal(card.kind, 'state_card');
  assert.equal(card.version, 2);
  assert.equal(card.type, 'balance_sheet');
  assert.equal(typeof card.title, 'string');
  assert.ok(card.period && card.period.asOf);
  assert.ok(Number.isInteger(card.headSeq));
  assert.ok(card.currency && card.currency.code);
  assert.ok(Array.isArray(card.columns));
  assert.ok(Array.isArray(card.sections));
  assert.ok(Array.isArray(card.checks));
  assert.equal(typeof card.ok, 'boolean');
  assert.match(card.hash, /^[0-9a-f]{16}$/);
});

test('cards: every row carries id and refs { entries, accounts }', () => {
  const l = ledger();
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
    for (const section of card.sections) {
      for (const row of section.rows) {
        assert.ok(typeof row.id === 'string' && row.id.length > 0,
          `${type}: row missing id in section ${section.id}`);
        assert.ok(row.refs && Array.isArray(row.refs.entries) && Array.isArray(row.refs.accounts),
          `${type}: row ${row.id} missing refs`);
      }
    }
  }
});

test('cards: hashes are stable across two builds of the same journal', () => {
  const a = buildCard('balance_sheet', ledger().view(), { asOf: AS_OF });
  const b = buildCard('balance_sheet', ledger().view(), { asOf: AS_OF });
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, buildCard('balance_sheet', ledger().view(), { asOf: AS_OF }).hash);
});

test('cards: income statement net profit equals 6000 on the demo', () => {
  const card = buildCard('income_statement', ledger().view(), DEMO_PERIOD);
  const net = card.sections.find((s) => s.id === 'net');
  assert.equal(net.total, 6000);
});

test('cards: cash flow closing is 76000 on the demo', () => {
  const card = buildCard('cash_flow', ledger().view(), DEMO_PERIOD);
  const closing = card.sections.find((s) => s.id === 'cf_closing');
  assert.equal(closing.total, 76000);
});

test('cards: balance sheet assets = 76000 + 30000 = 106000 on the demo', () => {
  const card = buildCard('balance_sheet', ledger().view(), { asOf: AS_OF });
  const A = card.sections.find((s) => s.id === 'assets').total;
  assert.equal(A, 106000);
});

test('cards: receipt takes entryId, id string, and seq alias', () => {
  const l = ledger();
  const e3 = l.getEntry(3);
  const bySeq = buildCard('receipt', l.view(), { entryId: 3 });
  const byId  = buildCard('receipt', l.view(), { entryId: e3.id });
  assert.equal(bySeq.hash, byId.hash);
  assert.equal(bySeq.meta.seq, 3);
});

test('open(view, cards, period): receipt bypasses period, others inherit it', () => {
  const l = ledger();
  const cards = open(l.view(), [
    { type: 'balance_sheet' },
    { type: 'receipt', entryId: 3 },
  ], { asOf: AS_OF });
  assert.equal(cards.length, 2);
  assert.equal(cards[0].type, 'balance_sheet');
  assert.equal(cards[1].type, 'receipt');
  assert.equal(cards[1].meta.seq, 3);
});

test('cards: asOf accepts a plain date string (treated as end of that day)', () => {
  const card = buildCard('balance_sheet', ledger().view(), { asOf: '2026-03-31' });
  assert.equal(card.period.asOf.date, '2026-03-31');
  assert.ok(card.ok);
});
