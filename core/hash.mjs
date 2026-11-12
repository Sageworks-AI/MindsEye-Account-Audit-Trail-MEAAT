// SHA-256 via node:crypto. The entry hash chain uses GENESIS_HASH for the
// first prevHash. Card hashes are short stable fingerprints, not security
// primitives — used to keep byte-identical SVGs across runs and to key caches.

import { createHash } from 'node:crypto';
import { canonicalize } from './canonical.mjs';

export const GENESIS_HASH = '0'.repeat(64);

export function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

export function hashEntryBody(body) {
  return sha256Hex(canonicalize(body));
}

// First `chars` hex characters of the SHA-256 of the canonical form of `value`.
// 16 chars keeps a comfortable collision margin for a single user's cache.
export function shortHash(value, chars = 16) {
  const s = typeof value === 'string' ? value : canonicalize(value);
  return sha256Hex(s).slice(0, chars);
}
