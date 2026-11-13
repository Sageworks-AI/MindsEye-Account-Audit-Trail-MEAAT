# attention/ — C ABI

The C ABI carries the attention state and one event across the JS↔wasm
boundary. All state is flat `int64_t` arrays; no JSON, no strings except
length-prefixed code-point arrays. Nothing is allocated by the ABI itself:
every function reads and writes into a fixed scratch buffer of
`att_scratch_size()` int64 slots.

## Conventions

- **Version word first.** Every input array starts with `att_version()` (= `1`).
  Any mismatch is `ATT_BAD_VERSION`.
- **All int64.** BigInt in the JS twin; `int64_t` in C++. Lengths fit.
- **Scratch.** JS calls `att_scratch_ptr()` once for the byte address and
  `att_scratch_size()` for the capacity in int64 slots. Every ABI function
  reads its input from `scratch[0..in_len)`, writes its output starting at
  `scratch[in_len ..)`.
- **No floats.** Appearance values are permille; radii are centipoints
  (1 cpt = 1/100 pt = 1/75 CSS px).
- **Determinism.** Same inputs → same outputs, every platform.

## Return codes
0 ATT_OK
1 ATT_NOOP
2 ATT_POINTER_STALE
3 ATT_ALREADY_FOCUSED
-1 ATT_BAD_ACTOR
-2 ATT_BAD_EVENT
-3 ATT_TRANSFER_INVALID
-4 ATT_RING_FULL
-5 ATT_LAW_VIOLATION
-6 ATT_OVERFLOW
-7 ATT_OUTPUT_TOO_SMALL


## Constants

- `ATT_MAX_ACTORS = 8`
- `ATT_HISTORY_DEPTH = 16`
- `ATT_MAX_ID_CP = 32` — a string actor id may be at most 32 code points
- `ATT_SCRATCH_SLOTS = 65536` (512 KiB)

## Actor kind and event-type integers (stable)

Kinds: `0=DOC, 1=FORM, 2=TRAIL, 3=BAR`.

Event types: `0=OPEN, 1=CLOSE, 2=FOCUS, 3=INPUT_BEGIN, 4=INPUT_END,
5=TRANSFER_COPY, 6=TRANSFER_PASTE, 7=TRANSFER_CANCEL, 8=BACK, 9=RESIZE`.

Focus sources: `0=pointer, 1=keyboard, 2=command, 3=programmatic`.
Input channels: `0=text, 1=voice, 2=document`.
Input outcomes: `0=commit, 1=cancel`.
Payload kinds: `0=entry, 1=rows, 2=row, 3=period, 4=node`.
Outcome kinds: `0=impact, 1=draft-entry, 2=draft-lines, 3=trail-edit, 4=period-change`.

## Functions

### `att_version() -> int64`

Returns `1`. Does not touch scratch.

### `att_scratch_ptr() -> int64` / `att_scratch_size() -> int64`

Scratch buffer address and capacity in int64 slots.

### `att_levels_table(in_len) -> out_len | err`
in = [ V, theme ] theme: 0=light, 1=dark
out = [ V, <18 level fields>, 6 color fields, 8 timing fields ]


`<18 level fields>`: for level 0..2, then per level: `opacity, brightness,
saturation, blur, shadow, radius`. Colors: `fgR, fgG, fgB, bgR, bgG, bgB`.
Timing: `focusMs, inputBeginMs, inputEndMs, transferMs, x1, y1, x2, y2`
(easing in permille).

### `att_validate(in_len) -> out_len | err`
in = [ V, <18 level fields>, 6 color fields, 8 timing fields ]
out = [ V, code ] -- 0 for OK, ATT_LAW_VIOLATION for T1–T4

text

### `att_step(in_len) -> out_len | err`
in = [ V, stateLen, <state>, eventLen, <event> ]
out = [ V, code, outStateLen, <state>, frameLen, <frame> ]


On any error, `outStateLen` is `0` and the input state is unchanged; the
caller should reuse its previous state. On `ATT_NOOP`, `ATT_ALREADY_FOCUSED`,
`ATT_POINTER_STALE`, the returned state is byte-identical to the input state.

### `<state>`
[ lastPointerEpoch,
<ring>,
<history>,
transferActive, [if active: sourceIdCpLen, cp..., payloadKindInt, <basicSnapshot>],
inputActive, [if active: channelInt, <fullSnapshot>] ]



`<ring>` = `[ ringCount, per actor: idCpLen, cp..., kindInt ]`.
`<history>` = `[ histDepth, per snapshot: <ring> ]`.

`<basicSnapshot>` (used by a transfer's snapshot, which by construction has
no active input and no nested transfer):
[ <ring>, <history>, lastPointerEpoch ]


`<fullSnapshot>` (used by an input's snapshot, which may hold an armed
transfer):
[ <ring>, <history>, lastPointerEpoch,
transferActive, [if active: sourceIdCpLen, cp..., payloadKindInt, <basicSnapshot>] ]


### `<event>`
[ typeInt, payload... ]


| type | payload |
|---|---|
| OPEN (0) | idCpLen, cp..., kindInt |
| CLOSE (1) | idCpLen, cp... |
| FOCUS (2) | idCpLen, cp..., sourceInt, [if source==0: pointerEpoch] |
| INPUT_BEGIN (3) | channelInt |
| INPUT_END (4) | outcomeInt |
| TRANSFER_COPY (5) | sourceIdCpLen, cp..., payloadKindInt |
| TRANSFER_PASTE (6) | targetIdCpLen, cp..., outcomeKindInt |
| TRANSFER_CANCEL (7) | (nothing) |
| BACK (8) | (nothing) |
| RESIZE (9) | (nothing) |

### `<frame>`
[ actorCount,
per actor: idCpLen, cp..., kindInt, rankInt, levelInt, docRankInt, slotInt,
opacityInt, brightnessInt, saturationInt, blurInt, shadowInt, radiusInt ]


Appearance values come from the *light* theme's level table (same as
`frame(state, loadLevels())` in the JS twin). `docRank = -1` and `slot = -1`
for BAR.

## Baked level table

`attention/cpp/levels.hpp` bakes the same numbers as
`attention/dist/levels.json`. Light and dark themes are baked; `frame` uses
light. `attention/marshal.mjs` bakes the same numbers into int64 for the JS
ABI, and `test/attention/parity.test.mjs` verifies the two agree.

## Baked contrast LUT

`attention/cpp/contrast.hpp` bakes the 256-entry sRGB→linear LUT computed
by `attention/js/contrast.mjs`. `att_validate` uses it. A parity test fuzzes
`levelContrastPermille()` and asserts twin-vs-wasm agree to the last digit.

## Error notes

Every function validates the version word, lengths (`0 <= len <=
ATT_SCRATCH_SLOTS/2`), all enum values, `idCpLen <= ATT_MAX_ID_CP`,
`ringCount <= ATT_MAX_ACTORS`, `histDepth <= ATT_HISTORY_DEPTH`, and
returns an error code rather than crashing.
