// C ABI for the attention layer. All state crosses as flat int64 arrays.
// The ABI itself allocates nothing: inputs and outputs share a fixed
// scratch buffer whose pointer and capacity the JS side queries once.
//
// Every function returns the OUTPUT LENGTH in int64 slots (>= 0) on success,
// or a negative error code. Inputs and outputs both start with a version
// word (= att_version()) so a mismatch is caught immediately.
//
// S8 correction: `emit_state` uses `emit_id` (no kind) for the transfer's
// source. The earlier version used `emit_actor`, which emitted an extra
// slot and desynced the parse that follows; `parse_state` uses `parse_id`
// for the same field, so emit and parse must agree.
#include <cstdint>
#include <cstring>

#include "export.hpp"
#include "types.hpp"
#include "cstr.hpp"
#include "events.hpp"
#include "machine.hpp"
#include "levels.hpp"
#include "contrast.hpp"

static int64_t g_scratch[65536]; // 512 KiB; documented in attention/ABI.md

static constexpr int64_t VERSION = 1;
static constexpr int64_t SCRATCH_SLOTS = 65536;
static constexpr int64_t E_BAD_VERSION      = -1;
static constexpr int64_t E_BAD_ARGUMENT     = -2;
static constexpr int64_t E_OUTPUT_TOO_SMALL = -7;

// State layout: lastPointerEpoch, ring, history, transferActive,
// [sourceId, payloadKind, basicSnapshot], inputActive, [channel, fullSnapshot].
// The transfer's source is emitted with emit_id (no kind).
static bool emit_state(int64_t* out, int64_t outLen, int64_t* offset,
                       const att::State& s) {
    int64_t off = *offset;
    if (off + 1 > outLen) return false;
    out[off++] = s.lastPointerEpoch;
    if (!att::emit_ring(out, outLen, &off, s.ring)) return false;
    if (!att::emit_history(out, outLen, &off, s.history)) return false;
    if (off + 1 > outLen) return false;
    out[off++] = s.transfer.active;
    if (s.transfer.active) {
        if (!att::emit_id(out, outLen, &off, s.transfer.source.cpLen, s.transfer.source.cp)) return false;
        if (off + 1 > outLen) return false;
        out[off++] = s.transfer.payloadKind;
        if (!att::emit_basic(out, outLen, &off, s.transfer.snap)) return false;
    }
    if (off + 1 > outLen) return false;
    out[off++] = s.input.active;
    if (s.input.active) {
        if (off + 1 > outLen) return false;
        out[off++] = s.input.channel;
        if (!att::emit_full(out, outLen, &off, s.input.snap)) return false;
    }
    *offset = off;
    return true;
}

static bool parse_state(int64_t const* in, int64_t inLen, int64_t* offset,
                        att::State* s) {
    att::zero_state(s);
    int64_t off = *offset;
    if (off >= inLen) return false;
    s->lastPointerEpoch = in[off++];
    if (!att::parse_ring(in, inLen, &off, &s->ring)) return false;
    if (!att::parse_history(in, inLen, &off, &s->history)) return false;
    if (off >= inLen) return false;
    int64_t tActive = in[off++];
    if (tActive != 0 && tActive != 1) return false;
    if (tActive) {
        int32_t cps[att::ATT_MAX_ID_CP];
        int32_t cpl = 0;
        if (!att::parse_id(in, inLen, &off, cps, &cpl)) return false;
        s->transfer.active = 1;
        s->transfer.source.cpLen = cpl;
        for (int32_t i = 0; i < cpl; ++i) s->transfer.source.cp[i] = cps[i];
        s->transfer.source.kind = att::KIND_DOC;
        if (off >= inLen) return false;
        s->transfer.payloadKind = (int32_t)in[off++];
        if (!att::parse_basic(in, inLen, &off, &s->transfer.snap)) return false;
    }
    if (off >= inLen) return false;
    int64_t iActive = in[off++];
    if (iActive != 0 && iActive != 1) return false;
    if (iActive) {
        if (off >= inLen) return false;
        s->input.active = 1;
        s->input.channel = (int32_t)in[off++];
        if (!att::parse_full(in, inLen, &off, &s->input.snap)) return false;
    }
    *offset = off;
    return true;
}

