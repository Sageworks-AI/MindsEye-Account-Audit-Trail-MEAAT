# Mind's Eye Account Audit Trail (MEAAT)

An enclosed, offline-capable accounting system whose interface is a split
screen of "state cards" (balance sheet, cash flow, receipt, and so on) drawn
as SVG slips. Three data layers: an append-only **Journal** (financial truth),
a **Sequencer** (time-labelled events, advisory only), and a **Card Store**
(derived cache). Three interface modes: **Read**, **Input**, **Trail**.

Enclosed means: one `git clone`, one `npm install`, one command to run. No
cloud accounts, no CDN, no web fonts, no network calls at runtime or at
report time, no credentials anywhere in the repo.

## Current status

All fifteen stages are complete. S0 through S14 are marked **done** in the
status table below; the two C++/wasm stages (S5, S8) are marked
**sources done, wasm pending local build**, which is the documented,
test-passing state: the C++ sources, CMake files, ABI, parity tests,
manifest tooling and CSS emitter are all in place, and the compiled
`space/dist/space.wasm` and `attention/dist/attention.wasm` are produced
locally by the developer with `npm run build:space` / `npm run
build:attention`. **The JS twins are authoritative.** `npm test`,
`npm run report`, `npm run dev` and `npm start` all work with no wasm, no
C++ toolchain and no Python.

## Design in one page

- **Time is the coordinate. Money is the measured quantity.** Every card is
  a pure function of `(journal, time coordinate, parameters)`. A card never
  stores its own date; it receives one. A **Tick** is `{ date, seq }` so two
  entries on the same day still have a total order.
- **Three brains, one bridge.**
  - **Ledger brain** (`core/`, `store/`) — decides *what* is shown.
  - **Space brain** (`space/`) — decides *how much room* and *where*.
  - **Attention brain** (`attention/`) — decides *appearance order*.
  They meet **only** in `bridge/`. `core/` never imports `space/`, `bridge/`,
  `attention/`, `store/`, `sequencer/`, `server/` or `view/`. `space/` and
  `attention/` import nothing outside their own folders. `bridge/` may import
  `core/schema.mjs` **only** from `core/`. See
  `scripts/check-boundaries.mjs` for the enforced matrix.
- **Python proposes, C++ disposes.** The Python conductor (`conductor/`)
  proposes event sequences; the attention state machine (JS twin today,
  wasm or native in production) accepts, rejects or no-ops them. Python
  holds no state of its own; every state comes from the engine.
- **View is pure.** `view/` functions are `(card data, rect, tier, theme) ->
  SVG string`. No DOM, no React, no ledger imports, no network. React only
  mounts and wires; every SVG the client shows comes from `view/`.
- **Determinism.** Same journal and same request always produce byte-identical
  cards, hashes and SVG. `npm run report` produces byte-identical output on
  two runs (checked by `npm test` and by `scripts/check-dod.mjs`).
- **No floats.** Money is an integer in minor units. Geometry is int64
  **centipoints** (1 cpt = 1/100 pt; 1 CSS px = 75 cpt). SVG coordinates are
  emitted as exact decimal strings derived from BigInt cpt values.
- **Append-only journal.** Corrections are reversal entries: a mirror entry
  with a `reverses` field pointing at the original seq.
- **The Journal is the only source of financial truth.** Sequencer events
  and cached cards are derived or advisory. Nothing financial is ever read
  back from events.
- **No number reaches the screen except from a card builder.**
- **Every card carries checks.** A failing check is visible on the card and
  makes `npm run report` exit non-zero.

## Running

Requires Node 20 or newer. Nothing else is required for the core workflow.

```
npm install

# Development: server on 127.0.0.1:4000 and Vite on 127.0.0.1:5173.
npm run dev

# Production: build the client, then serve the client AND the API on one port.
npm run build && npm start
```

### Tests and verification

