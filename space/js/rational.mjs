// Rationals { num, den } of BigInt, den > 0, reduced by gcd. Used only for
// the one non-trivial scale in the space layer (page rect to logical page).
// No floats anywhere; comparisons are cross-multiplied.
import { check, mul, floorDiv } from './fixed.mjs';

export function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  return a;
}

export function makeRational(num, den) {
  if (typeof num !== 'bigint' || typeof den !== 'bigint') {
    throw new Error('makeRational: num and den must be BigInt');
  }
  if (den === 0n) throw new Error('makeRational: den must be nonzero');
  if (den < 0n) { num = -num; den = -den; }
  const g = gcd(num, den);
  if (g > 1n) { num = num / g; den = den / g; }
  return Object.freeze({ num, den });
}

export function compareRational(a, b) {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function minRational(a, b) { return compareRational(a, b) <= 0 ? a : b; }

// floor(length * num / den), 128-bit intermediate. den > 0.
export function applyRational(length, r) {
  check(length, 'length');
  return floorDiv(mul(length, r.num, 'scale.numerator'), r.den, 'scale.denominator');
}

export function rationalEQ(a, b) { return compareRational(a, b) === 0; }

export function rationalToPair(r) {
  // For ABI marshalling and hashing.
  return { num: r.num, den: r.den };
}
