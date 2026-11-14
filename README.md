# Mind's Eye Account Audit Trail (MEAAT)

An enclosed, offline-capable accounting system whose interface is a split
screen of "state cards" (balance sheet, cash flow, receipt, and so on) drawn
as SVG slips. Three data layers: an append-only **Journal** (financial truth),
a **Sequencer** (time-labelled events, advisory only), and a **Card Store**
(derived cache). Three interface modes: **Read**, **Input**, **Trail**.

Enclosed means: one `git clone`, one `npm install`, one command to run. No
cloud accounts, no CDN, no web fonts, no network calls at runtime or at report
time, no credentials anywhere in the repo.

## Current status

S0 is done. S1 to S4 are being brought to a green suite in nine stabilisation
batches (B1 to B9). S5's space C++ sources, ABI, parity and manifest tooling
are done at source level; the wasm binary is built locally and not required
for `npm test`. S6's bridge (Measure Contract) is done. S7's attention JS
twin, level table and W1–W10 workflows are done. S8's attention C++ sources,
CMake, ABI, parity, manifest tooling, CSS emitter and CSS drift test are done
at source level. S9's Python conductor is done. **S10's view/ SVG renderers
(slip, impact, trail, strip) are done**, with structural + determinism tests.

Only these commands work today: `npm install`, `npm test`, `npm run verify`,
`npm run check-boundaries`, `npm run verify:space`, `npm run build:space`
(Emscripten), `npm run test:cpp` (cmake + a compiler),
`npm run gen:space-golden`, `npm run verify:attention`,
`npm run build:attention` (Emscripten), `npm run gen:attention-golden`,
`npm run emit:attention-css`, `npm run test:attention`,
`npm run conduct` (Python 3.10+), `npm run conduct:verify`,
`npm run test:conductor` (skipped without Python). Everything else in
`package.json` is a placeholder for a later stage.

Longer documentation lives in the project wiki: architecture, module
boundaries, ledger and cards, space layout engine, resolve layer, attention
brain, conductor workflows, view renderers, testing and guards, roadmap and
conventions.

## Design in one page

- **Time is the coordinate. Money is the measured quantity.** Every card is a
  pure function of `(journal, time coordinate, parameters)`. A card never
  stores its own date; it receives one. A **Tick** is `{ date, seq }` so two
  entries on the same day still have a total order.
- **Three brains, one bridge.**
  - **Ledger brain** (`core/`, `store/`) — decides *what* is shown.
  - **Space brain** (`space/`) — decides *how much room* and *where*.
  - **Attention brain** (`attention/`) — decides *appearance order*.
  They meet **only** in `bridge/`. `core/` never imports `space/`, `bridge/`,
  `attention/`, `store/`, `sequencer/`, `server/` or `view/`. `space/` and
  `attention/` import nothing outside their own folders. `bridge/` may
  import `core/schema.mjs` **only** from `core/`.
  See `scripts/check-boundaries.mjs` for the enforced matrix.
- **Python proposes, C++ disposes.** The Python conductor proposes event
  sequences; the attention state machine accepts, rejects or no-ops them.
- **View is pure.** `view/` functions are `(card data, rect, tier, theme) ->
  SVG string`. No DOM, no React, no ledger imports, no network. All drawing
  comes from `view/`; the React client only mounts and wires.
- **Determinism.** Same journal and same request always produce byte-identical
  cards, hashes and SVG.
- **No floats.** Money is an integer in minor units. Geometry is int64
  **centipoints** (1 cpt = 1/100 pt; 1 CSS px = 75 cpt). SVG coordinates are
  emitted as exact decimal strings derived from BigInt cpt values.
- **Append-only journal.** Corrections are reversal entries.
- **The Journal is the only source of financial truth.**
- **No number reaches the screen except from a card builder.**
- **Every card carries checks.** A failing check is visible on the card (in
  red) and makes `npm run report` exit non-zero.

## Running

Works today (needs Node 20 or newer):
npm install
npm test # node:test suites + boundary + verify:space + verify:attention
npm run check-boundaries
npm run verify:space # notice if no wasm built
npm run verify:attention
npm run emit:attention-css
npm run verify # verifies data/journal.jsonl hash chain
npm run test:conductor # Python conductor tests; skipped if Python 3.10+ is absent

text

Optional, requires Python 3.10+ (build-time only, standard library only):
npm run conduct # regenerate conductor/out/ + emit attention.css
npm run conduct:verify # byte-compare a fresh build to disk

text

Optional, requires a C++ toolchain:
npm run build:space # Emscripten -> space/dist/space.wasm + manifest.json
npm run build:attention # Emscripten -> attention/dist/attention.wasm + manifest.json
npm run test:cpp # cmake + native tests (space and attention; skipped without tools)
npm run gen:space-golden
npm run gen:attention-golden

text

Available once the later stages are built (S11 to S13):
npm run report
npm run dev
npm start
npm run demo

text

