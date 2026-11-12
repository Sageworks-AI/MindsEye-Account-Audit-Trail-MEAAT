// Hamilton (largest-remainder) apportionment. Parts are integers that sum
// exactly to `total`; the quota rule holds; ties go to the lower index. This
// is the only apportionment used by the solver, so Law L2 ("conservation:
// apportioned parts sum exactly to the span") is discharged by construction.
//
// Spec: total, weights are BigInt; weights.length >= 1; each weight > 0.
export function apportion(total, weights) {
  if (typeof total !== 'bigint') throw new Error('apportion: total must be BigInt');
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new Error('apportion: weights must be a non-empty array');
  }
  let sum = 0n;
  for (const w of weights) {
    if (typeof w !== 'bigint' || w <= 0n) throw new Error('apportion: weights must be positive BigInt');
    sum += w;
  }
  const parts = weights.map((w) => (total * w) / sum);
  const rems = weights.map((w, i) => total * w - parts[i] * sum);
  let left = total - parts.reduce((a, b) => a + b, 0n);
  const order = weights.map((_, i) => i).sort((a, b) => {
    const d = rems[b] - rems[a];
    if (d !== 0n) return d > 0n ? 1 : -1;
    return a - b;
  });
  for (let k = 0; left > 0n; k++, left--) parts[order[k % order.length]] += 1n;
  return parts;
}
