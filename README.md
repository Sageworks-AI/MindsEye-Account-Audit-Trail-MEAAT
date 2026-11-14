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
are done at source level. S6's bridge (Measure Contract) is done. S7's
attention JS twin, level table and W1–W10 workflows are done. S8's attention
C++ sources, CMake, ABI, parity, manifest tooling, CSS emitter and CSS drift
test are done at source level. S9's Python conductor is done. S10's view/
SVG renderers are done. **S11's demo ledger and `npm run report` are done**:
`out/report.html` and `out/report.json` are written; the command exits
non-zero on any failed check or on two runs producing different bytes.

Only these commands work today: `npm install`, `npm test`, `npm run verify`,
`npm run check-boundaries`, `npm run verify:space`, `npm run build:space`,
`npm run test:cpp`, `npm run gen:space-golden`, `npm run verify:attention`,
`npm run build:attention`, `npm run gen:attention-golden`,
`npm run emit:attention-css`, `npm run test:attention`, `npm run conduct`,
`npm run conduct:verify`, `npm run test:conductor`, `npm run demo`,
`npm run report`. Everything else in `package.json` is a placeholder for
S12 and S13.

Longer documentation lives in the project wiki: architecture, module
boundaries, ledger and cards, space layout engine, resolve layer, attention
brain, conductor workflows, view renderers, report sections, testing and
guards, roadmap and conventions.

## Design in one page

- **Time is the coordinate. Money is the measured quantity.** Every card is
  a pure function of `(journal, time coordinate, parameters)`. A card never
  stores its own date; it receives one. A **Tick** is `{ date, seq }`.
- **Three brains, one bridge.** Ledger brain decides *what*; space brain
  decides *how much room and where*; attention brain decides *appearance
  order*. They meet only in `bridge/`. Enforced by
  `scripts/check-boundaries.mjs`.
- **Python proposes, C++ disposes.** The Python conductor proposes event
  sequences; the attention state machine accepts, rejects or no-ops them.
- **View is pure.** `view/` functions are `(card data, rect, tier, theme) ->
  SVG string`. No DOM, no React, no ledger imports, no network.
- **Determinism.** Same journal and same request always produce
  byte-identical cards, hashes and SVG. `npm run report` produces identical
  bytes on two runs.
- **No floats.** Money is an integer in minor units. Geometry is int64
  **centipoints** (1 cpt = 1/100 pt; 1 CSS px = 75 cpt).
- **Append-only journal.** Corrections are reversal entries.
- **The Journal is the only source of financial truth.**
- **No number reaches the screen except from a card builder.**
- **Every card carries checks.** A failing check is visible on the card
  and makes `npm run report` exit non-zero.

## Running

Works today (needs Node 20 or newer):
npm install
npm test # node:test suites + boundary + verify:space + verify:attention
npm run demo # prints card summaries for the fixed demo ledger
npm run report # writes out/report.html and out/report.json
npm run check-boundaries
npm run verify:space # notice if no wasm built
npm run verify:attention
npm run emit:attention-css
npm run verify # verifies data/journal.jsonl hash chain
npm run test:conductor # skipped if Python 3.10+ is absent


Optional, requires Python 3.10+ (build-time only, standard library only):
npm run conduct # regenerate conductor/out/ + emit attention.css
npm run conduct:verify # byte-compare a fresh build to disk


Optional, requires a C++ toolchain:
npm run build:space
npm run build:attention
npm run test:cpp
npm run gen:space-golden
npm run gen:attention-golden

text

Available once S12 and S13 are built:
npm run dev
npm start


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
fuzz summary from `conductor/out/fuzz-summary.json` when present, or a
tiny inline smoke walk otherwise). `out/report.json` carries the same data
in machine-readable form.

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
demo/ demo.ledger.mjs, report.mjs, report-read.mjs, report-meta.mjs,
report-space.mjs, report-attn.mjs
test/ node:test suites
scripts/ check-boundaries, verify-journal, build-space, test-cpp,
verify-space, gen-space-golden, build-attention, verify-attention,
gen-attention-golden, emit-attention-css, test-cpp-attention, conduct
data/ runtime only (gitignored): journal.jsonl, events.jsonl, trails/, cards-cache.json
out/ report output (gitignored): report.html, report.json


The server binds `127.0.0.1` only. There is **no authentication in v1** —
that is a known limit; do not expose this server on a public interface.

## Assumptions and conflict resolutions

Precedence: base specification (Part 1) > Addendum A (space layer) >
Addendum B (attention layer). Every conflict and every deliberate choice
is recorded below.

1. **`app` import rules.** App may import `view`, `resolve`, `space`,
   `attention`, `bridge`, its own files, and `react` / `react-dom` /
   `vite` / `@vitejs/plugin-react`. `app/src/attention/` is restricted
   to `attention`, `bridge` and its own files.

2. **`.gitignore` and the wasm binaries.** `space/dist/` and
   `attention/dist/` are committed; `app/dist/` and native build
   directories are not.

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

17. **`npm run dev` on Windows.** Uses `concurrently`.

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

29. **Constancy guards.**

30. **Portable 128-bit arithmetic** in `space/cpp/fixed.hpp`.

31. **Golden vectors.**

32. **CRLF-normalised hashing.**

33. **Standalone wasm.**

34. **Empty `space/dist/` and `attention/dist/`.**

35. **`MAX_ENTRY_LINES = 32`.**

36. **px derivation rule.**

37. **Bridge event drafts.**

38. **`resolve/` delegates to `space/` and `bridge/`.**

39. **Focal weights coerce to 1.**

40. **Attention state shape.**

41. **Anti-oscillation epoch.**

42. **Transfer matrix.**

43. **Level-2 opacity is 760.**

44. **Keyboard shortcuts (S13).**

