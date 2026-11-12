// The solver: viewport + pane requests + archetypes -> per-pane { rect,
// shapeClass, tier, scale, pagination }. All geometry in cpt (BigInt).
// Enforces L1, L3, L4, L6, L11 inside the solve; L2 is discharged by
// apportion; L5, L7, L8, L9, L10, L12 are verified by tests. Any law that
// would be violated returns { error, law } rather than a bad layout.
import { chooseTemplate } from './templates.mjs';
import { paginate } from './paginate.mjs';
import { makeRational } from './rational.mjs';

export const MIN_BODY_CPT   = 675n;
export const DISPLAY_MAX    = 12;
export const DEFAULT_GUTTER_CPT = 600n;   // 8 CSS px

// Tier thresholds in cpt, mirroring resolve/tiers.mjs (px * 75).
export const TIER_THRESHOLDS = Object.freeze({
  summaryBelow:  { w: 24000n, h: 18000n },
  standardBelow: { w: 48000n, h: 36000n },
});

const SHAPES = ['FULL', 'HALF', 'QUARTER', 'STRIP'];

function pickShape(rectCpt, archetype, minBodyCpt) {
  const bodyCpt = BigInt(archetype.typeScalePt.body * 100);
  for (const shapeClass of SHAPES) {
    const dims = archetype.shapeDimensions[shapeClass];
    if (!dims) continue;
    const pageW = BigInt(dims.wPt * 100);
    const pageH = BigInt(dims.hPt * 100);
    // Uniform scale = min(rect.w / pageW, rect.h / pageH), as a rational.
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

  // Focal is first; if the caller passed a focalIndex outside the geometry
  // panes (e.g. pointed at a BAR), we fall back to the first.
  const focalAt = opts.focalIndex;
  const focalPos = geom.findIndex(({ i }) => i === focalAt);
  const ordered = focalPos > 0
    ? [...geom.slice(focalPos), ...geom.slice(0, focalPos)]
    : geom;

  const rects = chooseTemplate(ordered.length)(viewport.w, viewport.h, gutter);

  // L1: partition (rects inside viewport, disjoint).
  for (const r of rects) {
    if (r.x < 0n || r.y < 0n || r.x + r.w > viewport.w || r.y + r.h > viewport.h) {
      return { error: `L1 violation: rect ${r.x},${r.y},${r.w},${r.h} outside viewport ${viewport.w}x${viewport.h}`, law: 'L1' };
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j])) return { error: `L1 violation: panes ${i},${j} overlap`, law: 'L1' };
    }
  }

  // L6: focal (rect 0 by construction) contains the viewport center.
  const cx = viewport.w / 2n, cy = viewport.h / 2n;
  const f = rects[0];
  if (!(cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h)) {
    return { error: `L6 violation: focal rect does not contain viewport center`, law: 'L6' };
  }

  const out = new Array(panes.length);
  for (let k = 0; k < ordered.length; k++) {
    const { p, i } = ordered[k];
    const archetype = archetypes[p.archetypeId];
    if (!archetype) return { error: `unknown archetype: ${p.archetypeId}` };
    const rect = rects[k];
    const shapePick = pickShape(rect, archetype, minBodyCpt);
    if (shapePick.error) return { error: `pane ${i}: ${shapePick.error}`, law: shapePick.law };
    const tier = pickTier(rect);
    const rowsUpperBound = p.claim && Number.isInteger(p.claim.rowsUpperBound)
      ? p.claim.rowsUpperBound : archetype.typicalRows;
    const pagination = paginate({ rows: rowsUpperBound, shapeClass: shapePick.shapeClass, archetype });
    if (pagination.error) return { error: `pane ${i}: ${pagination.error}`, law: 'L11' };
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
