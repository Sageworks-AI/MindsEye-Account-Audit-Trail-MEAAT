// Page split for a card's row count into pages of an archetype's shape. The
// header and footer are repeated on every page; rows-per-page is derived by
// integer division. Fits its capacity (Law L11) and returns an error when
// rows exceed the capacity of a non-paginating archetype.
#ifndef SPACE_CPP_PAGINATE_HPP
#define SPACE_CPP_PAGINATE_HPP

#include "fixed.hpp"

namespace space {

constexpr int32_t PAGINATE_OK = 0;
constexpr int32_t PAGINATE_ERR_TOO_MANY = 1;

struct Page { int32_t from; int32_t to; };

// In: rows >= 0, leadingCpt > 0, headerCpt >= 0, footerCpt >= 0, pageHCpt > 0,
//     paginates (bool), pages buffer of capacity >= rows (worst case 1 row
//     per page).
// Out: *nPages, *perPage.
// On capacity failure for a non-paginating archetype returns PAGINATE_ERR_TOO_MANY.
inline int32_t paginate(int32_t rows, int64_t leadingCpt, int64_t headerCpt,
                        int64_t footerCpt, int64_t pageHCpt, bool paginates,
                        Page* pages, int32_t pagesCapacity,
                        int32_t* nPages, int32_t* perPage) {
    if (!pages || !nPages || !perPage) return PAGINATE_ERR_TOO_MANY;
    if (rows < 0 || leadingCpt <= 0 || headerCpt < 0 || footerCpt < 0 || pageHCpt <= 0) {
        return PAGINATE_ERR_TOO_MANY;
    }
    int64_t content = pageHCpt - headerCpt - footerCpt;
    if (content <= 0) return PAGINATE_ERR_TOO_MANY;
    int64_t perPageBig = content / leadingCpt;
    if (perPageBig <= 0) return PAGINATE_ERR_TOO_MANY;
    if (perPageBig > INT32_MAX) perPageBig = INT32_MAX;
    int32_t pp = (int32_t)perPageBig;
    *perPage = pp;
    if (rows == 0) { *nPages = 0; return PAGINATE_OK; }
    if (rows <= pp) {
        if (pagesCapacity < 1) return PAGINATE_ERR_TOO_MANY;
        pages[0] = Page{0, rows};
        *nPages = 1;
        return PAGINATE_OK;
    }
    if (!paginates) return PAGINATE_ERR_TOO_MANY;
    int32_t n = 0;
    for (int32_t i = 0; i < rows; i += pp, ++n) {
        if (n >= pagesCapacity) return PAGINATE_ERR_TOO_MANY;
        int32_t hi = i + pp;
        if (hi > rows) hi = rows;
        pages[n] = Page{i, hi};
    }
    *nPages = n;
    return PAGINATE_OK;
}

} // namespace space

#endif
