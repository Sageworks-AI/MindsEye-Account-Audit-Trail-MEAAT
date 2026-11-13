// Split templates for 1..4 panes. The focal pane (index 0 of the geometry
// panes) always occupies the large slot. All splits use apportion() so
// Law L2 is discharged by construction. The 3-pane rule is 600:400 on the
// long axis (README #22); weights choose the large pane and split only the
// two small ones.
#ifndef SPACE_CPP_TEMPLATES_HPP
#define SPACE_CPP_TEMPLATES_HPP

#include "fixed.hpp"
#include "apportion.hpp"

namespace space {

struct Rect { int64_t x, y, w, h; };

// Fills out[0..n). All rects use the whole span and respect the gutter.
// Returns false on apportion failure or unknown n.
inline bool build_template(int32_t n, int64_t W, int64_t H, int64_t gutter,
                           int32_t largeIdx, Rect* out) {
    if (!out || n < 1 || n > 4) return false;
    if (W <= 0 || H <= 0 || gutter < 0) return false;
    if (n == 1) {
        out[0] = Rect{0, 0, W, H};
        return true;
    }
    if (n == 2) {
        if (W >= H) {
            int64_t w = W - gutter;
            int64_t weights[2] = {1, 1};
            int64_t parts[2];
            if (!apportion(w, weights, 2, parts)) return false;
            out[0] = Rect{0, 0, parts[0], H};
            out[1] = Rect{parts[0] + gutter, 0, parts[1], H};
        } else {
            int64_t h = H - gutter;
            int64_t weights[2] = {1, 1};
            int64_t parts[2];
            if (!apportion(h, weights, 2, parts)) return false;
            out[0] = Rect{0, 0, W, parts[0]};
            out[1] = Rect{0, parts[0] + gutter, W, parts[1]};
        }
        return true;
    }
    if (n == 3) {
        int32_t i1 = -1, i2 = -1;
        for (int32_t i = 0; i < 3; ++i) {
            if (i == largeIdx) continue;
            if (i1 == -1) i1 = i;
            else i2 = i;
        }
        if (i1 < 0 || i2 < 0) return false;
        if (W >= H) {
            int64_t ws = W - gutter;
            int64_t lw_weights[2] = {600, 400};
            int64_t lw[2];
            if (!apportion(ws, lw_weights, 2, lw)) return false;
            int64_t hs = H - gutter;
            int64_t hh_weights[2] = {1, 1};
            int64_t hh[2];
            if (!apportion(hs, hh_weights, 2, hh)) return false;
            out[largeIdx] = Rect{0, 0, lw[0], H};
            out[i1]       = Rect{lw[0] + gutter, 0, lw[1], hh[0]};
            out[i2]       = Rect{lw[0] + gutter, hh[0] + gutter, lw[1], hh[1]};
        } else {
            int64_t hs = H - gutter;
            int64_t lh_weights[2] = {600, 400};
            int64_t lh[2];
            if (!apportion(hs, lh_weights, 2, lh)) return false;
            int64_t ws = W - gutter;
            int64_t ww_weights[2] = {1, 1};
            int64_t ww[2];
            if (!apportion(ws, ww_weights, 2, ww)) return false;
            out[largeIdx] = Rect{0, 0, W, lh[0]};
            out[i1]       = Rect{0, lh[0] + gutter, ww[0], lh[1]};
            out[i2]       = Rect{ww[0] + gutter, lh[0] + gutter, ww[1], lh[1]};
        }
        return true;
    }
    // n == 4
    int64_t ws = W - gutter;
    int64_t hs = H - gutter;
    int64_t ww[2], hh[2];
    int64_t weights[2] = {1, 1};
    if (!apportion(ws, weights, 2, ww)) return false;
    if (!apportion(hs, weights, 2, hh)) return false;
    out[0] = Rect{0, 0, ww[0], hh[0]};
    out[1] = Rect{ww[0] + gutter, 0, ww[1], hh[0]};
    out[2] = Rect{0, hh[0] + gutter, ww[0], hh[1]};
    out[3] = Rect{ww[0] + gutter, hh[0] + gutter, ww[1], hh[1]};
    return true;
}

} // namespace space

#endif
