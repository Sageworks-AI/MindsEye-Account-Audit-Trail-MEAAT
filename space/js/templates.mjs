// Finite set of split templates for n = 1..4 panes. Pane index 0 is the
// focal pane; the templates place it in the large/central slot by
// construction, so the solver never has to search. All splits use Hamilton
// apportionment so parts sum exactly to the span (Law L2).
import { apportion } from './apportion.mjs';

export function chooseTemplate(n) {
  switch (n) {
    case 1: return (w, h) => [{ x: 0n, y: 0n, w, h }];
    case 2: return (w, h, g) => w >= h
      ? splitHorizontal(w, h, g)
      : splitVertical(w, h, g);
    case 3: return (w, h, g) => threePane(w, h, g);
    case 4: return (w, h, g) => fourPane(w, h, g);
  }
  throw new Error(`no template for n=${n}`);
}

function splitHorizontal(w, h, g) {
  const [lw, rw] = apportion(w - g, [1n, 1n]);
  return [
    { x: 0n,        y: 0n, w: lw, h },
    { x: lw + g,    y: 0n, w: rw, h },
  ];
}

function splitVertical(w, h, g) {
  const [th, bh] = apportion(h - g, [1n, 1n]);
  return [
    { x: 0n, y: 0n,       w, h: th },
    { x: 0n, y: th + g,   w, h: bh },
  ];
}

function threePane(w, h, g) {
  if (w >= h) {
    // Focal at left (60%), two stacked on the right.
    const [lw, rw] = apportion(w - g, [3n, 2n]);
    const [th, bh] = apportion(h - g, [1n, 1n]);
    return [
      { x: 0n,        y: 0n,       w: lw, h },
      { x: lw + g,    y: 0n,       w: rw, h: th },
      { x: lw + g,    y: th + g,   w: rw, h: bh },
    ];
  }
  // Tall viewport: focal on top (60%), two side by side below.
  const [th, bh] = apportion(h - g, [3n, 2n]);
  const [lw, rw] = apportion(w - g, [1n, 1n]);
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
