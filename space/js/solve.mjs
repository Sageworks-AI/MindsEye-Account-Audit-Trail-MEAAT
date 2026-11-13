// Finite set of split templates for n = 1..4 panes. All splits use Hamilton
// apportionment so parts sum exactly to the span (Law L2).
//
// S6: templates now take an optional `weights` array in **template order**
// (focal first when the caller has reordered; original order otherwise).
// The JS twin's solve.mjs and resolve/layout.mjs both reorder before calling
// so the focal pane lands in the large slot. n=1 and n=4 ignore weights
// (single pane or 2x2 grid).
//
// 3-pane rule (README #22): the focal pane takes 600/1000 of the long axis,
// the two smalls share the remaining 400/1000 in proportion to their own
// weights. This matches resolve/layout.mjs's S4-close behaviour exactly; the
// two modules must stay in lockstep (they do — this template is the only
// implementation now).
import { apportion } from './apportion.mjs';

export function chooseTemplate(n) {
  switch (n) {
    case 1: return (w, h) => [{ x: 0n, y: 0n, w, h }];
    case 2: return (w, h, g, weights) => w >= h
      ? splitHorizontal(w, h, g, weights)
      : splitVertical(w, h, g, weights);
    case 3: return (w, h, g, weights) => threePane(w, h, g, weights);
    case 4: return (w, h, g) => fourPane(w, h, g);
  }
  throw new Error(`no template for n=${n}`);
}

function defaultWeights(weights, n) {
  if (Array.isArray(weights) && weights.length === n) return weights;
  return new Array(n).fill(1n);
}

function splitHorizontal(w, h, g, weights) {
  const [lw, rw] = apportion(w - g, defaultWeights(weights, 2));
  return [
    { x: 0n,        y: 0n, w: lw, h },
    { x: lw + g,    y: 0n, w: rw, h },
  ];
}

function splitVertical(w, h, g, weights) {
  const [th, bh] = apportion(h - g, defaultWeights(weights, 2));
  return [
    { x: 0n, y: 0n,       w, h: th },
    { x: 0n, y: th + g,   w, h: bh },
  ];
}

function threePane(w, h, g, weights) {
  const ws = defaultWeights(weights, 3);
  // weights[0] is the focal weight (caller reordered). Smalls share 400 by
  // their own weights; a missing/invalid weight is coerced to 1.
  const smallWeights = [
    ws[1] > 0n ? ws[1] : 1n,
    ws[2] > 0n ? ws[2] : 1n,
  ];
  if (w >= h) {
    const [lw, rw] = apportion(w - g, [600n, 400n]);
    const [th, bh] = apportion(h - g, smallWeights);
    return [
      { x: 0n,        y: 0n,       w: lw, h },
      { x: lw + g,    y: 0n,       w: rw, h: th },
      { x: lw + g,    y: th + g,   w: rw, h: bh },
    ];
  }
  const [th, bh] = apportion(h - g, [600n, 400n]);
  const [lw, rw] = apportion(w - g, smallWeights);
  return [
    { x: 0n,       y: 0n,       w, h: th },
    { x: 0n,       y: th + g,   w: lw, h: bh },
    { x: lw + g,   y: th + g,   w: rw, h: bh },
  ];
}

function fourPane(w, h, g) {
  const [lw, rw] = apportion(w - g, [1n, 1n]);
  const [th, bh] = apportion(h - g, [1n, 1n]);
  return [
    { x: 0n,        y: 0n,       w: lw, h: th },
    { x: lw + g,    y: 0n,       w: rw, h: th },
    { x: 0n,        y: th + g,   w: lw, h: bh },
    { x: lw + g,    y: th + g,   w: rw, h: bh },
  ];
}
