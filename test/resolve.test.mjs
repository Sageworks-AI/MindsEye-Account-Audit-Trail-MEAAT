// Request shape validation and plan output shape. plan() is called with a
// minimal ledger head so cache keys are deterministic; the card builders are
// not invoked at this stage.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateRequest } from '../resolve/request.mjs';
import { plan } from '../resolve/plan.mjs';
import { buildDemoLedger } from './fixtures/ledger.mjs';

const HEAD = Object.freeze({ seq: 7, hash: 'a'.repeat(64) });

test('request: happy path', () => {
  const r = validateRequest({
    cards: [{ type: 'balance_sheet', params: { asOf: '2026-03-31' } }],
    period: { from: '2026-01-01', to: '2026-03-31' },
    mode: 'read',
  });
  assert.equal(r.mode, 'read');
  assert.equal(r.cards.length, 1);
});

test('request: unknown card type rejected', () => {
  assert.throws(() => validateRequest({ cards: [{ type: 'not_a_card' }] }),
    /not a known card type/);
});

test('request: more than 4 cards rejected', () => {
  const cards = Array(5).fill({ type: 'balance_sheet' });
  assert.throws(() => validateRequest({ cards }), /at most 4/);
});

test('request: invalid mode rejected', () => {
  assert.throws(() => validateRequest({
    cards: [], mode: 'flash',
  }), /request.mode must be one of/);
});

test('request: period.from after period.to rejected', () => {
  assert.throws(() => validateRequest({
    cards: [{ type: 'balance_sheet' }],
    period: { from: '2026-04-01', to: '2026-03-31' },
  }), /after period.to/);
});

test('request: invalid calendar date rejected', () => {
  assert.throws(() => validateRequest({
    cards: [{ type: 'balance_sheet' }],
    period: { from: '2026-02-31', to: '2026-03-31' },
  }), /not a real calendar date/);
});

test('request: focus.entryId must be integer or string', () => {
  assert.throws(() => validateRequest({
    cards: [{ type: 'balance_sheet' }],
    focus: { entryId: 1.5 },
  }), /entryId/);
});

test('request: trail.from must be a positive integer', () => {
  assert.throws(() => validateRequest({
    cards: [], mode: 'trail', trail: { from: 0 },
  }), /trail.from/);
});

test('request: empty cards array is allowed', () => {
  const r = validateRequest({ cards: [], mode: 'read' });
  assert.equal(r.cards.length, 0);
});

test('plan: returns a cacheKey, rect, and tier per card', () => {
  const ledger = buildDemoLedger();
  const head = ledger.head();
  const p = plan({
    cards: [
      { type: 'balance_sheet', params: {} },
      { type: 'cash_flow',    params: {} },
    ],
    period: { from: '2026-01-01', to: '2026-03-31' },
    mode: 'read',
  }, { w: 1280, h: 720 }, { head });
  assert.ok(!p.error, p.error);
  assert.equal(p.cards.length, 2);
  for (const c of p.cards) {
    assert.match(c.cacheKey, /^[0-9a-f]{24}$/);
    assert.ok(Number.isSafeInteger(c.rect.w));
    assert.ok(Number.isSafeInteger(c.rect.h));
    assert.ok(['summary', 'standard', 'full'].includes(c.tier));
  }
});

test('plan: cacheKey changes when head changes', () => {
  const base = {
    cards: [{ type: 'balance_sheet', params: {} }],
    period: { from: '2026-01-01', to: '2026-03-31' },
    mode: 'read',
  };
  const p1 = plan(base, { w: 1280, h: 720 }, { head: HEAD });
  const p2 = plan(base, { w: 1280, h: 720 }, { head: { seq: 8, hash: 'b'.repeat(64) } });
  assert.notEqual(p1.cards[0].cacheKey, p2.cards[0].cacheKey);
});

test('plan: viewport too small returns error', () => {
  const p = plan({
    cards: [{ type: 'balance_sheet', params: {} }],
    period: { from: '2026-01-01', to: '2026-03-31' },
  }, { w: 100, h: 100 }, { head: HEAD });
  assert.match(p.error, /too small/);
});

test('plan: empty cards returns empty plan', () => {
  const p = plan({ cards: [], period: {}, mode: 'read' }, { w: 1280, h: 720 }, { head: HEAD });
  assert.ok(!p.error);
  assert.equal(p.cards.length, 0);
});
