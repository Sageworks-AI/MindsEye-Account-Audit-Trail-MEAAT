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
batches (B1 to B9). S5's C++ sources, ABI, CMake, parity and manifest tooling
are **done at source level**; the wasm binary itself has not been built yet in
this checkout, and is not required for `npm test` or for the JS twin to run.
S6 onward has not been started.

Only these commands work today: `npm install`, `npm test`, `npm run verify`,
`npm run check-boundaries`, `npm run verify:space`, `npm run build:space`
(requires Emscripten), `npm run test:cpp` (requires cmake + a compiler),
`npm run gen:space-golden`. Everything else in `package.json` is a
placeholder for a later stage.

Longer documentation lives in the project wiki: architecture, module
boundaries, ledger and cards, space layout engine, resolve layer, testing and
guards, roadmap and conventions.

## Design in one page

- **Time is the coordinate. Money is the measured quantity.** Every card is a
  pure function of `(journal, time coordinate, parameters)`. A card never
  stores its own date; it receives one. A **Tick** is `{ date, seq }` so two
  entries on the same day still have a total order.
- **Three brains, one bridge.**
  - **Ledger brain** (`core/`, `store/`) — decides *what* is shown: which
    numbers, rows and checks.
  - **Space brain** (`space/`) — decides *how much room* each thing takes and
    *where* it sits. It sees only counts, formatted strings (for measuring),
    enumerations, and integers; never money values or ledger objects.
  - **Attention brain** (`attention/`) — decides *appearance order*: which
    pane is focus / near / far. Appearance only; geometry comes from the
    space brain.
  They meet **only** in `bridge/`. `core/` never imports `space/`, `bridge/`,
  `attention/`, `store/`, `sequencer/`, `server/` or `view/`. `space/` imports
  nothing outside `space/`. `attention/` imports nothing outside `attention/`.
  See `scripts/check-boundaries.mjs` for the enforced matrix.
- **Determinism.** Same journal and same request always produce byte-identical
  cards, hashes and SVG. Wall-clock timestamps exist only on Sequencer events.
  No randomness or wall-clock inside core, resolve, space, view, or attention.
- **No floats.** Money is an integer in minor units (default BWP, thebe,
  100 per pula). Currency, symbol and exponent come from a config object.
  Geometry is int64 **centipoints** (1 cpt = 1/100 pt; 1 CSS px = 75 cpt).
- **Append-only journal.** Corrections are reversal entries: a mirror entry
  with a `reverses` field pointing at the original seq. No edit, no delete,
  no public mutable array.
- **The Journal is the only source of financial truth.** Sequencer events and
  cached cards are derived or advisory. Nothing financial is ever read back
  from events.
- **No number reaches the screen except from a card builder.** The command
  box and any AI interpretation layer produce validated requests only; they
  never compute numbers and never post an entry without explicit human
  confirmation.
- **Every card carries checks.** A failing check is visible on the card and
  makes `npm run report` exit non-zero.

## Running

Works today (needs Node 20 or newer):
npm install
npm test # node:test suites + boundary check + verify:space
npm run check-boundaries
npm run verify:space # manifest check (prints a notice if no wasm built)
npm run verify # verifies data/journal.jsonl hash chain


Optional, requires a C++ toolchain:
npm run build:space # Emscripten -> space/dist/space.wasm + manifest.json
npm run test:cpp # cmake + native tests (skipped without tools)
npm run gen:space-golden # regenerate golden vectors from the JS twin ABI


Available once the later stages are built (S11 to S13):
npm run report
npm run dev
npm start
npm run demo



`npm test` and `npm run report` use the JS twin and, when present, the
committed wasm. Neither requires a C++ toolchain or Python.

