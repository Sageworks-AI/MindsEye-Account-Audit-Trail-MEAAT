// Native test runner for the space layer. Uses only hand-written edge case
// checks plus golden vector replay (test_vectors.cpp). The golden replay is
// what gives parity between the C++ and JS ABI; the hand-written tests
// cover the arithmetic primitives that the goldens do not exercise
// systematically (overflow, tie rules, clamp boundaries).
#include "runner.hpp"
#include "fixed.hpp"
#include "rational.hpp"
#include "apportion.hpp"
#include "claim.hpp"
#include "paginate.hpp"
#include "anchor.hpp"
#include "solve.hpp"
#include "params.hpp"

#include <cstdio>
#include <cstdint>

namespace space_test { void run_vectors(int* failures); }

// ---- fixed.hpp ----
static void test_mul_u64() {
    using namespace space;
    I128 r = mul_u64(0, 0);
    EXPECT_EQ_INT(r.hi, 0); EXPECT_EQ_INT(r.lo, 0);
    r = mul_u64(1, 1);
    EXPECT_EQ_INT(r.hi, 0); EXPECT_EQ_INT(r.lo, 1);
    r = mul_u64(0xFFFFFFFFFFFFFFFFull, 0xFFFFFFFFFFFFFFFFull);
    // (2^64-1)^2 = 2^128 - 2^65 + 1; lo = 1, hi = 0xFFFFFFFFFFFFFFFE
    EXPECT_EQ_INT((std::uint64_t)r.lo, 1ull);
    EXPECT_EQ_INT((std::uint64_t)r.hi, 0xFFFFFFFFFFFFFFFEull);
    r = mul_u64(1ull << 32, 1ull << 32);
    EXPECT_EQ_INT(r.hi, 0); EXPECT_EQ_INT(r.lo, 1ull << 32 | 0); // (2^32)*(2^32)=2^64 -> hi=1, lo=0
    EXPECT_EQ_INT((std::uint64_t)r.hi, 1ull);
    EXPECT_EQ_INT((std::uint64_t)r.lo, 0ull);
}

static void test_div_128() {
    using namespace space;
    std::uint64_t qh, ql, rem;
    div_128_by_64(0, 100, 7, &qh, &ql, &rem);
    EXPECT_EQ_INT(qh, 0); EXPECT_EQ_INT(ql, 14); EXPECT_EQ_INT(rem, 2);
    div_128_by_64(0, 0, 1, &qh, &ql, &rem);
    EXPECT_EQ_INT(ql, 0); EXPECT_EQ_INT(rem, 0);
    // 2^100 / 2 = 2^99 (hi = 2^36, lo = 0)
    div_128_by_64((std::uint64_t)1 << 36, 0, 2, &qh, &ql, &rem);
    EXPECT_EQ_INT(qh, 0);
    EXPECT_EQ_INT((std::uint64_t)ql, (std::uint64_t)1 << 35);
    EXPECT_EQ_INT(rem, 0);
}

static void test_muldiv_floor() {
    using namespace space;
    std::int64_t r = 0;
    EXPECT_TRUE(muldiv_floor(10, 3, 4, &r));   EXPECT_EQ_INT(r, 7);   // 30/4=7.5 -> 7
    EXPECT_TRUE(muldiv_floor(-10, 3, 4, &r));  EXPECT_EQ_INT(r, -8);  // -7.5 -> -8 (floor)
    EXPECT_TRUE(muldiv_floor(0, 5, 7, &r));    EXPECT_EQ_INT(r, 0);
    EXPECT_TRUE(!muldiv_floor(1, 1, 0, &r));   // c <= 0 rejected
    EXPECT_TRUE(!muldiv_floor(INT64_MAX, INT64_MAX, 1, &r)); // overflow
    // Known exact division with 128-bit intermediate:
    EXPECT_TRUE(muldiv_floor(INT64_MAX, 2, 2, &r)); EXPECT_EQ_INT(r, INT64_MAX);
}

// ---- rational.hpp ----
static void test_rational() {
    using namespace space;
    Rational r;
    EXPECT_TRUE(make_rational(10, 4, &r));  EXPECT_EQ_INT(r.num, 5);  EXPECT_EQ_INT(r.den, 2);
    EXPECT_TRUE(make_rational(10, -4, &r)); EXPECT_EQ_INT(r.num, -5); EXPECT_EQ_INT(r.den, 2);
    EXPECT_TRUE(!make_rational(1, 0, &r));
    std::int64_t v = 0;
    EXPECT_TRUE(apply_rational(3, Rational{5, 2}, &v));  EXPECT_EQ_INT(v, 7);   // floor 7.5
    EXPECT_TRUE(apply_rational(-3, Rational{5, 2}, &v)); EXPECT_EQ_INT(v, -8);  // floor -7.5
    EXPECT_EQ_INT(compare_rational(Rational{1, 2}, Rational{2, 4}), 0);
    EXPECT_EQ_INT(compare_rational(Rational{1, 3}, Rational{1, 2}), -1);
    EXPECT_EQ_INT(compare_rational(Rational{2, 3}, Rational{1, 2}), 1);
}

