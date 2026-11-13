// Checked int64 arithmetic for the attention layer. No 128-bit needed here
// (contrast fits in int64 by design; see contrast.hpp), so this file is just
// overflow-checked add / sub / mul, plus helpers. No exceptions, no RTTI, no
// compiler builtins. Portable across MSVC / MinGW / clang / gcc / Emscripten.
#ifndef ATTENTION_CPP_FIXED_HPP
#define ATTENTION_CPP_FIXED_HPP

#include <cstdint>

namespace att {

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
    // Clamp-check without using __int128: |a| <= INT64_MAX / |b| suffices,
    // because a*b <= INT64_MAX iff |a| <= INT64_MAX/|b| (with the INT64_MIN
    // edge handled separately below).
    if (a == INT64_MIN) {
        if (b == 1) { *out = INT64_MIN; return true; }
        if (b == -1) return false;
        if (b > 1 || b < -1) return false;
    }
    if (b == INT64_MIN) {
        if (a == 1) { *out = INT64_MIN; return true; }
        if (a == -1) return false;
        if (a > 1 || a < -1) return false;
    }
    int64_t aa = a < 0 ? -a : a;
    int64_t bb = b < 0 ? -b : b;
    if (aa == 0 || bb == 0) { *out = 0; return true; }
    if (aa > INT64_MAX / bb) return false;
    *out = a * b;
    return true;
}

inline int64_t imax(int64_t a, int64_t b) { return a > b ? a : b; }
inline int64_t imin(int64_t a, int64_t b) { return a < b ? a : b; }

} // namespace att

#endif
