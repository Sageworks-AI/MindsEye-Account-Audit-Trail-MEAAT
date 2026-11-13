// Archetype table baked from space/reference/documents.json. The C++ ABI
// takes an archetype index; the table is the source of truth for solve and
// paginate. Values mirror the JSON exactly in cpt (pt * 100). If the JSON
// changes, this file must be regenerated; scripts/verify-space.mjs flags a
// mismatch via the manifest.
//
// Field subset: only the fields solve() and paginate() need. Margins are
// used by the SVG renderer, not by the layout solver, and are not baked.
// Shape dimensions are -1 (missing) for archetypes that do not define a
// given shape class; solve() skips missing shapes.
#ifndef SPACE_CPP_PARAMS_HPP
#define SPACE_CPP_PARAMS_HPP

#include "fixed.hpp"

namespace space {

struct Archetype {
    int64_t bodyCpt;
    int64_t leadingCpt;
    int64_t headerCpt;
    int64_t footerCpt;
    int32_t paginates;     // 0 = no, 1 = yes
    int32_t typicalRows;
    int64_t shapeW[4];     // [FULL, HALF, QUARTER, STRIP], -1 if missing
    int64_t shapeH[4];
};

// Indices are STABLE and must match space/marshal.mjs and space/ABI.md.
// 0 balance_sheet_report_form
// 1 balance_sheet_t_form
// 2 income_statement
// 3 cash_flow_statement
// 4 trial_balance
// 5 journal_voucher
// 6 receipt_roll
// 7 small_business_flowchart
// 8 sequence_strip
constexpr int32_t ARCHETYPE_COUNT = 9;

inline constexpr Archetype ARCHETYPES[ARCHETYPE_COUNT] = {
    // 0 balance_sheet_report_form (A4 portrait)
    { 1000, 1200, 6000, 3000, 1, 25,
      { 59500, 59500, 59500, 59500 },
      { 84200, 45000, 25000, 4000 } },
    // 1 balance_sheet_t_form (A4 landscape)
    { 1000, 1200, 6000, 3000, 1, 30,
      { 84200, 84200, 84200, 84200 },
      { 59500, 32000, 18000, 4000 } },
    // 2 income_statement (A4 portrait)
    { 1000, 1200, 6000, 3000, 1, 20,
      { 59500, 59500, 59500, 59500 },
      { 84200, 45000, 25000, 4000 } },
    // 3 cash_flow_statement (A4 portrait)
    { 1000, 1200, 6000, 3000, 1, 20,
      { 59500, 59500, 59500, 59500 },
      { 84200, 45000, 25000, 4000 } },
    // 4 trial_balance (A4 portrait)
    { 1000, 1200, 6000, 3000, 1, 30,
      { 59500, 59500, 59500, 59500 },
      { 84200, 45000, 25000, 4000 } },
    // 5 journal_voucher (A5 landscape)
    { 1000, 1200, 5000, 4000, 0, 8,
      { 59500, 59500, 59500, 59500 },
      { 42000, 22000, 12000, 4000 } },
    // 6 receipt_roll (80mm roll)
    { 900, 1100, 3000, 2000, 0, 10,
      { 22700, 22700, 22700, 22700 },
      { 50000, 26000, 14000, 4000 } },
    // 7 small_business_flowchart (A4 landscape)
    { 1000, 1200, 5000, 3000, 0, 15,
      { 84200, 84200, 84200, 84200 },
      { 59500, 32000, 18000, 4000 } },
    // 8 sequence_strip (screen, STRIP only)
    { 900, 1200, 0, 0, 0, 1,
      { -1, -1, -1, 72000 },
      { -1, -1, -1, 4000 } },
};

// Ship-time sanity check (compile-time equivalent of the loader rules).
constexpr bool params_valid() {
    for (int32_t i = 0; i < ARCHETYPE_COUNT; ++i) {
        if (ARCHETYPES[i].bodyCpt <= 0) return false;
        if (ARCHETYPES[i].leadingCpt <= 0) return false;
        if (ARCHETYPES[i].typicalRows < 0) return false;
        bool anyShape = false;
        for (int32_t s = 0; s < 4; ++s) {
            if (ARCHETYPES[i].shapeW[s] < 0 && ARCHETYPES[i].shapeH[s] < 0) continue;
            if (ARCHETYPES[i].shapeW[s] <= 0 || ARCHETYPES[i].shapeH[s] <= 0) return false;
            anyShape = true;
        }
        if (!anyShape) return false;
    }
    return true;
}

} // namespace space

#endif