// ---- apportion.hpp ----
static void test_apportion() {
    using namespace space;
    std::int64_t w[3];
    std::int64_t parts[3];
    w[0] = 1; w[1] = 1; w[2] = 1;
    EXPECT_TRUE(apportion(100, w, 3, parts));
    EXPECT_EQ_INT(parts[0] + parts[1] + parts[2], 100);
    EXPECT_EQ_INT(parts[0], 34); EXPECT_EQ_INT(parts[1], 33); EXPECT_EQ_INT(parts[2], 33);
    w[0] = 1; w[1] = 3;
    EXPECT_TRUE(apportion(400, w, 2, parts));
    EXPECT_EQ_INT(parts[0], 100); EXPECT_EQ_INT(parts[1], 300);
    w[0] = 0;
    EXPECT_TRUE(!apportion(100, w, 2, parts));
    // Tie to lower index: total = 7, weights = [1,1,1] -> 3,2,2
    w[0] = 1; w[1] = 1; w[2] = 1;
    EXPECT_TRUE(apportion(7, w, 3, parts));
    EXPECT_EQ_INT(parts[0], 3); EXPECT_EQ_INT(parts[1], 2); EXPECT_EQ_INT(parts[2], 2);
}

// ---- claim.hpp ----
static void test_claim() {
    using namespace space;
    Claim a{100, 200, 400, 50, 100, 200, 10, SHAPE_FULL | SHAPE_HALF};
    Claim b{120, 220, 500, 80, 120, 250, 5, SHAPE_HALF | SHAPE_QUARTER};
    Claim c;
    EXPECT_TRUE(combine_claim(OP_STACK, &a, &b, &c));
    EXPECT_EQ_INT(c.minW, 120); EXPECT_EQ_INT(c.prefW, 220); EXPECT_EQ_INT(c.maxW, 500);
    EXPECT_EQ_INT(c.minH, 130); EXPECT_EQ_INT(c.prefH, 220); EXPECT_EQ_INT(c.maxH, 450);
    EXPECT_EQ_INT(c.rowsUpper, 15);
    EXPECT_EQ_INT(c.shapes, SHAPE_HALF);
    EXPECT_TRUE(combine_claim(OP_OVERLAY, &a, &b, &c));
    EXPECT_EQ_INT(c.minH, 80); EXPECT_EQ_INT(c.maxH, 250);
    EXPECT_EQ_INT(c.rowsUpper, 10);
}

// ---- paginate.hpp ----
static void test_paginate() {
    using namespace space;
    Page pages[MAX_PAGES_PER_PANE];
    std::int32_t n = 0, pp = 0;
    // 25 rows, leading 12pt, header 60, footer 30, page 842. Content=752 -> perPage=62.
    // 25 <= 62 -> one page.
    EXPECT_EQ_INT(paginate(25, 1200, 6000, 3000, 84200, true, pages, MAX_PAGES_PER_PANE, &n, &pp), 0);
    EXPECT_EQ_INT(n, 1); EXPECT_EQ_INT(pages[0].from, 0); EXPECT_EQ_INT(pages[0].to, 25);
    // 100 rows -> 100 > 62 -> two pages.
    EXPECT_EQ_INT(paginate(100, 1200, 6000, 3000, 84200, true, pages, MAX_PAGES_PER_PANE, &n, &pp), 0);
    EXPECT_EQ_INT(n, 2);
    EXPECT_EQ_INT(pages[0].from, 0);  EXPECT_EQ_INT(pages[0].to, 62);
    EXPECT_EQ_INT(pages[1].from, 62); EXPECT_EQ_INT(pages[1].to, 100);
    // Non-paginating archetype with too many rows fails.
    EXPECT_EQ_INT(paginate(200, 1200, 5000, 4000, 42000, false, pages, MAX_PAGES_PER_PANE, &n, &pp), 1);
}

