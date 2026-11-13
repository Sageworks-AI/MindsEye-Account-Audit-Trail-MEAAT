// Deterministic screen-space solver. Same public API as S4-close
// (solve, DEFAULT_GUTTER, DEFAULT_MIN_SIZE), but the rectangle math is now
// delegated to space/templates.mjs so 600:400 on the long axis lives in one
// place (space) and both backends share it. Pixels are converted to cpt
// (1 px = 75 cpt) at entry and back at exit; per README §px rects, floor
// each edge independently so px rects stay disjoint and inside the
// viewport even when cpt coordinates leave a sub-pixel remainder.
//
// Reordering: for n=2 and n=3 the pane with the largest weight (ties to
// lower index) becomes the focal pane and is placed in the large slot by
// space/templates. n=1 has one pane; n=4 is a 2x2 grid in which weights are
// intentionally ignored (README #22), so no reordering is applied.
import { chooseTemplate, DEFAULT_GUTTER_CPT } from '../space/index.mjs';

const PT_PER_PX = 75n;

export const DEFAULT_GUTTER = Number(DEFAULT_GUTTER_CPT / PT_PER_PX); // 8
export const DEFAULT_MIN_SIZE = Object.freeze({ w: 200, h: 150 });

function argmax(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

function cptRectToPx(r) {
  const left = Number(r.x / PT_PER_PX);
  const top = Number(r.y / PT_PER_PX);
  const right = Number((r.x + r.w) / PT_PER_PX);
  const bottom = Number((r.y + r.h) / PT_PER_PX);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function solve(cards, viewport, opts = {}) {
  const n = cards.length;
  if (!viewport || !Number.isSafeInteger(viewport.w) || !Number.isSafeInteger(viewport.h) ||
      viewport.w <= 0 || viewport.h <= 0) {
    return { error: 'viewport must be { w, h } positive integers' };
  }
  if (n > 4) return { error: `cannot layout ${n} cards (max 4)` };
  if (n === 0) return { rects: [] };
  if (opts.weights && opts.weights.length !== n) {
    return { error: `weights length ${opts.weights.length} does not match card count ${n}` };
  }
  const weights = opts.weights ? opts.weights.slice() : new Array(n).fill(1);
  for (const wt of weights) {
    if (!Number.isSafeInteger(wt) || wt < 1) {
      return { error: `weights must be positive integers (got ${wt})` };
    }
  }
  const gutter = opts.gutter ?? DEFAULT_GUTTER;
  const minSize = opts.minSize ?? DEFAULT_MIN_SIZE;

  if (n === 1) {
    const rect = { x: 0, y: 0, w: viewport.w, h: viewport.h };
    if (rect.w < minSize.w || rect.h < minSize.h) {
      return { error: `pane 0 too small: ${rect.w}x${rect.h} < ${minSize.w}x${minSize.h}` };
    }
    return { rects: [rect] };
  }

  const wCpt = BigInt(viewport.w) * PT_PER_PX;
  const hCpt = BigInt(viewport.h) * PT_PER_PX;
  const gutterCpt = BigInt(gutter) * PT_PER_PX;

  const shouldReorder = n === 2 || n === 3;
  const focalIdx = shouldReorder ? argmax(weights) : 0;
  const orderedWeights = shouldReorder
    ? [...weights.slice(focalIdx), ...weights.slice(0, focalIdx)].map((w) => BigInt(w))
    : weights.map((w) => BigInt(w));

  const template = chooseTemplate(n);
  const orderedRects = template(wCpt, hCpt, gutterCpt, orderedWeights);

  const rectsCpt = new Array(n);
  for (let k = 0; k < n; k++) {
    const origIdx = shouldReorder ? (k + focalIdx) % n : k;
    rectsCpt[origIdx] = orderedRects[k];
  }
  const rects = rectsCpt.map(cptRectToPx);

  for (let i = 0; i < rects.length; i++) {
    if (rects[i].w < minSize.w || rects[i].h < minSize.h) {
      return { error: `pane ${i} too small: ${rects[i].w}x${rects[i].h} < ${minSize.w}x${minSize.h}` };
    }
  }
  return { rects };
}
