// Bounded undo stack of ring snapshots. Only FOCUS events push; INPUT and
// TRANSFER have their own snapshots so their cancel is exact. BACK falls
// through to this stack only when input and transfer are idle (Law M15).
//
// "Pushing a duplicate of the top is skipped" (Addendum B) — a FOCUS that
// produces the same ring as the previous entry cannot add undo depth.
import { sameRing } from './ring.mjs';

export const HISTORY_DEPTH = 16;

export function makeHistory() { return Object.freeze([]); }

export function pushHistory(history, ringSnapshot) {
  if (history.length > 0 && sameRing(history[history.length - 1], ringSnapshot)) {
    return history;
  }
  const next = [...history, ringSnapshot];
  while (next.length > HISTORY_DEPTH) next.shift();
  return Object.freeze(next);
}

export function popHistory(history) {
  if (history.length === 0) return { history, top: null };
  const top = history[history.length - 1];
  return { history: Object.freeze(history.slice(0, -1)), top };
}

export function historyDepth(history) { return history.length; }
