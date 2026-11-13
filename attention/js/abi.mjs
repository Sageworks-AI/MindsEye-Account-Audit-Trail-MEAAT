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
      if (offset >= inLen) return null;
      const kind = Number(scratch[offset++]);
      if (kind < 0 || kind > 2) return null;
      return { event: { type: 'OPEN', actor: { id: idRes.id, kind: KIND_NAMES[kind] } }, offset };
    }
    case 1: { // CLOSE
      const idRes = parseId(scratch, offset, inLen);
      if (!idRes) return null;
      return { event: { type: 'CLOSE', id: idRes.id }, offset: idRes.offset };
    }
    case 2: { // FOCUS
      const idRes = parseId(scratch, offset, inLen);
      if (!idRes) return null;
      offset = idRes.offset;
      if (offset >= inLen) return null;
      const src = Number(scratch[offset++]);
      if (src < 0 || src > 3) return null;
      const source = ['pointer', 'keyboard', 'command', 'programmatic'][src];
      let pointerEpoch;
      if (source === 'pointer') {
        if (offset >= inLen) return null;
        pointerEpoch = Number(scratch[offset++]);
        if (pointerEpoch < 0) return null;
      }
      const event = pointerEpoch !== undefined
        ? { type: 'FOCUS', id: idRes.id, source, pointerEpoch }
        : { type: 'FOCUS', id: idRes.id, source };
      return { event, offset };
    }
    case 3: { // INPUT_BEGIN
      if (offset >= inLen) return null;
      const ch = Number(scratch[offset++]);
      const channel = ['text', 'voice', 'document'][ch];
      if (!channel) return null;
      return { event: { type: 'INPUT_BEGIN', channel }, offset };
    }
    case 4: { // INPUT_END
      if (offset >= inLen) return null;
      const oc = Number(scratch[offset++]);
      const outcome = ['commit', 'cancel'][oc];
      if (!outcome) return null;
      return { event: { type: 'INPUT_END', outcome }, offset };
    }
    case 5: { // TRANSFER_COPY
      const idRes = parseId(scratch, offset, inLen);
      if (!idRes) return null;
      offset = idRes.offset;
      if (offset >= inLen) return null;
      const pk = Number(scratch[offset++]);
      const payloadKind = ['entry', 'rows', 'row', 'period', 'node'][pk];
      if (!payloadKind) return null;
      return { event: { type: 'TRANSFER_COPY', sourceId: idRes.id, payloadKind }, offset };
    }
    case 6: { // TRANSFER_PASTE
      const idRes = parseId(scratch, offset, inLen);
      if (!idRes) return null;
      offset = idRes.offset;
      if (offset >= inLen) return null;
      const ok = Number(scratch[offset++]);
      const outcomeKind = ['impact', 'draft-entry', 'draft-lines', 'trail-edit', 'period-change'][ok];
      if (!outcomeKind) return null;
      return { event: { type: 'TRANSFER_PASTE', targetId: idRes.id, outcomeKind }, offset };
    }
    case 7: return { event: { type: 'TRANSFER_CANCEL' }, offset };
    case 8: return { event: { type: 'BACK' }, offset };
    case 9: return { event: { type: 'RESIZE' }, offset };
    default: return null;
  }
}

// ---- ABI functions ----

export function att_version() { return Number(ATT_VERSION); }
export function att_scratch_size() { return ATT_SCRATCH_SLOTS; }