static bool emit_frame(int64_t* out, int64_t outLen, int64_t* offset,
                       const att::State& s) {
    int64_t off = *offset;
    if (off + 1 > outLen) return false;
    out[off++] = s.ring.count;
    for (int32_t rank = 0; rank < s.ring.count; ++rank) {
        const att::Actor& a = s.ring.actors[rank];
        if (!att::emit_actor(out, outLen, &off, a)) return false;
        int32_t level = rank < 2 ? rank : 2;
        int32_t dRank = (a.kind == att::KIND_BAR)
            ? -1 : att::doc_rank(s.ring, a.cpLen, a.cp);
        int32_t slot = (a.kind == att::KIND_BAR)
            ? -1 : (dRank == 0 ? 0 : dRank == 1 ? 1 : 2);
        const att::LevelRow& row = att::LEVELS.light.rows[level];
        if (off + 10 > outLen) return false;
        out[off++] = rank;
        out[off++] = level;
        out[off++] = dRank;
        out[off++] = slot;
        out[off++] = row.opacity;
        out[off++] = row.brightness;
        out[off++] = row.saturation;
        out[off++] = row.blur;
        out[off++] = row.shadow;
        out[off++] = row.radius;
    }
    *offset = off;
    return true;
}

static void emit_theme(int64_t* out, const att::ThemeTable& t, const att::Timing& timing) {
    int64_t p = 0;
    for (int32_t l = 0; l < 3; ++l) {
        out[p++] = t.rows[l].opacity;
        out[p++] = t.rows[l].brightness;
        out[p++] = t.rows[l].saturation;
        out[p++] = t.rows[l].blur;
        out[p++] = t.rows[l].shadow;
        out[p++] = t.rows[l].radius;
    }
    out[p++] = t.colors.fgR; out[p++] = t.colors.fgG; out[p++] = t.colors.fgB;
    out[p++] = t.colors.bgR; out[p++] = t.colors.bgG; out[p++] = t.colors.bgB;
    out[p++] = timing.focusMs; out[p++] = timing.inputBeginMs;
    out[p++] = timing.inputEndMs; out[p++] = timing.transferMs;
    out[p++] = timing.x1; out[p++] = timing.y1;
    out[p++] = timing.x2; out[p++] = timing.y2;
}

// S8 correction: shadow/radius accept up to 100000 cpt so the shipped
// levels.json (shadow 1800, radius 1050) parses. opacity/brightness/
// saturation/blur stay bounded to permille [0, 1000].
static bool parse_theme(int64_t const* in, int64_t inLen, int64_t offset,
                        att::ThemeTable* t, att::Timing* timing) {
    if (offset + 32 > inLen) return false;
    int64_t p = offset;
    for (int32_t l = 0; l < 3; ++l) {
        att::LevelRow& r = t->rows[l];
        r.opacity    = (int32_t)in[p++];
        r.brightness = (int32_t)in[p++];
        r.saturation = (int32_t)in[p++];
        r.blur       = (int32_t)in[p++];
        r.shadow     = (int32_t)in[p++];
        r.radius     = (int32_t)in[p++];
        if (r.opacity    < 0 || r.opacity    > 1000)   return false;
        if (r.brightness < 0 || r.brightness > 1000)   return false;
        if (r.saturation < 0 || r.saturation > 1000)   return false;
        if (r.blur       < 0 || r.blur       > 1000)   return false;
        if (r.shadow     < 0 || r.shadow     > 100000) return false;
        if (r.radius     < 0 || r.radius     > 100000) return false;
    }
    t->colors.fgR = (int32_t)in[p++]; t->colors.fgG = (int32_t)in[p++]; t->colors.fgB = (int32_t)in[p++];
    t->colors.bgR = (int32_t)in[p++]; t->colors.bgG = (int32_t)in[p++]; t->colors.bgB = (int32_t)in[p++];
    timing->focusMs = (int32_t)in[p++];
    timing->inputBeginMs = (int32_t)in[p++];
    timing->inputEndMs = (int32_t)in[p++];
    timing->transferMs = (int32_t)in[p++];
    timing->x1 = (int32_t)in[p++]; timing->y1 = (int32_t)in[p++];
    timing->x2 = (int32_t)in[p++]; timing->y2 = (int32_t)in[p++];
    return true;
}

