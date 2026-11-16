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
 
