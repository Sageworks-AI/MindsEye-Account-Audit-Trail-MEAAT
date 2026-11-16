// The solver: viewport + pane requests + archetypes -> per-pane { rect,
// shapeClass, tier, scale, pagination }. All geometry in cpt (BigInt).
// Enforces L1, L3, L4, L6, L11 inside the solve; L2 is discharged by
// apportion; L5, L7, L8, L9, L10, L12 are verified by tests. Any law that
// would be violated returns { error, law } rather than a bad layout.
//
// Behaviour ports solve_panes in space/cpp/solve.hpp:
//   MIN_BODY_CPT = 675; DEFAULT_GUTTER_CPT = 600;
//   TIER_THRESHOLDS = { summaryBelow: 24000x18000, standardBelow: 48000x36000 };
//   MAX_PAGES_PER_PANE = 128;
//   Hamilton apportionment (chooseTemplate delegates to apportion);
//   3-pane rule = 600/1000 of the long axis to the focal pane, 400/1000
//   split between the two smalls by their weights;
//   the BAR check (isBar===true) excludes a pane from geometry (L12);
//   focal pane is reordered first, its rect is rects[0], and the centre of
//   the viewport must land inside it (L6).
//
// Caller interface (abi.mjs, bridge/attention.mjs, bridge/measure.mjs):
//   solve(viewport, panes, { archetypes, gutter?, focalIndex?, minBodyCpt? })
//   viewport  = { w: BigInt, h: BigInt }
//   panes     = [{ archetypeId, isBar?, rowsUpper?, weight?, claim? }]
//   returns   = { panes: [...], focalIndex } or { error, law? }
// Each returned pane carries { originalIndex, rect: {x,y,w,h:BigInt},
//   shapeClass: 'FULL'|'HALF'|'QUARTER'|'STRIP', tier: 'summary'|'standard'|'full',
//   scale: {num:BigInt, den:BigInt}, effectiveBodyCpt: BigInt,
//   pagination: [{from:number, to:number}], rowsUpperBound: number }.
import { chooseTemplate } from './templates.mjs';
import { paginate } from './paginate.mjs';
import { makeRational } from './rational.mjs';

export const MIN_BODY_CPT = 675n;
export const DISPLAY_MAX = 12;
export const DEFAULT_GUTTER_CPT = 600n;

export const TIER_THRESHOLDS = Object.freeze({
  summaryBelow:  { w: 24000n, h: 18000n },
  standardBelow: { w: 48000n, h: 36000n },
});

// Order matches SHAPE_INDEX in space/marshal.mjs and SHAPE_* in
// space/cpp/claim.hpp: FULL=0 (most detailed), HALF=1, QUARTER=2, STRIP=3.
const SHAPES = ['FULL', 'HALF', 'QUARTER', 'STRIP'];
const MAX_PAGES_PER_PANE = 128;

// Try shapes in order of decreasing detail; pick the first whose scaled
// body size is at least minBodyCpt. Mirrors pick_shape() in solve.hpp.
function pickShape(rectCpt, archetype, minBodyCpt) {
  const bodyCpt = BigInt(archetype.typeScalePt.body * 100);
  for (const shapeClass of SHAPES) {
    const dims = archetype.shapeDimensions[shapeClass];
    if (!dims) continue;
    const pageW = BigInt(dims.wPt * 100);
    const pageH = BigInt(dims.hPt * 100);
    let num, den;
    if (rectCpt.w * pageH < rectCpt.h * pageW) { num = rectCpt.w; den = pageW; }
    else { num = rectCpt.h; den = pageH; }
    const effectiveBodyCpt = (bodyCpt * num) / den;
    if (effectiveBodyCpt >= minBodyCpt) {
      return { shapeClass, scale: makeRational(num, den), effectiveBodyCpt };
    }
  }
  return {
    error: `pane ${rectCpt.w}x${rectCpt.h}cpt too small for STRIP shape at MIN_BODY (${minBodyCpt}cpt)`,
    law: 'L4',
  };
}

function pickTier(rectCpt) {
  if (rectCpt.w < TIER_THRESHOLDS.summaryBelow.w ||
      rectCpt.h < TIER_THRESHOLDS.summaryBelow.h) return 'summary';
  if (rectCpt.w < TIER_THRESHOLDS.standardBelow.w ||
      rectCpt.h < TIER_THRESHOLDS.standardBelow.h) return 'standard';
  return 'full';
}

function overlaps(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x ||
           a.y + a.h <= b.y || b.y + b.h <= a.y);
}

