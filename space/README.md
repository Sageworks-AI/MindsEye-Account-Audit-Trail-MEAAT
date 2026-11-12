# space/ — the space brain

The space brain decides *how much room* everything takes and *where* it
sits. It knows nothing about accounting. It sees only: counts, formatted
strings (for measuring), enumerations, and integers. It never sees money
values or ledger objects.

## Units

- Base unit: **centipoint (cpt)** = 1/100 typographic point.
- 1 pt = 100 cpt. 1 CSS px = 0.75 pt = exactly **75 cpt**.
- All lengths are `BigInt` int64 in the JS twin (identical semantics to the
  C++ `int64_t` in `space/cpp`). Rational scale factors are `{ num, den }`
  pairs of `BigInt`, `den > 0`, reduced by gcd.
- Rounding: lengths **floor**; remainders are distributed by the
  largest-remainder (Hamilton) method; ties go to the lower index. Every
  add and multiply is range-checked; overflow returns an error code in the
  C ABI and throws in the JS twin.

## Paper sizes (points; conventional PDF roundings)

| name | width × height |
|---|---|
| A3 | 842 × 1191 |
| A4 | 595 × 842 |
| A5 | 420 × 595 |
| US Letter | 612 × 792 |
| 80 mm receipt roll | 227 × variable |
| 58 mm roll | 164 × variable |

Aspect ratios are exact rationals built from these integers. Never sqrt(2).

## Shape classes

Each archetype in `reference/documents.json` declares its `shapeDimensions`
for the four shape classes:

- **FULL** — the whole document
- **HALF** — a section group (e.g. assets only, or liabilities and equity)
- **QUARTER** — headline totals plus one section summary
- **STRIP** — a one-line band

A card is drawn into a *logical page* of its archetype; on-screen, one
uniform rational scale is applied to the logical coordinates (SVG viewBox),
so proportions are exact. The pane's bounding box is the floored result.

## Reference data

`reference/documents.json` and `reference/metrics.json` are data, not code.
`reference/loader.mjs` validates them: missing fields, non-integers, and
margins larger than the page are rejected. Values are **reference defaults**
from common small-business accounting practice (margins ~20 mm = 57 pt,
body 10 pt, headings 12–14 pt, captions 8 pt, leading 1.2× body, a balance
sheet of roughly 20–40 lines, an income statement of 15–30). They are not
legal or regulatory standards. To change, edit the JSON; the loader will
reject anything that violates the range checks.

## Constants assumed by the solver

- `MIN_BODY = 675 cpt` (9 CSS px) — effective on-screen body size floor.
- `DISPLAY_MAX = 12` — maximum formatted amount length in characters; longer
  amounts switch to "in thousands" with a header note.
- `focusTolerance = 300 cpt` (4 CSS px).
- `gutter = 600 cpt` (8 CSS px).
- Paper-size roundings and every default above are recorded in
  `README.md §Assumptions`.

## Import rules

`space/` imports nothing outside `space/`. `core/` never imports `space/`
or `bridge/`. `bridge/` is the only module that imports both. Enforced by
`scripts/check-boundaries.mjs`.

## Build

`space/js/` is the complete JS twin — no compiler required. `space/cpp/`
(S5) provides the same algorithms in C++20 for native parity tests and
Emscripten compilation to `dist/space.wasm` (committed).