## Repository layout
core/ money, time, canonical, hash, accounts, ledger, checks, cards, impact, trail, schema
store/ journalFile, journalMemory, cardStore, trailStore
sequencer/ events, lanes, buckets, log, strip
resolve/ request, layout, tiers, plan, command, dates
view/ pure SVG builders (text, theme, primitives, slip, impact, trail, strip)
space/ JS twin, C++ sources, reference data, wasm
attention/ JS twin, C++ sources, level table, wasm, CSS emitter
bridge/ schema.mjs, measure.mjs, attention.mjs, contract.md
server/ node:http, router, routes, sse, errors
app/ Vite + React client (mounts only; drawing is from view/)
demo/ demo.ledger.mjs, report.mjs
conductor/ Python 3.10+ (build-time only); workflows, choreographies, fuzz
test/ node:test suites
scripts/ check-boundaries, verify-journal, build-space, test-cpp,
verify-space, gen-space-golden, verify-attention, emit-attention-css
data/ runtime only (gitignored): journal.jsonl, events.jsonl, trails/, cards-cache.json


The server binds `127.0.0.1` only. There is **no authentication in v1** — that
is a known limit; do not expose this server on a public interface.

## Assumptions and conflict resolutions

Precedence: base specification (Part 1) > Addendum A (space layer) > Addendum B
(attention layer). Every conflict and every deliberate choice is recorded below.
An extension that A or B needs to make a feature reachable is allowed and noted.

1. **`app` import rules.** Base says *"app imports view and its own api.js
   only."* Addendum A says *"app imports resolve, view and bridge."* Addendum B
   gives `app/src/attention/` its own driver, hook and player files. **Strict
   base reading would make the space and attention layers unreachable from
   the client, defeating A and B.** Resolution: app may import `view`,
   `resolve`, `space`, `attention`, `bridge`, its own files, and
   `react` / `react-dom` / `vite` / `@vitejs/plugin-react` as bare packages.
   `app/src/attention/` is further restricted to `attention`, `bridge` and its
   own files (per B).

2. **`.gitignore` and the wasm binaries.** Base says `.gitignore` includes
   `dist`. Addendum A says the wasm is *committed* so a fresh clone needs no
   C++ toolchain. Resolution: ignore `app/dist/` (Vite output) and
   `build/`/`cmake-build-*/`, but **commit** `space/dist/` and
   `attention/dist/`. Also commit `conductor/out/` (per Addendum B).

3. **Python conductor is build-time only.** Base requires "one command to
   run" and "no cloud, no credentials." Addendum B adds a Python conductor.
   Resolution: Python 3.10+ is optional; `npm test` and `npm run report` use
   committed choreographies and never invoke Python. `npm run conduct` is
   opt-in and requires Python + a C++ compiler.

4. **Voice adapter default = none.** Addendum B notes that browser speech may
   use a remote service, breaking the enclosed rule. Resolution: default
   adapter is `none`. Enabling it is a user opt-in.

5. **View purity vs importing `space`.** Base says view functions are pure
   `(card data, rect, tier, theme) -> SVG string`. Addendum A says view may
   import `bridge` and `space`. Resolution: view stays deterministic; any
   use of `space` is for pure measurements (fixed-point text width, wrap).
   No state leaks.

6. **`npm test` scope.** Base says node:test + boundary check. Addendum A
   adds space laws and parity; Addendum B adds attention laws, workflow
   goldens, CSS drift, static scans. Resolution: `npm test` runs the union;
   no base coverage is dropped.

7. **`data/`, `out/`, `.env`.** All gitignored. `data/` is runtime only;
   `out/` is report output recreated by `npm run report`.

8. **Centipoint scale.** 1 cpt = 1/100 pt. 1 CSS px = 75 cpt. Paper sizes in
   points use conventional PDF roundings (A4 = 595×842 pt). Aspect ratios are
   exact rationals built from those integers. Documented further in
   `space/README.md` (S4) and `space/ABI.md` (S5).

9. **Reference defaults for `space/reference/documents.json`.** Margins
   ~20 mm (57 pt), body 10 pt, headings 12–14 pt, captions 8 pt, leading 1.2×
   body. These are reference defaults, not legal or regulatory standards.

