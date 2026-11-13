// Solver mirroring space/js/solve.mjs. Enforces L1 (partition), L3 (uniform
// scale), L4 (legibility floor), L6 (focal contains center), L11 (page
// counts), L12 (BAR reserves no geometry). Each violation returns an error
// code rather than a bad layout.
#ifndef SPACE_CPP_SOLVE_HPP
#define SPACE_CPP_SOLVE_HPP

#include "fixed.hpp"
#include "rational.hpp"
#include "templates.hpp"
#include "paginate.hpp"
#include "params.hpp"

namespace space {

constexpr int64_t MIN_BODY_CPT = 675;
constexpr int64_t DEFAULT_GUTTER_CPT = 600;

constexpr int64_t TIER_SUMMARY_W = 24000;
constexpr int64_t TIER_SUMMARY_H = 18000;
constexpr int64_t TIER_STANDARD_W = 48000;
constexpr int64_t TIER_STANDARD_H = 36000;

constexpr int32_t MAX_PAGES_PER_PANE = 128;

struct SolvePaneInput {
    int32_t archetypeIdx;
    int32_t isBar;
    int64_t rowsUpper;
    int64_t weight;
};

struct SolvePaneOutput {
    int32_t origIdx;
    Rect rect;
    int32_t shapeClass;   // 0 FULL, 1 HALF, 2 QUARTER, 3 STRIP
    int32_t tier;         // 0 summary, 1 standard, 2 full
    Rational scale;
    int64_t effectiveBodyCpt;
    int32_t nPages;
    Page pages[MAX_PAGES_PER_PANE];
};

inline int32_t pick_tier(int64_t rw, int64_t rh) {
    if (rw < TIER_SUMMARY_W || rh < TIER_SUMMARY_H) return 0;
    if (rw < TIER_STANDARD_W || rh < TIER_STANDARD_H) return 1;
    return 2;
}

// Iterates FULL, HALF, QUARTER, STRIP; returns the first shape class whose
// scaled body >= minBody. Mirrors pickShape() in solve.mjs exactly.
inline int32_t pick_shape(const Archetype& arch, Rect rect, int64_t minBody,
                          int32_t* shapeClassOut, Rational* scaleOut,
                          int64_t* effectiveBodyOut) {
    for (int32_t s = 0; s < 4; ++s) {
        if (arch.shapeW[s] <= 0 || arch.shapeH[s] <= 0) continue;
        int64_t pageW = arch.shapeW[s];
        int64_t pageH = arch.shapeH[s];
        int64_t lhs = 0, rhs = 0;
        if (!mul_ovf(rect.w, pageH, &lhs)) return -3;
        if (!mul_ovf(rect.h, pageW, &rhs)) return -3;
        int64_t num, den;
        if (lhs < rhs) { num = rect.w; den = pageW; }
        else           { num = rect.h; den = pageH; }
        int64_t eff = 0;
        if (!muldiv_floor(arch.bodyCpt, num, den, &eff)) return -3;
        if (eff >= minBody) {
            Rational r;
            if (!make_rational(num, den, &r)) return -2;
            *shapeClassOut = s;
            *scaleOut = r;
            *effectiveBodyOut = eff;
            return 0;
        }
    }
    return -6; // ERR_NO_FEASIBLE_LAYOUT
}

// Returns 0 on success. panesOut[*nOut] are filled in original index order,
// each carrying its pages. focalOrigIdx is the ORIGINAL index of the focal
// pane (-1 if no geometry panes). Uses focal = first non-BAR pane unless
// focalIdx points to a non-BAR pane.
inline int32_t solve_panes(
    int64_t viewportW, int64_t viewportH,
    const SolvePaneInput* in, int32_t nIn,
    int64_t gutter, int64_t minBodyCpt, int32_t focalIdx,
    SolvePaneOutput* panesOut, int32_t panesCapacity, int32_t* nOut,
    int32_t* focalOrigIdx) {
    if (!in || !panesOut || !nOut || !focalOrigIdx) return -2;
    if (viewportW <= 0 || viewportH <= 0 || nIn < 0 || gutter < 0) return -2;

    // Extract geometry panes in original order.
    int32_t geomCount = 0;
    int32_t geomOrigIdx[4];
    for (int32_t i = 0; i < nIn && geomCount < 4; ++i) {
        if (in[i].isBar) continue;
        if (in[i].archetypeIdx < 0 || in[i].archetypeIdx >= ARCHETYPE_COUNT) return -2;
        geomOrigIdx[geomCount++] = i;
    }
    if (geomCount > 4) return -2;
    if (geomCount == 0) { *nOut = 0; *focalOrigIdx = -1; return 0; }

    // Focal position in geometry order; falls back to 0.
    int32_t focalPos = 0;
    for (int32_t g = 0; g < geomCount; ++g) {
        if (geomOrigIdx[g] == focalIdx) { focalPos = g; break; }
    }
    *focalOrigIdx = geomOrigIdx[focalPos];

    // Reordered inputs, focal first.
    SolvePaneInput ordered[4];
    int32_t orderedOrig[4];
    for (int32_t g = 0; g < geomCount; ++g) {
        int32_t src = (g + focalPos) % geomCount;
        ordered[g] = in[geomOrigIdx[src]];
        orderedOrig[g] = geomOrigIdx[src];
    }

    // Template rects (all in cpt).
    Rect rects[4];
    if (!build_template(geomCount, viewportW, viewportH, gutter, 0, rects)) return -3;

    // L1: partition check.
    for (int32_t g = 0; g < geomCount; ++g) {
        Rect r = rects[g];
        if (r.x < 0 || r.y < 0 || r.x + r.w > viewportW || r.y + r.h > viewportH) return -7;
        for (int32_t h = g + 1; h < geomCount; ++h) {
            Rect s = rects[h];
            bool overlap = !(r.x + r.w <= s.x || s.x + s.w <= r.x ||
                             r.y + r.h <= s.y || s.y + s.h <= r.y);
            if (overlap) return -7;
        }
    }

    // L6: viewport center inside focal rect (rects[0]).
    int64_t cx = viewportW / 2;
    int64_t cy = viewportH / 2;
    Rect f = rects[0];
    if (!(cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h)) return -7;

    // Compute shape, tier, pagination for each geometry pane, then map back.
    for (int32_t g = 0; g < geomCount; ++g) {
        SolvePaneInput pin = ordered[g];
        const Archetype& arch = ARCHETYPES[pin.archetypeIdx];
        Rect rect = rects[g];

        int32_t shapeClass = 0;
        Rational scale{1, 1};
        int64_t effectiveBody = 0;
        int32_t rc = pick_shape(arch, rect, minBodyCpt, &shapeClass, &scale, &effectiveBody);
        if (rc != 0) return rc;

        int32_t tier = pick_tier(rect.w, rect.h);

        int64_t rows = pin.rowsUpper;
        if (rows <= 0) rows = arch.typicalRows;
        if (rows > 100000) return -2;
        int32_t rowsInt = (int32_t)rows;

        Page localPages[MAX_PAGES_PER_PANE];
        int32_t nPages = 0, perPage = 0;
        int32_t prc = paginate(rowsInt, arch.leadingCpt, arch.headerCpt, arch.footerCpt,
                               arch.shapeH[shapeClass], arch.paginates != 0,
                               localPages, MAX_PAGES_PER_PANE, &nPages, &perPage);
        if (prc != 0) return -8;

        // Find the original index for this reordered position.
        int32_t orig = orderedOrig[g];
        int32_t slot = -1;
        for (int32_t k = 0; k < *nOut; ++k) if (panesOut[k].origIdx == orig) { slot = k; break; }
        if (slot < 0) {
            if (*nOut >= panesCapacity) return -5;
            slot = (*nOut)++;
            panesOut[slot].origIdx = orig;
        }
        panesOut[slot].rect = rect;
        panesOut[slot].shapeClass = shapeClass;
        panesOut[slot].tier = tier;
        panesOut[slot].scale = scale;
        panesOut[slot].effectiveBodyCpt = effectiveBody;
        panesOut[slot].nPages = nPages;
        for (int32_t p = 0; p < nPages; ++p) panesOut[slot].pages[p] = localPages[p];
    }

    // Sort output by origIdx for determinism.
    for (int32_t i = 1; i < *nOut; ++i) {
        SolvePaneOutput key = panesOut[i];
        int32_t j = i - 1;
        while (j >= 0 && panesOut[j].origIdx > key.origIdx) {
            panesOut[j + 1] = panesOut[j];
            --j;
        }
        panesOut[j + 1] = key;
    }
    return 0;
}

} // namespace space

#endif
