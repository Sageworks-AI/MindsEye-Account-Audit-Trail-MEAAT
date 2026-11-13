// C ABI for the space layer. All state crosses as flat int64 arrays. The
// ABI itself allocates nothing: inputs and outputs share a fixed scratch
// buffer whose pointer and capacity the JS side queries once.
//
// Every function returns the OUTPUT LENGTH in int64 slots (>= 0) on success,
// or a negative error code. Inputs and outputs both start with a version
// word (= space_version()) so a mismatch is caught immediately.
#include <cstdint>
#include <cstring>

#include "fixed.hpp"
#include "rational.hpp"
#include "apportion.hpp"
#include "claim.hpp"
#include "metrics.hpp"
#include "paginate.hpp"
#include "templates.hpp"
#include "anchor.hpp"
#include "solve.hpp"
#include "params.hpp"

// Exported via emscripten when building wasm; visible as normal functions
// when built natively for tests. The scratch buffer is a fixed static array
// so no dynamic allocation ever occurs in the ABI layer.
extern "C" {

static int64_t g_scratch[131072]; // 1 MiB; documented in space/ABI.md

static constexpr int64_t VERSION = 1;
static constexpr int64_t SCRATCH_SLOTS = 131072;

// Error codes; mirrored in space/ABI.md.
enum {
    E_OK = 0,
    E_BAD_VERSION = -1,
    E_BAD_ARGUMENT = -2,
    E_OVERFLOW = -3,
    E_DIVIDE_BY_ZERO = -4,
    E_OUTPUT_TOO_SMALL = -5,
    E_NO_FEASIBLE_LAYOUT = -6,
    E_PARTITION = -7,
    E_PAGINATE = -8,
    E_ARITHMETIC = -9
};

static int32_t map_error(int32_t impl) {
    switch (impl) {
        case 0: return 0;
        case -2: return E_BAD_ARGUMENT;
        case -3: return E_OVERFLOW;
        case -5: return E_OUTPUT_TOO_SMALL;
        case -6: return E_NO_FEASIBLE_LAYOUT;
        case -7: return E_PARTITION;
        case -8: return E_PAGINATE;
        default: return E_BAD_ARGUMENT;
    }
}

__attribute__((visibility("default")))
int64_t space_version(void) { return VERSION; }

__attribute__((visibility("default")))
int64_t space_scratch_ptr(void) {
    return (int64_t)(uintptr_t)&g_scratch[0];
}

__attribute__((visibility("default")))
int64_t space_scratch_size(void) { return SCRATCH_SLOTS; }

// ---- space_measure_text ----
// in  = [ V, family, fontSizeCpt, cpLen, cp0 .. cp(cpLen-1) ]
// out = [ V, widthCpt ]
__attribute__((visibility("default")))
int64_t space_measure_text(int64_t inLen) {
    if (inLen < 4 || inLen > SCRATCH_SLOTS / 2) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    int64_t family = in[1];
    int64_t fontSize = in[2];
    int64_t cpLen = in[3];
    if (cpLen < 0 || cpLen > 256) return E_BAD_ARGUMENT;
    if (inLen != 4 + cpLen) return E_BAD_ARGUMENT;
    if (family < 0 || family > 1) return E_BAD_ARGUMENT;
    int64_t width = 0;
    if (!space::measure_text((int32_t)family, fontSize, &in[4], (int32_t)cpLen, &width)) {
        return E_BAD_ARGUMENT;
    }
    if (inLen + 2 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    out[0] = VERSION;
    out[1] = width;
    return 2;
}

// ---- space_apportion ----
// in  = [ V, total, n, w0 .. wn-1 ]
// out = [ V, n, p0 .. pn-1 ]
__attribute__((visibility("default")))
int64_t space_apportion(int64_t inLen) {
    if (inLen < 3) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    int64_t total = in[1];
    int64_t n = in[2];
    if (n < 1 || n > space::MAX_APPORTION_PARTS) return E_BAD_ARGUMENT;
    if (inLen != 3 + n) return E_BAD_ARGUMENT;
    if (inLen + 2 + n > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    out[0] = VERSION;
    out[1] = n;
    if (!space::apportion(total, &in[3], (int32_t)n, &out[2])) return E_BAD_ARGUMENT;
    return 2 + n;
}

// ---- space_claim_combine ----
// in  = [ V, op, a_minW,a_prefW,a_maxW,a_minH,a_prefH,a_maxH,a_rows, shapesMask,
//         b_minW,b_prefW,b_maxW,b_minH,b_prefH,b_maxH,b_rows, shapesMask ]
// out = [ V, minW,prefW,maxW,minH,prefH,maxH, rows, shapesMask ]
__attribute__((visibility("default")))
int64_t space_claim_combine(int64_t inLen) {
    if (inLen != 19) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    int64_t op = in[1];
    if (op < 0 || op > 2) return E_BAD_ARGUMENT;
    space::Claim a{ in[2], in[3], in[4], in[5], in[6], in[7], in[8], (int32_t)in[9] };
    space::Claim b{ in[10], in[11], in[12], in[13], in[14], in[15], in[16], (int32_t)in[17] };
    (void)in[18];
    space::Claim c;
    if (!space::combine_claim((int32_t)op, &a, &b, &c)) return E_BAD_ARGUMENT;
    if (inLen + 9 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    out[0] = VERSION;
    out[1] = c.minW; out[2] = c.prefW; out[3] = c.maxW;
    out[4] = c.minH; out[5] = c.prefH; out[6] = c.maxH;
    out[7] = c.rowsUpper; out[8] = (int64_t)c.shapes;
    return 9;
}

// ---- space_paginate ----
// in  = [ V, archetypeIdx, shapeClass, rows ]
// out = [ V, nPages, perPage, from0,to0, from1,to1, ... ]
__attribute__((visibility("default")))
int64_t space_paginate(int64_t inLen) {
    if (inLen != 4) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    int64_t archIdx = in[1];
    int64_t shapeClass = in[2];
    int64_t rows = in[3];
    if (archIdx < 0 || archIdx >= space::ARCHETYPE_COUNT) return E_BAD_ARGUMENT;
    if (shapeClass < 0 || shapeClass > 3) return E_BAD_ARGUMENT;
    if (rows < 0 || rows > 1000000) return E_BAD_ARGUMENT;
    const space::Archetype& arch = space::ARCHETYPES[archIdx];
    if (arch.shapeH[shapeClass] <= 0) return E_BAD_ARGUMENT;
    space::Page pages[space::MAX_PAGES_PER_PANE];
    int32_t nPages = 0, perPage = 0;
    int32_t rc = space::paginate((int32_t)rows, arch.leadingCpt, arch.headerCpt,
                                 arch.footerCpt, arch.shapeH[shapeClass], arch.paginates != 0,
                                 pages, space::MAX_PAGES_PER_PANE, &nPages, &perPage);
    if (rc != 0) return E_PAGINATE;
    int64_t outLen = 3 + (int64_t)nPages * 2;
    if (inLen + outLen > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    out[0] = VERSION;
    out[1] = nPages;
    out[2] = perPage;
    for (int32_t i = 0; i < nPages; ++i) {
        out[3 + i * 2] = pages[i].from;
        out[3 + i * 2 + 1] = pages[i].to;
    }
    return outLen;
}

// ---- space_anchor ----
// in  = [ V, oX,oY,oW,oH, oNum,oDen, aPageX,aPageY,
//            nX,nY,nW,nH, nNum,nDen, tolCpt, viewportW, viewportH ]
// out = [ V, offX, offY ]
__attribute__((visibility("default")))
int64_t space_anchor(int64_t inLen) {
    if (inLen != 18) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    space::Rect oldRect{in[1], in[2], in[3], in[4]};
    space::Rational oldScale{in[5], in[6]};
    int64_t apx = in[7], apy = in[8];
    space::Rect newRect{in[9], in[10], in[11], in[12]};
    space::Rational newScale{in[13], in[14]};
    int64_t tol = in[15];
    (void)in[16]; (void)in[17];
    if (oldScale.den <= 0 || newScale.den <= 0 || tol < 0) return E_BAD_ARGUMENT;
    int64_t ox = 0, oy = 0;
    if (!space::anchor_offset(oldRect, oldScale, apx, apy, newRect, newScale, tol, &ox, &oy)) {
        return E_OVERFLOW;
    }
    if (inLen + 3 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    out[0] = VERSION;
    out[1] = ox;
    out[2] = oy;
    return 3;
}

// ---- space_solve ----
// in  = [ V, viewportW, viewportH, nPanes,
//         for each pane: archetypeIdx, isBar, rowsUpper, weight ]
//        plus optional 2 tail fields: gutter, focalOrigIdx (if inLen == 4+4*n+2)
// out = [ V, nGeomPanes, focalOrigIdx,
//         per geom pane: origIdx, rectX,rectY,rectW,rectH,
//                        shapeClass, tier, scaleNum, scaleDen,
//                        effectiveBodyCpt, nPages,
//                        nPages * [from,to] ]
__attribute__((visibility("default")))
int64_t space_solve(int64_t inLen) {
    if (inLen < 4) return E_BAD_ARGUMENT;
    int64_t* in = g_scratch;
    if (in[0] != VERSION) return E_BAD_VERSION;
    int64_t vw = in[1], vh = in[2], nPanes = in[3];
    if (nPanes < 0 || nPanes > 8) return E_BAD_ARGUMENT;
    int64_t baseLen = 4 + nPanes * 4;
    int64_t gutter = space::DEFAULT_GUTTER_CPT;
    int64_t focalIdx = 0;
    if (inLen == baseLen + 2) {
        gutter = in[baseLen];
        focalIdx = in[baseLen + 1];
    } else if (inLen != baseLen) {
        return E_BAD_ARGUMENT;
    }
    if (gutter < 0 || gutter > 100000) return E_BAD_ARGUMENT;
    space::SolvePaneInput inputs[8];
    for (int64_t i = 0; i < nPanes; ++i) {
        inputs[i].archetypeIdx = (int32_t)in[4 + i * 4];
        inputs[i].isBar = (int32_t)in[4 + i * 4 + 1];
        inputs[i].rowsUpper = in[4 + i * 4 + 2];
        inputs[i].weight = in[4 + i * 4 + 3];
        if (inputs[i].archetypeIdx < 0 || inputs[i].archetypeIdx >= space::ARCHETYPE_COUNT) return E_BAD_ARGUMENT;
        if (inputs[i].isBar != 0 && inputs[i].isBar != 1) return E_BAD_ARGUMENT;
        if (inputs[i].rowsUpper < 0) return E_BAD_ARGUMENT;
        if (inputs[i].weight < 0) return E_BAD_ARGUMENT;
    }
    space::SolvePaneOutput panes[8];
    int32_t nOut = 0;
    int32_t focalOrig = 0;
    int32_t rc = space::solve_panes(vw, vh, inputs, (int32_t)nPanes,
                                    gutter, space::MIN_BODY_CPT, (int32_t)focalIdx,
                                    panes, 8, &nOut, &focalOrig);
    if (rc != 0) return (int64_t)map_error(rc);

    // Output length.
    int64_t outLen = 3;
    for (int32_t i = 0; i < nOut; ++i) outLen += 11 + (int64_t)panes[i].nPages * 2;
    if (inLen + outLen > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
    int64_t* out = g_scratch + inLen;
    int64_t p = 0;
    out[p++] = VERSION;
    out[p++] = nOut;
    out[p++] = focalOrig;
    for (int32_t i = 0; i < nOut; ++i) {
        const space::SolvePaneOutput& sp = panes[i];
        out[p++] = sp.origIdx;
        out[p++] = sp.rect.x; out[p++] = sp.rect.y; out[p++] = sp.rect.w; out[p++] = sp.rect.h;
        out[p++] = sp.shapeClass;
        out[p++] = sp.tier;
        out[p++] = sp.scale.num; out[p++] = sp.scale.den;
        out[p++] = sp.effectiveBodyCpt;
        out[p++] = sp.nPages;
        for (int32_t q = 0; q < sp.nPages; ++q) {
            out[p++] = sp.pages[q].from;
            out[p++] = sp.pages[q].to;
        }
    }
    return outLen;
}

} // extern "C"
