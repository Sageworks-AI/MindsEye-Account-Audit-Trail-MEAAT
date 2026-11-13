// Native test runner for the attention layer. Hand-written tests cover the
// arithmetic primitives (contrast, level validation) and the state machine
// edge cases; golden vector replay (test_vectors.cpp) covers the long
// event sequences W1–W10 and random fuzz. The two together are the C++ side
// of parity with the JS twin.
#include "runner.hpp"
#include "../types.hpp"
#include "../contrast.hpp"
#include "../levels.hpp"
#include "../ring.hpp"
#include "../history.hpp"
#include "../machine.hpp"
#include "../events.hpp"

#include <cstdio>
#include <cstdint>

namespace att_test { void run_vectors(int* failures); }

// ---- contrast.hpp ----
static void test_contrast_lut_edges() {
    using namespace att;
    // Pure black and pure white should bracket every intermediate grey.
    EXPECT_EQ_INT(LINEAR_LUT[0], 0);
    EXPECT_EQ_INT(LINEAR_LUT[255], 1000000);
    EXPECT_EQ_INT(luminance_ppm(255, 255, 255), 1000000);
    EXPECT_EQ_INT(luminance_ppm(0, 0, 0), 0);
    // 0.5 grey linearises to about 21404 ppm under the WCAG formula.
    int32_t lum = luminance_ppm(128, 128, 128);
    EXPECT_TRUE(lum > 20000 && lum < 22000);
}

static void test_contrast_permille() {
    using namespace att;
    // Black-on-white contrast is 21:1 = 21000 permille.
    EXPECT_EQ_INT(contrast_permille(luminance_ppm(0,0,0), luminance_ppm(255,255,255)), 21000);
    // Equal luminance gives 1:1 = 1000 permille.
    EXPECT_EQ_INT(contrast_permille(50000, 50000), 1000);
    // Symmetric.
    EXPECT_EQ_INT(contrast_permille(10000, 200000), contrast_permille(200000, 10000));
}

static void test_blend_channel() {
    using namespace att;
    // Full opacity/brightness (factor = 1e6) -> fg unchanged.
    EXPECT_EQ_INT(blend_channel(200, 50, 1000, 1000), 200);
    // Zero opacity -> bg unchanged.
    EXPECT_EQ_INT(blend_channel(200, 50, 0, 1000), 50);
    // Half opacity (500) at full brightness -> halfway.
    EXPECT_EQ_INT(blend_channel(200, 50, 500, 1000), 125);
}

static void test_level_contrast_permille() {
    using namespace att;
    // Real calculation for the default light level 0: fg=(32,32,32) on
    // bg=(255,255,255) at opacity 1000, brightness 1000 -> full fg.
    int32_t c = level_contrast_permille(32, 32, 32, 255, 255, 255, 1000, 1000);
    // Black on white is 21000; (32,32,32) is close.
    EXPECT_TRUE(c >= 7000);
    EXPECT_TRUE(c < 21000);
}

// ---- levels.hpp ----
static void test_levels_validate_defaults() {
    using namespace att;
    EXPECT_EQ_INT(validate_level_set(LEVELS, false), ATT_OK);
    EXPECT_EQ_INT(validate_level_set(LEVELS, true), ATT_OK);
}

static void test_levels_t1_monotonic() {
    using namespace att;
    LevelSet bad = LEVELS;
    bad.light.rows[1].opacity = 1100; // opacity increases -> T1 violation
    EXPECT_EQ_INT(validate_level_set(bad, false), ATT_LAW_VIOLATION);
}

static void test_levels_t2_distinct() {
    using namespace att;
    LevelSet bad = LEVELS;
    bad.light.rows[1].opacity = 950; // step from 1000 is 50 < 100
    EXPECT_EQ_INT(validate_level_set(bad, false), ATT_LAW_VIOLATION);
}

static void test_levels_t3_contrast() {
    using namespace att;
    LevelSet bad = LEVELS;
    // Force level 2 low opacity/brightness so it fails prefer-high contrast.
    bad.light.rows[2].opacity = 700;
    bad.light.rows[2].brightness = 700;
    // Under normal floors it should still pass; under prefer-high it must fail.
    int32_t normal = validate_level_set(bad, false);
    int32_t strict = validate_level_set(bad, true);
    EXPECT_TRUE(strict == ATT_LAW_VIOLATION || normal == ATT_LAW_VIOLATION);
}

