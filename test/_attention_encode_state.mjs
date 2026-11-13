// Helper for parity tests. Encodes a twin state as the flat ABI <state>
// layout so a golden step vector can be replayed through both the twin and
// the wasm. Kept outside test/attention/ so its helper nature is obvious.
import { makeState, step } from '../attention/index.mjs';

const KIND_INT = { DOC: 0, FORM: 1, TRAIL: 2, BAR: 3 };
const PAYLOAD_INT = { entry: 0, rows: 1, row: 2, period: 3, node: 4 };
const CHANNEL_INT = { text: 0, voice: 1, document: 2 };

export function encodeState(state) {
  const out = [];
  function emitId(id) {
    out.push(BigInt([...id].length));
    for (const ch of id) out.push(BigInt(ch.codePointAt(0)));
  }
  function emitRing(ring) {
    out.push(BigInt(ring.length));
    for (const a of ring) { emitId(a.id); out.push(BigInt(KIND_INT[a.kind])); }
  }
  function emitHist(history) {
    out.push(BigInt(history.length));
    for (const ring of history) emitRing(ring);
  }
  function emitBasic(snap) {
    emitRing(snap.ring);
    emitHist(snap.history);
    out.push(BigInt(snap.lastPointerEpoch));
  }
  function emitFull(snap) {
    emitRing(snap.ring);
    emitHist(snap.history);
    out.push(BigInt(snap.lastPointerEpoch));
    if (snap.transfer) {
      out.push(1n); emitId(snap.transfer.sourceId);
      out.push(BigInt(PAYLOAD_INT[snap.transfer.payloadKind]));
      emitBasic(snap.transfer.snapshot);
    } else { out.push(0n); }
  }
  out.push(BigInt(state.lastPointerEpoch));
  emitRing(state.ring);
  emitHist(state.history);
  if (state.transfer) {
    out.push(1n); emitId(state.transfer.sourceId);
    out.push(BigInt(PAYLOAD_INT[state.transfer.payloadKind]));
    emitBasic(state.transfer.snapshot);
  } else { out.push(0n); }
  if (state.input) {
    out.push(1n); out.push(BigInt(CHANNEL_INT[state.input.channel]));
    emitFull(state.input.snapshot);
  } else { out.push(0n); }
  return out;
}

export function encodeEvent(e) {
  const out = [];
  function emitId(id) {
    out.push(BigInt([...id].length));
    for (const ch of id) out.push(BigInt(ch.codePointAt(0)));
  }
  switch (e.type) {
    case 'OPEN': out.push(0n); emitId(e.actor.id); out.push(BigInt(KIND_INT[e.actor.kind])); break;
    case 'CLOSE': out.push(1n); emitId(e.id); break;
    case 'FOCUS': {
      out.push(2n); emitId(e.id);
      out.push(BigInt({ pointer: 0, keyboard: 1, command: 2, programmatic: 3 }[e.source]));
      if (e.source === 'pointer') out.push(BigInt(e.pointerEpoch));
      break;
    }
    case 'INPUT_BEGIN': out.push(3n); out.push(BigInt(CHANNEL_INT[e.channel])); break;
    case 'INPUT_END': out.push(4n); out.push(BigInt(e.outcome === 'cancel' ? 1n : 0n)); break;
    case 'TRANSFER_COPY': out.push(5n); emitId(e.sourceId); out.push(BigInt(PAYLOAD_INT[e.payloadKind])); break;
    case 'TRANSFER_PASTE': {
      out.push(6n); emitId(e.targetId);
      out.push(BigInt({ impact: 0, 'draft-entry': 1, 'draft-lines': 2, 'trail-edit': 3, 'period-change': 4 }[e.outcomeKind]));
      break;
    }
    case 'TRANSFER_CANCEL': out.push(7n); break;
    case 'BACK': out.push(8n); break;
    case 'RESIZE': out.push(9n); break;
  }
  return out;
}

export function stepVector(scenario, event) {
  let s = makeState({ actors: scenario.actors });
  for (const prior of scenario.priorEvents || []) s = step(s, prior).state;
  const stateEnc = encodeState(s);
  const evtEnc = encodeEvent(event);
  return {
    stateLen: stateEnc.length,
    stateEnc,
    evtLen: evtEnc.length,
    evtEnc,
    expectedState: s,
  };
}
