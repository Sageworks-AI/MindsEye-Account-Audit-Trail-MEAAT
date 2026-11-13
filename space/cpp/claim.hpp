// SpaceClaim arithmetic: struct plus the three combinators from Addendum A.
// Shapes are a bitmask so the struct stays a POD the ABI can copy verbatim.
#ifndef SPACE_CPP_CLAIM_HPP
#define SPACE_CPP_CLAIM_HPP

#include "fixed.hpp"

namespace space {

enum CombineOp { OP_STACK = 0, OP_SIDE_BY_SIDE = 1, OP_OVERLAY = 2 };

constexpr int32_t SHAPE_FULL    = 1;
constexpr int32_t SHAPE_HALF    = 2;
constexpr int32_t SHAPE_QUARTER = 4;
constexpr int32_t SHAPE_STRIP   = 8;
constexpr int32_t SHAPE_ALL     = 15;

// Field order matches the ABI layout in space/ABI.md so api.cpp can memcpy
// between the scratch int64 slots and this struct without conversion.
struct Claim {
    int64_t minW, prefW, maxW;
    int64_t minH, prefH, maxH;
    int64_t rowsUpper;
    int32_t shapes;
};

inline bool combine_claim(int32_t op, const Claim* a, const Claim* b, Claim* out) {
    if (!a || !b || !out) return false;
    out->shapes = a->shapes & b->shapes;
    if (op == OP_STACK) {
        out->minW = imax(a->minW, b->minW);
        out->prefW = imax(a->prefW, b->prefW);
        out->maxW = imax(a->maxW, b->maxW);
        if (!add_ovf(a->minH, b->minH, &out->minH)) return false;
        if (!add_ovf(a->prefH, b->prefH, &out->prefH)) return false;
        if (!add_ovf(a->maxH, b->maxH, &out->maxH)) return false;
        if (!add_ovf(a->rowsUpper, b->rowsUpper, &out->rowsUpper)) return false;
        return true;
    }
    if (op == OP_SIDE_BY_SIDE) {
        if (!add_ovf(a->minW, b->minW, &out->minW)) return false;
        if (!add_ovf(a->prefW, b->prefW, &out->prefW)) return false;
        if (!add_ovf(a->maxW, b->maxW, &out->maxW)) return false;
        out->minH = imax(a->minH, b->minH);
        out->prefH = imax(a->prefH, b->prefH);
        out->maxH = imax(a->maxH, b->maxH);
        out->rowsUpper = imax(a->rowsUpper, b->rowsUpper);
        return true;
    }
    if (op == OP_OVERLAY) {
        out->minW = imax(a->minW, b->minW);
        out->prefW = imax(a->prefW, b->prefW);
        out->maxW = imax(a->maxW, b->maxW);
        out->minH = imax(a->minH, b->minH);
        out->prefH = imax(a->prefH, b->prefH);
        out->maxH = imax(a->maxH, b->maxH);
        out->rowsUpper = imax(a->rowsUpper, b->rowsUpper);
        return true;
    }
    return false;
}

} // namespace space

#endif
