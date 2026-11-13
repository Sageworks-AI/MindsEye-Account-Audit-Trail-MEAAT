// Bounded undo stack of ring snapshots. Only FOCUS events push; INPUT and
// TRANSFER have their own snapshots so their cancel is exact. BACK falls
// through to this stack only when input and transfer are idle (M15).
//
// Pushing a snapshot identical to the current top is a no-op, matching the
// JS twin's `pushHistory`. Depth cap ATT_HISTORY_DEPTH; pushing past it
// drops the oldest entry (a bounded FIFO, not an error — that matches the
// twin's `while (next.length > HISTORY_DEPTH) next.shift()`).
#ifndef ATTENTION_CPP_HISTORY_HPP
#define ATTENTION_CPP_HISTORY_HPP

#include "types.hpp"

namespace att {

inline void history_push(History* h, const Ring& ring_snapshot) {
    if (!h) return;
    if (h->depth > 0 && ring_eq(h->rings[h->depth - 1], ring_snapshot)) return;
    if (h->depth < ATT_HISTORY_DEPTH) {
        h->rings[h->depth++] = ring_snapshot;
        return;
    }
    for (int32_t i = 1; i < ATT_HISTORY_DEPTH; ++i) h->rings[i - 1] = h->rings[i];
    h->rings[ATT_HISTORY_DEPTH - 1] = ring_snapshot;
}

// Pop and write into *outRing. Returns false if empty (caller maps to NOOP).
inline bool history_pop(History* h, Ring* outRing) {
    if (!h || h->depth <= 0) return false;
    h->depth -= 1;
    *outRing = h->rings[h->depth];
    zero_ring(&h->rings[h->depth]);
    return true;
}

} // namespace att

#endif
