// Integer-only money helpers. No float ever enters this module. Amounts are
// minor units (thebe for BWP, exponent 2, 100 per pula). Every operation that
// could produce a value beyond Number.MAX_SAFE_INTEGER throws — silently
// wrapping money is worse than crashing.

export const DEFAULT_CURRENCY = Object.freeze({
  code: 'BWP',
  exponent: 2,
  symbol: 'P',
});

export function assertMinor(amount, label = 'amount') {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new Error(`${label} must be a safe integer, got ${String(amount)}`);
  }
  return amount;
}

export function addMinor(a, b, label = 'sum') {
  assertMinor(a, 'a');
  assertMinor(b, 'b');
  const r = a + b;
  if (!Number.isSafeInteger(r)) {
    throw new Error(`${label} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return r;
}

export function subMinor(a, b, label = 'difference') {
  assertMinor(a, 'a');
  assertMinor(b, 'b');
  const r = a - b;
  if (!Number.isSafeInteger(r)) {
    throw new Error(`${label} exceeds safe-integer range`);
  }
  return r;
}

export function sumMinor(values, label = 'total') {
  let acc = 0;
  for (const v of values) {
    assertMinor(v, 'term');
    acc += v;
    if (!Number.isSafeInteger(acc)) {
      throw new Error(`${label} exceeds Number.MAX_SAFE_INTEGER`);
    }
  }
  return acc;
}

export function negateMinor(amount) {
  assertMinor(amount);
  const r = -amount;
  if (!Number.isSafeInteger(r)) {
    throw new Error('negate exceeds safe-integer range');
  }
  return r;
}

// 12345 with exponent 2 -> "123.45". Exponent 0 -> "12345". Negative values
// keep a leading minus. Math.floor on an integer/factor quotient is exact
// because both operands are safe integers and the quotient fits in a double.
export function formatMinor(amount, currency = DEFAULT_CURRENCY) {
  assertMinor(amount);
  const exp = currency.exponent;
  if (!Number.isInteger(exp) || exp < 0 || exp > 6) {
    throw new Error(`bad currency exponent: ${exp}`);
  }
  if (exp === 0) return String(amount);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const factor = 10 ** exp;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  return `${sign}${whole}.${String(frac).padStart(exp, '0')}`;
}
