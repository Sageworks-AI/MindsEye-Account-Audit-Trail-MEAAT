# attention/ — the attention brain

Decides *appearance order*: which pane is focus / near / far. **Appearance
only.** No geometry, no money, no ledger objects. Imports nothing outside
`attention/`. Enforced by `scripts/check-boundaries.mjs`.

## What it is

Three actors live in one ordered list — the **ring**, most recent first.
Actor kinds: `DOC` (a card pane), `FORM` (the entry form), `TRAIL` (the
trail board), `BAR` (the floating input bar, present only while input is
active). Each actor has a rank = its index in the ring; its **level** is
`min(rank, 2)`:

- **level 0** — focus: the most seen
- **level 1** — near: the one you viewed just before
- **level 2** — far: everything else

The single movement primitive is **move-to-front**. `FOCUS(X)` moves X to
rank 0 and leaves everyone else's relative order intact.

## Two views of one ring

- **Appearance ring** — the full ring, including BAR while input is active.
  Drives levels.
- **Geometry ring** (`docRank`) — the same ring with BAR removed. Drives the
  space solver's slots. Because BAR is excluded, beginning or ending input
  changes appearance only and moves no pane (Law L12 of Addendum A).

## Events

`OPEN`, `CLOSE`, `FOCUS`, `INPUT_BEGIN`, `INPUT_END`, `TRANSFER_COPY`,
`TRANSFER_PASTE`, `TRANSFER_CANCEL`, `BACK`, `RESIZE`. Each event's
preconditions, postconditions and inverse are listed in `LAWS.md`.

## Rules (short form)

- **Python proposes, C++ disposes.** In S7 the JS twin is authoritative.
  In S8 a C++ port must produce byte-identical states for the same event
  sequence (parity tested). In S9 a Python conductor proposes event
  sequences; the twin (or C++/wasm in S8+) accepts, rejects or no-ops them.
- **Nothing disappears.** Only `CLOSE` removes an actor. Dimmed panes stay
  visible and interactive.
- **Input primacy.** While input is active, `BAR` is rank 0 and no event
  displaces it. FOCUS reorders documents only.
- **Pin.** While a transfer is armed, the source is at rank 0 or 1 and can
  never fall to level 2.
- **Anti-oscillation.** A pointer FOCUS is accepted only if its
  `pointerEpoch` is strictly greater than the epoch recorded at the last
  accepted pointer FOCUS. Otherwise it returns `POINTER_STALE` and the
  state is unchanged. The JS side increments `pointerEpoch` only on real
  pointer movement, coalesced per frame.

## Determinism

`step(state, event)` is pure: it never mutates its inputs and produces the
same new state for the same inputs. `hashState(state)` returns a stable
SHA-256 over a canonical JSON form. Laws M11 (determinism/parity) and M4
(idempotent FOCUS) are checked against these hashes.

## Level table

`attention/dist/levels.json` holds the default level table for both light
and dark themes, plus timing tokens and easing control points. It is data,
not code: `attention/js/levels.mjs` validates it against T1–T4 at module
load and throws if a rule is violated. The defaults are chosen to pass the
contrast floors (7:1 / 4.5:1 / 3:1 for levels 0 / 1 / 2).

## ABI (S8)

The C ABI (attention/cpp + attention/dist/attention.wasm) carries the same
state shape as flat int64 arrays. The JS twin's `step()` is the oracle.
Details in `attention/ABI.md` (S8).
