// Baked level table + timing. Matches attention/dist/levels.json exactly.
// `att_levels_table` reads from here; `att_validate` cross-checks the same
// T1–T4 rules that attention/js/levels.mjs enforces. The LUT in
// contrast.hpp and the values here are kept in lockstep with the JSON by
// the manifest: change the JSON, rebuild, rebuild the manifest.
#ifndef ATTENTION_CPP_LEVELS_HPP
#define ATTENTION_CPP_LEVELS_HPP

#include "types.hpp"
#include "contrast.hpp"

namespace att {

struct LevelRow {
    int32_t opacity, brightness, saturation, blur, shadow, radius;
};
struct ThemeColors {
    int32_t fgR, fgG, fgB, bgR, bgG, bgB;
};
struct ThemeTable {
    ThemeColors colors;
    LevelRow rows[3];
};
struct Timing {
    int32_t focusMs, inputBeginMs, inputEndMs, transferMs;
    int32_t x1, y1, x2, y2;
};
struct LevelSet {
    ThemeTable light;
    ThemeTable dark;
    Timing timing;
};

// Baked from attention/dist/levels.json (2026 edition, S7).
inline constexpr LevelSet LEVELS = {
    // light
    { { 32, 32, 32, 255, 255, 255 },
      { { 1000, 1000, 1000, 0, 1800, 1050 },
        { 880,  940,  900,  0, 900,  900  },
        { 760,  820,  700,  0, 450,  750  } } },
    // dark
    { { 230, 230, 230, 30, 30, 30 },
      { { 1000, 1000, 1000, 0, 1800, 1050 },
        { 880,  940,  900,  0, 900,  900  },
        { 760,  820,  700,  0, 450,  750  } } },
    // timing
    { 220, 160, 200, 240, 250, 100, 250, 1000 },
};

// T1: opacity/brightness/saturation/shadow never increase with level;
// blur never decreases. T2: opacity step between adjacent levels >= 100.
// T3: per-theme, per-level contrast >= floor (7000/4500/3000; under
// prefers-contrast: more the level-2 floor is 4500). T4 is structural —
// LevelRow has no geometry fields, so it cannot violate it.
inline int32_t validate_level_set(const LevelSet& s, bool prefersContrastMore) {
    const ThemeTable* themes[2] = { &s.light, &s.dark };
    const int32_t floorsNormal[3] = { 7000, 4500, 3000 };
    const int32_t floorsHigh[3]   = { 7000, 4500, 4500 };
    for (int32_t t = 0; t < 2; ++t) {
        for (int32_t l = 1; l < 3; ++l) {
            const LevelRow& prev = themes[t]->rows[l - 1];
            const LevelRow& cur  = themes[t]->rows[l];
            if (cur.opacity    > prev.opacity)    return ATT_LAW_VIOLATION;
            if (cur.brightness > prev.brightness) return ATT_LAW_VIOLATION;
            if (cur.saturation > prev.saturation) return ATT_LAW_VIOLATION;
            if (cur.shadow     > prev.shadow)     return ATT_LAW_VIOLATION;
            if (cur.blur       < prev.blur)       return ATT_LAW_VIOLATION;
            if (prev.opacity - cur.opacity < 100) return ATT_LAW_VIOLATION;
        }
        for (int32_t l = 0; l < 3; ++l) {
            const LevelRow& r = themes[t]->rows[l];
            const int32_t floor = prefersContrastMore ? floorsHigh[l] : floorsNormal[l];
            int32_t got = level_contrast_permille(
                themes[t]->colors.fgR, themes[t]->colors.fgG, themes[t]->colors.fgB,
                themes[t]->colors.bgR, themes[t]->colors.bgG, themes[t]->colors.bgB,
                r.opacity, r.brightness);
            if (got < floor) return ATT_LAW_VIOLATION;
        }
    }
    return ATT_OK;
}

} // namespace att

#endif