## Repository layout
core/ money, time, canonical, hash, accounts, ledger, checks, cards, impact, trail, schema
store/ journalFile, journalMemory, cardStore, trailStore
sequencer/ events, lanes, buckets, log, strip
resolve/ request, layout, tiers, plan, command, dates
view/svg/ text, theme, primitives, slip, impact, trail, strip
space/ JS twin, C++ sources, reference data, wasm
attention/ JS twin, C++ sources, level table, wasm, CSS emitter, cli
conductor/ Python 3.10+ build-time conductor: workflows, choreography, fuzz, storyboards
bridge/ schema.mjs, measure.mjs, attention.mjs, contract.md
server/ node:http, router, routes, sse, errors
app/ Vite + React client (mounts only; drawing is from view/)
demo/ demo.ledger.mjs, report.mjs
test/ node:test suites
scripts/ check-boundaries, verify-journal, build-space, test-cpp,
verify-space, gen-space-golden, build-attention, verify-attention,
gen-attention-golden, emit-attention-css, test-cpp-attention, conduct
data/ runtime only (gitignored): journal.jsonl, events.jsonl, trails/, cards-cache.json

text

## Assumptions and conflict resolutions

Precedence: base specification (Part 1) > Addendum A (space layer) > Addendum B
(attention layer). Every conflict and every deliberate choice is recorded below.

1. **`app` import rules.** App may import `view`, `resolve`, `space`,
   `attention`, `bridge`, its own files, and `react` / `react-dom` / `vite` /
   `@vitejs/plugin-react`. `app/src/attention/` is restricted to `attention`,
   `bridge` and its own files.

2. **`.gitignore` and the wasm binaries.** `space/dist/` and
   `attention/dist/` are committed; `app/dist/` and native build directories
   are not.

3. **Python conductor is build-time only.** Python 3.10+ is optional;
   `npm test` and `npm run report` never invoke Python.

4. **Voice adapter default = none.**

5. **View purity vs importing `space`.** View stays deterministic; any use
   of `space` is for pure measurements. In S10 the renderers do NOT import
   `space/`; see #55.

6. **`npm test` scope** = base node:test + boundary + space laws/parity +
   attention laws/workflows/CSS drift + verify:space + verify:attention.

7. **`data/`, `out/`, `.env`.** All gitignored.

8. **Centipoint scale** (1 cpt = 1/100 pt, 1 CSS px = 75 cpt).

9. **Reference defaults** in `space/reference/documents.json` are not legal
   or regulatory standards.

10. **`DISPLAY_MAX`** switches long amounts to "in thousands".

11. **`MIN_BODY = 9 px` (675 cpt)** — the solver rejects anything smaller.

12. **Focus tolerance = 4 px (300 cpt)**.

13. **Attention level formula.** `level = min(rank, 2)`; ranks above 2 all
    render at level 2. Contrast floors: 7:1 / 4.5:1 / 3:1 for levels 0 / 1
    / 2. See `attention/LAWS.md`.

14. **Pointer dwell = 250 ms.** Measured in JS; the C++ attention machine is
    time-free.

15. **"Focus stays at center."** Viewport center inside the focal rect;
    anchor point stays within tolerance.

16. **Python ctypes fallback.** Both paths produce byte-identical results.

17. **`npm run dev` on Windows.** Uses `concurrently`; fall back to two
    terminals if needed.

18. **Node version.** `engines.node >= 20`.

19. **Boundary-check enforcement.** Union of import rules across the three
    spec parts; scoped bare specifiers matched by package name.

20. **Git tracking policy.** `.gitattributes` pins LF; wasm marked binary.

21. **License.** MIT. See `LICENSE`.

22. **Three-pane rule (60 percent).** Focal pane takes 60 percent of the
    long axis; the other two share 40 percent.

23. **Narrower QUARTER and STRIP pages** so body text stays above
    `MIN_BODY` at 1280x720.

24. **Schema route for `resolve`.** `bridge/` may import `core/schema.mjs`
    only from `core/`.

25. **`resolve/dates.mjs` mirrors `core/time.mjs`.**

26. **`plan()` takes its cache-key function from the caller.**

27. **Copyright line in `LICENSE`.** Structure-only check in scaffold test.

28. **L7 and L8 tested in `bridge/` tests.**

29. **Constancy guards.** Stage manifest, API surface snapshot, golden
    outputs.

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

44. **Keyboard shortcuts (S13).** Driver wires pointer dwell, Tab/F6
    cycling, Ctrl/Cmd+K focus-input, Ctrl/Cmd+C/V transfer, Escape BACK.

45. **`attention/cli.mjs` line protocol.** JSON line in, JSON line out.
    Three ops: `step`, `frame`, `levels`.

46. **Shadow and radius are centipoints** in `levels.json`, not permille.

47. **Attention ABI version is 1.** Same rule as `space` ABI.

48. **`emit_state` emits the transfer's `sourceId` as a length-prefixed
    code-point array, no kind.**

49. **CSS emission is byte-stable.**

50. **Static scan for hand-written appearance values.** Any `.css` under
    `app/src/` other than `attention.css` and `tokens.css` that mentions
    `opacity`, `brightness`, `saturate`, `blur`, `filter` or `shadow` as
    a property fails the CSS drift test.

