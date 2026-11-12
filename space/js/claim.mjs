// SpaceClaim algebra: { minW, prefW, maxW, minH, prefH, maxH, allowedShapeClasses, rowsUpperBound }.
// Three combinators:
//   stack       - vertical: heights add, widths max
//   sideBySide  - horizontal: widths add, heights max
//   overlay     - max on every axis
// Laws of the algebra (tested in laws.test.mjs):
//   identity:   overlay(c, EMPTY) === c; stack(c, ZERO) === c; sideBySide(c, ZERO) === c
//   associativity: stack(stack(a,b),c) === stack(a,stack(b,c)), same for the others
//   monotonicity: c1 <= c2 implies combine(c1, c3) <= combine(c2, c3) for each op.
//
// c1 <= c2 means component-wise minW <= minW, prefW <= prefW, etc., and
// allowedShapeClasses is a superset (c2 supports at least what c1 supports).
import { max, min } from './fixed.mjs';

const SHAPES = ['FULL', 'HALF', 'QUARTER', 'STRIP'];

export function makeClaim({
  minW = 0n, prefW = 0n, maxW = 0n,
  minH = 0n, prefH = 0n, maxH = 0n,
  allowedShapeClasses = ['FULL', 'HALF', 'QUARTER', 'STRIP'],
  rowsUpperBound = 0,
} = {}) {
  for (const [v, name] of [[minW,'minW'],[prefW,'prefW'],[maxW,'maxW'],[minH,'minH'],[prefH,'prefH'],[maxH,'maxH']]) {
    if (typeof v !== 'bigint') throw new Error(`makeClaim: ${name} must be BigInt`);
  }
  if (!Number.isInteger(rowsUpperBound) || rowsUpperBound < 0) {
    throw new Error('makeClaim: rowsUpperBound must be a non-negative integer');
  }
  return Object.freeze({
    minW, prefW, maxW, minH, prefH, maxH,
    allowedShapeClasses: Object.freeze([...allowedShapeClasses]),
    rowsUpperBound,
  });
}

export const EMPTY = makeClaim(); // no constraint; identity for overlay

function intersectShapes(a, b) {
  const out = [];
  for (const s of SHAPES) if (a.includes(s) && b.includes(s)) out.push(s);
  return out;
}

export function stack(a, b) {
  return makeClaim({
    minW: max(a.minW, b.minW), prefW: max(a.prefW, b.prefW), maxW: max(a.maxW, b.maxW),
    minH: a.minH + b.minH,     prefH: a.prefH + b.prefH,     maxH: a.maxH + b.maxH,
    allowedShapeClasses: intersectShapes(a.allowedShapeClasses, b.allowedShapeClasses),
    rowsUpperBound: a.rowsUpperBound + b.rowsUpperBound,
  });
}

export function sideBySide(a, b) {
  return makeClaim({
    minW: a.minW + b.minW,     prefW: a.prefW + b.prefW,     maxW: a.maxW + b.maxW,
    minH: max(a.minH, b.minH), prefH: max(a.prefH, b.prefH), maxH: max(a.maxH, b.maxH),
    allowedShapeClasses: intersectShapes(a.allowedShapeClasses, b.allowedShapeClasses),
    rowsUpperBound: max(a.rowsUpperBound, b.rowsUpperBound),
  });
}

export function overlay(a, b) {
  return makeClaim({
    minW: max(a.minW, b.minW), prefW: max(a.prefW, b.prefW), maxW: max(a.maxW, b.maxW),
    minH: max(a.minH, b.minH), prefH: max(a.prefH, b.prefH), maxH: max(a.maxH, b.maxH),
    allowedShapeClasses: intersectShapes(a.allowedShapeClasses, b.allowedShapeClasses),
    rowsUpperBound: max(a.rowsUpperBound, b.rowsUpperBound),
  });
}

// c1 <= c2: c1 demands no more than c2 on every bound, and c2 offers at
// least the shapes c1 offers.
export function claimLE(a, b) {
  if (a.minW > b.minW || a.prefW > b.prefW || a.maxW > b.maxW) return false;
  if (a.minH > b.minH || a.prefH > b.prefH || a.maxH > b.maxH) return false;
  for (const s of a.allowedShapeClasses) if (!b.allowedShapeClasses.includes(s)) return false;
  if (a.rowsUpperBound > b.rowsUpperBound) return false;
  return true;
}

// A few helpers used by params.mjs and the solver.
export function withShapeClasses(claim, shapes) {
  return makeClaim({ ...claim, allowedShapeClasses: shapes });
}

export function withRowsUpperBound(claim, n) {
  return makeClaim({ ...claim, rowsUpperBound: n });
}

export function scaleClaim(claim, factor) {
  if (typeof factor !== 'bigint' || factor < 1n) throw new Error('scaleClaim: factor must be BigInt >= 1');
  return makeClaim({
    minW: claim.minW * factor, prefW: claim.prefW * factor, maxW: claim.maxW * factor,
    minH: claim.minH * factor, prefH: claim.prefH * factor, maxH: claim.maxH * factor,
    allowedShapeClasses: claim.allowedShapeClasses,
    rowsUpperBound: claim.rowsUpperBound,
  });
}

export { SHAPES };
export { min };
