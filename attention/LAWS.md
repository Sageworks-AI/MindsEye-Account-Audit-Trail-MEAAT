# Attention laws

Enforced by `attention/js/machine.mjs` (the JS twin) and, from S8, by
`attention/cpp/machine.hpp` with byte-identical behaviour. Tests live in
`test/attention/laws.test.mjs`.

## Movement laws (M)

- **M1 Conservation.** The set of actors is unchanged by every event except
  `OPEN`, `CLOSE`, `INPUT_BEGIN` and `INPUT_END`, which only add or remove
  `BAR` (the input bar).
- **M2 Totality and shape.** Every actor has level in {0, 1, 2}. Exactly one
  actor has level 0. If there are at least two actors, exactly one has
  level 1. All others have level 2. (`level(actor) = min(rank, 2)`, and
  rank = the actor's index in the ring, so M2 is a consequence of the ring
  being well-formed and having unique ranks.)
- **M3 Stability.** `FOCUS(X)` preserves the relative order of all actors
  other than X.
- **M4 Idempotence.** `FOCUS(X)` when X is already at rank 0 is a no-op:
  the resulting state hashes identically to the input state.
- **M5 Reversibility.**
  - `INPUT_BEGIN` followed immediately by `INPUT_END(cancel)` returns the
    identical state.
  - `TRANSFER_COPY(S, kind)` followed immediately by `TRANSFER_CANCEL`
    returns the identical state.
  - `BACK` (with input and transfer idle) undoes exactly one focus change.
- **M6 Input primacy.** While input is active, `BAR` is at rank 0 and no
  event displaces it. A `FOCUS(X)` during input moves X to rank 1 (not 0)
  and preserves the relative order of the other non-BAR actors.
- **M7 Pin.** While a transfer is armed, the source is at rank 0 or 1 and
  cannot reach level 2.
- **M8 Geometry agreement.** `docRank(actor)` = rank counting only non-`BAR`
  actors. `docRank 0` is the space solver's focal pane. `BAR` never appears
  in the geometry ring.
- **M9 Appearance only.** For every step, the state contains no geometry
  (rects, scales). A pure appearance step (input, transfer arm) changes no
  rect and no scale.
- **M10 No oscillation.** A pointer `FOCUS` whose `pointerEpoch` is not
  strictly greater than `state.lastPointerEpoch` returns `POINTER_STALE`
  and leaves the state unchanged.
- **M11 Determinism and parity.** Identical event sequences produce
  byte-identical states. (In S8, native, wasm, JS twin and Python ctypes
  must agree bit-for-bit; S7 verifies the twin against itself.)
- **M12 Boundedness.** History depth never exceeds 16 entries. Ring never
  exceeds 8 actors. Exceeding either is a clean error (`RING_FULL` or
  `HISTORY_FULL`), never a silent loss.
- **M13 Primary/secondary pairing.** In any armed transfer, once a target
  distinct from the source is focused, the pair `(target, source)` occupies
  levels `(0, 1)`.
- **M14 Closure.** After `CLOSE(actor)`, the remaining ring order equals the
  previous order with that actor removed.
- **M15 Priority.** `BACK` resolves in the order input, transfer, history,
  with exactly one effect per press.

## Level-table laws (T)

Checked by `attention/js/levels.mjs:validateLevels()`. The default table in
`attention/dist/levels.json` passes; a mutation test in
`test/attention/laws.test.mjs` requires that a bad table is rejected.

- **T1 Monotonic.** opacity, brightness, saturation and shadow radius never
  increase with level (levels are ordered focus → near → far). Blur radius
  never decreases with level.
- **T2 Distinct.** Adjacent levels differ by at least 100 permille on
  opacity, so the three levels are perceptibly different.
- **T3 Legible.** Effective text contrast ratio at each level must stay
  above its floor, per theme:
  - level 0: 7000 permille (7:1)
  - level 1: 4500 permille (4.5:1)
  - level 2: 3000 permille (3:1)

  Effective colours are computed in integer sRGB: the foreground is blended
  toward the theme's background by `opacity * brightness / 1e6`, and the
  relative luminance uses a 256-entry integer LUT (permille linearity).
  Contrast is the standard `(L1 + 0.05) / (L2 + 0.05)` formula, expressed
  as a rational and compared by cross-multiplication in int64.
- **T4 Appearance only.** The level table contains no width, height or
  position fields. A structural check rejects a table that adds them.

## Invariants after every step

`step()` returns a state that satisfies M1, M2, M6, M7, M8, M9, M12, M14
by construction, or returns an error code with the input state unchanged.
The tests additionally verify M3, M4, M5, M10, M11, M13, M15.
