// The same flat int64 ABI as attention/cpp/api.cpp, implemented on top of
// the JS twin (attention/js/machine.mjs). This is the oracle for parity:
// scripts/gen-attention-golden.mjs runs inputs through this module and
// writes text vectors; the native C++ test runner replays them and asserts
// identical output. test/attention/parity.test.mjs does the same comparison
// in-process when a wasm backend is present.
//
// Every function takes (scratch, inLen) and writes its output starting at
// scratch[inLen]. It returns the output length, or a negative error code.
// Callers must have written the input into scratch[0..inLen).
import { step as twinStep, hashState as twinHashState, frame as twinFrame,
         makeState } from './machine.mjs';
import { loadLevels, validateLevels } from './levels.mjs';

export const ATT_VERSION = 1n;
export const ATT_SCRATCH_SLOTS = 65536;

export const ATT_OK = 0;
export const ATT_NOOP = 1;
export const ATT_POINTER_STALE = 2;
export const ATT_ALREADY_FOCUSED = 3;
export const ATT_BAD_ACTOR = -1;
export const ATT_BAD_EVENT = -2;
export const ATT_TRANSFER_INVALID = -3;
export const ATT_RING_FULL = -4;
export const ATT_LAW_VIOLATION = -5;
export const ATT_OVERFLOW = -6;
export const ATT_OUTPUT_TOO_SMALL = -7;

const MAX_ACTORS = 8;
const HISTORY_DEPTH = 16;
const MAX_ID_CP = 32;

const KIND_DOC = 0, KIND_FORM = 1, KIND_TRAIL = 2, KIND_BAR = 3;
const KIND_NAMES = ['DOC', 'FORM', 'TRAIL', 'BAR'];
const KIND_BY_NAME = { DOC: 0, FORM: 1, TRAIL: 2, BAR: 3 };

// Shadow/radius accept up to 100000 cpt (matches attention/cpp/levels.hpp).
// opacity/brightness/saturation/blur stay permille 0..1000.
const SHADOW_RADIUS_MAX = 100000;

function cpsToStr(cps) {
  return String.fromCodePoint(...cps);
}
function strToCps(s) {
  const out = [];
  for (const ch of s) out.push(ch.codePointAt(0));
  return out;
}

// ---- emit helpers ----

function emitId(scratch, offset, id) {
  const cps = strToCps(id);
  if (cps.length > MAX_ID_CP) return -1;
  scratch[offset++] = BigInt(cps.length);
  for (const cp of cps) scratch[offset++] = BigInt(cp);
  return offset;
}

function emitActor(scratch, offset, actor) {
  let next = emitId(scratch, offset, actor.id);
  if (next < 0) return -1;
  scratch[next++] = BigInt(KIND_BY_NAME[actor.kind]);
  return next;
}

function emitRing(scratch, offset, ring) {
  scratch[offset++] = BigInt(ring.length);
  for (const a of ring) {
    const next = emitActor(scratch, offset, a);
    if (next < 0) return -1;
    offset = next;
  }
  return offset;
}

function emitHistory(scratch, offset, history) {
  scratch[offset++] = BigInt(history.length);
  for (const ring of history) {
    const next = emitRing(scratch, offset, ring);
    if (next < 0) return -1;
    offset = next;
  }
  return offset;
}

function emitBasic(scratch, offset, snap) {
  let next = emitRing(scratch, offset, snap.ring);
  if (next < 0) return -1;
  next = emitHistory(scratch, next, snap.history);
  if (next < 0) return -1;
  scratch[next++] = BigInt(snap.lastPointerEpoch);
  return next;
}