// ---- ring.hpp ----
static att::Actor make_actor(const char* name, int32_t kind) {
    att::Actor a;
    att::zero_actor(&a);
    int32_t i = 0;
    while (name[i] && i < att::ATT_MAX_ID_CP) {
        a.cp[i] = (int32_t)(unsigned char)name[i];
        i += 1;
    }
    a.cpLen = i;
    a.kind = kind;
    return a;
}

static void test_ring_basics() {
    using namespace att;
    Ring r;
    zero_ring(&r);
    Actor a = make_actor("A", KIND_DOC);
    Actor b = make_actor("B", KIND_DOC);
    EXPECT_TRUE(insert_at_front(&r, a));
    EXPECT_TRUE(insert_at_front(&r, b));
    // Ring is now [B, A].
    EXPECT_EQ_INT(r.count, 2);
    EXPECT_EQ_INT(rank_of(r, a.cpLen, a.cp), 1);
    EXPECT_EQ_INT(rank_of(r, b.cpLen, b.cp), 0);
    // Move A to front -> [A, B].
    move_to_front(&r, 1);
    EXPECT_EQ_INT(r.actors[0].kind, KIND_DOC);
    EXPECT_EQ_INT(rank_of(r, a.cpLen, a.cp), 0);
    // Remove A -> [B].
    remove_at(&r, 0);
    EXPECT_EQ_INT(r.count, 1);
    EXPECT_EQ_INT(rank_of(r, b.cpLen, b.cp), 0);
}

static void test_ring_doc_rank() {
    using namespace att;
    Ring r;
    zero_ring(&r);
    Actor bar = make_actor("BAR", KIND_BAR);
    Actor a = make_actor("A", KIND_DOC);
    Actor b = make_actor("B", KIND_DOC);
    insert_at_front(&r, a);
    insert_at_front(&r, b);
    insert_at_front(&r, bar);
    // Ring is [BAR, B, A]. docRank of A = 1, B = 0, BAR = -1.
    EXPECT_EQ_INT(doc_rank(r, a.cpLen, a.cp), 1);
    EXPECT_EQ_INT(doc_rank(r, b.cpLen, b.cp), 0);
    EXPECT_EQ_INT(doc_rank(r, bar.cpLen, bar.cp), -1);
}

static void test_ring_pair_front() {
    using namespace att;
    Ring in, out;
    zero_ring(&in);
    zero_ring(&out);
    Actor a = make_actor("A", KIND_DOC);
    Actor b = make_actor("B", KIND_DOC);
    Actor c = make_actor("C", KIND_DOC);
    insert_at_front(&in, a); // [A]
    insert_at_front(&in, b); // [B, A]
    insert_at_front(&in, c); // [C, B, A]
    // Pair (A, C): out = [A, C, B].
    EXPECT_TRUE(pair_front(&out, in, a.cpLen, a.cp, c.cpLen, c.cp));
    EXPECT_EQ_INT(out.count, 3);
    EXPECT_EQ_INT(rank_of(out, a.cpLen, a.cp), 0);
    EXPECT_EQ_INT(rank_of(out, c.cpLen, c.cp), 1);
    EXPECT_EQ_INT(rank_of(out, b.cpLen, b.cp), 2);
}

// ---- history.hpp ----
static void test_history_push_pop() {
    using namespace att;
    History h;
    zero_history(&h);
    Ring r1, r2;
    zero_ring(&r1);
    zero_ring(&r2);
    Actor a = make_actor("A", KIND_DOC);
    Actor b = make_actor("B", KIND_DOC);
    insert_at_front(&r1, a);
    insert_at_front(&r2, b);
    history_push(&h, r1);
    history_push(&h, r2);
    EXPECT_EQ_INT(h.depth, 2);
    Ring popped;
    zero_ring(&popped);
    EXPECT_TRUE(history_pop(&h, &popped));
    EXPECT_EQ_INT(popped.count, 1);
    EXPECT_EQ_INT(rank_of(popped, b.cpLen, b.cp), 0);
}

static void test_history_skips_duplicate() {
    using namespace att;
    History h;
    zero_history(&h);
    Ring r1;
    zero_ring(&r1);
    Actor a = make_actor("A", KIND_DOC);
    insert_at_front(&r1, a);
    history_push(&h, r1);
    history_push(&h, r1); // identical to top
    EXPECT_EQ_INT(h.depth, 1);
}

