// Ring operations. Pure, no allocation. Each operation returns true on
// success and false on law violation (missing actor, duplicate, full). The
// caller (machine.hpp) maps false to the appropriate error code, so error
// semantics live in one place.
#ifndef ATTENTION_CPP_RING_HPP
#define ATTENTION_CPP_RING_HPP

#include "types.hpp"
#include "fixed.hpp"

namespace att {

inline int32_t rank_of(const Ring& r, int32_t cpLen, const int32_t* cp) {
    for (int32_t i = 0; i < r.count; ++i) {
        if (id_eq(r.actors[i], cpLen, cp)) return i;
    }
    return -1;
}

inline const Actor* find_by_id(const Ring& r, int32_t cpLen, const int32_t* cp) {
    int32_t idx = rank_of(r, cpLen, cp);
    return idx < 0 ? nullptr : &r.actors[idx];
}

inline int32_t level_of(int32_t rank) {
    if (rank < 0) return -1;
    return rank < 2 ? rank : 2;
}

// Move actor at index `idx` to the front, preserving the relative order of
// every other actor (Law M3). No-op if idx == 0. Caller has already checked
// idx is in range.
inline void move_to_front(Ring* r, int32_t idx) {
    if (!r || idx <= 0 || idx >= r->count) return;
    Actor moved = r->actors[idx];
    for (int32_t i = idx; i > 0; --i) r->actors[i] = r->actors[i - 1];
    r->actors[0] = moved;
}

// Insert a new actor at rank 0. Returns false if the ring is full or the id
// is already present (the caller distinguishes those two cases via the code
// table in machine.hpp).
inline bool insert_at_front(Ring* r, const Actor& a) {
    if (!r) return false;
    if (r->count + 1 > ATT_MAX_ACTORS) return false;
    for (int32_t i = 0; i < r->count; ++i) {
        if (actor_eq(r->actors[i], a)) return false;
    }
    for (int32_t i = r->count; i > 0; --i) r->actors[i] = r->actors[i - 1];
    r->actors[0] = a;
    r->count += 1;
    return true;
}

// Insert an actor at rank 1 while keeping rank 0 in place (input primacy,
// Law M6). Used by OPEN during input. Rejects duplicates and full rings.
inline bool insert_at_one(Ring* r, const Actor& a) {
    if (!r || r->count < 1) return false;
    if (r->count + 1 > ATT_MAX_ACTORS) return false;
    for (int32_t i = 0; i < r->count; ++i) {
        if (actor_eq(r->actors[i], a)) return false;
    }
    for (int32_t i = r->count; i > 1; --i) r->actors[i] = r->actors[i - 1];
    r->actors[1] = a;
    r->count += 1;
    return true;
}

// Remove the actor at index `idx`. Caller has already checked idx in range.
inline void remove_at(Ring* r, int32_t idx) {
    if (!r || idx < 0 || idx >= r->count) return;
    for (int32_t i = idx; i + 1 < r->count; ++i) r->actors[i] = r->actors[i + 1];
    r->count -= 1;
    zero_actor(&r->actors[r->count]);
}

// Rebuild `out` as [target, source, ...rest-without-either]. Used by FOCUS
// during a transfer (M13) and TRANSFER_PASTE.
inline bool pair_front(Ring* out, const Ring& in,
                       int32_t tCpLen, const int32_t* tCp,
                       int32_t sCpLen, const int32_t* sCp) {
    if (!out) return false;
    int32_t ti = rank_of(in, tCpLen, tCp);
    int32_t si = rank_of(in, sCpLen, sCp);
    if (ti < 0 || si < 0 || ti == si) return false;
    Ring tmp;
    zero_ring(&tmp);
    tmp.actors[0] = in.actors[ti];
    tmp.actors[1] = in.actors[si];
    tmp.count = 2;
    for (int32_t i = 0; i < in.count; ++i) {
        if (i == ti || i == si) continue;
        tmp.actors[tmp.count++] = in.actors[i];
    }
    *out = tmp;
    return true;
}

// docRank: rank among non-BAR actors. -1 for BAR or missing.
inline int32_t doc_rank(const Ring& r, int32_t cpLen, const int32_t* cp) {
    int32_t dRank = 0;
    for (int32_t i = 0; i < r.count; ++i) {
        if (r.actors[i].kind == KIND_BAR) continue;
        if (id_eq(r.actors[i], cpLen, cp)) return dRank;
        dRank += 1;
    }
    return -1;
}

} // namespace att

#endif