export function att_levels_table(scratch, inLen) {
  if (inLen !== 2) return ATT_BAD_ARGUMENT;
  if (scratch[0] !== ATT_VERSION) return ATT_BAD_VERSION;
  const theme = Number(scratch[1]);
  if (theme !== 0 && theme !== 1) return ATT_BAD_ARGUMENT;
  const levels = loadLevels();
  const t = theme === 0 ? levels.themes.light : levels.themes.dark;
  const timing = levels.timing;
  if (inLen + 1 + 32 > ATT_SCRATCH_SLOTS) return ATT_OUTPUT_TOO_SMALL;
  let p = inLen;
  scratch[p++] = ATT_VERSION;
  for (let l = 0; l < 3; l++) {
    const r = t.table[l];
    scratch[p++] = BigInt(r.opacity);
    scratch[p++] = BigInt(r.brightness);
    scratch[p++] = BigInt(r.saturation);
    scratch[p++] = BigInt(r.blur);
    scratch[p++] = BigInt(r.shadow);
    scratch[p++] = BigInt(r.radius);
  }
  scratch[p++] = BigInt(t.fg.r); scratch[p++] = BigInt(t.fg.g); scratch[p++] = BigInt(t.fg.b);
  scratch[p++] = BigInt(t.bg.r); scratch[p++] = BigInt(t.bg.g); scratch[p++] = BigInt(t.bg.b);
  scratch[p++] = BigInt(timing.durationMs.focus);
  scratch[p++] = BigInt(timing.durationMs.inputBegin);
  scratch[p++] = BigInt(timing.durationMs.inputEnd);
  scratch[p++] = BigInt(timing.durationMs.transfer);
  scratch[p++] = BigInt(timing.easing.x1);
  scratch[p++] = BigInt(timing.easing.y1);
  scratch[p++] = BigInt(timing.easing.x2);
  scratch[p++] = BigInt(timing.easing.y2);
  return 1 + 32;
}

export function att_validate(scratch, inLen) {
  if (inLen !== 33) return ATT_BAD_ARGUMENT;
  if (scratch[0] !== ATT_VERSION) return ATT_BAD_VERSION;
  let p = 1;
  const table = [];
  for (let l = 0; l < 3; l++) {
    const row = {
      opacity:    Number(scratch[p++]),
      brightness: Number(scratch[p++]),
      saturation: Number(scratch[p++]),
      blur:       Number(scratch[p++]),
      shadow:     Number(scratch[p++]),
      radius:     Number(scratch[p++]),
    };
    if (row.opacity    < 0 || row.opacity    > 1000)    return ATT_BAD_ARGUMENT;
    if (row.brightness < 0 || row.brightness > 1000)    return ATT_BAD_ARGUMENT;
    if (row.saturation < 0 || row.saturation > 1000)    return ATT_BAD_ARGUMENT;
    if (row.blur       < 0 || row.blur       > 1000)    return ATT_BAD_ARGUMENT;
    if (row.shadow     < 0 || row.shadow     > SHADOW_RADIUS_MAX) return ATT_BAD_ARGUMENT;
    if (row.radius     < 0 || row.radius     > SHADOW_RADIUS_MAX) return ATT_BAD_ARGUMENT;
    table.push(row);
  }
  const fg = { r: Number(scratch[p++]), g: Number(scratch[p++]), b: Number(scratch[p++]) };
  const bg = { r: Number(scratch[p++]), g: Number(scratch[p++]), b: Number(scratch[p++]) };
  const timing = {
    durationMs: {
      focus:      Number(scratch[p++]),
      inputBegin: Number(scratch[p++]),
      inputEnd:   Number(scratch[p++]),
      transfer:   Number(scratch[p++]),
    },
    easing: {
      x1: Number(scratch[p++]),
      y1: Number(scratch[p++]),
      x2: Number(scratch[p++]),
      y2: Number(scratch[p++]),
    },
  };
  const raw = {
    version: 1,
    themes: {
      light: { fg, bg, table },
      dark:  { fg, bg, table },
    },
    timing,
  };
  let code;
  try { validateLevels(raw); code = ATT_OK; }
  catch (e) { code = ATT_LAW_VIOLATION; }
  if (inLen + 2 > ATT_SCRATCH_SLOTS) return ATT_OUTPUT_TOO_SMALL;
  scratch[inLen] = ATT_VERSION;
  scratch[inLen + 1] = BigInt(code);
  return 2;
}

