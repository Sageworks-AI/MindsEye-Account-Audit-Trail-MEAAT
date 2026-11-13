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
