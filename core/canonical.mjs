// Canonical JSON: keys sorted lexically, no whitespace. Used for entry hashes,
// card hashes and cache keys. Rejects non-finite numbers and undefined so a
// canonicalization failure is loud, not silent.

export function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonicalize: non-finite number');
    return v;
  }
  if (v === undefined) throw new Error('canonicalize: undefined value');
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const val = v[k];
      if (val === undefined) continue;
      out[k] = sortKeys(val);
    }
    return out;
  }
  throw new Error(`canonicalize: unsupported type ${typeof v}`);
}
