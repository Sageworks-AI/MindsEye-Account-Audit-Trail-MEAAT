# space/ — C ABI

The C ABI is the only way the JS layer talks to the compiled space module.
All state crosses the boundary as flat `int64_t` arrays. No JSON, no
structures, no strings except length-prefixed code-point arrays. Nothing is
allocated on the heap by the ABI itself: every function reads and writes
into a fixed scratch buffer of `space_scratch_size()` int64 slots.

## Conventions

- **Version word first.** Every input array and every output array begins
  with `space_version()` (= `1`). Any mismatch is `ERR_BAD_VERSION`.
- **All int64.** BigInt in the JS twin; `int64_t` in C++. Lengths that fit
  in a JS `number` are passed as int64 too — no `double` ever crosses.
- **Scratch.** JS calls `space_scratch_ptr()` once to obtain the byte
  address of the scratch buffer (as an int64 that fits an unsigned 32-bit
  offset in wasm32) and `space_scratch_size()` for its capacity in int64s.
  Every ABI function reads its input from `scratch[0..in_len)` and writes
  its output starting at `scratch[in_len ..)`. The function returns the
  output length in int64 slots, or a negative error code.
- **No floats.** Geometry is centipoints (1 cpt = 1/100 pt, 1 CSS px = 75
  cpt). Scale is `(num, den)` int64s, `den > 0`, reduced.
- **Determinism.** Same inputs → same outputs, every platform.

## Return codes
0 ok (output length ≥ 0)
-1 ERR_BAD_VERSION
-2 ERR_BAD_ARGUMENT (length/range/enum out of bounds)
-3 ERR_OVERFLOW (int64 overflow)
-4 ERR_DIVIDE_BY_ZERO
-5 ERR_OUTPUT_TOO_SMALL (scratch capacity exceeded)
-6 ERR_NO_FEASIBLE_LAYOUT (L4 legibility floor unreachable)
-7 ERR_PARTITION (L1 or L6 law would be violated)
-8 ERR_PAGINATE (L11 law would be violated)
-9 ERR_ARITHMETIC (hand-written 128-bit helper refused)


## Functions

Each entry lists the input array layout (from `scratch[0]`) and the output
array layout (from `scratch[in_len]`). `V` means the version word (always
`1`). All lengths include their own header.

### `space_version() -> int64`

Returns `1`. Does not touch scratch.

### `space_scratch_ptr() -> int64`

Returns the pointer to the scratch buffer as an int64 (wasm32 linear-memory
offset, or a native pointer truncated to int64 for tests).

### `space_scratch_size() -> int64`

Returns the capacity in int64 slots. Current value: 131072 (1 MiB).

### `space_measure_text(in_len) -> out_len | err`
in = [ V, family, fontSizeCpt, cpLen, cp0, cp1, ..., cp(cpLen-1) ]
out = [ V, widthCpt ]


`family`: `0` sans, `1` mono. `cp*` are Unicode code points (int64). Uses
the baked advance table from `params.hpp`. Fails `ERR_BAD_ARGUMENT` for an
unknown family, `ERR_BAD_ARGUMENT` if `cpLen < 0` or `cpLen > 256`.

### `space_apportion(in_len) -> out_len | err`
in = [ V, total, n, w0, w1, ..., wn-1 ]
out = [ V, n, p0, p1, ..., pn-1 ]


Parts sum exactly to `total`; ties broken by lower index. `n >= 1`.

### `space_claim_combine(in_len) -> out_len | err`
in = [ V, op, a_minW, a_prefW, a_maxW, a_minH, a_prefH, a_maxH, a_rows,
b_minW, b_prefW, b_maxW, b_minH, b_prefH, b_maxH, b_rows ]
out = [ V, minW, prefW, maxW, minH, prefH, maxH, rows ]


`op`: `0` stack, `1` sideBySide, `2` overlay. Shapes are intersected by the
JS twin before the call (they are not part of the ABI), so the caller passes
already-intersected shapes.

### `space_paginate(in_len) -> out_len | err`
in = [ V, archetypeIdx, shapeClass, rows ]
out = [ V, nPages, perPage, from0, to0, from1, to1, ... ]


`shapeClass`: `0` FULL, `1` HALF, `2` QUARTER, `3` STRIP. `archetypeIdx`
indexes the baked archetype table (below). `nPages == 0` when `rows == 0`.

### `space_anchor(in_len) -> out_len | err`
in = [ V,
oldRectX, oldRectY, oldRectW, oldRectH,
oldNum, oldDen,
anchorPageX, anchorPageY,
newRectX, newRectY, newRectW, newRectH,
newNum, newDen,
toleranceCpt,
viewportW, viewportH ]
out = [ V, viewOffsetX, viewOffsetY ]


All coordinates are cpt. `viewOffset*` is the integer offset to apply to
the *new* rect's origin so the anchor's screen position stays within
`toleranceCpt` of where it was, or inside the new rect if it cannot.

### `space_solve(in_len) -> out_len | err`
in = [ V, viewportW, viewportH, nPanes,
for each pane: archetypeIdx, isBar, rowsUpper, weight ]
out = [ V, nGeomPanes, focalIndex,
for each geometry pane:
origIdx, rectX, rectY, rectW, rectH,
shapeClass, tier,
scaleNum, scaleDen,
effectiveBodyCpt, nPages,
then nPages * [from, to] ]


`isBar != 0` marks an appearance-only pane that reserves no geometry
(Law L12). `weight` is the pane's weight for split apportionment; the
focal pane is index 0 of the geometry panes.

## Baked archetype table

`space/cpp/params.hpp` bakes the same fields as `space/reference/documents.json`.
Indices are stable and must match `space/marshal.mjs`:
0 balance_sheet_report_form
1 balance_sheet_t_form
2 income_statement
3 cash_flow_statement
4 trial_balance
5 journal_voucher
6 receipt_roll
7 small_business_flowchart
8 sequence_strip


## Baked advance table

`space/cpp/metrics.hpp` bakes the same `charWidths` and `fallback` as
`space/reference/metrics.json` for the `sans` and `mono` families, in
`1/1000 em` units, indexed by ASCII code point (0x20..0x7E). Any code point
outside that range uses the family fallback. This matches the JS twin.

## Error notes

- Every function validates the version word, all lengths (`0 <= len <=
  SCRATCH_SLOTS/2`), all enum values, all sign constraints (`den > 0`,
  `weights > 0`, `total >= 0`), and returns an error code rather than
  crashing.
- `space_solve` returns `ERR_NO_FEASIBLE_LAYOUT` when no pane can meet
  `MIN_BODY = 675 cpt` at the largest shape class that fits its rect.
- The scratch buffer is shared; a caller must not rely on its contents
  after another ABI call.
