// Layout solver and tier selection: deterministic templates for 1..4 cards;
// Hamilton apportionment; min-size rejection; tier thresholds including the
// receipt minimum (standard).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { solve, DEFAULT_GUTTER } from '../resolve/layout.mjs';
import { tierForRect, THRESHOLDS, tierIndex, sliceSections } from '../resolve/tiers.mjs';

const VP = { w: 1280, h: 720 };

test('layout: 1 card fills the viewport', () => {
  const r = solve([{}], VP);
  assert.deepEqual(r.rects, [{ x: 0, y: 0, w: 1280, h: 720 }]);
});

test('layout: 2 cards at wide viewport split horizontally with a gutter', () => {
  const r = solve([{}, {}], VP);
  assert.equal(r.rects.length, 2);
  assert.equal(r.rects[0].w + r.rects[1].w + DEFAULT_GUTTER, VP.w);
  assert.equal(r.rects[0].h, VP.h);
  assert.equal(r.rects[1].h, VP.h);
  assert.equal(r.rects[0].y, 0);
  assert.equal(r.rects[1].y, 0);
  assert.equal(r.rects[1].x, r.rects[0].w + DEFAULT_GUTTER);
});

test('layout: 2 cards at tall viewport split vertically', () => {
  const r = solve([{}, {}], { w: 720, h: 1280 });
  assert.equal(r.rects[0].h + r.rects[1].h + DEFAULT_GUTTER, 1280);
  assert.equal(r.rects[0].w, 720);
  assert.equal(r.rects[1].w, 720);
});

test('layout: 2 cards with weights [1, 3] split proportionally', () => {
  const r = solve([{}, {}], VP, { weights: [1, 3] });
  const totalW = VP.w - DEFAULT_GUTTER;
  assert.equal(r.rects[0].w, Math.floor(totalW / 4));
  assert.equal(r.rects[1].w, totalW - Math.floor(totalW / 4));
});

test('layout: 3 cards give one large plus two stacked (wide)', () => {
  const r = solve([{}, {}, {}], VP);
  assert.equal(r.rects.length, 3);
  assert.equal(r.rects[0].h, VP.h);
  assert.ok(r.rects[0].w > r.rects[1].w);
  assert.equal(r.rects[1].h + r.rects[2].h + DEFAULT_GUTTER, VP.h);
  assert.equal(r.rects[1].x, r.rects[2].x);
  assert.equal(r.rects[1].w, r.rects[2].w);
});

test('layout: 3 cards with focal weight keeps the focal card large', () => {
  const r = solve([{}, {}, {}], VP, { weights: [1, 5, 1] });
  assert.ok(r.rects[1].w > r.rects[0].w);
  assert.ok(r.rects[1].h > r.rects[0].h);
});

test('layout: 4 cards form a 2x2 grid with gutters', () => {
  const r = solve([{}, {}, {}, {}], VP);
  assert.equal(r.rects.length, 4);
  assert.equal(r.rects[0].y, 0);
  assert.equal(r.rects[1].y, 0);
  assert.equal(r.rects[2].y, r.rects[0].h + DEFAULT_GUTTER);
  assert.equal(r.rects[3].y, r.rects[0].h + DEFAULT_GUTTER);
  assert.equal(r.rects[0].x, 0);
  assert.equal(r.rects[2].x, 0);
  assert.equal(r.rects[1].x, r.rects[0].w + DEFAULT_GUTTER);
});

test('layout: 5 cards are rejected', () => {
  const r = solve([{}, {}, {}, {}, {}], VP);
  assert.match(r.error, /cannot layout 5 cards/);
});

test('layout: pane smaller than the minimum is rejected', () => {
  const r = solve([{}, {}], { w: 500, h: 500 }, { minSize: { w: 300, h: 200 } });
  assert.match(r.error, /too small/);
});

test('layout: weights length must equal card count', () => {
  const r = solve([{}, {}], VP, { weights: [1, 1, 1] });
  assert.match(r.error, /weights length/);
});

test('tiers: thresholds raise summary -> standard -> full as size grows', () => {
  assert.equal(tierForRect({ w: 200, h: 150 }), 'summary');
  assert.equal(tierForRect({ w: 500, h: 400 }), 'standard');
  assert.equal(tierForRect({ w: 900, h: 700 }), 'full');
});

test('tiers: minTier enforces receipt standard minimum', () => {
  assert.equal(tierForRect({ w: 200, h: 150 }, { minTier: 'standard' }), 'standard');
  assert.equal(tierIndex('full'), 2);
});

test('tiers: sliceSections drops rows at summary and keeps them at standard/full', () => {
  const card = {
    sections: [
      { id: 'a', label: 'A', rows: [{ id: 'r1' }, { id: 'r2' }], total: 10 },
    ],
  };
  const sum = sliceSections(card, 'summary');
  assert.equal(sum[0].rows.length, 0);
  assert.equal(sum[0].total, 10);
  const std = sliceSections(card, 'standard');
  assert.equal(std[0].rows.length, 2);
  const full = sliceSections(card, 'full');
  assert.equal(full[0].exposeRefs, true);
});
