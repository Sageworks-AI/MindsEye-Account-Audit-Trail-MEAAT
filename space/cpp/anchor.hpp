// Anchor invariance (Law L6, second half). Given the focal pane's old rect
// and scale, the anchor's page coordinates, the focal pane's new rect and
// scale, and a tolerance in cpt, return the view offset (added to the new
// rect's origin) that keeps the anchor's screen position within tolerance
// of where it was, or — when that is impossible — puts the anchor at the
// closest boundary point of the new rect to the old screen position.
// Exactly mirrors space/js/anchor.mjs.
#ifndef SPACE_CPP_ANCHOR_HPP
#define SPACE_CPP_ANCHOR_HPP

#include "fixed.hpp"
#include "rational.hpp"
#include "templates.hpp"

namespace space {

// Returns false on overflow; the ABI maps that to ERR_OVERFLOW.
inline bool anchor_offset(Rect oldRect, Rational oldScale,
                          int64_t anchorPageX, int64_t anchorPageY,
                          Rect newRect, Rational newScale,
                          int64_t toleranceCpt,
                          int64_t* outOffX, int64_t* outOffY) {
    if (!outOffX || !outOffY || toleranceCpt < 0) return false;
    // Old screen position: page coord scaled by oldScale, plus old origin.
    int64_t axOld = 0, ayOld = 0;
    if (!apply_rational(anchorPageX, oldScale, &axOld)) return false;
    if (!apply_rational(anchorPageY, oldScale, &ayOld)) return false;
    int64_t oldSX = 0, oldSY = 0;
    if (!add_ovf(oldRect.x, axOld, &oldSX)) return false;
    if (!add_ovf(oldRect.y, ayOld, &oldSY)) return false;
    // New screen position without any offset.
    int64_t axNew = 0, ayNew = 0;
    if (!apply_rational(anchorPageX, newScale, &axNew)) return false;
    if (!apply_rational(anchorPageY, newScale, &ayNew)) return false;
    int64_t baseSX = 0, baseSY = 0;
    if (!add_ovf(newRect.x, axNew, &baseSX)) return false;
    if (!add_ovf(newRect.y, ayNew, &baseSY)) return false;
    // Desired offset restores the old screen position exactly.
    int64_t dx = 0, dy = 0;
    if (!sub_ovf(oldSX, baseSX, &dx)) return false;
    if (!sub_ovf(oldSY, baseSY, &dy)) return false;
    // Distance check: within tolerance → return desired offset.
    int64_t dx2 = 0, dy2 = 0;
    if (!mul_ovf(dx, dx, &dx2)) return false;
    if (!mul_ovf(dy, dy, &dy2)) return false;
    int64_t d2 = 0;
    if (!add_ovf(dx2, dy2, &d2)) return false;
    int64_t tol2 = 0;
    if (!mul_ovf(toleranceCpt, toleranceCpt, &tol2)) return false;
    if (d2 <= tol2) { *outOffX = dx; *outOffY = dy; return true; }
    // Outside tolerance: clamp so the anchor lands at the closest point of
    // the new rect to the old screen position. target = clamp(oldS, newRect).
    int64_t targetX = oldSX, targetY = oldSY;
    int64_t newX2 = 0, newY2 = 0;
    if (!add_ovf(newRect.x, newRect.w, &newX2)) return false;
    if (!add_ovf(newRect.y, newRect.h, &newY2)) return false;
    if (targetX < newRect.x) targetX = newRect.x;
    if (targetX > newX2)     targetX = newX2;
    if (targetY < newRect.y) targetY = newRect.y;
    if (targetY > newY2)     targetY = newY2;
    if (!sub_ovf(targetX, baseSX, outOffX)) return false;
    if (!sub_ovf(targetY, baseSY, outOffY)) return false;
    return true;
}

} // namespace space

#endif
