// Transfer state: { active, source, payloadKind, snap } where `snap` is the
// pre-arm BasicSnapshot (ring, history, lastPointerEpoch). Arming moves the
// source to rank 0 (Law M7 trivially from the moment of arming). Clearing
// discards the transfer; the caller is responsible for restoring `snap`
// when the event is TRANSFER_CANCEL or BACK during a transfer.
#ifndef ATTENTION_CPP_TRANSFER_HPP
#define ATTENTION_CPP_TRANSFER_HPP

#include "types.hpp"
#include "ring.hpp"

namespace att {

// Move source to rank 0 and populate `t`. Caller has already captured the
// snapshot into t->snap and set t->active = 1. Returns false if source is
// missing (caller maps to BAD_ACTOR).
inline bool transfer_arm(Ring* ring, const Actor& source,
                         int32_t payloadKind, Transfer* t) {
    if (!ring || !t) return false;
    int32_t idx = rank_of(*ring, source.cpLen, source.cp);
    if (idx < 0) return false;
    move_to_front(ring, idx);
    t->active = 1;
    t->source = source;
    t->payloadKind = payloadKind;
    return true;
}

inline void transfer_clear(Transfer* t) {
    if (t) zero_transfer(t);
}

} // namespace att

#endif