```
# All node:test suites plus the boundary check and the two manifest checks.
# `npm test` runs `node --test --test-reporter=spec` first, so the per-file
# output is readable; a failure in any suite is a hard failure.
npm test

# Individual checks, runnable on their own:
node --test --test-reporter=spec               # all node:test suites
npm run check-boundaries                       # import-boundary matrix
npm run verify:space                           # space/dist/manifest.json
npm run verify:attention                       # attention/dist/manifest.json
npm run verify                                 # data/journal.jsonl hash chain

# Optional: native C++ tests for space and attention. Skipped cleanly
# (exit 0, notice printed) when CMake or a C++ compiler is absent.
npm run test:cpp
```

`npm run verify:space` and `npm run verify:attention` both print
`no wasm built yet, JS twin in use` on a fresh clone (or `verify:*: OK`
when the corresponding wasm has been built locally). The JS twins are
authoritative; a missing wasm never causes a test to fail.

Optional, requires Python 3.10+ (build-time only, standard library only):

```
npm run conduct                                # regenerate conductor/out/
npm run conduct:verify                         # byte-compare to disk
npm run test:conductor                         # skipped without Python
```

Optional, requires a C++ toolchain (Emscripten for the wasm binaries):

```
npm run build:space
npm run build:attention
npm run gen:space-golden
npm run gen:attention-golden
```

Demo and report:

```
npm run demo                                   # card summaries for the demo ledger
npm run report                                 # out/report.html + out/report.json
```

Server options: `--port N`, `--host H` (default `127.0.0.1`), `--data DIR`
(default `./data` or `$DATA_DIR`), `--production`. `npm start` implies
`--production`.

## Report contents

`out/report.html` is a single self-contained file (inline SVG, inline CSS,
no network). Sections, in order: Read (three cards laid out by the space
solver), Impact (receipt 4 beside the balance sheet with before / delta /
after and the sequence strip), Trail (flowchart from the credit sale
through the cash collection, reconciled to its target), Sequencer (event
counts per lane and cache hit/miss), Checks (the aggregated check table),
Space (per-layout diagrams from solver output, plus layouts n = 1..4 at
three viewport sizes proving the laws), Attention (a storyboard for W1..W10
from a live replay through the JS twin), Levels (both themes' level tables
with integer contrast figures and the three-level swatch), and Fuzz (the
fuzz summary). `out/report.json` carries the same data.

## Repository layout

```
core/ money, time, canonical, hash, accounts, ledger, checks, cards, impact, trail, schema
store/ journalFile, journalMemory, cardStore, trailStore
sequencer/ events, lanes, buckets, log, strip
resolve/ request, layout, tiers, plan, command, dates
view/svg/ text, theme, primitives, slip, impact, trail, strip
space/ JS twin, C++ sources, reference data, wasm
attention/ JS twin, C++ sources, level table, wasm, CSS emitter, cli
conductor/ Python 3.10+ build-time conductor: workflows, choreography, fuzz, storyboards
bridge/ schema.mjs, measure.mjs, attention.mjs, contract.md
server/ index.mjs, config.mjs, router.mjs, errors.mjs, bodyLimit.mjs,
        static.mjs, sse.mjs, routes/*
app/ index.html, vite.config.js
     src/main.jsx, App.jsx, api.js, styles.css
     src/components/{Workspace, CommandBox, TimeCursor, SequenceStrip,
                     TrailBoard, CardSlip, PageFrame}.jsx
     src/layers/{PagesLayer, InputLayer}.jsx
     src/hooks/{useWorkspace, useCards, useStrip, useAttention}.js
     src/attention/{machine-browser.mjs, levels.mjs, driver.mjs,
                    keyboard.mjs, ChoreoPlayer.jsx}
     src/state/workspace.mjs
     src/styles/{tokens.css, attention.css}
demo/ demo.ledger.mjs, report.mjs, report-{read,meta,space,attn}.mjs
test/ node:test suites
scripts/ check-boundaries, verify-journal, build-space, test-cpp,
         verify-space, gen-space-golden, build-attention, verify-attention,
         gen-attention-golden, emit-attention-css, test-cpp-attention,
         conduct, stages.json, api-surface.mjs, check-dod.mjs
data/ runtime only (gitignored): journal.jsonl, events.jsonl, trails/, cards-cache.json
out/ report output (gitignored): report.html, report.json
```