10. **`DISPLAY_MAX` and the "in thousands" switch.** When a formatted amount
    exceeds `DISPLAY_MAX` characters, the card deterministically switches to
    "in thousands" and states this in the page header.

11. **`MIN_BODY = 9 px` (675 cpt).** Effective on-screen body size must be at
    least 9 px, or the solver rejects the shape or tier.

12. **Focus tolerance = 4 px (300 cpt).** Anchor invariance: after a relayout,
    the anchor stays within 4 px of its previous screen position (or inside
    the new rect). Documented in `space/ABI.md` (S5).

13. **Attention level formula.** `level = min(rank, 2)`; ranks above 2 all
    render at level 2. Default level table and timings ship in
    `attention/dist/levels.json` (S7/S8). Contrast floors: 7:1 / 4.5:1 / 3:1
    for levels 0 / 1 / 2. See `attention/LAWS.md`.

14. **Pointer dwell = 250 ms.** Measured in JS; the C++ attention machine is
    time-free and receives only the resulting `FOCUS` event.

15. **"Focus stays at center."** Addendum B says *"the viewport center C
    always lies inside the focal pane."* Interpreted as: viewport center
    inside the focal rect, and the anchor point (default page center) stays
    within tolerance (see #12).

16. **Python ctypes fallback.** Addendum B says Python uses `ctypes` to the
    native library, or falls back to a Node subprocess over stdin/stdout
    JSON. Both paths must produce byte-identical results.

17. **`npm run dev` on Windows.** Uses `concurrently`. If it misbehaves on
    Windows, run `node --watch server/index.mjs` and
    `npx vite --config app/vite.config.js` in two terminals.

18. **Node version.** `engines.node >= 20` as stated in the base layout.

19. **Boundary-check enforcement.** The matrix enforced by
    `scripts/check-boundaries.mjs` reflects the *union* of import rules
    across the three spec parts, with base restrictions relaxed per #1.
    `core/` is still restricted to `node:*` plus its own relative imports;
    `space/` and `attention/` are self-contained. Scoped bare specifiers are
    matched by package name.

20. **Git tracking policy.** `.gitattributes` pins LF line endings and marks
    `*.wasm` as binary. The wasm commit decision itself is #2.

21. **License.** MIT. See `LICENSE`. This project builds on ideas and a
    client skeleton from MindsEye (MIT, (c) 2025 Peace Thabiwa).

22. **Three-pane rule (60 percent).** In a three-pane layout the focal pane
    takes 60 percent of the long axis and the other two share 40 percent.
    Pane weights choose the large pane (ties to the lowest index) and split
    the two small panes. Implemented in `resolve/layout.mjs`.

23. **Narrower QUARTER and STRIP pages.** For archetypes whose FULL page is
    wider than 420 pt, QUARTER is 420 pt wide and STRIP is 360 pt wide, so
    body text stays at or above `MIN_BODY` in a pane at 1280x720. `MIN_BODY`
    itself is not lowered.

24. **Schema route for `resolve`.** `resolve/` must not import `core/` or
    `store/`. Card type data reaches it through `bridge/schema.mjs`, which
    re-exports `core/schema.mjs` (plain data, no imports). The boundary
    checker enforces this at file level.

25. **`resolve/dates.mjs` mirrors `core/time.mjs`.** The pure date helpers
    are copied so `resolve/` stays off `core/`. A parity test keeps the two
    identical on seeded inputs.

26. **`plan()` takes its cache-key function from the caller.** Callers pass
    `CardStore.cacheKey` as `opts.cacheKey`. `plan()` returns an error if it
    is missing.

27. **Copyright line in `LICENSE`.** The owner changed it on purpose and it
    is never edited by tooling. The scaffold test checks only its structure
    (starts with `MIT License`, has a year and a name), not the name itself.

28. **L7 and L8 arrive in S6.** The two space laws that involve the bridge
    are tested when `bridge/` is built.

29. **Constancy guards.** Three guards keep earlier stages stable while
    later ones are built: a stage manifest (`scripts/stages.json`) checked
    against the status table below, an API-surface snapshot of the public
    modules, and golden outputs (demo card hashes and layout rectangles).
    Golden files change only on purpose, by running `npm run golden:update`
    and committing the result. They are never edited by hand.

30. **Portable 128-bit arithmetic.** `space/cpp/fixed.hpp` implements
    64×64→128 multiply and 128÷64 divide from 64-bit limbs, without
    `__int128`, compiler builtins, or floating point. The same source
    compiles under MSVC, MinGW, clang, gcc and Emscripten. `muldiv_floor`
    does floor rounding on the sign-corrected magnitude, then reapplies the
    sign, matching `space/js/fixed.mjs` exactly (parity is golden-tested).

31. **Golden vectors.** The C++ ABI's parity with the JS twin is enforced
    by line-based text vectors in `space/cpp/test/golden/`, generated by
    `scripts/gen-space-golden.mjs` using `space/js/abi.mjs` as the oracle.
    The native test runner replays them; `test/space/parity.test.mjs` also
    replays them against the JS twin, so both ends are checked
    independently. Golden files change only when the twin changes on
    purpose and `npm run gen:space-golden` is run to regenerate them.

32. **CRLF-normalised hashing.** `space/dist/manifest.json` stores SHA-256
    of every C++ source with `\r\n` normalised to `\n` before hashing, so a
    Windows checkout and a Unix checkout produce the same hash for the same
    logical source. `scripts/verify-space.mjs` applies the same
    normalisation, so "rebuild required" fires only on a real change.

33. **Standalone wasm.** `scripts/build-space.mjs` builds with
    `-sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=4MiB
    -sWASM_BIGINT=1 --no-entry`. No JS runtime is generated: the module
    exports the C ABI functions, the memory, and the scratch pointer
    directly. `space/index.mjs` loads the bytes synchronously and its
    `getWasmBackend()` helper marshals typed arrays through
    `BigInt64Array`, which the golden vectors and parity tests exercise.

34. **Empty `space/dist/`.** A fresh clone has no `space/dist/space.wasm`
    and no `space/dist/manifest.json`. `npm test` still passes: the JS twin
    is authoritative, `verify:space` prints "no wasm built yet, JS twin in
    use" and exits 0, and wasm-specific parity assertions skip. A developer
    who wants the second implementation runs `npm run build:space` with
    Emscripten installed and commits both files; `space/dist/.gitkeep`
    keeps the directory present either way.

## Status by stage

| Stage | Content | State |
|---|---|---|
| S0 | Scaffold, boundary checker, scaffold test | **done** |
| S1 | `core/` v2 + tests | stabilising |
| S2 | `store/` + `sequencer/` | stabilising |
| S3 | `resolve/` | stabilising |
| S4 | `space/` JS twin + reference data | stabilising |
| S5 | `space/` C++ + wasm + parity | **sources done, wasm pending local build** |
| S6 | `bridge/` | pending |
| S7 | `attention/` JS twin + level table | pending |
| S8 | `attention/` C++ + wasm + CSS emitter | pending |
| S9 | `conductor/` (Python) | pending |
| S10 | `view/` SVG renderers + snapshots | pending |
| S11 | demo ledger + `npm run report` | pending |
| S12 | `server/` | pending |
| S13 | `app/` (React + Vite) | pending |
| S14 | Final integration, README final pass, DoD checklist | pending |

S1 to S4 change from *stabilising* to **done** when the stabilisation batches
pass (`npm test`: 0 failures, `boundary check: OK`). S5's row means the C++
sources, CMake, ABI, parity tests and manifest tooling are complete; the
`space/dist/space.wasm` binary itself is built on the developer's machine
via `npm run build:space` and committed afterwards, and is not required for
`npm test` to pass.

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