51. **`conductor/out/` is regenerated by `npm run conduct` and committed
    by the developer.** On a fresh clone without Python, `conductor/out/`
    contains only `choreography/.gitkeep`; `npm test` still passes because
    Python conductor tests are in `npm run test:conductor`.

52. **Python discovery is wrapped in `scripts/conduct.mjs`.**

53. **`test_verify.py` copies the whole `attention/` tree into a temp dir
    and runs a full build+verify cycle.**

54. **`cancelVariant` re-runs from the workflow's `initialRing`.**

55. **View renderers are self-contained.** `view/svg/*` does not import
    `space/`, `core/`, `store/`, `resolve/` or `bridge/`. This is stricter
    than Addendum A allows (view may import `space` and `bridge` for pure
    measurements), but importing `space/index.mjs` opens files with
    `node:fs` at module load, which would break in the browser. The width
    table from `space/reference/metrics.json` is duplicated in
    `view/svg/text.mjs` for the same reason `resolve/dates.mjs` duplicates
    `core/time.mjs`; a future S10b could share via `bridge/`, but the
    duplication is small, stable and byte-checked by the renderer tests.
    The boundary checker enforces the current rule.

56. **SVG coordinates are exact decimal strings derived from BigInt cpt.**
    `view/svg/primitives.cptToPt(cpt)` emits pt as a decimal string with no
    trailing zeros. There are no floats anywhere in the renderer, so the
    output is byte-identical across platforms and Node versions.

57. **Card headings and titles truncate with an ellipsis and carry a
    `<title>` element with the full text.** A title is only emitted when
    the visible text differs from the full text, so ordinary labels do not
    carry redundant `<title>` elements. Escaping is applied to every text
    node and attribute; the renderer tests include an escaping test with
    `<`, `>`, `&`, `"` and `'`.

58. **Trail layout uses evenly spaced x positions, not calendar distance.**
    Two nodes one day apart and two nodes one month apart both render at the
    same horizontal distance. This keeps a single far-future date from
    squashing every other node against the left edge. The trail's date axis
    labels each tick so the actual calendar distance is visible; a future
    S10b could offer logarithmic time scaling, but S10 ships linear.

59. **Node collision within a lane offsets by NODE_H/4.** Two nodes on the
    same (date, account) are stacked vertically by NODE_H/4 each so labels
    never overlap. Offsets are deterministic; no floats.

60. **`view/svg/strip.mjs` renders the strip's currency from an options
    argument, not from a card.** The strip shows figures across several
    cards whose currency is identical in v1 (single currency), so the
    caller passes `currency` once. When multi-currency lands, the strip's
    data shape (`strip.figures[].label`) will already carry per-figure
    currency in the label text, so this API does not need to change.

61. **Renderer tests do not depend on the wasm.** They exercise the JS twin
    path only. When wasm is committed the same tests run unchanged (they
    call `view/`, which is backend-agnostic).

62. **`.gitignore` continues to exclude `app/dist/`; `view/` is source and
    is committed.** No build step produces `view/`.

## Status by stage

| Stage | Content | State |
|---|---|---|
| S0 | Scaffold, boundary checker, scaffold test | **done** |
| S1 | `core/` v2 + tests | stabilising |
| S2 | `store/` + `sequencer/` | stabilising |
| S3 | `resolve/` | stabilising |
| S4 | `space/` JS twin + reference data | stabilising |
| S5 | `space/` C++ + wasm + parity | **sources done, wasm pending local build** |
| S6 | `bridge/` | **done** |
| S7 | `attention/` JS twin + level table | **done** |
| S8 | `attention/` C++ + wasm + CSS emitter | **sources done, wasm pending local build** |
| S9 | `conductor/` (Python) | **done** |
| S10 | `view/` SVG renderers + snapshots | **done** |
| S11 | demo ledger + `npm run report` | pending |
| S12 | `server/` | pending |
| S13 | `app/` (React + Vite) | pending |
| S14 | Final integration, README final pass, DoD checklist | pending |

S1 to S4 change from *stabilising* to **done** when the stabilisation batches
pass. S5, S8 and S9 rows mean the source-level implementation, tooling and
tests are complete. The `.wasm` binaries are built locally by the developer
and not required for `npm test`. S10 covers the renderers and the renderer
test suite (structural, escaping, byte-stability, no-overflow).

## Known limitations (v1)

- No authentication. Server binds `127.0.0.1` only. Do not expose.
- Single currency. Per-line currency and dated FX are extension points.
- Single writer. Entry ids are content hashes with a `prevHash` chain, so
  later merge or sync by head comparison is feasible; not implemented.
- No period locking (a `lockThrough` date that rejects backdated posts).
- No depreciation, accruals, tax, inventory, sub-ledgers.
- No LLM-backed command interpreter (interface is pluggable; only the
  deterministic grammar ships).
- Trail layout uses evenly spaced dates, not calendar distance (see #58).

## License

MIT. See `LICENSE`. This project builds on ideas and a client skeleton from
MindsEye (MIT, (c) 2025 Peace Thabiwa).
