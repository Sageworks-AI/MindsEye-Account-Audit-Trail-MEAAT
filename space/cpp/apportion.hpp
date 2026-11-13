// Hamilton (largest-remainder) apportionment. Identical tie rule to
// space/js/apportion.mjs: remainders descending, then lower index wins.
// Discharges Law L2 — parts sum exactly to total — for every call.
#ifndef SPACE_CPP_APPORTION_HPP
#define SPACE_CPP_APPORTION_HPP

#include "fixed.hpp"

namespace space {

constexpr int32_t MAX_APPORTION_PARTS = 32;

// Preconditions enforced by return false (caller maps to ERR_BAD_ARGUMENT):
//   n in [1, MAX_APPORTION_PARTS], weights[i] > 0, total >= 0.
// Overflow in the sum or in the 128-bit intermediates also returns false.
inline bool apportion(int64_t total, const int64_t* weights, int32_t n, int64_t* parts) {
    if (n <= 0 || n > MAX_APPORTION_PARTS || !weights || !parts) return false;
    if (total < 0) return false;
    int64_t sum = 0;
    for (int32_t i = 0; i < n; ++i) {
        if (weights[i] <= 0) return false;
        if (!add_ovf(sum, weights[i], &sum)) return false;
    }
    // Quotients first: floor(total * w[i] / sum). total * w[i] can be 128-bit
    // but muldiv_floor handles it and refuses an overflowing quotient, which
    // cannot happen here since w[i] <= sum means the quotient is <= total.
    for (int32_t i = 0; i < n; ++i) {
        if (!muldiv_floor(total, weights[i], sum, &parts[i])) return false;
    }
    // Remainders. The mathematical value total*w[i] - parts[i]*sum fits a
    // non-negative int64 because it is < sum, but the intermediate product
    // total*w[i] can be 128-bit, so compute the difference in 128-bit and
    // assert the high word ends up zero.
    int64_t rems[MAX_APPORTION_PARTS];
    for (int32_t i = 0; i < n; ++i) {
        I128 tw = mul_u64((uint64_t)total, (uint64_t)weights[i]);
        I128 ps = mul_u64((uint64_t)parts[i], (uint64_t)sum);
        uint64_t rhi = tw.hi - ps.hi;
        uint64_t rlo = tw.lo - ps.lo;
        if (tw.lo < ps.lo) rhi -= 1;
        if (rhi != 0) return false; // invariant broken: parts[i]*sum > total*w[i]
        rems[i] = (int64_t)rlo;
    }
    // Distribute the leftover slots by remainder descending; ties to lower i.
    int64_t assigned = 0;
    for (int32_t i = 0; i < n; ++i) assigned += parts[i];
    int64_t left = total - assigned;
    int32_t order[MAX_APPORTION_PARTS];
    for (int32_t i = 0; i < n; ++i) order[i] = i;
    // Insertion sort by (remainder desc, index asc); n <= 32 so this is fine.
    for (int32_t i = 1; i < n; ++i) {
        int32_t key = order[i];
        int32_t j = i - 1;
        while (j >= 0) {
            int32_t oj = order[j];
            bool oj_goes_first;
            if (rems[oj] != rems[key]) oj_goes_first = rems[oj] > rems[key];
            else                       oj_goes_first = oj < key;
            if (!oj_goes_first) break;
            order[j + 1] = order[j];
            --j;
        }
        order[j + 1] = key;
    }
    for (int32_t k = 0; left > 0 && k < n; ++k, --left) parts[order[k]] += 1;
    return left == 0;
}

} // namespace space

#endif