ATT_EXPORT int64_t att_version(void) { return VERSION; }

ATT_EXPORT int64_t att_scratch_ptr(void) {
    return (int64_t)(uintptr_t)&g_scratch[0];
}

ATT_EXPORT int64_t att_scratch_size(void) { return SCRATCH_SLOTS; }

ATT_EXPORT int64_t att_levels_table(int64_t inLen) {
    if (inLen != 2) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    int64_t theme = in[1];
    if (theme != 0 && theme != 1) return E_BAD_ARGUMENT;
    if (inLen + 1 + 32 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    out[0] = VERSION;
    const att::ThemeTable& t = (theme == 0) ? att::LEVELS.light : att::LEVELS.dark;
    emit_theme(out + 1, t, att::LEVELS.timing);
    return 1 + 32;
}

ATT_EXPORT int64_t att_validate(int64_t inLen) {
    if (inLen != 33) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    att::LevelSet set = att::LEVELS;
    att::Timing timing = set.timing;
    if (!parse_theme(in, inLen, 1, &set.light, &timing)) return E_BAD_ARGUMENT;
    int32_t code = att::validate_level_set(set, /*prefersContrastMore=*/false);
    if (inLen + 2 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    out[0] = VERSION;
    out[1] = (int64_t)code;
    return 2;
}

ATT_EXPORT int64_t att_step(int64_t inLen) {
    if (inLen < 3) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;

    int64_t stateLen = in[1];
    if (stateLen < 0 || 2 + stateLen >= inLen) return E_BAD_ARGUMENT;
    int64_t stateOff = 2;

    att::State state;
    att::zero_state(&state);
    int64_t cursor = stateOff;
    if (!parse_state(in, inLen, &cursor, &state)) return E_BAD_ARGUMENT;
    if (cursor != stateOff + stateLen) return E_BAD_ARGUMENT;

    int64_t eventLen = in[cursor++];
    if (eventLen < 1 || cursor + eventLen != inLen) return E_BAD_ARGUMENT;
    att::ParsedEvent evt;
    std::memset(&evt, 0, sizeof(evt));
    int64_t evtCursor = cursor;
    if (!att::parse_event(in, inLen, &evtCursor, &evt)) return E_BAD_ARGUMENT;
    if (evtCursor != cursor + eventLen) return E_BAD_ARGUMENT;

    att::State preState = state;
    int32_t rc = att::step(&state, evt);

    const att::State& outState =
        (rc == att::ATT_OK || rc == att::ATT_NOOP ||
         rc == att::ATT_ALREADY_FOCUSED || rc == att::ATT_POINTER_STALE)
            ? state : preState;

    int64_t writeStart = inLen;
    if (writeStart + 3 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + writeStart;
    out[0] = VERSION;
    out[1] = (int64_t)rc;

    int64_t stateStart = 3;
    int64_t stateCursor = stateStart;
    int64_t outStateLen = 0;
    if (rc == att::ATT_OK || rc == att::ATT_NOOP ||
        rc == att::ATT_ALREADY_FOCUSED || rc == att::ATT_POINTER_STALE) {
        if (!emit_state(out, SCRATCH_SLOTS - writeStart, &stateCursor, outState)) {
            return E_OUTPUT_TOO_SMALL;
        }
        outStateLen = stateCursor - stateStart;
    }
    out[2] = outStateLen;

    int64_t frameStart = stateCursor;
    int64_t frameCursor = frameStart;
    if (!emit_frame(out, SCRATCH_SLOTS - writeStart, &frameCursor, outState)) {
        return E_OUTPUT_TOO_SMALL;
    }
    int64_t frameLen = frameCursor - frameStart;

    if (frameCursor + 1 > SCRATCH_SLOTS - writeStart) return E_OUTPUT_TOO_SMALL;
    for (int64_t i = frameCursor; i > frameStart; --i) out[i] = out[i - 1];
    out[frameStart] = frameLen;

    return 5 + outStateLen + frameLen;
}