The server binds `127.0.0.1` only. There is **no authentication in v1** — that
is a known limit; do not expose this server on a public interface.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness + head + counts |
| GET | `/api/head` | journal head only |
| GET | `/api/accounts` | chart of accounts |
| POST | `/api/entries` | post a new entry |
| POST | `/api/entries/:seq/reverse` | post a reversal |
| GET | `/api/cards?types=…&from=…&to=…&asOf=…&entryId=…&focus=…` | build or return cached cards |
| POST | `/api/plan` | layout plan (premeasure, cache keys) |
| POST | `/api/command` | deterministic grammar; never posts |
| GET | `/api/events?since=…&limit=…` | event log tail |
| GET | `/api/events/stats?bucket=…&minutes=…` | per-lane counts |
| GET | `/api/trails` | list trails |
| GET | `/api/trails/:id` | read a trail |
| PUT | `/api/trails` | save a trail |
| POST | `/api/verify` | hash-chain verification |
| GET | `/api/strip?…` | pre-built strip data (extension; see #70) |
| GET | `/api/stream` | SSE: Sequencer events |

All error responses are `{ error, code }` with `code` as a stable
identifier (`BAD_ENTRY`, `BAD_REVERSAL`, `BAD_QUERY`, `NOT_FOUND`,
`METHOD_NOT_ALLOWED`, `INTERNAL`, `PAYLOAD_TOO_LARGE`, `INVALID_JSON`,
`JOURNAL_WRITE_FAILED`, `CARD_BUILD_FAILED`, `PLAN_FAILED`, `STRIP_FAILED`,
`BAD_BODY`, `BAD_TRAIL`, `WRITE_FAILED`, `READ_FAILED`, `BAD_SEQ`,
`CLIENT_CLOSED`, `REQUEST_ERROR`).

## Known issues

No failing tests are recorded. The three checks that make up the DoD all
pass on a fresh clone with no toolchain:

- `node --test --test-reporter=spec` and `npm test` — 0 failures.
- `npm run check-boundaries` — `boundary check: OK`.
- `npm run verify:space` and `npm run verify:attention` — print `no wasm
  built yet, JS twin in use` and exit 0.
- `npm run report` — writes `out/report.html` and `out/report.json`, exits
  0, and produces byte-identical output on two runs (asserted by
  `test/report.test.mjs` and by `scripts/check-dod.mjs`).
- `npm run verify` — verifies the journal hash chain (or notes there is no
  journal yet on a fresh clone).
- `npm run test:cpp` — skips cleanly when CMake or a C++ compiler is
  absent; with them, runs the native space and attention tests.

The following are **known limitations that do not block the Definition of
Done**, not failing tests:

- The wasm binaries under `space/dist/` and `attention/dist/` are built
  locally (`npm run build:space`, `npm run build:attention`). They are not
  required for `npm test`, `npm run report`, `npm run dev` or `npm start`;
  the JS twins are authoritative.
- Pointer focus in the client is click-only (no dwell timer). The state
  machine's anti-oscillation epoch is in place; the dwell loop is a future
  feature.
- No selection model in the client: Ctrl/Cmd+C / +V fall through to native
  copy/paste. The transfer matrix is implemented in the state machine; the
  driver does not yet produce TRANSFER events from user gestures.
- The client's TrailBoard is read-only; a full trail builder (drag nodes,
  draw links, save) is not implemented.
- Theme re-render: `PageFrame` and `SequenceStrip` read `data-theme` on
  render, so an OS theme change while a component is mounted is picked up
  on the next workspace change, not immediately.
