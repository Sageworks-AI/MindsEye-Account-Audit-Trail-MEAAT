// The attention state machine. One pure step per event. Returns the ABI
// return code; on error the input state is not modified (the caller
// reuses its own state). On success, `state` is overwritten with the new
// frozen-equivalent state.
//
// Byte-identical to attention/js/machine.mjs. Every branch here has a
// sibling branch there; parity tests replay the same events through both
// and compare state hashes plus frames. The correctness of "history_push
// receives the pre-move ring" was the source of one rewrite during
// development; the twin's `const newHistory = pushHistory(state.history,
// state.ring);` line shows the intent unambiguously.
#ifndef ATTENTION_CPP_MACHINE_HPP
#define ATTENTION_CPP_MACHINE_HPP

#include "types.hpp"
#include "ring.hpp"
#include "history.hpp"
#include "transfer.hpp"
#include "events.hpp"

namespace att {

inline int32_t transfer_expected_outcome(int32_t payloadKind, int32_t targetKind) {
    switch (payloadKind) {
        case PAYLOAD_ENTRY:
            if (targetKind == KIND_DOC) return OUTCOME_IMPACT;
            if (targetKind == KIND_FORM) return OUTCOME_DRAFT_ENTRY;
            return -1;
        case PAYLOAD_ROWS:
        case PAYLOAD_ROW:
            if (targetKind == KIND_FORM) return OUTCOME_DRAFT_LINES;
            if (targetKind == KIND_TRAIL) return OUTCOME_TRAIL_EDIT;
            return -1;
        case PAYLOAD_PERIOD:
            if (targetKind == KIND_DOC) return OUTCOME_PERIOD_CHANGE;
            return -1;
        case PAYLOAD_NODE:
            if (targetKind == KIND_TRAIL) return OUTCOME_TRAIL_EDIT;
            return -1;
        default:
            return -1;
    }
}

inline void capture_nested_transfer(const State& s, NestedTransfer* nt) {
    zero_nested(nt);
    if (!s.transfer.active) return;
    nt->active = 1;
    nt->source = s.transfer.source;
    nt->payloadKind = s.transfer.payloadKind;
    nt->snap = s.transfer.snap;
}

inline void restore_input_snapshot(State* s, const FullSnapshot& snap) {
    s->ring = snap.ring;
    s->history = snap.history;
    s->lastPointerEpoch = snap.lastPointerEpoch;
    s->input.active = 0;
    s->input.channel = CH_TEXT;
    zero_full(&s->input.snap);
    zero_transfer(&s->transfer);
    if (snap.transfer.active) {
        s->transfer.active = 1;
        s->transfer.source = snap.transfer.source;
        s->transfer.payloadKind = snap.transfer.payloadKind;
        s->transfer.snap = snap.transfer.snap;
    }
}

inline void restore_basic_snapshot(State* s, const BasicSnapshot& snap) {
    s->ring = snap.ring;
    s->history = snap.history;
    s->lastPointerEpoch = snap.lastPointerEpoch;
    s->input.active = 0;
    s->input.channel = CH_TEXT;
    zero_full(&s->input.snap);
    zero_transfer(&s->transfer);
}

inline void capture_basic_snapshot(const State& s, BasicSnapshot* snap) {
    snap->ring = s.ring;
    snap->history = s.history;
    snap->lastPointerEpoch = s.lastPointerEpoch;
}

inline void capture_full_snapshot(const State& s, FullSnapshot* snap) {
    snap->ring = s.ring;
    snap->history = s.history;
    snap->lastPointerEpoch = s.lastPointerEpoch;
    capture_nested_transfer(s, &snap->transfer);
}

inline bool ring_after_input_focus(Ring* out, const Ring& in,
                                   int32_t cpLen, const int32_t* cp) {
    if (in.count < 1) return false;
    if (in.actors[0].kind != KIND_BAR) return false;
    if (in.count >= 2 && id_eq(in.actors[1], cpLen, cp)) return false;
    const Actor* x = find_by_id(in, cpLen, cp);
    if (!x) return false;
    Ring tmp;
    zero_ring(&tmp);
    tmp.actors[0] = in.actors[0];
    tmp.actors[1] = *x;
    tmp.count = 2;
    for (int32_t i = 1; i < in.count; ++i) {
        if (id_eq(in.actors[i], cpLen, cp)) continue;
        tmp.actors[tmp.count++] = in.actors[i];
    }
    *out = tmp;
    return true;
}

inline int32_t step(State* state, const ParsedEvent& evt);

inline int32_t step_back(State* s) {
    if (s->input.active) {
        ParsedEvent ev;
        ev.type = EV_INPUT_END;
        ev.outcome = OUTCOME_CANCEL;
        return step(s, ev);
    }
    if (s->transfer.active) {
        restore_basic_snapshot(s, s->transfer.snap);
        return ATT_OK;
    }
    Ring popped;
    zero_ring(&popped);
    if (!history_pop(&s->history, &popped)) return ATT_NOOP;
    s->ring = popped;
    return ATT_OK;
}

inline int32_t step(State* s, const ParsedEvent& evt) {
    if (!s) return ATT_BAD_EVENT;
    switch (evt.type) {
        case EV_OPEN: {
            if (find_by_id(s->ring, evt.openActor.cpLen, evt.openActor.cp)) {
                return ATT_BAD_ACTOR;
            }
            bool ok = s->input.active
                ? insert_at_one(&s->ring, evt.openActor)
                : insert_at_front(&s->ring, evt.openActor);
            return ok ? ATT_OK : ATT_RING_FULL;
        }
        case EV_CLOSE: {
            int32_t idx = rank_of(s->ring, evt.cpLen, evt.cp);
            if (idx < 0) return ATT_BAD_ACTOR;
            if (s->ring.actors[idx].kind == KIND_BAR) return ATT_BAD_ACTOR;
            if (s->transfer.active &&
                id_eq(s->transfer.source, evt.cpLen, evt.cp)) {
                restore_basic_snapshot(s, s->transfer.snap);
                idx = rank_of(s->ring, evt.cpLen, evt.cp);
                if (idx < 0) return ATT_BAD_ACTOR;
            }
            remove_at(&s->ring, idx);
            return ATT_OK;
        }
        case EV_FOCUS: {
            const Actor* a = find_by_id(s->ring, evt.cpLen, evt.cp);
            if (!a) return ATT_BAD_ACTOR;
            if (a->kind == KIND_BAR) return ATT_BAD_ACTOR;
            if (evt.source == SRC_POINTER && evt.pointerEpoch <= s->lastPointerEpoch) {
                return ATT_POINTER_STALE;
            }
            int64_t newEpoch = (evt.source == SRC_POINTER)
                ? evt.pointerEpoch : s->lastPointerEpoch;

            if (s->input.active) {
                Ring newRing;
                zero_ring(&newRing);
                if (!ring_after_input_focus(&newRing, s->ring, evt.cpLen, evt.cp)) {
                    return ATT_NOOP;
                }
                history_push(&s->history, s->ring);
                s->ring = newRing;
                s->lastPointerEpoch = newEpoch;
                return ATT_OK;
            }
            if (s->transfer.active) {
                if (id_eq(s->transfer.source, evt.cpLen, evt.cp)) return ATT_NOOP;
                Ring newRing;
                zero_ring(&newRing);
                if (!pair_front(&newRing, s->ring, evt.cpLen, evt.cp,
                                s->transfer.source.cpLen, s->transfer.source.cp)) {
                    return ATT_LAW_VIOLATION;
                }
                history_push(&s->history, s->ring);
                s->ring = newRing;
                s->lastPointerEpoch = newEpoch;
                return ATT_OK;
            }
            if (rank_of(s->ring, evt.cpLen, evt.cp) == 0) {
                return ATT_ALREADY_FOCUSED;
            }
            Ring preMove = s->ring;
            int32_t idx = rank_of(s->ring, evt.cpLen, evt.cp);
            move_to_front(&s->ring, idx);
            history_push(&s->history, preMove);
            s->lastPointerEpoch = newEpoch;
            return ATT_OK;
        }
        case EV_INPUT_BEGIN: {
            if (s->input.active) return ATT_BAD_EVENT;
            if (find_by_id(s->ring, 3, (const int32_t[]){ 'B', 'A', 'R' })) {
                return ATT_LAW_VIOLATION;
            }
            FullSnapshot snap;
            zero_full(&snap);
            capture_full_snapshot(*s, &snap);
            Actor bar;
            zero_actor(&bar);
            bar.cpLen = 3;
            bar.cp[0] = 'B'; bar.cp[1] = 'A'; bar.cp[2] = 'R';
            bar.kind = KIND_BAR;
            if (!insert_at_front(&s->ring, bar)) return ATT_RING_FULL;
            s->input.active = 1;
            s->input.channel = evt.channel;
            s->input.snap = snap;
            return ATT_OK;
        }
        case EV_INPUT_END: {
            if (!s->input.active) return ATT_BAD_EVENT;
            if (evt.outcome == OUTCOME_CANCEL) {
                FullSnapshot snap = s->input.snap;
                restore_input_snapshot(s, snap);
                return ATT_OK;
            }
            int32_t idx = rank_of(s->ring, 3, (const int32_t[]){ 'B', 'A', 'R' });
            if (idx < 0) return ATT_LAW_VIOLATION;
            remove_at(&s->ring, idx);
            s->input.active = 0;
            s->input.channel = CH_TEXT;
            zero_full(&s->input.snap);
            return ATT_OK;
        }
        case EV_TRANSFER_COPY: {
            if (s->transfer.active || s->input.active) return ATT_TRANSFER_INVALID;
            int32_t nonBar = 0;
            for (int32_t i = 0; i < s->ring.count; ++i) {
                if (s->ring.actors[i].kind != KIND_BAR) nonBar += 1;
            }
            if (nonBar < 2) return ATT_TRANSFER_INVALID;
            const Actor* source = find_by_id(s->ring, evt.cpLen, evt.cp);
            if (!source || source->kind == KIND_BAR) return ATT_BAD_ACTOR;
            BasicSnapshot snap;
            capture_basic_snapshot(*s, &snap);
            Actor src = *source;
            if (!transfer_arm(&s->ring, src, evt.payloadKind, &s->transfer)) {
                return ATT_TRANSFER_INVALID;
            }
            s->transfer.snap = snap;
            return ATT_OK;
        }
        case EV_TRANSFER_PASTE: {
            if (!s->transfer.active || s->input.active) return ATT_TRANSFER_INVALID;
            const Actor* target = find_by_id(s->ring, evt.cpLen, evt.cp);
            if (!target) return ATT_BAD_ACTOR;
            if (id_eq(s->transfer.source, evt.cpLen, evt.cp)) return ATT_TRANSFER_INVALID;
            int32_t expected = transfer_expected_outcome(s->transfer.payloadKind, target->kind);
            if (expected < 0 || expected != evt.outcomeKind) return ATT_TRANSFER_INVALID;
            Ring newRing;
            zero_ring(&newRing);
            if (!pair_front(&newRing, s->ring, evt.cpLen, evt.cp,
                            s->transfer.source.cpLen, s->transfer.source.cp)) {
                return ATT_LAW_VIOLATION;
            }
            history_push(&s->history, s->ring);
            s->ring = newRing;
            transfer_clear(&s->transfer);
            return ATT_OK;
        }
        case EV_TRANSFER_CANCEL: {
            if (!s->transfer.active) return ATT_NOOP;
            BasicSnapshot snap = s->transfer.snap;
            restore_basic_snapshot(s, snap);
            return ATT_OK;
        }
        case EV_BACK:
            return step_back(s);
        case EV_RESIZE:
            return ATT_NOOP;
    }
    return ATT_BAD_EVENT;
}

} // namespace att

#endif
