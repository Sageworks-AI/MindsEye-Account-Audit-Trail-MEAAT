// Event parsing. Reads the flat event layout from attention/ABI.md into a
// compact struct. Only the fields that the type uses are populated. Parsing
// rejects any malformed input by returning false; the machine maps that to
// ATT_BAD_EVENT.
#ifndef ATTENTION_CPP_EVENTS_HPP
#define ATTENTION_CPP_EVENTS_HPP

#include "types.hpp"
#include "cstr.hpp"

namespace att {

struct ParsedEvent {
    int32_t type;                  // EventTypeInt
    // OPEN
    Actor openActor;
    // CLOSE / FOCUS
    int32_t cpLen;
    int32_t cp[ATT_MAX_ID_CP];
    int32_t source;                // FOCUS
    int64_t pointerEpoch;          // FOCUS with source == pointer
    // INPUT_BEGIN / INPUT_END
    int32_t channel;
    int32_t outcome;
    // TRANSFER_COPY / TRANSFER_PASTE
    int32_t payloadKind;
    int32_t outcomeKind;
};

// Parses the event payload starting at `offset`. Returns false on malformed
// input or unknown type.
inline bool parse_event(int64_t const* in, int64_t inLen, int64_t* offset,
                        ParsedEvent* out) {
    if (!in || !offset || !out) return false;
    int64_t off = *offset;
    if (off >= inLen) return false;
    int64_t type = in[off++];
    if (type < EV_OPEN || type > EV_RESIZE) return false;
    out->type = (int32_t)type;

    switch (out->type) {
        case EV_OPEN: {
            Actor a;
            zero_actor(&a);
            // OPEN event: id, then kind (kind is a plain integer, not part of
            // an actor block).
            int32_t cps[ATT_MAX_ID_CP];
            int32_t cpl = 0;
            if (!parse_id(in, inLen, &off, cps, &cpl)) return false;
            a.cpLen = cpl;
            for (int32_t i = 0; i < cpl; ++i) a.cp[i] = cps[i];
            if (off >= inLen) return false;
            int64_t kind = in[off++];
            if (kind < KIND_DOC || kind > KIND_TRAIL) return false; // BAR not openable
            a.kind = (int32_t)kind;
            out->openActor = a;
            break;
        }
        case EV_CLOSE: {
            if (!parse_id(in, inLen, &off, out->cp, &out->cpLen)) return false;
            break;
        }
        case EV_FOCUS: {
            if (!parse_id(in, inLen, &off, out->cp, &out->cpLen)) return false;
            if (off >= inLen) return false;
            int64_t src = in[off++];
            if (src < SRC_POINTER || src > SRC_PROGRAMMATIC) return false;
            out->source = (int32_t)src;
            if (out->source == SRC_POINTER) {
                if (off >= inLen) return false;
                out->pointerEpoch = in[off++];
                if (out->pointerEpoch < 0) return false;
            } else {
                out->pointerEpoch = 0;
            }
            break;
        }
        case EV_INPUT_BEGIN: {
            if (off >= inLen) return false;
            int64_t ch = in[off++];
            if (ch < CH_TEXT || ch > CH_DOCUMENT) return false;
            out->channel = (int32_t)ch;
            break;
        }
        case EV_INPUT_END: {
            if (off >= inLen) return false;
            int64_t oc = in[off++];
            if (oc < OUTCOME_COMMIT || oc > OUTCOME_CANCEL) return false;
            out->outcome = (int32_t)oc;
            break;
        }
        case EV_TRANSFER_COPY: {
            if (!parse_id(in, inLen, &off, out->cp, &out->cpLen)) return false;
            if (off >= inLen) return false;
            int64_t pk = in[off++];
            if (pk < PAYLOAD_ENTRY || pk > PAYLOAD_NODE) return false;
            out->payloadKind = (int32_t)pk;
            break;
        }
        case EV_TRANSFER_PASTE: {
            if (!parse_id(in, inLen, &off, out->cp, &out->cpLen)) return false;
            if (off >= inLen) return false;
            int64_t ok = in[off++];
            if (ok < OUTCOME_IMPACT || ok > OUTCOME_PERIOD_CHANGE) return false;
            out->outcomeKind = (int32_t)ok;
            break;
        }
        case EV_TRANSFER_CANCEL:
        case EV_BACK:
        case EV_RESIZE:
            // no payload
            break;
        default:
            return false;
    }
    *offset = off;
    return true;
}

} // namespace att

#endif
