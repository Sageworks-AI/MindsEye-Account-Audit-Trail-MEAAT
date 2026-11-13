# The Measure Contract

`bridge/measure.mjs` is the only place the ledger brain and the space brain
meet. It imports `./schema.mjs` (which re-exports `core/schema.mjs`) and
`../space/index.mjs`, nothing else. The boundary checker enforces this at
file level: `bridge` may only import `core/schema.mjs` from `core`.

## What premeasure does

`premeasure(request, chartOfAccounts, viewportCpt, opts)`

- Synchronous. Never touches a journal. `chartOfAccounts` is plain data
  (from `Ledger.accounts`) or `null`.
- Computes an upper bound on rows for each card (see table below), passes
  each bound as `rowsUpper` to `space.solve`, returns, per card,
  `{ frameCpt, shapeClass, tier, scale, predictedRows, pagination }`.
- `frameCpt` is the frame in **centipoints** (1 cpt = 1/100 pt; 1 CSS px =
  75 cpt). Rectangles are exact int64; `space.solve` guarantees the L1
  partition, L3 uniform-scale, L4 legibility and L6 focal laws.

## What reconcile does

`reconcile(plan, exactCards)`

- Compares exact row counts (or the `sections` of built cards) against
  `predictedRows`. **Never changes any rect** — that is the L8 no-reflow
  guarantee. Page compaction inside a frame is a render-time concern.
- When `exact <= predicted` for every card: returns `{ ok: true, drafts }`
  with one `space.reconciled` draft per card.
- When `exact > predicted` for any card: returns
  `{ error, violations, drafts }`. Each violation is
  `{ index, type, exactRows, predictedRows }`; each draft is a
  `space.violation` event (plain object) that the caller marshals via
  `sequencer.events.eventFromDraft`.

## Row-bound table

When a chart of accounts is supplied, per-card row upper bounds are:

| Card type | Upper bound |
|---|---|
| `trial_balance` | `count(accounts)` |
| `balance_sheet` | `count(asset) + count(liability) + count(equity) + 1` |
| `income_statement` | `count(revenue) + count(expense) + 1` |
| `cash_flow` | `7` (4 cf classes + net change + opening + closing) |
| `receipt` | `MAX_ENTRY_LINES = 32` |

When no chart of accounts is supplied, `DEFAULT_ROWS` is used instead:
`60 / 40 / 30 / 7 / 32` for the same order. Both tables are documented in
the source of `bridge/measure.mjs` (`predictedRowsFor`).

`MAX_ENTRY_LINES = 32` is enforced by `Ledger.post`; the receipt upper bound
equals that cap so L7 is provable without inspecting the ledger.

## Px derivation

`pxFromCpt(rectCpt)` is the sole px derivation rule. It floors each
**edge**, not the width and height independently:

left_i = floor(x_i / 75)
right_i = floor((x_i + w_i) / 75)
w_i = right_i - left_i


This guarantees that px rects stay disjoint when cpt rects were, and that
the rightmost px edge never exceeds the px viewport width even when the
cpt viewport has a sub-pixel remainder. Used by `resolve/plan.mjs` and by
any caller that needs px coordinates for CSS.

## Event drafts

The bridge never imports `sequencer`; it returns plain event drafts:

{ type: 'space.premeasured' | 'space.laid_out' | 'space.reconciled'
| 'space.violation' | 'space.rejected' | 'space.degraded'
| 'space.fallback',
lane: 'space',
ref: { ... },
tags: [ ... ],
note?: string }


The caller turns them into real events with
`sequencer.events.eventFromDraft(draft, { id, ts, source })`. This keeps
the "invisible never means unaudited" rule while respecting the boundary
"bridge imports only schema, space and (S13) attention".

## Adapters in resolve/

`resolve/layout.mjs`, `resolve/tiers.mjs` and `resolve/plan.mjs` are thin
adapters over space and bridge:

- `layout.mjs` calls `space.chooseTemplate` for the split, converts px ↔
  cpt at the boundary. Same public API as before.
- `tiers.mjs` reads `TIER_THRESHOLDS` from `space/index.mjs` (one source of
  truth). Converts cpt → px for the exported thresholds.
- `plan.mjs` keeps its signature, calls `bridge.premeasure`, converts
  `frameCpt` back to px via `bridge.pxFromCpt`, attaches caller-supplied
  cache keys, returns the plan plus a `space.premeasured` draft.
