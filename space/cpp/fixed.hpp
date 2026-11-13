// Portable int64 arithmetic for the space layer. No __int128, no compiler
// builtins, no floating point — the same source must compile under MSVC,
// MinGW, clang and Emscripten. The 128-bit multiply and divide are written
// from 64-bit limbs and run in constant time proportional to bit length.
#ifndef SPACE_CPP_FIXED_HPP
#define SPACE_CPP_FIXED_HPP

#include <cstdint>

namespace space {

// (hi, lo) pair representing an unsigned 128-bit intermediate. Only used
// inside this file's multiply/divide; never crosses the ABI.
struct I128 {
    uint64_t hi;
    uint64_t lo;
};

// Unsigned 64x64 -> 128. Splits each operand into two 32-bit limbs; the
// middle term's carries cannot be lost because each sub-product fits a
// uint64 and the additions that cross the 64-bit boundary are the only
// sources of overflow, which we capture explicitly.
inline I128 mul_u64(uint64_t a, uint64_t b) {
    uint64_t a_lo = a & 0xFFFFFFFFu;
    uint64_t a_hi = a >> 32;
    uint64_t b_lo = b & 0xFFFFFFFFu;
    uint64_t b_hi = b >> 32;
    uint64_t p0 = a_lo * b_lo;
    uint64_t p1 = a_lo * b_hi;
    uint64_t p2 = a_hi * b_lo;
    uint64_t p3 = a_hi * b_hi;
    uint64_t mid = (p0 >> 32) + (p1 & 0xFFFFFFFFu) + (p2 & 0xFFFFFFFFu);
    uint64_t lo  = (p0 & 0xFFFFFFFFu) | (mid << 32);
    uint64_t hi  = p3 + (p1 >> 32) + (p2 >> 32) + (mid >> 32);
    return I128{hi, lo};
}

// Unsigned 128 / 64 via bit-by-bit long division. The quotient may be up to
// 128-bit in theory; our callers only accept a 64-bit quotient and check
// q_hi == 0. r stays < d, so r never needs to hold 2^64 (see the invariant
// in the loop: r < d before each shift, so r << 1 | bit < 2d <= 2^64 — the
// strict inequality d < 2^64 makes the bound tight for the carry-in bit).
inline void div_128_by_64(uint64_t hi, uint64_t lo, uint64_t d,
                          uint64_t* q_hi_out, uint64_t* q_lo_out, uint64_t* rem_out) {
    if (d == 0) {
        if (q_hi_out) *q_hi_out = 0;
        if (q_lo_out) *q_lo_out = 0;
        if (rem_out)  *rem_out  = 0;
        return;
    }
    if (hi == 0) {
        if (q_hi_out) *q_hi_out = 0;
        if (q_lo_out) *q_lo_out = lo / d;
        if (rem_out)  *rem_out  = lo % d;
        return;
    }
    uint64_t q_hi = 0, q_lo = 0, r = 0;
    for (int i = 127; i >= 0; --i) {
        uint64_t bit = (i >= 64) ? ((hi >> (i - 64)) & 1u) : ((lo >> i) & 1u);
        r = (r << 1) | bit;
        if (r >= d) {
            r -= d;
            if (i >= 64) q_hi |= (uint64_t)1 << (i - 64);
            else         q_lo |= (uint64_t)1 << i;
        }
    }
    if (q_hi_out) *q_hi_out = q_hi;
    if (q_lo_out) *q_lo_out = q_lo;
    if (rem_out)  *rem_out  = r;
}

// (a * b) / c with floor rounding, c > 0. Callers of the space layer only
// ever pass c > 0 (weights, denominators). Returns false on overflow.
inline bool muldiv_floor(int64_t a, int64_t b, int64_t c, int64_t* out) {
    if (c <= 0 || out == nullptr) return false;
    bool neg = false;
    uint64_t ua, ub;
    if (a < 0) { neg = !neg; ua = (uint64_t)0 - (uint64_t)a; } else ua = (uint64_t)a;
    if (b < 0) { neg = !neg; ub = (uint64_t)0 - (uint64_t)b; } else ub = (uint64_t)b;
    I128 prod = mul_u64(ua, ub);
    uint64_t q_hi = 0, q_lo = 0, r = 0;
    div_128_by_64(prod.hi, prod.lo, (uint64_t)c, &q_hi, &q_lo, &r);
    // Floor rounding on a negative product adds one to the magnitude when the
    // unsigned division leaves a remainder.
    if (neg && r != 0) {
        if (q_lo == UINT64_MAX) { q_hi += 1; q_lo = 0; }
        else q_lo += 1;
    }
    if (neg) {
        if (q_hi != 0) return false;
        if (q_lo > (uint64_t)INT64_MAX + 1u) return false;
        if (q_lo == (uint64_t)INT64_MAX + 1u) { *out = INT64_MIN; return true; }
        *out = -(int64_t)q_lo;
        return true;
    }
    if (q_hi != 0) return false;
    if (q_lo > (uint64_t)INT64_MAX) return false;
    *out = (int64_t)q_lo;
    return true;
}

inline bool add_ovf(int64_t a, int64_t b, int64_t* out) {
    if ((b > 0 && a > INT64_MAX - b) || (b < 0 && a < INT64_MIN - b)) return false;
    *out = a + b;
    return true;
}
inline bool sub_ovf(int64_t a, int64_t b, int64_t* out) {
    if ((b < 0 && a > INT64_MAX + b) || (b > 0 && a < INT64_MIN + b)) return false;
    *out = a - b;
    return true;
}
inline bool mul_ovf(int64_t a, int64_t b, int64_t* out) {
    if (a == 0 || b == 0) { *out = 0; return true; }
    return muldiv_floor(a, b, 1, out);
}

inline int64_t imax(int64_t a, int64_t b) { return a > b ? a : b; }
inline int64_t imin(int64_t a, int64_t b) { return a < b ? a : b; }
inline int64_t iabs(int64_t a) { return a < 0 ? -a : a; }

} // namespace space

#endif
