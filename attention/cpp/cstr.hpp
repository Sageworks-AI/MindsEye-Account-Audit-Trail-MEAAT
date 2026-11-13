// Code-point array parsing and emission for the ABI. Code points are int64
// in the flat array; we store them as int32 internally because 0x10FFFF is
// well under INT32_MAX and any code point outside that range is rejected by
// the parser (matching the JS twin's `cp < 0 || cp > 0x10FFFF` check).
//
// S8 correction: `emit_id` emits only `cpLen, cps` (no kind). `emit_full`
// uses `emit_id` for a nested transfer's source, matching the shape that
// `parse_full` expects via `parse_id`. Using `emit_actor` there emitted an
// extra kind slot and corrupted every subsequent field. `emit_actor` is
// still used for ring actors, where the kind is part of the record.
#ifndef ATTENTION_CPP_CSTR_HPP
#define ATTENTION_CPP_CSTR_HPP

#include <cstdint>
#include "types.hpp"

namespace att {

// Read a code-point array from `in[offset..]`, producing an Actor with the
// given kind. Advances `offset` past the consumed slots (1 length slot +
// cpLen code-point slots). Returns false on malformed input.
inline bool parse_actor(int64_t const* in, int64_t inLen, int64_t* offset,
                        Actor* out, int32_t kind) {
    if (!in || !offset || !out) return false;
    int64_t off = *offset;
    if (off < 0 || off >= inLen) return false;
    int64_t cpLen64 = in[off++];
    if (cpLen64 < 0 || cpLen64 > ATT_MAX_ID_CP) return false;
    if (off + cpLen64 > inLen) return false;
    out->cpLen = (int32_t)cpLen64;
    for (int32_t i = 0; i < out->cpLen; ++i) {
        int64_t c = in[off++];
        if (c < 0 || c > 0x10FFFF) return false;
        out->cp[i] = (int32_t)c;
    }
    out->kind = kind;
    *offset = off;
    return true;
}

// Read a code-point array with no kind (used for CLOSE, FOCUS, TRANSFER_COPY,
// TRANSFER_PASTE, and transfer-source ids in states/snapshots).
inline bool parse_id(int64_t const* in, int64_t inLen, int64_t* offset,
                     int32_t* outCp, int32_t* outLen) {
    if (!in || !offset || !outCp || !outLen) return false;
    int64_t off = *offset;
    if (off < 0 || off >= inLen) return false;
    int64_t cpLen64 = in[off++];
    if (cpLen64 < 0 || cpLen64 > ATT_MAX_ID_CP) return false;
    if (off + cpLen64 > inLen) return false;
    *outLen = (int32_t)cpLen64;
    for (int32_t i = 0; i < *outLen; ++i) {
        int64_t c = in[off++];
        if (c < 0 || c > 0x10FFFF) return false;
        outCp[i] = (int32_t)c;
    }
    *offset = off;
    return true;
}

// Emit an id and a kind. Used for ring actors. Caller must have capacity.
inline bool emit_actor(int64_t* out, int64_t outLen, int64_t* offset,
                       const Actor& a) {
    if (!out || !offset) return false;
    int64_t off = *offset;
    if (a.cpLen < 0 || a.cpLen > ATT_MAX_ID_CP) return false;
    if (off + 1 + a.cpLen + 1 > outLen) return false;
    out[off++] = a.cpLen;
    for (int32_t i = 0; i < a.cpLen; ++i) out[off++] = a.cp[i];
    out[off++] = a.kind;
    *offset = off;
    return true;
}

// Emit an id (no kind). Used for transfer sources, where the kind is
// redundant (source is at rank 0 of the ring and the twin stores only id).
inline bool emit_id(int64_t* out, int64_t outLen, int64_t* offset,
                    int32_t cpLen, const int32_t* cp) {
    if (!out || !offset) return false;
    if (cpLen < 0 || cpLen > ATT_MAX_ID_CP) return false;
    if (off_of(offset) + 1 + cpLen > outLen) return false;
    int64_t off = *offset;
    out[off++] = cpLen;
    for (int32_t i = 0; i < cpLen; ++i) out[off++] = cp[i];
    *offset = off;
    return true;
}

inline bool emit_ring(int64_t* out, int64_t outLen, int64_t* offset,
                      const Ring& r) {
    if (!out || !offset) return false;
    int64_t off = *offset;
    if (off >= outLen) return false;
    out[off++] = r.count;
    for (int32_t i = 0; i < r.count; ++i) {
        if (!emit_actor(out, outLen, &off, r.actors[i])) return false;
    }
    *offset = off;
    return true;
}

inline bool emit_history(int64_t* out, int64_t outLen, int64_t* offset,
                         const History& h) {
    if (!out || !offset) return false;
    int64_t off = *offset;
    if (off >= outLen) return false;
    out[off++] = h.depth;
    for (int32_t i = 0; i < h.depth; ++i) {
        if (!emit_ring(out, outLen, &off, h.rings[i])) return false;
    }
    *offset = off;
    return true;
}

inline bool emit_basic(int64_t* out, int64_t outLen, int64_t* offset,
                       const BasicSnapshot& s) {
    if (!emit_ring(out, outLen, offset, s.ring)) return false;
    if (!emit_history(out, outLen, offset, s.history)) return false;
    int64_t off = *offset;
    if (off >= outLen) return false;
    out[off++] = s.lastPointerEpoch;
    *offset = off;
    return true;
}

// Full snapshot layout: ring, history, lastPointerEpoch, transferActive,
// [if active: idOnly, payloadKind, basicSnapshot]. The transfer's source is
// emitted with `emit_id` (no kind), matching `parse_full`'s `parse_id`.
inline bool emit_full(int64_t* out, int64_t outLen, int64_t* offset,
                      const FullSnapshot& f) {
    if (!emit_ring(out, outLen, offset, f.ring)) return false;
    if (!emit_history(out, outLen, offset, f.history)) return false;
    int64_t off = *offset;
    if (off >= outLen) return false;
    out[off++] = f.lastPointerEpoch;
    if (off >= outLen) return false;
    out[off++] = f.transfer.active;
    if (f.transfer.active) {
        if (!emit_id(out, outLen, &off, f.transfer.source.cpLen, f.transfer.source.cp)) return false;
        if (off >= outLen) return false;
        out[off++] = f.transfer.payloadKind;
        if (!emit_basic(out, outLen, &off, f.transfer.snap)) return false;
    }
    *offset = off;
    return true;
}

// ---- Parsers (mirror of the emitters above) ----

inline bool parse_ring(int64_t const* in, int64_t inLen, int64_t* offset, Ring* out) {
    if (!in || !offset || !out) return false;
    int64_t off = *offset;
    if (off >= inLen) return false;
    int64_t c = in[off++];
    if (c < 0 || c > ATT_MAX_ACTORS) return false;
    out->count = (int32_t)c;
    for (int32_t i = 0; i < out->count; ++i) {
        int32_t cps[ATT_MAX_ID_CP];
        int32_t cpl = 0;
        if (!parse_id(in, inLen, &off, cps, &cpl)) return false;
        if (off >= inLen) return false;
        int64_t kind = in[off++];
        if (kind < KIND_DOC || kind > KIND_BAR) return false;
        Actor& a = out->actors[i];
        a.cpLen = cpl;
        for (int32_t k = 0; k < cpl; ++k) a.cp[k] = cps[k];
        a.kind = (int32_t)kind;
    }
    *offset = off;
    return true;
}

inline bool parse_history(int64_t const* in, int64_t inLen, int64_t* offset, History* out) {
    if (!in || !offset || !out) return false;
    int64_t off = *offset;
    if (off >= inLen) return false;
    int64_t d = in[off++];
    if (d < 0 || d > ATT_HISTORY_DEPTH) return false;
    out->depth = (int32_t)d;
    for (int32_t i = 0; i < out->depth; ++i) {
        if (!parse_ring(in, inLen, &off, &out->rings[i])) return false;
    }
    *offset = off;
    return true;
}

inline bool parse_basic(int64_t const* in, int64_t inLen, int64_t* offset, BasicSnapshot* out) {
    if (!parse_ring(in, inLen, offset, &out->ring)) return false;
    if (!parse_history(in, inLen, offset, &out->history)) return false;
    int64_t off = *offset;
    if (off >= inLen) return false;
    out->lastPointerEpoch = in[off++];
    *offset = off;
    return true;
}

inline bool parse_full(int64_t const* in, int64_t inLen, int64_t* offset, FullSnapshot* out) {
    if (!parse_ring(in, inLen, offset, &out->ring)) return false;
    if (!parse_history(in, inLen, offset, &out->history)) return false;
    int64_t off = *offset;
    if (off >= inLen) return false;
    out->lastPointerEpoch = in[off++];
    if (off >= inLen) return false;
    out->transfer.active = (int32_t)in[off++];
    if (out->transfer.active) {
        int32_t cps[ATT_MAX_ID_CP];
        int32_t cpl = 0;
        if (!parse_id(in, inLen, &off, cps, &cpl)) return false;
        out->transfer.source.cpLen = cpl;
        for (int32_t i = 0; i < cpl; ++i) out->transfer.source.cp[i] = cps[i];
        out->transfer.source.kind = KIND_DOC; // unused for transfers
        if (off >= inLen) return false;
        out->transfer.payloadKind = (int32_t)in[off++];
        if (!parse_basic(in, inLen, &off, &out->transfer.snap)) return false;
    }
    *offset = off;
    return true;
}

} // namespace att

#endif
