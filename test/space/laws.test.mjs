// Property tests for Laws L1, L2, L4, L6, L9, L10, L11, L12 of the space
// layer. Each law is exercised over seeded random inputs. A failure here is
// a solver bug, not a caller bug — the C++ port in S5 must match every
// assertion verbatim, which is what makes the wasm parity test meaningful.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  solve, MIN_BODY_CPT, DEFAULT_GUTTER_CPT,
  apportion, paginate, loadDocuments, loadMetrics, makeClaim,
} from '../../space/index.mjs';

const DOCS = loadDocuments();
const ARCHETYPES = DOCS.archetypes;

function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}
function randInt(rng, lo, hi) { return lo + (rng() % (hi - lo + 1)); }

function paneFor(type, weight = 1) {
  const archetypeId = {
    balance_sheet: 'balance_sheet_report_form',
    income_statement: 'income_statement',
    cash_flow: 'cash_flow_statement',
    trial_balance: 'trial_balance',
    receipt: 'journal_voucher',
  }[type];
  return {
    archetypeId,
    weight,
    claim: makeClaim({ rowsUpperBound: 20 }),
  };
}

test('L1: pane rects are disjoint and inside the viewport', () => {
  const rng = prng(42);
  for (let trial = 0; trial < 60; trial++) {
    const w = BigInt(randInt(rng, 400, 3000)) * 75n;
    const h = BigInt(randInt(rng, 400, 2000)) * 75n;
    const n = randInt(rng, 1, 4);
    const panes = [];
    for (let i = 0; i < n; i++) panes.push(paneFor('balance_sheet'));
    const r = solve({ w, h }, panes, { archetypes: ARCHETYPES });
    if (r.error) continue; // viewport too small is a legitimate rejection
    const rects = r.panes.map((p) => p.rect);
    for (const rect of rects) {
      assert.ok(rect.x >= 0n && rect.y >= 0n);
      assert.ok(rect.x + rect.w <= w && rect.y + rect.h <= h);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlap = !(a.x + a.w <= b.x || b.x + b.w <= a.x ||
                          a.y + a.h <= b.y || b.y + b.h <= a.y);
        assert.equal(overlap, false, `trial ${trial}: panes ${i},${j} overlap`);
      }
    }
  }
});

test('L2: apportion sums exactly to the span', () => {
  const rng = prng(7);
  for (let trial = 0; trial < 200; trial++) {
    const total = BigInt(randInt(rng, 100, 100000));
    const n = randInt(rng, 1, 5);
    const weights = [];
    for (let i = 0; i < n; i++) weights.push(BigInt(randInt(rng, 1, 100)));
    const parts = apportion(total, weights);
    const sum = parts.reduce((a, b) => a + b, 0n);
    assert.equal(sum, total, `trial ${trial}: sum ${sum} != ${total}`);
    for (const p of parts) assert.ok(p >= 0n);
  }
});

test('L4: every solved pane has effective body >= MIN_BODY', () => {
  const rng = prng(99);
  let solved = 0;
  for (let trial = 0; trial < 80; trial++) {
    const w = BigInt(randInt(rng, 600, 3000)) * 75n;
    const h = BigInt(randInt(rng, 600, 2000)) * 75n;
    const n = randInt(rng, 1, 4);
    const panes = [];
    for (let i = 0; i < n; i++) panes.push(paneFor('balance_sheet'));
    const r = solve({ w, h }, panes, { archetypes: ARCHETYPES });
    if (r.error) continue;
    solved += 1;
    for (const p of r.panes) {
      assert.ok(p.effectiveBodyCpt >= MIN_BODY_CPT,
        `pane effective body ${p.effectiveBodyCpt} < MIN_BODY ${MIN_BODY_CPT}`);
    }
  }
  assert.ok(solved >= 20, `only ${solved} solves succeeded; fuzz too strict`);
});

