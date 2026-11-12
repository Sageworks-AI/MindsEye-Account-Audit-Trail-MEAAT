// Checked int64 arithmetic for the JS twin. Everything is BigInt so we match
// the C++ int64 ABI bit-for-bit. Overflow throws here; the C++ layer returns
// an error code. The bridge converts one to the other.
export const INT64_MIN = -(1n << 63n);
export const INT64_MAX = (1n << 63n) - 1n;

export function inRange(v) { return v >= INT64_MIN && v <= INT64_MAX; }

export function check(v, label = 'value') {
  if (typeof v !== 'bigint') throw new Error(`${label}: expected BigInt, got ${typeof v}`);
  if (!inRange(v)) throw new Error(`${label}: out of int64 range`);
  return v;
}

export function add(a, b, label = 'sum') {
  check(a, 'a'); check(b, 'b');
  const r = a + b;
  check(r, label);
  return r;
}

export function sub(a, b, label = 'diff') {
  check(a, 'a'); check(b, 'b');
  const r = a - b;
  check(r, label);
  return r;
}

// 128-bit safe via BigInt. Range-checked on the result.
export function mul(a, b, label = 'product') {
  check(a, 'a'); check(b, 'b');
  const r = a * b;
  check(r, label);
  return r;
}

// floor(a / b) for b > 0. BigInt division truncates toward zero, so adjust
// for negative numerators to get true floor.
export function floorDiv(a, b, label = 'quotient') {
  check(a, 'a'); check(b, 'b');
  if (b <= 0n) throw new Error(`${label}: divisor must be positive`);
  const q = a / b;
  return (a % b === 0n || a >= 0n) ? q : q - 1n;
}

export function abs(a) { check(a); return a < 0n ? -a : a; }
export function sign(a) { check(a); return a < 0n ? -1 : (a > 0n ? 1 : 0); }

export function max(a, b) { return a > b ? a : b; }
export function min(a, b) { return a < b ? a : b; }

export function toBigInt(v, label = 'value') {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`${label}: not a safe integer`);
    return BigInt(v);
  }
  throw new Error(`${label}: cannot convert ${typeof v} to BigInt`);
}

export function toNumber(v, label = 'value') {
  check(v, label);
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${label}: too large for Number`);
  }
  return Number(v);
}
