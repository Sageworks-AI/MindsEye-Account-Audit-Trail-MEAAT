// L8: reconcile never moves any pane's rect. When a card's exact row count
// exceeds its prediction, an error is returned with a space.violation draft
// per offending card; when all fit, space.reconciled drafts are returned and
// the plan is returned unchanged.
//
// L5 across plans: for the same card type and axis, a larger rect never
// yields a lower tier (monotone non-decreasing) or a coarser shape class
// (shape class index is monotone non-increasing — FULL=0 is the coarsest,
// STRIP=3 the least detailed). We verify by premeasuring one card at
// several viewport sizes.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { premeasure, reconcile, draftPremeasured, draftLaidOut } from '../../bridge/measure.mjs';

const CARD = Object.freeze({ type: 'balance_sheet', params: {} });
const REQUEST = Object.freeze({
  cards: [CARD],
  period: { from: '2026-01-01', to: '2026-12-31' },
  mode: 'read',
});

function vp(px) { return { w: BigInt(px.w) * 75n, h: BigInt(px.h) * 75n }; }

const SMALL = vp({ w: 800, h: 600 });
const MEDIUM = vp({ w: 1280, h: 720 });
const LARGE = vp({ w: 1920, h: 1080 });

test('reconcile: plan and all frames unchanged when exact rows fit', () => {
  const plan = premeasure(REQUEST, null, MEDIUM);
  assert.ok(!plan.error, plan.error);
  const before = JSON.stringify(serializePlan(plan));

  const r = reconcile(plan, [{ type: 'balance_sheet', rows: 5 }]);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.drafts.length, 1);
  assert.equal(r.drafts[0].type, 'space.reconciled');

  const after = JSON.stringify(serializePlan(plan));
  assert.equal(before, after, 'reconcile must not mutate the plan');
});

test('reconcile: exact rows == predicted is accepted', () => {
  const plan = premeasure(REQUEST, null, MEDIUM);
  assert.ok(!plan.error, plan.error);
  const predicted = plan.cards[0].predictedRows;
  const r = reconcile(plan, [{ type: 'balance_sheet', rows: predicted }]);
  assert.equal(r.ok, true);
});

test('reconcile: exact rows > predicted returns error and space.violation', () => {
  const plan = premeasure(REQUEST, null, MEDIUM);
  assert.ok(!plan.error, plan.error);
  const predicted = plan.cards[0].predictedRows;
  const r = reconcile(plan, [{ type: 'balance_sheet', rows: predicted + 1 }]);
  assert.match(r.error, /exceed prediction/);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].exactRows, predicted + 1);
  assert.equal(r.violations[0].predictedRows, predicted);
  assert.equal(r.drafts.length, 1);
  assert.equal(r.drafts[0].type, 'space.violation');
  assert.equal(r.drafts[0].lane, 'space');
});

test('reconcile: multiple cards, one violation', () => {
  const req = {
    cards: [
      { type: 'balance_sheet', params: {} },
      { type: 'cash_flow',    params: {} },
    ],
    period: { from: '2026-01-01', to: '2026-12-31' },
    mode: 'read',
  };
  const plan = premeasure(req, null, MEDIUM);
  assert.ok(!plan.error, plan.error);
  const r = reconcile(plan, [
    { type: 'balance_sheet', rows: 5 },
    { type: 'cash_flow',    rows: plan.cards[1].predictedRows + 2 },
  ]);
  assert.match(r.error, /1 card/);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].type, 'cash_flow');
});

test('reconcile: no change to another pane\'s frame when a card is over', () => {
  const req = {
    cards: [
      { type: 'balance_sheet', params: {} },
      { type: 'cash_flow',    params: {} },
    ],
    period: { from: '2026-01-01', to: '2026-12-31' },
    mode: 'read',
  };
  const plan = premeasure(req, null, MEDIUM);
  const before = plan.cards.map((c) => ({ ...c.frameCpt }));
  reconcile(plan, [
    { type: 'balance_sheet', rows: 1 },
    { type: 'cash_flow',    rows: 999 },
  ]);
  const after = plan.cards.map((c) => ({ ...c.frameCpt }));
  for (let i = 0; i < before.length; i++) {
    assert.equal(before[i].x, after[i].x, `pane ${i} x moved`);
    assert.equal(before[i].y, after[i].y, `pane ${i} y moved`);
    assert.equal(before[i].w, after[i].w, `pane ${i} w changed`);
    assert.equal(before[i].h, after[i].h, `pane ${i} h changed`);
  }
});

test('L5: larger rect never yields a lower tier (monotone non-decreasing)', () => {
  const tierIdx = { summary: 0, standard: 1, full: 2 };
  const sizes = [
    { w: 400, h: 400 }, { w: 600, h: 600 }, { w: 800, h: 600 },
    { w: 1280, h: 720 }, { w: 1600, h: 900 }, { w: 1920, h: 1080 },
  ];
  let lastTier = -1;
  for (const s of sizes) {
    const plan = premeasure(REQUEST, null, vp(s));
    assert.ok(!plan.error, plan.error);
    const t = tierIdx[plan.cards[0].tier];
    assert.ok(t >= lastTier,
      `tier at ${s.w}x${s.h} is ${plan.cards[0].tier} < previous`);
    lastTier = t;
  }
});

test('L5: larger rect never yields a coarser shape class', () => {
  // Shape class index: FULL=0 is the most detailed, STRIP=3 is the least.
  // Larger rect -> index should be non-increasing.
  const shapeIdx = { FULL: 0, HALF: 1, QUARTER: 2, STRIP: 3 };
  const sizes = [
    { w: 400, h: 400 }, { w: 600, h: 600 }, { w: 800, h: 600 },
    { w: 1280, h: 720 }, { w: 1600, h: 900 }, { w: 1920, h: 1080 },
  ];
  let last = 99;
  for (const s of sizes) {
    const plan = premeasure(REQUEST, null, vp(s));
    assert.ok(!plan.error, plan.error);
    const idx = shapeIdx[plan.cards[0].shapeClass];
    assert.ok(idx <= last,
      `shape class at ${s.w}x${s.h} is ${plan.cards[0].shapeClass} (${idx}) > previous (${last})`);
    last = idx;
  }
});

test('draftPremeasured and draftLaidOut return well-shaped drafts', () => {
  const plan = premeasure(REQUEST, null, MEDIUM);
  const pre = draftPremeasured(plan);
  assert.equal(pre.type, 'space.premeasured');
  assert.equal(pre.lane, 'space');
  const laid = draftLaidOut(plan);
  assert.equal(laid.type, 'space.laid_out');
  assert.equal(laid.lane, 'space');
});

function serializePlan(plan) {
  return {
    cards: plan.cards.map((c) => ({
      type: c.type,
      frameCpt: [c.frameCpt.x.toString(), c.frameCpt.y.toString(),
                 c.frameCpt.w.toString(), c.frameCpt.h.toString()],
      shapeClass: c.shapeClass,
      tier: c.tier,
      predictedRows: c.predictedRows,
      pagination: c.pagination.map((p) => [p.from, p.to]),
    })),
    focalIndex: plan.focalIndex,
  };
}
