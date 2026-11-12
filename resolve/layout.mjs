// Deterministic screen-space solver. Inputs are plain card specs and a
// viewport { w, h } in pixels; outputs are rects in the same pixel units.
// Templates: 1 full; 2 split along the longer axis; 3 one large plus two
// stacked; 4 a 2x2 grid. Weights are integers; apportionment uses the
// largest-remainder (Hamilton) method so parts sum exactly to the whole and
// ties go to the lower index. No floats anywhere.
export const DEFAULT_GUTTER = 8;
export const DEFAULT_MIN_SIZE = Object.freeze({ w: 200, h: 150 });

function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('apportion: weights sum must be positive');
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  const rem = weights.map((w, i) => total * w - parts[i] * sum);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((a, b) => rem[b] - rem[a] || a - b);
  for (let k = 0; left > 0; k++, left--) parts[order[k]] += 1;
  return parts;
}

function argmax(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

function twoPaneRects(w, h, gutter, weights) {
  if (w >= h) {
    const totalW = w - gutter;
    const [w1, w2] = apportion(totalW, weights);
    return [
      { x: 0, y: 0, w: w1, h },
      { x: w1 + gutter, y: 0, w: w2, h },
    ];
  }
  const totalH = h - gutter;
  const [h1, h2] = apportion(totalH, weights);
  return [
    { x: 0, y: 0, w, h: h1 },
    { x: 0, y: h1 + gutter, w, h: h2 },
  ];
}

function threePaneRects(w, h, gutter, weights) {
  const largeIdx = argmax(weights);
  const others = [0, 1, 2].filter((i) => i !== largeIdx);
  const [i1, i2] = others;
  const out = new Array(3);
  if (w >= h) {
    const totalW = w - gutter;
    const [largeW, smallW] = apportion(totalW, [weights[largeIdx], weights[i1] + weights[i2]]);
    const totalH = h - gutter;
    const [h1, h2] = apportion(totalH, [weights[i1], weights[i2]]);
    out[largeIdx] = { x: 0, y: 0, w: largeW, h };
    out[i1]       = { x: largeW + gutter, y: 0, w: smallW, h: h1 };
    out[i2]       = { x: largeW + gutter, y: h1 + gutter, w: smallW, h: h2 };
  } else {
    const totalH = h - gutter;
    const [largeH, smallH] = apportion(totalH, [weights[largeIdx], weights[i1] + weights[i2]]);
    const totalW = w - gutter;
    const [w1, w2] = apportion(totalW, [weights[i1], weights[i2]]);
    out[largeIdx] = { x: 0, y: 0, w, h: largeH };
    out[i1]       = { x: 0, y: largeH + gutter, w: w1, h: smallH };
    out[i2]       = { x: w1 + gutter, y: largeH + gutter, w: w2, h: smallH };
  }
  return out;
}

function fourPaneRects(w, h, gutter) {
  const totalW = w - gutter;
  const totalH = h - gutter;
  const w1 = Math.floor(totalW / 2);
  const w2 = totalW - w1;
  const h1 = Math.floor(totalH / 2);
  const h2 = totalH - h1;
  return [
    { x: 0,          y: 0,          w: w1, h: h1 },
    { x: w1 + gutter, y: 0,         w: w2, h: h1 },
    { x: 0,          y: h1 + gutter, w: w1, h: h2 },
    { x: w1 + gutter, y: h1 + gutter, w: w2, h: h2 },
  ];
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
  const { w, h } = viewport;

  let rects;
  if (n === 1)      rects = [{ x: 0, y: 0, w, h }];
  else if (n === 2) rects = twoPaneRects(w, h, gutter, weights);
  else if (n === 3) rects = threePaneRects(w, h, gutter, weights);
  else              rects = fourPaneRects(w, h, gutter);

  for (let i = 0; i < rects.length; i++) {
    if (rects[i].w < minSize.w || rects[i].h < minSize.h) {
      return {
        error: `pane ${i} too small: ${rects[i].w}x${rects[i].h} < ${minSize.w}x${minSize.h}`,
      };
    }
  }
  return { rects };
}
