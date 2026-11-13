// Text measurement. The advance tables are baked from
// space/reference/metrics.json as 95 int32 values (ASCII 0x20..0x7E); any
// code point outside that range uses the family fallback. Units are
// 1/1000 em. Width in cpt = floor(sum(advances) * fontSizeCpt / 1000). This
// exactly mirrors space/js/metrics.mjs; parity tests are the contract.
#ifndef SPACE_CPP_METRICS_HPP
#define SPACE_CPP_METRICS_HPP

#include "fixed.hpp"

namespace space {

constexpr int32_t METRIC_FIRST = 0x20;
constexpr int32_t METRIC_LAST  = 0x7E;
constexpr int32_t METRIC_COUNT = METRIC_LAST - METRIC_FIRST + 1; // 95

// family 0 = sans (Helvetica/Arial metrics); fallback 556.
constexpr int32_t SANS_WIDTHS[METRIC_COUNT] = {
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
};
constexpr int32_t SANS_FALLBACK = 556;

// family 1 = monospace; every glyph 600 so digits are strictly tabular.
constexpr int32_t MONO_WIDTHS[METRIC_COUNT] = {
    600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600,
    600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600,
    600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600,
    600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600,
    600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600,
    600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600
};
constexpr int32_t MONO_FALLBACK = 600;

// Returns -1 for an unknown family; callers map to ERR_BAD_ARGUMENT.
inline int32_t char_width_ppm(int32_t family, int64_t codePoint) {
    if (family == 0) {
        if (codePoint < METRIC_FIRST || codePoint > METRIC_LAST) return SANS_FALLBACK;
        return SANS_WIDTHS[codePoint - METRIC_FIRST];
    }
    if (family == 1) {
        if (codePoint < METRIC_FIRST || codePoint > METRIC_LAST) return MONO_FALLBACK;
        return MONO_WIDTHS[codePoint - METRIC_FIRST];
    }
    return -1;
}

// Width in cpt of a code-point array at fontSizeCpt. cpLen <= 256 (see
// space/ABI.md). Returns false on overflow or invalid family.
inline bool measure_text(int32_t family, int64_t fontSizeCpt,
                         const int64_t* cps, int32_t cpLen, int64_t* widthCpt) {
    if (!cps || !widthCpt || cpLen < 0 || cpLen > 256 || fontSizeCpt < 0) return false;
    int64_t sum = 0;
    for (int32_t i = 0; i < cpLen; ++i) {
        int32_t w = char_width_ppm(family, cps[i]);
        if (w < 0) return false;
        if (!add_ovf(sum, (int64_t)w, &sum)) return false;
    }
    // floor(sum * fontSizeCpt / 1000)
    return muldiv_floor(sum, fontSizeCpt, 1000, widthCpt);
}

} // namespace space

#endif