test('L6: focal pane contains the viewport center', () => {
  const rng = prng(13);
  for (let trial = 0; trial < 40; trial++) {
    const w = BigInt(randInt(rng, 800, 2000)) * 75n;
    const h = BigInt(randInt(rng, 800, 1500)) * 75n;
    const n = randInt(rng, 2, 4);
    const panes = [];
    for (let i = 0; i < n; i++) panes.push(paneFor('balance_sheet'));
    const r = solve({ w, h }, panes, { archetypes: ARCHETYPES, focalIndex: 0 });
    if (r.error) continue;
    const cx = w / 2n, cy = h / 2n;
    const f = r.panes[0].rect;
    assert.ok(cx >= f.x && cx <= f.x + f.w, `trial ${trial}: cx out of focal`);
    assert.ok(cy >= f.y && cy <= f.y + f.h, `trial ${trial}: cy out of focal`);
  }
});

test('L9: solve is deterministic (same inputs, same output)', () => {
  const panes = [paneFor('balance_sheet'), paneFor('cash_flow'), paneFor('income_statement')];
  const vp = { w: 1280n * 75n, h: 720n * 75n };
  const a = solve(vp, panes, { archetypes: ARCHETYPES });
  const b = solve(vp, panes, { archetypes: ARCHETYPES });
  assert.ok(!a.error, a.error);
  assert.equal(JSON.stringify(serialize(a)), JSON.stringify(serialize(b)));
});

test('L10: solving twice returns the same layout (idempotence)', () => {
  const panes = [paneFor('balance_sheet')];
  const vp = { w: 1200n * 75n, h: 800n * 75n };
  const a = solve(vp, panes, { archetypes: ARCHETYPES });
  const b = solve(vp, panes, { archetypes: ARCHETYPES });
  assert.ok(!a.error, a.error);
  assert.deepEqual(serialize(a), serialize(b));
});

test('L11: paginate splits rows with page counts summing exactly', () => {
  const archetype = ARCHETYPES.balance_sheet_report_form;
  for (const rows of [0, 1, 5, 25, 100, 500]) {
    const r = paginate({ rows, shapeClass: 'FULL', archetype });
    assert.ok(!r.error, r.error);
    const sum = r.pages.reduce((a, p) => a + (p.to - p.from), 0);
    assert.equal(sum, rows, `rows=${rows}: sum ${sum} != ${rows}`);
  }
});

test('L11: paginate rejects rows beyond capacity when archetype is non-paginating', () => {
  const archetype = ARCHETYPES.journal_voucher; // paginates: false
  const r = paginate({ rows: 200, shapeClass: 'FULL', archetype });
  assert.match(r.error, /does not paginate/);
});

test('L12: BAR panes reserve no geometry; other rects unchanged', () => {
  const vp = { w: 1280n * 75n, h: 720n * 75n };
  const withoutBar = [
    paneFor('balance_sheet'), paneFor('cash_flow'), paneFor('income_statement'),
  ];
  const withBar = [...withoutBar, { ...paneFor('receipt'), isBar: true }];
  const a = solve(vp, withoutBar, { archetypes: ARCHETYPES });
  const b = solve(vp, withBar, { archetypes: ARCHETYPES });
  assert.ok(!a.error, a.error);
  assert.ok(!b.error, b.error);
  for (let i = 0; i < withoutBar.length; i++) {
    const ra = a.panes[i].rect, rb = b.panes[i].rect;
    assert.equal(ra.x, rb.x);
    assert.equal(ra.y, rb.y);
    assert.equal(ra.w, rb.w);
    assert.equal(ra.h, rb.h);
  }
});

test('L12: solve output for BAR-only input is an empty panes list', () => {
  const vp = { w: 1280n * 75n, h: 720n * 75n };
  const r = solve(vp, [{ ...paneFor('receipt'), isBar: true }], { archetypes: ARCHETYPES });
  assert.equal(r.panes.length, 0);
  assert.equal(r.focalIndex, -1);
});

function serialize(r) {
  return {
    panes: r.panes.map((p) => ({
      rect: [p.rect.x.toString(), p.rect.y.toString(), p.rect.w.toString(), p.rect.h.toString()],
      shapeClass: p.shapeClass, tier: p.tier,
      scale: [p.scale.num.toString(), p.scale.den.toString()],
      effectiveBodyCpt: p.effectiveBodyCpt.toString(),
      pagination: p.pagination.map((pp) => [pp.from, pp.to]),
    })),
    focalIndex: r.focalIndex,
    laws: r.laws,
  };
}
