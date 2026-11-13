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
CMake, ABI, parity and manifest tooling, CSS emitter and CSS drift test are
**done at source level**; `attention/dist/attention.wasm` is built locally
and is not required for `npm test`.

Only these commands work today: `npm install`, `npm test`, `npm run verify`,
`npm run check-boundaries`, `npm run verify:space`, `npm run build:space`
(Emscripten), `npm run test:cpp` (cmake + a compiler),
`npm run gen:space-golden`, `npm run verify:attention`,
`npm run build:attention` (Emscripten), `npm run gen:attention-golden`,
`npm run emit:attention-css`, `npm run test:attention`. Everything else in
`package.json` is a placeholder for a later stage.

Longer documentation lives in the project wiki: architecture, module
boundaries, ledger and cards, space layout engine, resolve layer, attention
brain, testing and guards, roadmap and conventions.

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
- **Determinism.** Same journal and same request always produce byte-identical
  cards, hashes and SVG. Wall-clock timestamps exist only on Sequencer events.
- **No floats.** Money is an integer in minor units. Geometry is int64
  **centipoints** (1 cpt = 1/100 pt; 1 CSS px = 75 cpt).
- **Append-only journal.** Corrections are reversal entries.
- **The Journal is the only source of financial truth.**
- **No number reaches the screen except from a card builder.**
- **Every card carries checks.** A failing check makes `npm run report` exit
  non-zero.

## Running

Works today (needs Node 20 or newer):
npm install
npm test # node:test suites + boundary + verify:space + verify:attention
npm run check-boundaries
npm run verify:space # notice if no wasm built
npm run verify:attention
npm run emit:attention-css
npm run verify # verifies data/journal.jsonl hash chain

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

`npm test` and `npm run report` use the JS twin and, when present, the
committed wasm. Neither requires a C++ toolchain or Python.

## Repository layout
core/ money, time, canonical, hash, accounts, ledger, checks, cards, impact, trail, schema
store/ journalFile, journalMemory, cardStore, trailStore
sequencer/ events, lanes, buckets, log, strip
resolve/ request, layout, tiers, plan, command, dates
view/ pure SVG builders (text, theme, primitives, slip, impact, trail, strip)
space/ JS twin, C++ sources, reference data, wasm
attention/ JS twin, C++ sources, level table, wasm, CSS emitter, cli
bridge/ schema.mjs, measure.mjs, attention.mjs, contract.md
server/ node:http, router, routes, sse, errors
app/ Vite + React client (mounts only; drawing is from view/)
demo/ demo.ledger.mjs, report.mjs
conductor/ Python 3.10+ (build-time only); workflows, choreographies, fuzz
test/ node:test suites
scripts/ check-boundaries, verify-journal, build-space, test-cpp,
verify-space, gen-space-golden, build-attention, verify-attention,
gen-attention-golden, emit-attention-css, test-cpp-attention
data/ runtime only (gitignored): journal.jsonl, events.jsonl, trails/, cards-cache.json

text

The server binds `127.0.0.1` only. There is **no authentication in v1** — that
is a known limit; do not expose this server on a public interface.

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
   of `space` is for pure measurements.

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
    render at level 2. Default level table ships in
    `attention/dist/levels.json`. Contrast floors: 7:1 / 4.5:1 / 3:1 for
    levels 0 / 1 / 2. See `attention/LAWS.md`.

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
    long axis; the other two share 40 percent. Implemented once in
    `space/js/templates.mjs` and mirrored in `space/cpp/templates.hpp`;
    `resolve/layout.mjs` delegates to the twin.

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

32. **CRLF-normalised hashing** for both `space` and `attention` manifests.

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
    `attention/cpp/machine.hpp`. `TRANSFER_COPY` requires at least two
    non-BAR actors. Invalid (payloadKind, targetKind, outcomeKind) triples
    are TRANSFER_INVALID.

43. **Level-2 opacity is 760** so both the normal (3:1) and prefers-contrast
    (4.5:1) floors pass.

44. **Keyboard shortcuts (S13).** Driver wires pointer dwell, Tab/F6
    cycling, Ctrl/Cmd+K focus-input, Ctrl/Cmd+C/V transfer, Escape BACK.

45. **`attention/cli.mjs` line protocol.** JSON line in, JSON line out.
    Three ops: `step`, `frame`, `levels`.

46. **Shadow and radius are centipoints** in `levels.json`, not permille.
    The JS ABI and C++ ABI both accept `0..100000` for these two fields
    (matching the shipped values `shadow: 1800`, `radius: 1050`).
    `opacity`, `brightness`, `saturation` and `blur` stay at permille
    `0..1000`. `S7`'s validation (`attention/js/levels.mjs`) also accepts
    these wider ranges.

47. **Attention ABI version is 1.** `att_version()` returns 1; a mismatch
    is `E_BAD_VERSION`. Same rule as `space` ABI.

48. **`emit_state` emits the transfer's `sourceId` as a length-prefixed
    code-point array, no kind.** `emit_actor` adds a kind slot; `emit_id`
    does not. Mixing them caused a byte desync in the first draft; fixed
    and the golden vectors cover it.

49. **CSS emission is byte-stable.** `attention/emitCss.mjs` sorts keys,
    uses fixed formatting, and carries the SHA-256 of `levels.json` in the
    header. `app/src/styles/attention.css` is committed; drift is caught by
    `test/attention/css-drift.test.mjs`.

50. **Static scan for hand-written appearance values.** Any `.css` under
    `app/src/` other than `attention.css` and `tokens.css` that mentions
    `opacity`, `brightness`, `saturate`, `blur`, `filter` or `shadow` as
    a property fails the CSS drift test.

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
| S9 | `conductor/` (Python) | pending |
| S10 | `view/` SVG renderers + snapshots | pending |
| S11 | demo ledger + `npm run report` | pending |
| S12 | `server/` | pending |
| S13 | `app/` (React + Vite) | pending |
| S14 | Final integration, README final pass, DoD checklist | pending |

S1 to S4 change from *stabilising* to **done** when the stabilisation batches
pass. S5 and S8 rows mean the C++ sources, CMake, ABI, parity tests, manifest
tooling and CSS emitter are complete; the `.wasm` binaries are built locally
by the developer and not required for `npm test`.

## Known limitations (v1)

- No authentication. Server binds `127.0.0.1` only. Do not expose.
- Single currency. Per-line currency and dated FX are extension points.
- Single writer. Entry ids are content hashes with a `prevHash` chain, so
  later merge or sync by head comparison is feasible; not implemented.
- No period locking (a `lockThrough` date that rejects backdated posts).
- No depreciation, accruals, tax, inventory, sub-ledgers.
- No LLM-backed command interpreter (interface is pluggable; only the
  deterministic grammar ships).

## License

MIT. See `LICENSE`. This project builds on ideas and a client skeleton from
MindsEye (MIT, (c) 2025 Peace Thabiwa).
RUN:

text
npm test
node scripts/verify-attention.mjs
node scripts/emit-attention-css.mjs --force
node scripts/test-cpp-attention.mjs
# pass: boundary check: OK; all node:test suites green including the four
#       new attention tests (parity, abi-fuzz, manifest, css-drift);
#       verify:space and verify:attention print
#       "no wasm built yet, JS twin in use"; emit:attention-css rewrites
#       app/src/styles/attention.css and reports "wrote"; test-cpp-attention
#       either runs the native suite or skips with a notice.
# then, if you have Emscripten:
npm run build:attention
npm run gen:attention-golden
npm run test:cpp
npm run verify:attention
git add -A && git commit -m "S8: attention C++, ABI, parity and CSS emitter"
