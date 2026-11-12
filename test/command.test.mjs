// Deterministic command grammar. Covers every example from the base spec plus
// the aliases, unknown-card rejection, and the period-required rule for
// commands that open cards without an explicit period in the command.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { interpret } from '../resolve/command.mjs';

function ok(r) { assert.equal(r.ok, true, r.error); return r.request; }

test('command: open balance sheet and cash flow for a range', () => {
  const r = ok(interpret('open balance sheet and cash flow for 2026-01-01 to 2026-03-31'));
  assert.equal(r.mode, 'read');
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].type, 'balance_sheet');
  assert.equal(r.cards[1].type, 'cash_flow');
  assert.equal(r.period.from, '2026-01-01');
  assert.equal(r.period.to, '2026-03-31');
});

test('command: receipt N produces one receipt card', () => {
  const r = ok(interpret('receipt 3'));
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].type, 'receipt');
  assert.equal(r.cards[0].params.entryId, 3);
});

test('command: balance sheet as at date', () => {
  const r = ok(interpret('balance sheet as at 2026-02-28'));
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].type, 'balance_sheet');
  assert.equal(r.period.asOf, '2026-02-28');
  assert.equal(r.period.from, '2026-02-28');
  assert.equal(r.period.to, '2026-02-28');
});

test('command: show impact of N on card', () => {
  const r = ok(interpret('show impact of 3 on balance sheet',
    { period: { from: '2026-01-01', to: '2026-03-31' } }));
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].type, 'balance_sheet');
  assert.equal(r.focus.entryId, 3);
});

test('command: trail from N', () => {
  const r = ok(interpret('trail from 3'));
  assert.equal(r.mode, 'trail');
  assert.equal(r.trail.from, 3);
  assert.equal(r.cards.length, 0);
});

test('command: mode input', () => {
  const r = ok(interpret('mode input', {
    period: { from: '2026-01-01', to: '2026-03-31' },
    cards: [{ type: 'balance_sheet', params: {} }],
  }));
  assert.equal(r.mode, 'input');
  assert.equal(r.cards.length, 1);
});

test('command: compare Q1 with Q2 using activeYear', () => {
  const r = ok(interpret('compare Q1 with Q2', { activeYear: 2026 }));
  assert.equal(r.period.from, '2026-01-01');
  assert.equal(r.period.to, '2026-03-31');
  assert.equal(r.compare.from, '2026-04-01');
  assert.equal(r.compare.to, '2026-06-30');
});

test('command: compare without an active year errors', () => {
  const r = interpret('compare Q1 with Q2', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /active year/);
});

test('command: unknown card name is rejected', () => {
  const r = interpret('open not_a_card for 2026-01-01 to 2026-03-31');
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown card/);
});

test('command: opening cards with no period anywhere errors', () => {
  const r = interpret('open balance sheet');
  assert.equal(r.ok, false);
  assert.match(r.error, /no active period/);
});

test('command: receipt does not require a period', () => {
  const r = interpret('receipt 3');
  assert.equal(r.ok, true);
});

test('command: empty input errors', () => {
  const r = interpret('');
  assert.equal(r.ok, false);
  assert.match(r.error, /empty command/);
});
