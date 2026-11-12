// Small helpers shared by the card builders. Not exported from the registry;
// this file exists only to avoid a fifteen-line copy in each builder.

import { shortHash } from '../hash.mjs';

// Compute ok, then hash over everything except the hash field itself. The
// contract from the base spec: "hash covers everything except itself."
export function finalize(card) {
  const ok = card.checks.every((c) => c.pass);
  const withOk = { ...card, ok };
  const hash = shortHash(withOk, 16);
  return Object.freeze({ ...withOk, hash });
}

// Instant cards take `asOf` as a Tick, a date string, or fall back to `to`.
// A date string means "end of that day", matching accounting convention: the
// balance sheet as at 2026-02-28 includes entries posted during that day.
export function resolveInstantTick(period, label) {
  const asOf = period.asOf ?? period.to;
  if (!asOf) throw new Error(`${label} needs asOf or to`);
  if (typeof asOf === 'string') {
    return Object.freeze({ date: asOf, seq: Number.MAX_SAFE_INTEGER });
  }
  if (!asOf.date || !Number.isSafeInteger(asOf.seq)) {
    throw new Error(`${label}: asOf tick must be { date, seq }`);
  }
  return Object.freeze({ date: asOf.date, seq: asOf.seq });
}

export function resolveRange(period, label) {
  if (!period.from || !period.to) throw new Error(`${label} needs from and to`);
  return {
    fromTick: Object.freeze({ date: period.from, seq: 0 }),
    toTick:   Object.freeze({ date: period.to,   seq: Number.MAX_SAFE_INTEGER }),
  };
}

// Map account code -> sorted unique array of entry seqs, for refs.entries.
export function collectEntriesByAccount(entries) {
  const sets = Object.create(null);
  for (const e of entries) {
    for (const l of e.lines) {
      (sets[l.account] = sets[l.account] || new Set()).add(e.seq);
    }
  }
  const out = Object.create(null);
  for (const k of Object.keys(sets)) out[k] = Object.freeze([...sets[k]].sort((a, b) => a - b));
  return out;
}