function emitFull(scratch, offset, snap) {
  let next = emitRing(scratch, offset, snap.ring);
  if (next < 0) return -1;
  next = emitHistory(scratch, next, snap.history);
  if (next < 0) return -1;
  scratch[next++] = BigInt(snap.lastPointerEpoch);
  if (snap.transfer) {
    scratch[next++] = 1n;
    next = emitId(scratch, next, snap.transfer.sourceId);
    if (next < 0) return -1;
    scratch[next++] = BigInt(snap.transfer.payloadKind === 'entry' ? 0
      : snap.transfer.payloadKind === 'rows' ? 1
      : snap.transfer.payloadKind === 'row' ? 2
      : snap.transfer.payloadKind === 'period' ? 3 : 4);
    next = emitBasic(scratch, next, snap.transfer.snapshot);
    if (next < 0) return -1;
  } else {
    scratch[next++] = 0n;
  }
  return next;
}

function emitState(scratch, offset, state) {
  scratch[offset++] = BigInt(state.lastPointerEpoch);
  let next = emitRing(scratch, offset, state.ring);
  if (next < 0) return -1;
  next = emitHistory(scratch, next, state.history);
  if (next < 0) return -1;
  if (state.transfer) {
    scratch[next++] = 1n;
    next = emitId(scratch, next, state.transfer.sourceId);
    if (next < 0) return -1;
    const pk = { entry: 0, rows: 1, row: 2, period: 3, node: 4 }[state.transfer.payloadKind];
    if (pk === undefined) return -1;
    scratch[next++] = BigInt(pk);
    next = emitBasic(scratch, next, state.transfer.snapshot);
    if (next < 0) return -1;
  } else {
    scratch[next++] = 0n;
  }
  if (state.input) {
    scratch[next++] = 1n;
    const ch = { text: 0, voice: 1, document: 2 }[state.input.channel];
    if (ch === undefined) return -1;
    scratch[next++] = BigInt(ch);
    next = emitFull(scratch, next, state.input.snapshot);
    if (next < 0) return -1;
  } else {
    scratch[next++] = 0n;
  }
  return next;
}

function emitFrame(scratch, offset, state) {
  const levels = loadLevels();
  const f = twinFrame(state, levels);
  scratch[offset++] = BigInt(f.length);
  for (const row of f) {
    let next = emitActor(scratch, offset, { id: row.id, kind: row.kind });
    if (next < 0) return -1;
    offset = next;
    scratch[offset++] = BigInt(row.rank);
    scratch[offset++] = BigInt(row.level);
    scratch[offset++] = BigInt(row.docRank);
    scratch[offset++] = BigInt(row.slot);
    scratch[offset++] = BigInt(row.appearance.opacity);
    scratch[offset++] = BigInt(row.appearance.brightness);
    scratch[offset++] = BigInt(row.appearance.saturation);
    scratch[offset++] = BigInt(row.appearance.blur);
    scratch[offset++] = BigInt(row.appearance.shadow);
    scratch[offset++] = BigInt(row.appearance.radius);
  }
  return offset;
}

// ---- parse helpers ----

function parseId(scratch, offset, inLen) {
  if (offset >= inLen) return null;
  const cpLen = Number(scratch[offset++]);
  if (cpLen < 0 || cpLen > MAX_ID_CP) return null;
  if (offset + cpLen > inLen) return null;
  const cps = [];
  for (let i = 0; i < cpLen; i++) {
    const c = Number(scratch[offset++]);
    if (c < 0 || c > 0x10FFFF) return null;
    cps.push(c);
  }
  return { id: cpsToStr(cps), offset };
}

function parseRing(scratch, offset, inLen) {
  if (offset >= inLen) return null;
  const count = Number(scratch[offset++]);
  if (count < 0 || count > MAX_ACTORS) return null;
  const ring = [];
  for (let i = 0; i < count; i++) {
    const idRes = parseId(scratch, offset, inLen);
    if (!idRes) return null;
    offset = idRes.offset;
    if (offset >= inLen) return null;
    const kind = Number(scratch[offset++]);
    if (kind < 0 || kind > 3) return null;
    ring.push({ id: idRes.id, kind: KIND_NAMES[kind] });
  }
  return { ring, offset };
}