// ---- anchor.hpp ----
static void test_anchor() {
    using namespace space;
    std::int64_t ox = 0, oy = 0;
    // Old rect (100,100,1000,1000) scale 1:1, anchor page (500,500) -> old screen (600,600).
    // New rect (200,200,1000,1000) scale 1:1, anchor same page -> base screen (700,700).
    // Desired offset = (-100,-100). |(-100,-100)|^2=20000, tol=300 -> tol^2=90000. Within -> exact.
    EXPECT_TRUE(anchor_offset(Rect{100,100,1000,1000}, Rational{1,1},
                              500, 500,
                              Rect{200,200,1000,1000}, Rational{1,1},
                              300, &ox, &oy));
    EXPECT_EQ_INT(ox, -100); EXPECT_EQ_INT(oy, -100);
    // Anchor far away, tolerance tiny: clamp to new rect boundary.
    // Old screen = (100 + 500, 100 + 500) = (600,600). New rect = (1000,1000,500,500).
    // Without offset, screen = (1000 + 500, 1000 + 500) = (1500,1500). offset wanted = (-900,-900).
    // tol=0, so clamp. Target = clamp(oldS=600, newRect=1000..1500) = (1000,1000).
    // Offset = 1000 - 1500 = -500. Same for y.
    EXPECT_TRUE(anchor_offset(Rect{100,100,1000,1000}, Rational{1,1},
                              500, 500,
                              Rect{1000,1000,500,500}, Rational{1,1},
                              0, &ox, &oy));
    EXPECT_EQ_INT(ox, -500); EXPECT_EQ_INT(oy, -500);
}

// ---- solve.hpp ----
static void test_solve() {
    using namespace space;
    // 2 panes of balance_sheet_report_form (archetype 0) in a 1280x720*75 cpt viewport.
    SolvePaneInput in[2] = {
        {0, 0, 25, 1},
        {0, 0, 25, 1},
    };
    SolvePaneOutput out[8];
    std::int32_t nOut = 0, focalOrig = 0;
    std::int32_t rc = solve_panes(96000, 54000, in, 2, DEFAULT_GUTTER_CPT, MIN_BODY_CPT, 0,
                                  out, 8, &nOut, &focalOrig);
    EXPECT_EQ_INT(rc, 0);
    EXPECT_EQ_INT(nOut, 2);
    EXPECT_EQ_INT(focalOrig, 0);
    // Partition: total widths + gutter == viewport width.
    EXPECT_EQ_INT(out[0].rect.x, 0);
    EXPECT_EQ_INT(out[1].rect.x, out[0].rect.w + DEFAULT_GUTTER_CPT);
    EXPECT_EQ_INT(out[0].rect.w + out[1].rect.w + DEFAULT_GUTTER_CPT, 96000);
    // Both panes have valid shape classes and MIN_BODY respected.
    for (int32_t i = 0; i < nOut; ++i) {
        EXPECT_TRUE(out[i].effectiveBodyCpt >= MIN_BODY_CPT);
        EXPECT_TRUE(out[i].shapeClass >= 0 && out[i].shapeClass <= 3);
    }
    // BAR pane: reserves no geometry.
    SolvePaneInput in2[3] = {
        {0, 0, 25, 1},
        {0, 0, 25, 1},
        {6, 1, 10, 1},
    };
    rc = solve_panes(96000, 54000, in2, 3, DEFAULT_GUTTER_CPT, MIN_BODY_CPT, 0,
                     out, 8, &nOut, &focalOrig);
    EXPECT_EQ_INT(rc, 0);
    EXPECT_EQ_INT(nOut, 2); // 3 inputs, 1 BAR -> 2 geometry panes
}

// ---- params.hpp ----
static void test_params() {
    using namespace space;
    static_assert(params_valid(), "params table must be valid at compile time");
    EXPECT_EQ_INT(ARCHETYPES[0].shapeH[0], 84200);
    EXPECT_EQ_INT(ARCHETYPES[0].shapeW[3], 59500);
    EXPECT_EQ_INT(ARCHETYPES[8].shapeH[3], 4000); // sequence_strip STRIP
}

int main() {
    space_test::TestCase cases[] = {
        {"mul_u64",      test_mul_u64},
        {"div_128",      test_div_128},
        {"muldiv_floor", test_muldiv_floor},
        {"rational",     test_rational},
        {"apportion",    test_apportion},
        {"claim",        test_claim},
        {"paginate",     test_paginate},
        {"anchor",       test_anchor},
        {"solve",        test_solve},
        {"params",       test_params},
    };
    int n = (int)(sizeof(cases) / sizeof(cases[0]));
    for (int i = 0; i < n; ++i) {
        std::printf("[ RUN  ] %s\n", cases[i].name);
        int before = g_failures;
        cases[i].fn();
        if (g_failures == before) std::printf("[  OK  ] %s\n", cases[i].name);
    }
    std::printf("[ VEC  ] golden replay\n");
    space_test::run_vectors(&g_failures);
    if (g_failures == 0) {
        std::printf("space tests: OK\n");
        return 0;
    }
    std::fprintf(stderr, "space tests: %d failure(s)\n", g_failures);
    return 1;
}