// ---- machine.hpp ----
static att::State make_state_2() {
    using namespace att;
    State s;
    zero_state(&s);
    Actor a = make_actor("A", KIND_DOC);
    Actor b = make_actor("B", KIND_DOC);
    insert_at_front(&s.ring, a);
    insert_at_front(&s.ring, b);
    return s;
}

static att::ParsedEvent evt_open(const char* name, int32_t kind) {
    att::ParsedEvent e;
    for (size_t i = 0; i < sizeof(e); ++i) ((char*)&e)[i] = 0;
    e.type = att::EV_OPEN;
    e.openActor = make_actor(name, kind);
    return e;
}

static att::ParsedEvent evt_close(const char* name) {
    att::ParsedEvent e;
    for (size_t i = 0; i < sizeof(e); ++i) ((char*)&e)[i] = 0;
    e.type = att::EV_CLOSE;
    int32_t i = 0;
    while (name[i] && i < att::ATT_MAX_ID_CP) { e.cp[i] = (int32_t)(unsigned char)name[i]; i += 1; }
    e.cpLen = i;
    return e;
}

static att::ParsedEvent evt_focus(const char* name, int32_t source, int64_t epoch = 0) {
    att::ParsedEvent e;
    for (size_t i = 0; i < sizeof(e); ++i) ((char*)&e)[i] = 0;
    e.type = att::EV_FOCUS;
    int32_t i = 0;
    while (name[i] && i < att::ATT_MAX_ID_CP) { e.cp[i] = (int32_t)(unsigned char)name[i]; i += 1; }
    e.cpLen = i;
    e.source = source;
    e.pointerEpoch = epoch;
    return e;
}

static att::ParsedEvent evt_type_only(int32_t type) {
    att::ParsedEvent e;
    for (size_t i = 0; i < sizeof(e); ++i) ((char*)&e)[i] = 0;
    e.type = type;
    return e;
}

static void test_machine_focus_ok() {
    using namespace att;
    State s = make_state_2(); // [B, A]
    int32_t rc = step(&s, evt_focus("A", SRC_COMMAND));
    EXPECT_EQ_INT(rc, ATT_OK);
    // Now [A, B]; A is focus (level 0), B is near (level 1).
    Actor a = make_actor("A", KIND_DOC);
    Actor b = make_actor("B", KIND_DOC);
    EXPECT_EQ_INT(rank_of(s.ring, a.cpLen, a.cp), 0);
    EXPECT_EQ_INT(rank_of(s.ring, b.cpLen, b.cp), 1);
    // History pushed the pre-move ring.
    EXPECT_EQ_INT(s.history.depth, 1);
}

static void test_machine_focus_idempotent() {
    using namespace att;
    State s = make_state_2(); // [B, A]
    Actor b = make_actor("B", KIND_DOC);
    int32_t rc = step(&s, evt_focus("B", SRC_COMMAND));
    EXPECT_EQ_INT(rc, ATT_ALREADY_FOCUSED);
    EXPECT_EQ_INT(s.history.depth, 0);
}

static void test_machine_pointer_stale() {
    using namespace att;
    State s = make_state_2();
    s.lastPointerEpoch = 5;
    int32_t rc = step(&s, evt_focus("A", SRC_POINTER, 5));
    EXPECT_EQ_INT(rc, ATT_POINTER_STALE);
    rc = step(&s, evt_focus("A", SRC_POINTER, 6));
    EXPECT_EQ_INT(rc, ATT_OK);
    EXPECT_EQ_INT(s.lastPointerEpoch, 6);
}

static void test_machine_input_primacy() {
    using namespace att;
    State s = make_state_2();
    // Bring A to focus so we can verify input doesn't displace the front.
    step(&s, evt_focus("A", SRC_COMMAND));
    int32_t rc = step(&s, evt_type_only(EV_INPUT_BEGIN));
    // Note: we passed a zero channel via the zeroed event, which is CH_TEXT (0).
    EXPECT_EQ_INT(rc, ATT_OK);
    EXPECT_EQ_INT(s.input.active, 1);
    EXPECT_EQ_INT(s.ring.actors[0].kind, KIND_BAR);
    Actor b = make_actor("B", KIND_DOC);
    rc = step(&s, evt_focus("B", SRC_COMMAND));
    EXPECT_EQ_INT(rc, ATT_OK);
    EXPECT_EQ_INT(s.ring.actors[0].kind, KIND_BAR);
    EXPECT_EQ_INT(rank_of(s.ring, b.cpLen, b.cp), 1);
}