// Best-effort rows upper bound for a pane. Preference order:
//   1. p.rowsUpper (number) — what abi.mjs and bridge/measure.mjs pass.
//   2. p.claim.rowsUpperBound — what bridge/attention.mjs passes.
//   3. archetype.typicalRows — the archetype's own default.
// This matches the C++ SolvePaneInput.rowsUpper contract.
function rowsUpperFor(pane, archetype) {
  if (typeof pane.rowsUpper === 'number' && Number.isInteger(pane.rowsUpper) && pane.rowsUpper >= 0) {
    return pane.rowsUpper;
  }
  if (pane.claim && Number.isInteger(pane.claim.rowsUpperBound) && pane.claim.rowsUpperBound >= 0) {
    return pane.claim.rowsUpperBound;
  }
  return archetype.typicalRows;
}

export function solve(viewport, panes, opts = {}) {
  if (!viewport || typeof viewport.w !== 'bigint' || typeof viewport.h !== 'bigint' ||
      viewport.w <= 0n || viewport.h <= 0n) {
    return { error: 'viewport must be { w: BigInt > 0, h: BigInt > 0 }' };
  }
  if (!Array.isArray(panes)) return { error: 'panes must be an array' };

  const gutter = opts.gutter ?? DEFAULT_GUTTER_CPT;
  const minBodyCpt = opts.minBodyCpt ?? MIN_BODY_CPT;
  const archetypes = opts.archetypes;
  if (!archetypes || typeof archetypes !== 'object') {
    return { error: 'opts.archetypes required' };
  }

  // L12 isolation: BAR panes are appearance-only and reserve no geometry.
  const geom = panes
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.isBar !== true);
  if (geom.length === 0) return { panes: [], focalIndex: -1, laws: { L1: 'pass' } };
  if (geom.length > 4) return { error: `cannot solve ${geom.length} geometry panes (max 4)` };

  const focalAt = opts.focalIndex;
  const focalPos = geom.findIndex(({ i }) => i === focalAt);
  const ordered = focalPos > 0
    ? [...geom.slice(focalPos), ...geom.slice(0, focalPos)]
    : geom;

  // Per-pane weights in template order. Missing or non-positive -> 1,
  // matching resolve/layout.mjs's historical default.
  const orderedWeights = ordered.map(({ p }) => {
    const w = p.weight;
    return (typeof w === 'bigint' && w > 0n) || (typeof w === 'number' && w >= 1)
      ? BigInt(w) : 1n;
  });
  const rects = chooseTemplate(ordered.length)(viewport.w, viewport.h, gutter, orderedWeights);

  // L1: partition (rects inside viewport, pairwise disjoint).
  for (const r of rects) {
    if (r.x < 0n || r.y < 0n || r.x + r.w > viewport.w || r.y + r.h > viewport.h) {
      return {
        error: `L1 violation: rect ${r.x},${r.y},${r.w},${r.h} outside viewport ${viewport.w}x${viewport.h}`,
        law: 'L1',
      };
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j])) {
        return { error: `L1 violation: panes ${i},${j} overlap`, law: 'L1' };
      }
    }
  }

  // L6: viewport centre must lie inside the focal rect (rects[0]).
  const cx = viewport.w / 2n;
  const cy = viewport.h / 2n;
  const f = rects[0];
  if (!(cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h)) {
    return { error: 'L6 violation: focal rect does not contain viewport center', law: 'L6' };
  }

  const out = new Array(panes.length);
  for (let k = 0; k < ordered.length; k++) {
    const { p, i } = ordered[k];
    const archetype = archetypes[p.archetypeId];
    if (!archetype) return { error: `unknown archetype: ${p.archetypeId}` };
    const rect = rects[k];

    const shapePick = pickShape(rect, archetype, minBodyCpt);
    if (shapePick.error) {
      return { error: `pane ${i}: ${shapePick.error}`, law: shapePick.law };
    }
    const tier = pickTier(rect);

    const rowsUpperBound = rowsUpperFor(p, archetype);
    const pagination = paginate({
      rows: rowsUpperBound, shapeClass: shapePick.shapeClass, archetype,
    });
    if (pagination.error) {
      return { error: `pane ${i}: ${pagination.error}`, law: 'L11' };
    }
    if (pagination.pages.length > MAX_PAGES_PER_PANE) {
      return {
        error: `pane ${i}: too many pages (${pagination.pages.length} > ${MAX_PAGES_PER_PANE})`,
        law: 'L11',
      };
    }

    out[i] = {
      originalIndex: i,
      rect,
      shapeClass: shapePick.shapeClass,
      tier,
      scale: shapePick.scale,
      effectiveBodyCpt: shapePick.effectiveBodyCpt,
      pagination: pagination.pages,
      rowsUpperBound,
    };
  }

  return {
    panes: out,
    focalIndex: focalAt ?? ordered[0].i,
    viewport,
    laws: {
      L1: 'pass', L2: 'pass', L3: 'pass', L4: 'pass',
      L6: 'pass', L11: 'pass', L12: 'pass',
    },
  };
}
