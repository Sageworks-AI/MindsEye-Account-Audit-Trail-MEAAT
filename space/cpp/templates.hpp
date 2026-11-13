// Split templates for 1..4 panes. S6: accepts a per-pane weights array in
// template order (focal first). Mirrors space/js/templates.mjs. The 3-pane
// rule is 600:400 on the long axis (README #22); the two small panes share
// the 400 by their own weights. n=1 and n=4 ignore weights.
#ifndef SPACE_CPP_TEMPLATES_HPP
#define SPACE_CPP_TEMPLATES_HPP

#include "fixed.hpp"
#include "apportion.hpp"

namespace space {

struct Rect { int64_t x, y, w, h; };

// All rects use the whole span and respect the gutter. weights may be null
// (all panes weighted 1) or an array of at least `n` positive int64s.
// Returns false on apportion failure, unknown n, or invalid weights.
inline bool build_template(int32_t n, int64_t W, int64_t H, int64_t gutter,
                           const int64_t* weights, Rect* out) {
    if (!out || n < 1 || n > 4) return false;
    if (W <= 0 || H <= 0 || gutter < 0) return false;

    int64_t wbuf[4] = {1, 1, 1, 1};
    if (weights) {
        for (int32_t i = 0; i < n; ++i) wbuf[i] = weights[i] > 0 ? weights[i] : 1;
    }

    if (n == 1) {
        out[0] = Rect{0, 0, W, H};
        return true;
    }
    if (n == 2) {
        if (W >= H) {
            int64_t parts[2];
            int64_t ws[2] = {wbuf[0], wbuf[1]};
            if (!apportion(W - gutter, ws, 2, parts)) return false;
            out[0] = Rect{0, 0, parts[0], H};
            out[1] = Rect{parts[0] + gutter, 0, parts[1], H};
        } else {
            int64_t parts[2];
            int64_t ws[2] = {wbuf[0], wbuf[1]};
            if (!apportion(H - gutter, ws, 2, parts)) return false;
            out[0] = Rect{0, 0, W, parts[0]};
            out[1] = Rect{0, parts[0] + gutter, W, parts[1]};
        }
        return true;
    }
    if (n == 3) {
        int64_t small[2] = {wbuf[1], wbuf[2]};
        if (small[0] <= 0) small[0] = 1;
        if (small[1] <= 0) small[1] = 1;
        if (W >= H) {
            int64_t lw[2];
            int64_t large[2] = {600, 400};
            if (!apportion(W - gutter, large, 2, lw)) return false;
            int64_t hh[2];
            if (!apportion(H - gutter, small, 2, hh)) return false;
            out[0] = Rect{0, 0, lw[0], H};
            out[1] = Rect{lw[0] + gutter, 0, lw[1], hh[0]};
            out[2] = Rect{lw[0] + gutter, hh[0] + gutter, lw[1], hh[1]};
        } else {
            int64_t lh[2];
            int64_t large[2] = {600, 400};
            if (!apportion(H - gutter, large, 2, lh)) return false;
            int64_t ww[2];
            if (!apportion(W - gutter, small, 2, ww)) return false;
            out[0] = Rect{0, 0, W, lh[0]};
            out[1] = Rect{0, lh[0] + gutter, ww[0], lh[1]};
            out[2] = Rect{ww[0] + gutter, lh[0] + gutter, ww[1], lh[1]};
        }
        return true;
    }
    // n == 4: 2x2 grid, weights ignored.
    int64_t ww[2], hh[2];
    int64_t eq[2] = {1, 1};
    if (!apportion(W - gutter, eq, 2, ww)) return false;
    if (!apportion(H - gutter, eq, 2, hh)) return false;
    out[0] = Rect{0, 0, ww[0], hh[0]};
    out[1] = Rect{ww[0] + gutter, 0, ww[1], hh[0]};
    out[2] = Rect{0, hh[0] + gutter, ww[0], hh[1]};
    out[3] = Rect{ww[0] + gutter, hh[0] + gutter, ww[1], hh[1]};
    return true;
}

} // namespace space

#endif