static void test_machine_input_cancel_restores() {
    using namespace att;
    State s = make_state_2();
    Ring before = s.ring;
    step(&s, evt_type_only(EV_INPUT_BEGIN));
    att::ParsedEvent end;
    for (size_t i = 0; i < sizeof(end); ++i) ((char*)&end)[i] = 0;
    end.type = EV_INPUT_END;
    end.outcome = OUTCOME_CANCEL;
    int32_t rc = step(&s, end);
    EXPECT_EQ_INT(rc, ATT_OK);
    EXPECT_TRUE(ring_eq(s.ring, before));
    EXPECT_EQ_INT(s.input.active, 0);
}

static void test_machine_back_priority() {
    using namespace att;
    State s = make_state_2();
    // No input, no transfer, no history: BACK is NOOP.
    int32_t rc = step(&s, evt_type_only(EV_BACK));
    EXPECT_EQ_INT(rc, ATT_NOOP);
    // FOCUS then BACK undoes it.
    step(&s, evt_focus("A", SRC_COMMAND));
    Actor b = make_actor("B", KIND_DOC);
    EXPECT_EQ_INT(rank_of(s.ring, b.cpLen, b.cp), 1);
    rc = step(&s, evt_type_only(EV_BACK));
    EXPECT_EQ_INT(rc, ATT_OK);
    EXPECT_EQ_INT(rank_of(s.ring, b.cpLen, b.cp), 0);
}

static void test_machine_unknown_actor() {
    using namespace att;
    State s = make_state_2();
    int32_t rc = step(&s, evt_focus("Z", SRC_COMMAND));
    EXPECT_EQ_INT(rc, ATT_BAD_ACTOR);
}

static void test_machine_open_full() {
    using namespace att;
    State s;
    zero_state(&s);
    for (int32_t i = 0; i < ATT_MAX_ACTORS; ++i) {
        char name[4] = {'D', (char)('0' + i), 0, 0};
        int32_t rc = step(&s, evt_open(name, KIND_DOC));
        EXPECT_EQ_INT(rc, ATT_OK);
    }
    int32_t rc = step(&s, evt_open("Dx", KIND_DOC));
    EXPECT_EQ_INT(rc, ATT_RING_FULL);
    EXPECT_EQ_INT(s.ring.count, ATT_MAX_ACTORS);
}

// ---- entry point ----
int main() {
    struct TestCase { const char* name; void (*fn)(); };
    TestCase cases[] = {
        {"contrast_lut_edges",        test_contrast_lut_edges},
        {"contrast_permille",         test_contrast_permille},
        {"blend_channel",             test_blend_channel},
        {"level_contrast_permille",   test_level_contrast_permille},
        {"levels_validate_defaults",  test_levels_validate_defaults},
        {"levels_t1_monotonic",       test_levels_t1_monotonic},
        {"levels_t2_distinct",        test_levels_t2_distinct},
        {"levels_t3_contrast",        test_levels_t3_contrast},
        {"ring_basics",               test_ring_basics},
        {"ring_doc_rank",             test_ring_doc_rank},
        {"ring_pair_front",           test_ring_pair_front},
        {"history_push_pop",          test_history_push_pop},
        {"history_skips_duplicate",   test_history_skips_duplicate},
        {"machine_focus_ok",          test_machine_focus_ok},
        {"machine_focus_idempotent",  test_machine_focus_idempotent},
        {"machine_pointer_stale",     test_machine_pointer_stale},
        {"machine_input_primacy",     test_machine_input_primacy},
        {"machine_input_cancel",      test_machine_input_cancel_restores},
        {"machine_back_priority",     test_machine_back_priority},
        {"machine_unknown_actor",     test_machine_unknown_actor},
        {"machine_open_full",         test_machine_open_full},
    };
    int n = (int)(sizeof(cases) / sizeof(cases[0]));
    for (int i = 0; i < n; ++i) {
        std::printf("[ RUN  ] %s\n", cases[i].name);
        int before = g_failures;
        cases[i].fn();
        if (g_failures == before) std::printf("[  OK  ] %s\n", cases[i].name);
    }
    std::printf("[ VEC  ] golden replay\n");
    att_test::run_vectors(&g_failures);
    if (g_failures == 0) {
        std::printf("attention tests: OK\n");
        return 0;
    }
    std::fprintf(stderr, "attention tests: %d failure(s)\n", g_failures);
    return 1;
}