function parseHistory(scratch, offset, inLen) {
  if (offset >= inLen) return null;
  const depth = Number(scratch[offset++]);
  if (depth < 0 || depth > HISTORY_DEPTH) return null;
  const history = [];
  for (let i = 0; i < depth; i++) {
    const r = parseRing(scratch, offset, inLen);
    if (!r) return null;
    history.push(r.ring);
    offset = r.offset;
  }
  return { history, offset };
}

function parseBasic(scratch, offset, inLen) {
  const r = parseRing(scratch, offset, inLen);
  if (!r) return null;
  offset = r.offset;
  const h = parseHistory(scratch, offset, inLen);
  if (!h) return null;
  offset = h.offset;
  if (offset >= inLen) return null;
  const lpe = Number(scratch[offset++]);
  return { snap: { ring: r.ring, history: h.history, lastPointerEpoch: lpe }, offset };
}

function parseFull(scratch, offset, inLen) {
  const r = parseRing(scratch, offset, inLen);
  if (!r) return null;
  offset = r.offset;
  const h = parseHistory(scratch, offset, inLen);
  if (!h) return null;
  offset = h.offset;
  if (offset >= inLen) return null;
  const lpe = Number(scratch[offset++]);
  if (offset >= inLen) return null;
  const tActive = Number(scratch[offset++]);
  if (tActive !== 0 && tActive !== 1) return null;
  let transfer = null;
  if (tActive) {
    const idRes = parseId(scratch, offset, inLen);
    if (!idRes) return null;
    offset = idRes.offset;
    if (offset >= inLen) return null;
    const pk = Number(scratch[offset++]);
    const payloadKind = ['entry', 'rows', 'row', 'period', 'node'][pk];
    if (!payloadKind) return null;
    const b = parseBasic(scratch, offset, inLen);
    if (!b) return null;
    offset = b.offset;
    transfer = { sourceId: idRes.id, payloadKind, snapshot: b.snap };
  }
  return {
    snap: { ring: r.ring, history: h.history, lastPointerEpoch: lpe, transfer },
    offset,
  };
}

function parseState(scratch, offset, inLen) {
  if (offset >= inLen) return null;
  const lpe = Number(scratch[offset++]);
  const r = parseRing(scratch, offset, inLen);
  if (!r) return null;
  offset = r.offset;
  const h = parseHistory(scratch, offset, inLen);
  if (!h) return null;
  offset = h.offset;
  if (offset >= inLen) return null;
  const tActive = Number(scratch[offset++]);
  if (tActive !== 0 && tActive !== 1) return null;
  let transfer = null;
  if (tActive) {
    const idRes = parseId(scratch, offset, inLen);
    if (!idRes) return null;
    offset = idRes.offset;
    if (offset >= inLen) return null;
    const pk = Number(scratch[offset++]);
    const payloadKind = ['entry', 'rows', 'row', 'period', 'node'][pk];
    if (!payloadKind) return null;
    const b = parseBasic(scratch, offset, inLen);
    if (!b) return null;
    offset = b.offset;
    transfer = { sourceId: idRes.id, payloadKind, snapshot: b.snap };
  }
  if (offset >= inLen) return null;
  const iActive = Number(scratch[offset++]);
  if (iActive !== 0 && iActive !== 1) return null;
  let input = null;
  if (iActive) {
    if (offset >= inLen) return null;
    const ch = Number(scratch[offset++]);
    const channel = ['text', 'voice', 'document'][ch];
    if (!channel) return null;
    const f = parseFull(scratch, offset, inLen);
    if (!f) return null;
    offset = f.offset;
    input = { channel, snapshot: f.snap };
  }
  return {
    state: { ring: r.ring, history: h.history, input, transfer, lastPointerEpoch: lpe },
    offset,
  };
}

function parseEvent(scratch, offset, inLen) {
  if (offset >= inLen) return null;
  const type = Number(scratch[offset++]);
  switch (type) {
    case 0: { // OPEN
      const idRes = parseId(scratch, offset, inLen);
      if (!idRes) return null;
      offset = idRes.offset;
      if (offset
