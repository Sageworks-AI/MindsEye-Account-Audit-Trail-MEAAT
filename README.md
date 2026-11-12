# Mind's Eye Account Audit Trail (MEAAT)

An enclosed, offline-capable accounting system whose interface is a split
screen of "state cards" (balance sheet, cash flow, receipt, and so on) drawn
as SVG slips. Three data layers: an append-only **Journal** (financial truth),
a **Sequencer** (time-labelled events, advisory only), and a **Card Store**
(derived cache). Three interface modes: **Read**, **Input**, **Trail**.

Enclosed means: one `git clone`, one `npm install`, one command to run. No
cloud accounts, no CDN, no web fonts, no network calls at runtime or at report
time, no credentials anywhere in the repo.

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

## Running (once fully built)
