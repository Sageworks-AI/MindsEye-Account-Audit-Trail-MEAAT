// Logical state model. Matches attention/js/machine.mjs's state shape one
// to one: ring of actors, bounded history of ring snapshots, optional input
// snapshot, optional transfer snapshot. All fixed-size arrays — the ABI
// layer never allocates. Sizes are chosen so worst-case depth-2 snapshot
// nesting fits in a stack local; see attention/ABI.md.
#ifndef ATTENTION_CPP_TYPES_HPP
#define ATTENTION_CPP_TYPES_HPP

#include <cstdint>

namespace att {

// ---- Enumerations (stable integers, mirrored in attention/ABI.md) ----
enum ActorKindInt {
    KIND_DOC = 0, KIND_FORM = 1, KIND_TRAIL = 2, KIND_BAR = 3,
};
enum EventTypeInt {
    EV_OPEN = 0, EV_CLOSE = 1, EV_FOCUS = 2, EV_INPUT_BEGIN = 3,
    EV_INPUT_END = 4, EV_TRANSFER_COPY = 5, EV_TRANSFER_PASTE = 6,
    EV_TRANSFER_CANCEL = 7, EV_BACK = 8, EV_RESIZE = 9,
};
enum FocusSourceInt {
    SRC_POINTER = 0, SRC_KEYBOARD = 1, SRC_COMMAND = 2, SRC_PROGRAMMATIC = 3,
};
enum InputChannelInt {
    CH_TEXT = 0, CH_VOICE = 1, CH_DOCUMENT = 2,
};
enum InputOutcomeInt {
    OUTCOME_COMMIT = 0, OUTCOME_CANCEL = 1,
};
enum PayloadKindInt {
    PAYLOAD_ENTRY = 0, PAYLOAD_ROWS = 1, PAYLOAD_ROW = 2,
    PAYLOAD_PERIOD = 3, PAYLOAD_NODE = 4,
};
enum OutcomeKindInt {
    OUTCOME_IMPACT = 0, OUTCOME_DRAFT_ENTRY = 1, OUTCOME_DRAFT_LINES = 2,
    OUTCOME_TRAIL_EDIT = 3, OUTCOME_PERIOD_CHANGE = 4,
};

// ---- Return codes (mirrored in attention/ABI.md) ----
enum ReturnCode {
    ATT_OK = 0,
    ATT_NOOP = 1,
    ATT_POINTER_STALE = 2,
    ATT_ALREADY_FOCUSED = 3,
    ATT_BAD_ACTOR = -1,
    ATT_BAD_EVENT = -2,
    ATT_TRANSFER_INVALID = -3,
    ATT_RING_FULL = -4,
    ATT_LAW_VIOLATION = -5,
    ATT_OVERFLOW = -6,
    ATT_OUTPUT_TOO_SMALL = -7,
};

// ---- Constants ----
constexpr int32_t ATT_MAX_ACTORS = 8;
constexpr int32_t ATT_HISTORY_DEPTH = 16;
constexpr int32_t ATT_MAX_ID_CP = 32;

// ---- Actor and ring ----
struct Actor {
    int32_t cpLen;                 // 0..ATT_MAX_ID_CP
    int32_t cp[ATT_MAX_ID_CP];     // code points; unused slots undefined
    int32_t kind;                  // ActorKindInt
};

struct Ring {
    int32_t count;                 // 0..ATT_MAX_ACTORS
    Actor actors[ATT_MAX_ACTORS];
};

struct History {
    int32_t depth;                 // 0..ATT_HISTORY_DEPTH
    Ring rings[ATT_HISTORY_DEPTH];
};

// ---- Snapshots ----
// A transfer's snapshot is the pre-arm state; by construction it cannot
// contain an input and its own transfer is always null. A basic snapshot
// therefore holds only ring / history / lastPointerEpoch.
struct BasicSnapshot {
    Ring ring;
    History history;
    int64_t lastPointerEpoch;
};

// An input's snapshot is the pre-input state, which may itself have a
// transfer armed. In that case the transfer is basic (no input, no nested
// transfer), so BasicSnapshot suffices for its snapshot.
struct NestedTransfer {
    int32_t active;                // 0 or 1
    Actor source;                  // valid if active
    int32_t payloadKind;           // valid if active
    BasicSnapshot snap;            // valid if active
};

struct FullSnapshot {
    Ring ring;
    History history;
    int64_t lastPointerEpoch;
    NestedTransfer transfer;       // active flag gates the rest
};

// ---- Working transfer (top level) ----
struct Transfer {
    int32_t active;                // 0 or 1
    Actor source;
    int32_t payloadKind;
    BasicSnapshot snap;
};

// ---- Working input (top level) ----
struct Input {
    int32_t active;                // 0 or 1
    int32_t channel;               // InputChannelInt
    FullSnapshot snap;
};

// ---- Top-level state ----
struct State {
    Ring ring;
    History history;
    int64_t lastPointerEpoch;
    Input input;
    Transfer transfer;
};

// Zero-initialise helpers. Every entry point that reads an incoming state
// must be sure every field is well-defined, so callers use these before
// populating fields.
inline void zero_actor(Actor* a) {
    if (!a) return;
    a->cpLen = 0;
    for (int32_t i = 0; i < ATT_MAX_ID_CP; ++i) a->cp[i] = 0;
    a->kind = KIND_DOC;
}
inline void zero_ring(Ring* r) {
    if (!r) return;
    r->count = 0;
    for (int32_t i = 0; i < ATT_MAX_ACTORS; ++i) zero_actor(&r->actors[i]);
}
inline void zero_history(History* h) {
    if (!h) return;
    h->depth = 0;
    for (int32_t i = 0; i < ATT_HISTORY_DEPTH; ++i) zero_ring(&h->rings[i]);
}
inline void zero_basic(BasicSnapshot* s) {
    if (!s) return;
    zero_ring(&s->ring);
    zero_history(&s->history);
    s->lastPointerEpoch = 0;
}
inline void zero_nested(NestedTransfer* t) {
    if (!t) return;
    t->active = 0;
    zero_actor(&t->source);
    t->payloadKind = 0;
    zero_basic(&t->snap);
}
inline void zero_full(FullSnapshot* f) {
    if (!f) return;
    zero_ring(&f->ring);
    zero_history(&f->history);
    f->lastPointerEpoch = 0;
    zero_nested(&f->transfer);
}
inline void zero_transfer(Transfer* t) {
    if (!t) return;
    t->active = 0;
    zero_actor(&t->source);
    t->payloadKind = 0;
    zero_basic(&t->snap);
}
inline void zero_input(Input* i) {
    if (!i) return;
    i->active = 0;
    i->channel = CH_TEXT;
    zero_full(&i->snap);
}
inline void zero_state(State* s) {
    if (!s) return;
    zero_ring(&s->ring);
    zero_history(&s->history);
    s->lastPointerEpoch = 0;
    zero_input(&s->input);
    zero_transfer(&s->transfer);
}

// ---- Comparisons (id equality, ring equality, history equality) ----
inline bool actor_eq(const Actor& a, const Actor& b) {
    if (a.kind != b.kind || a.cpLen != b.cpLen) return false;
    for (int32_t i = 0; i < a.cpLen; ++i) if (a.cp[i] != b.cp[i]) return false;
    return true;
}
inline bool id_eq(const Actor& a, int32_t cpLen, const int32_t* cp) {
    if (a.cpLen != cpLen) return false;
    for (int32_t i = 0; i < cpLen; ++i) if (a.cp[i] != cp[i]) return false;
    return true;
}
inline bool ring_eq(const Ring& a, const Ring& b) {
    if (a.count != b.count) return false;
    for (int32_t i = 0; i < a.count; ++i) if (!actor_eq(a.actors[i], b.actors[i])) return false;
    return true;
}
inline bool history_eq(const History& a, const History& b) {
    if (a.depth != b.depth) return false;
    for (int32_t i = 0; i < a.depth; ++i) if (!ring_eq(a.rings[i], b.rings[i])) return false;
    return true;
}

} // namespace att

#endif