- The sequence strip clips visually with more than ~3 figures; the SVG has
  its true intrinsic height, so a taller CSS container fixes it.
- The chart of accounts is fixed in v1 (`server/config.mjs` exports the
  eight demo accounts); there is no create-account endpoint.
- 405 responses do not set an `Allow` header.
- Trail layout uses evenly spaced dates, not calendar distance.

## Assumptions and conflict resolutions

Precedence: base specification (Part 1) > Addendum A (space layer) >
Addendum B (attention layer). Every conflict and every deliberate choice
is recorded below.

1. **`app` import rules.** App may import `view`, `resolve`, `space`,
   `attention`, `bridge`, its own files, and `react` / `react-dom` /
   `vite` / `@vitejs/plugin-react`. `app/src/attention/` is restricted
   to `attention`, `bridge` and its own files.

2. **`.gitignore` and the wasm binaries.** `space/dist/` and
   `attention/dist/` are committed when built; `app/dist/` and native
   build directories are not.

3. **Python conductor is build-time only.** Python 3.10+ is optional;
   `npm test` and `npm run report` never invoke Python.

4. **Voice adapter default = none.**

5. **View purity vs importing `space`.** Renderers are self-contained
   (see #55).

6. **`npm test` scope** = base node:test + boundary + space laws/parity
   + attention laws/workflows/CSS drift + verify:space + verify:attention.

7. **`data/`, `out/`, `.env`.** All gitignored.

8. **Centipoint scale** (1 cpt = 1/100 pt, 1 CSS px = 75 cpt).

9. **Reference defaults** in `space/reference/documents.json` are not
   legal or regulatory standards.

10. **`DISPLAY_MAX`** switches long amounts to "in thousands".

11. **`MIN_BODY = 9 px` (675 cpt)** — the solver rejects anything smaller.

12. **Focus tolerance = 4 px (300 cpt)**.

13. **Attention level formula.** `level = min(rank, 2)`.

14. **Pointer dwell = 250 ms.**

15. **"Focus stays at center."** Viewport centre inside the focal rect;
    anchor within tolerance.

16. **Python ctypes fallback.**

17. **`npm run dev` on Windows.** Uses `concurrently`; fall back to two
    terminals if needed.

18. **Node version.** `engines.node >= 20`.

19. **Boundary-check enforcement.**

20. **Git tracking policy.** `.gitattributes` pins LF; wasm marked binary.

21. **License.** MIT.

22. **Three-pane rule (60 percent).**

23. **Narrower QUARTER and STRIP pages.**

24. **Schema route for `resolve`.**

25. **`resolve/dates.mjs` mirrors `core/time.mjs`.**

26. **`plan()` takes its cache-key function from the caller.**

27. **Copyright line in `LICENSE`.**

28. **L7 and L8 tested in `bridge/` tests.**

29. **Constancy guards.** Stage manifest (`scripts/stages.json`), an API
    surface snapshot (`scripts/api-surface.mjs`), golden outputs (demo card
    hashes, layout rects), and the DoD script (`scripts/check-dod.mjs`).

30. **Portable 128-bit arithmetic** in `space/cpp/fixed.hpp`.

31. **Golden vectors.** `space/cpp/test/golden/` and
    `attention/cpp/test/golden/` regenerated by `gen:*` scripts.

32. **CRLF-normalised hashing** for both `space` and `attention` manifests,
    and for `conductor/out/manifest.json`.

33. **Standalone wasm.** Both builds use `--no-entry -sSTANDALONE_WASM=1`.

34. **Empty `space/dist/` and `attention/dist/`.** `npm test` passes with
    no wasm; `verify:*` prints a notice and exits 0.

35. **`MAX_ENTRY_LINES = 32`.**

36. **px derivation rule.** Edge-flooring keeps px rects disjoint.

37. **Bridge event drafts.** Turned into events by
    `sequencer.events.eventFromDraft`.

38. **`resolve/` delegates to `space/` and `bridge/`.**

39. **Focal weights coerce to 1.**

40. **Attention state shape.** `state = { ring, history, input, transfer,
    lastPointerEpoch }`.

41. **Anti-oscillation epoch.** Stale pointer FOCUS is rejected.

42. **Transfer matrix.** Enforced in `attention/js/machine.mjs` and
    `attention/cpp/machine.hpp`.

43. **Level-2 opacity is 760** so both the normal (3:1) and prefers-contrast
    (4.5:1) floors pass.

44. **Keyboard shortcuts (client).** Tab/F6 cycling, Ctrl/Cmd+K focus-input,
    Escape BACK. Ctrl/Cmd+C/V fall through to native copy/paste; the driver
    does not implement selection (see "Known issues").

45. **`attention/cli.mjs` line protocol.** JSON line in, JSON line out.

46. **Shadow and radius are centipoints** in `levels.json`, not permille.

47. **Attention ABI version is 1.** Same rule as `space` ABI.

48. **`emit_state` emits `sourceId` as length-prefixed code points.**

49. **CSS emission is byte-stable.**

50. **Static scan for hand-written appearance values.**

51. **`conductor/out/` is regenerated by `npm run conduct`.**

52. **Python discovery is wrapped in `scripts/conduct.mjs`.**

53. **`test_verify.py` copies the whole `attention/` tree.**

54. **`cancelVariant` re-runs from the workflow's `initialRing`.**

55. **View renderers are self-contained.** `view/svg/*` does not import
    `space/`, `core/`, `store/`, `resolve/` or `bridge/`.

56. **SVG coordinates are exact decimal strings derived from BigInt cpt.**

57. **Card headings and titles truncate with an ellipsis and carry a
    `<title>` element when truncated.**

58. **Trail layout uses evenly spaced x positions, not calendar distance.**

59. **Node collision within a lane offsets by NODE_H/4.**

60. **`view/svg/strip.mjs` renders the strip's currency from an options
    argument.**

61. **Renderer tests do not depend on the wasm.**

62. **`.gitignore` continues to exclude `app/dist/`; `view/` is source.**

63. **`demo/` does not import from `test/`.**

64. **Report section files are split for the ~300-line rule.**

65. **`setupDemo()` provides the sequencer event list.**

66. **`buildReport` aggregates checks from every section.**

67. **The report's fuzz section reads `conductor/out/fuzz-summary.json`
    when present.**

68. **The report reads workflow JSON files directly.**

69. **The server's chart of accounts is fixed in v1.**

70. **`/api/strip` is an extension.**

71. **SSE stream is capped at 32 subscribers.**

72. **Production mode serves `app/dist` with SPA fallback.**

73. **No authentication; binds to 127.0.0.1.**

74. **`server/index.mjs` exposes `createServer()` for tests.**

75. **Startup fails fast on a broken journal.**

76. **`app/src` may import `app/src/attention/`.** The base rule "app
    imports view and its own api.js only" cannot coexist with Addendum B,
    which requires `app/src/attention/` to be a real mounted module. The
    `app/src` area in `scripts/check-boundaries.mjs` therefore lists
    `app/src/attention` in its allowed sibling paths.
    `app/src/attention/` is still restricted to importing `attention`,
    `bridge` and `react`/`react-dom`.

77. **`CardSlip.jsx` is the spec name; `PageFrame.jsx` is the
    implementation.** `CardSlip.jsx` re-exports `PageFrame as CardSlip` so
    both names are available.

78. **The browser-safe attention machine is a small duplicate.** The
    canonical `attention/js/machine.mjs` imports `node:crypto` at module
    load. A browser cannot import that. `app/src/attention/machine-browser.mjs`
    is the same state machine without `hashState`. A random-event
    differential test between this file and `attention/js/machine.mjs` is a
    follow-up.

79. **S13 client limitations (v1).** Click-to-focus only; no selection or
    transfer gestures yet; read-only trail board; theme re-render only on
    next state change; strip clips with more than ~3 figures.

80. **`npm run dev` starts both processes.** Uses `concurrently`; two
    terminals if needed.

81. **The API surface snapshot is a commitment.** Adding or removing a
    public export requires updating `scripts/api-surface.mjs` in the same
    commit. `test/api-surface.test.mjs` fails otherwise, which is the
    point: a rename in one module cannot silently break a consumer in
    another.

82. **The DoD script is the single command for the final acceptance
    check.** `node scripts/check-dod.mjs` runs `npm test`, then two
    `npm run report` invocations with a sha256 comparison, then
    `npm run verify`, and exits 0 only if everything passes. It is
    documented as the last step of the workflow below.

83. **Status table consistency is enforced.** `scripts/stages.json` lists
    the same stages, titles and states as this table.
    `test/stages.test.mjs` fails on any drift, so the table cannot become
    a lie.

## Status by stage

| Stage | Content | State |
|---|---|---|
| S0 | Scaffold, boundary checker, scaffold test | **done** |
| S1 | `core/` v2 + tests | **done** |
| S2 | `store/` + `sequencer/` | **done** |
| S3 | `resolve/` | **done** |
| S4 | `space/` JS twin + reference data | **done** |
| S5 | `space/` C++ + wasm + parity | **sources done, wasm pending local build** |
| S6 | `bridge/` | **done** |
| S7 | `attention/` JS twin + level table | **done** |
| S8 | `attention/` C++ + wasm + CSS emitter | **sources done, wasm pending local build** |
| S9 | `conductor/` (Python) | **done** |
| S10 | `view/` SVG renderers + snapshots | **done** |
| S11 | demo ledger + `npm run report` | **done** |
| S12 | `server/` | **done** |
| S13 | `app/` (React + Vite) | **done** |
| S14 | Final integration, README final pass, DoD checklist | **done** |

## Definition of Done

A fresh clone with Node 20 (and nothing else) passes:

```
npm install
npm test                       # node --test --test-reporter=spec + checks
node scripts/check-dod.mjs     # the full acceptance sequence, single command
```

`node scripts/check-dod.mjs` runs in order:

1. `npm test`
2. `rm -rf out/ && npm run report` (first run)
3. sha256 of `out/report.html` and `out/report.json`
4. `npm run report` (second run)
5. sha256 comparison (must be identical — byte-stable)
6. `npm run verify`

If every step passes, `npm run report` produces `out/report.html` with
exit 0, and `npm run dev` opens the app at `http://127.0.0.1:5173` with
Read, Input and Trail modes working, the command box accepting text, and
the sequence strip visible. No network access is used and no credentials
are present.

With a C++ toolchain available, `npm run test:cpp` runs the native space
and attention tests. With Python 3.10+, `npm run conduct` regenerates
`conductor/out/` and `npm run conduct:verify` byte-compares a fresh build
to disk.

## Known limitations (v1)

- No authentication. Server binds `127.0.0.1` only. Do not expose.
- Single currency. Per-line currency and dated FX are extension points.
- Single writer. Entry ids are content hashes with a `prevHash` chain, so
  later merge or sync by head comparison is feasible; not implemented.
- No period locking (a `lockThrough` date that rejects backdated posts).
- No depreciation, accruals, tax, inventory, sub-ledgers.
- No LLM-backed command interpreter (interface is pluggable; only the
  deterministic grammar ships).
- Trail layout uses evenly spaced dates, not calendar distance.
- The chart of accounts is fixed (see #69); no create-account endpoint.
- 405 responses do not set an `Allow` header.

## License

MIT. See `LICENSE`. This project builds on ideas and a client skeleton
from MindsEye (MIT, (c) 2025 Thabiwa).