export function att_step(scratch, inLen) {
  if (inLen < 3) return ATT_BAD_ARGUMENT;
  if (scratch[0] !== ATT_VERSION) return ATT_BAD_VERSION;
  const stateLen = Number(scratch[1]);
  if (stateLen < 0 || 2 + stateLen >= inLen) return ATT_BAD_ARGUMENT;
  const stateOff = 2;
  const stateRes = parseState(scratch, stateOff, inLen);
  if (!stateRes || stateRes.offset !== stateOff + stateLen) return ATT_BAD_ARGUMENT;
  let cursor = stateRes.offset;
  const eventLen = Number(scratch[cursor++]);
  if (eventLen < 1 || cursor + eventLen !== inLen) return ATT_BAD_ARGUMENT;
  const evtRes = parseEvent(scratch, cursor, inLen);
  if (!evtRes || evtRes.offset !== cursor + eventLen) return ATT_BAD_ARGUMENT;

  const twinState = makeState({
    actors: stateRes.state.ring,
    lastPointerEpoch: stateRes.state.lastPointerEpoch,
  });
  // Overwrite history and input/transfer from the parsed state; makeState
  // zeroes them. The twin accepts plain objects for these fields.
  const composedState = Object.freeze({
    ...twinState,
    ring: Object.freeze(stateRes.state.ring.map((a) => Object.freeze({ ...a }))),
    history: Object.freeze(stateRes.state.history.map((ring) => Object.freeze(
      ring.map((a) => Object.freeze({ ...a }))))),
    input: stateRes.state.input
      ? Object.freeze({ channel: stateRes.state.input.channel,
                        snapshot: freezeSnapshot(stateRes.state.input.snapshot) })
      : null,
    transfer: stateRes.state.transfer
      ? Object.freeze({ sourceId: stateRes.state.transfer.sourceId,
                        payloadKind: stateRes.state.transfer.payloadKind,
                        snapshot: freezeSnapshot(stateRes.state.transfer.snapshot) })
      : null,
    lastPointerEpoch: stateRes.state.lastPointerEpoch,
  });

  const result = twinStep(composedState, evtRes.event);

  const writeStart = inLen;
  if (writeStart + 3 > ATT_SCRATCH_SLOTS) return ATT_OUTPUT_TOO_SMALL;
  let p = writeStart;
  scratch[p++] = ATT_VERSION;
  scratch[p++] = BigInt(result.code);

  const isSuccess = result.code === ATT_OK || result.code === ATT_NOOP ||
    result.code === ATT_ALREADY_FOCUSED || result.code === ATT_POINTER_STALE;

  const stateStart = p;
  let outStateLen = 0;
  if (isSuccess) {
    const next = emitState(scratch, p, result.state);
    if (next < 0) return ATT_OUTPUT_TOO_SMALL;
    outStateLen = next - stateStart;
    p = next;
  }
  // Patch the outStateLen slot which was reserved after the version+code.
  // Layout is V, code, outStateLen, <state>, frameLen, <frame>. We need to
  // write outStateLen before <state>. Do it by re-building the whole tail.
  // Simplest: write outStateLen into slot (writeStart + 2) then shift state
  // right by 0 (it was already written at stateStart = writeStart+3).
  scratch[writeStart + 2] = BigInt(outStateLen);

  const frameStart = p;
  const frameNext = emitFrame(scratch, frameStart, result.state);
  if (frameNext < 0) return ATT_OUTPUT_TOO_SMALL;
  const frameLen = frameNext - frameStart;
  // Reserve one slot for frameLen, shift the frame right by one.
  if (frameNext + 1 > ATT_SCRATCH_SLOTS) return ATT_OUTPUT_TOO_SMALL;
  for (let i = frameNext; i > frameStart; --i) scratch[i] = scratch[i - 1];
  scratch[frameStart] = BigInt(frameLen);

  return 5 + outStateLen + frameLen;
}

function freezeSnapshot(snap) {
  return Object.freeze({
    ring: Object.freeze(snap.ring.map((a) => Object.freeze({ ...a }))),
    history: Object.freeze(snap.history.map((ring) => Object.freeze(
      ring.map((a) => Object.freeze({ ...a }))))),
    lastPointerEpoch: snap.lastPointerEpoch,
    transfer: snap.transfer
      ? Object.freeze({
          sourceId: snap.transfer.sourceId,
          payloadKind: snap.transfer.payloadKind,
          snapshot: freezeSnapshot(snap.transfer.snapshot),
        })
      : null,
  });
}