45. **`attention/cli.mjs` line protocol.**

46. **Shadow and radius are centipoints.**

47. **Attention ABI version is 1.**

48. **`emit_state` emits `sourceId` as length-prefixed code points.**

49. **CSS emission is byte-stable.**

50. **Static scan for hand-written appearance values.**

51. **`conductor/out/` is regenerated by `npm run conduct`.**

52. **Python discovery is wrapped in `scripts/conduct.mjs`.**

53. **`test_verify.py` copies the whole `attention/` tree.**

54. **`cancelVariant` re-runs from the workflow's `initialRing`.**

55. **View renderers are self-contained.** `view/svg/*` does not import
    `space/`, `core/`, `store/`, `resolve/` or `bridge/`. The width table
    from `space/reference/metrics.json` is duplicated in
    `view/svg/text.mjs`. The boundary checker enforces the current rule.

56. **SVG coordinates are exact decimal strings derived from BigInt cpt.**
    No floats anywhere in the renderer; output is byte-identical across
    platforms.

57. **Card headings and titles truncate with an ellipsis and carry a
    `<title>` element when truncated.**

58. **Trail layout uses evenly spaced x positions, not calendar distance.**

59. **Node collision within a lane offsets by NODE_H/4.**

60. **`view/svg/strip.mjs` renders the strip's currency from an options
    argument.**

61. **Renderer tests do not depend on the wasm.**

62. **`.gitignore` continues to exclude `app/dist/`; `view/` is source.**

63. **`demo/` does not import from `test/`.** The boundary checker only
    allows `demo/` to import `core`, `store`, `sequencer`, `resolve`,
    `view`, `space`, `attention` and `bridge`. `demo/demo.ledger.mjs`
    therefore carries its own chart of accounts and entries rather than
    re-exporting `test/fixtures/ledger.mjs`. To keep the two from
    drifting, `test/report.test.mjs` asserts that
    `setupDemo().ledger.entries().map(e => e.id)` equals the same
    expression against `test/fixtures/ledger.mjs`. If someone changes one
    without the other, that test fails.

64. **Report section files are split for the ~300-line rule.**
    `demo/report.mjs` is the orchestrator and CLI. `report-read.mjs`
    builds the read, impact and trail sections. `report-meta.mjs` builds
    the sequencer summary and checks table. `report-space.mjs` builds the
    space diagrams. `report-attn.mjs` builds the attention storyboards,
    levels table and fuzz summary. The base spec named only
    `demo/report.mjs`; the split is size-driven, not architectural, and
    every helper is called from `report.mjs` only.

65. **`setupDemo()` provides the sequencer event list.** The report's
    sequencer summary is driven by synthetic events that mirror what the
    report actually does: one `entry.posted` per journal entry, a
    `(card.miss, card.built, card.hit)` triple per card the read section
    builds, `space.premeasured` / `space.laid_out` / `space.reconciled`,
    `impact.computed` for entry 4, `trail.saved` for `inv1-chain`, and
    four `attention.shifted` events. Timestamps are derived from a fixed
    epoch (2026-04-01T00:00:00Z) plus 1 second per event, so the counts
    are deterministic. Nothing is read back from these events.

66. **`buildReport` aggregates checks from every section.** The earlier
    draft aggregated only read, impact, trail and space. Attention,
    levels and fuzz checks are now part of the checks table and part of
    the exit code, so a failed attention law, a failed contrast floor or
    a failed fuzz walk makes `npm run report` exit non-zero.

67. **The report's fuzz section reads `conductor/out/fuzz-summary.json`
    when present.** On a fresh clone with no committed outputs it falls
    back to a tiny deterministic smoke walk that exercises each event
    type once. That smoke walk never fails on the demo inputs, so a fresh
    clone with no wasm and no Python still passes `npm run report`.

68. **The report reads workflow JSON files directly.** `report-attn.mjs`
    loads `conductor/workflows/W*.json` via `JSON.parse(readFileSync(...))`
    and replays each workflow through the JS twin. The Python conductor
    reads the same files; the report does not need Python to show the
    storyboards.

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
| S11 | demo ledger + `npm run report` | **done** |
| S12 | `server/` | pending |
| S13 | `app/` (React + Vite) | pending |
| S14 | Final integration, README final pass, DoD checklist | pending |

S1 to S4 change from *stabilising* to **done** when the stabilisation
batches pass. S5, S8 and S9 rows mean the source-level implementation,
tooling and tests are complete. The `.wasm` binaries are built locally by
the developer and not required for `npm test`. S10 covers the renderers
and the renderer test suite. S11 covers the demo ledger, the report
generator, the report sections and `test/report.test.mjs` (byte-stability,
all checks pass, section shape, money-path integrity).

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

MIT. See `LICENSE`. This project builds on ideas and a client skeleton
from MindsEye (MIT, (c) 2025 Thabiwa).
RUN:


npm test
npm run demo
npm run report
npm run report && shasum -a 256 out/report.html out/report.json > /tmp/report-a.sha 2>/dev/null || true
npm run report && shasum -a 256 out/report.html out/report.json > /tmp/report-b.sha 2>/dev/null || true
diff /tmp/report-a.sha /tmp/report-b.sha
# pass: npm test reports "boundary check: OK" and every node:test suite
#       green including test/renderer.test.mjs and test/report.test.mjs
#       (byte-stable HTML and JSON, all checks pass, section shape,
#       money-path integrity, no drift from test/fixtures/ledger.mjs).
#       npm run demo prints one line per card (all "ok=yes").
#       npm run report writes out/report.html and out/report.json and
#       exits 0 with "all checks pass". Running it a second time and
#       diffing the shasums yields no differences.
git add -A && git commit -m "S11: demo ledger and report generator (out/report.html + out/report.json)"
