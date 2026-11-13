// Rational scale factors { num, den }, den > 0, reduced by gcd. The only
// non-integer quantity the space layer uses; comparisons are cross-
// multiplied, never floated.
#ifndef SPACE_CPP_RATIONAL_HPP
#define SPACE_CPP_RATIONAL_HPP

#include "fixed.hpp"

namespace space {

struct Rational {
    int64_t num;
    int64_t den;
};

inline int64_t gcd64(int64_t a, int64_t b) {
    if (a < 0) a = -a;
    if (b < 0) b = -b;
    while (b != 0) { int64_t t = a % b; a = b; b = t; }
    return a;
}

// Normalises sign and reduces. den == 0 is a caller error (returns false).
inline bool make_rational(int64_t num, int64_t den, Rational* out) {
    if (den == 0 || out == nullptr) return false;
    if (den < 0) { num = -num; den = -den; }
    int64_t g = gcd64(num, den);
    if (g > 1) { num /= g; den /= g; }
    out->num = num;
    out->den = den;
    return true;
}

// floor(length * num / den). Caller guarantees den > 0.
inline bool apply_rational(int64_t length, Rational r, int64_t* out) {
    return muldiv_floor(length, r.num, r.den, out);
}

// -1 if a < b, 0 if equal, +1 if a > b. Cross-multiplied; product of two
// int64s is used, so values must be within mul_ovf's range — the space
// layer only ever compares scale factors derived from page and rect sizes,
// well within range.
inline int compare_rational(Rational a, Rational b) {
    int64_t l = 0, rr = 0;
    if (!mul_ovf(a.num, b.den, &l)) return (a.num > 0) ? 1 : -1;
    if (!mul_ovf(b.num, a.den, &rr)) return (b.num > 0) ? -1 : 1;
    if (l < rr) return -1;
    if (l > rr) return 1;
    return 0;
}

} // namespace space

#endif
