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

S0 is done. The files for S1 to S4 (`core/`, `store/`, `sequencer/`,
`resolve/`, `space/` JS twin) exist and are being brought to a green suite in
nine stabilisation batches (B1 to B9). S1 to S4 are marked **done** in the
table below only when `npm test` reports 0 failures and the boundary check
prints `boundary check: OK`. S5 onward has not been started.

Only these commands work today: `npm install`, `npm test`, `npm run verify`
and `npm run check-boundaries`. The rest of the scripts in `package.json` are
placeholders for later stages.

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

```
npm install
npm test               # node:test suites + boundary check
npm run check-boundaries
npm run verify         # verifies data/journal.jsonl hash chain
```

Available once the later stages are built (S11 to S13):

```
npm run report # out/report.html + out/report.json; non-zero on any failed check
npm run dev # server on 127.0.0.1:4000 + Vite client (Unix/macOS)
npm start # production server serving the built client
npm run demo # seeds the demo ledger in memory and prints card summaries
```

Optional, only needed when changing C++ or the Python conductor:

```
npm run build:space # Emscripten build of space/cpp → space/dist/space.wasm
npm run build:attention # Emscripten build of attention/cpp → attention/dist/attention.wasm
npm run conduct # Python 3.10+ regenerates choreographies, storyboards, CSS
npm run conduct:verify # verifies committed conductor outputs
```

`npm test` and `npm run report` use committed wasm binaries plus their JS
twins; no C++ toolchain and no Python are required.

## Repository layout

```
core/ money, time, canonical, hash, accounts, ledger, checks, cards, impact, trail
store/ journalFile, journalMemory, cardStore, trailStore
sequencer/ events, lanes, buckets, log, strip
resolve/ request, layout, tiers, plan, command
view/ pure SVG builders (text, theme, primitives, slip, impact, trail, strip)
space/ JS twin, C++ sources, reference data, wasm
attention/ JS twin, C++ sources, level table, wasm, CSS emitter
bridge/ measure.mjs, attention.mjs, contract.md
server/ node:http, router, routes, sse, errors
app/ Vite + React client (mounts only; drawing is from view/)
demo/ demo.ledger.mjs, report.mjs
conductor/ Python 3.10+ (build-time only); workflows, choreographies, fuzz
test/ node:test suites
scripts/ check-boundaries, verify-journal, verify-space, verify-attention,
emit-attention-css
data/ runtime only (gitignored): journal.jsonl, events.jsonl, trails/, cards-cache.json
```

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
   `space/README.md` (S4).

9. **Reference defaults for `space/reference/documents.json`.** Margins
   ~20 mm (57 pt), body 10 pt, headings 12–14 pt, captions 8 pt, leading 1.2×
   body. These are reference defaults, not legal or regulatory standards.
   Each value ships with a comment explaining it; see S4.

10. **`DISPLAY_MAX` and the "in thousands" switch.** When a formatted amount
    exceeds `DISPLAY_MAX` characters, the card deterministically switches to
    "in thousands" and states this in the page header. Set in
    `space/reference/metrics.json` (S4).

11. **`MIN_BODY = 9 px` (675 cpt).** Effective on-screen body size must be at
    least 9 px, or the solver rejects the shape or tier. See S4.

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
    `npx vite --config app/vite.config.js` in two terminals. No code
    workaround is provided.

18. **Node version.** `engines.node >= 20` as stated in the base layout. The
    `--test-reporter=spec` flag and native `BigInt64Array` are both available
    in Node 20.

19. **Boundary-check enforcement.** The matrix enforced by
    `scripts/check-boundaries.mjs` reflects the *union* of import rules across
    the three spec parts, with base restrictions that would prevent A or B
    from running relaxed per assumption #1. `core/` is still restricted to
    `node:*` plus its own relative imports; `space/` to its own folder;
    `attention/` to its own folder. Scoped bare specifiers are matched by
    package name (e.g. `@vitejs/plugin-react`), not by full path.

20. **Git tracking policy.** `.gitattributes` pins LF line endings
    (`* text=auto eol=lf`) and marks `*.wasm` as binary. LF keeps manifest
    hashes and SVG snapshot tests byte-identical across Windows/macOS/Linux;
    the binary marker prevents Git from attempting line-ending conversion on
    the committed wasm files. The wasm commit decision itself is recorded in
    #2; `.gitignore` therefore excludes `app/dist/` and native build
    directories but explicitly permits `space/dist/`, `attention/dist/` and
    `conductor/out/`.

21. **License.** MIT. See `LICENSE`. This project builds on ideas and a
    client skeleton from MindsEye (MIT, (c) 2025 Peace Thabiwa). The
    attribution is preserved in the License section below.

22. **Three-pane rule (60 percent).** In a three-pane layout the focal pane
    takes 60 percent of the long axis and the other two share 40 percent.
    Pane weights choose the large pane (ties to the lowest index) and split
    the two small panes. Implemented in `resolve/layout.mjs`.

23. **Narrower QUARTER and STRIP pages.** For archetypes whose FULL page is
    wider than 420 pt, QUARTER is 420 pt wide and STRIP is 360 pt wide, so
    body text stays at or above `MIN_BODY` in a pane at 1280x720. `MIN_BODY`
    itself is not lowered. Reasoning is recorded in `space/README.md`.

24. **Schema route for `resolve`.** `resolve/` must not import `core/` or
    `store/`. Card type data (period kind, minimum tier) reaches it through
    `bridge/schema.mjs`, which re-exports `core/schema.mjs` (plain data, no
    imports). `bridge/` may import only that one file from `core/`; the
    boundary checker enforces this at file level.

25. **`resolve/dates.mjs` mirrors `core/time.mjs`.** The pure date helpers are
    copied so `resolve/` stays off `core/`. A parity test keeps the two
    identical on seeded inputs.

26. **`plan()` takes its cache-key function from the caller.** Callers pass
    `CardStore.cacheKey` as `opts.cacheKey`. `plan()` returns an error if it
    is missing. This removes the `resolve` to `store` import.

27. **Copyright line in `LICENSE`.** The owner changed it on purpose and it is
    never edited by tooling. The scaffold test checks only its structure
    (starts with `MIT License`, has a year and a name), not the name itself.

28. **L7 and L8 arrive in S6.** The two space laws that involve the bridge are
    tested when `bridge/` is built. The property test file says so in its
    header.

29. **Constancy guards.** Three guards keep earlier stages stable while later
    ones are built: a stage manifest (`scripts/stages.json`) checked against
    the status table below, an API-surface snapshot of the public modules, and
    golden outputs (demo card hashes and layout rectangles). Golden files
    change only on purpose, by running `npm run golden:update` and committing
    the result. They are never edited by hand.

## Status by stage

| Stage | Content | State |
|---|---|---|
| S0 | Scaffold, boundary checker, scaffold test | **done** |
| S1 | `core/` v2 + tests | stabilising |
| S2 | `store/` + `sequencer/` | stabilising |
| S3 | `resolve/` | stabilising |
| S4 | `space/` JS twin + reference data | stabilising |
| S5 | `space/` C++ + wasm + parity | pending |
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
pass (`npm test`: 0 failures, `boundary check: OK`).

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
