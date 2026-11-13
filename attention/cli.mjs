#!/usr/bin/env node
// stdin/stdout JSON bridge for the S9 Python conductor. Reads one JSON
// request per line, writes one JSON response per line. Two request kinds:
//
//   { op: "step",    state, event, levels? }  -> { code, state, frame, hash }
//   { op: "frame",   state, levels?       }  -> { frame, hash }
//   { op: "levels",  raw?                 }  -> { levels } | { error }
//
// `state` is serialized by serializeState below. Kept JSON-compatible: ring
// becomes [{id, kind}, ...], input/transfer store only their public fields,
// history becomes [[{id,kind}, ...], ...]. Never uses BigInt so JSON is
// stable across Node versions.
import { createInterface } from 'node:readline';
import { makeState, step, frame, hashState } from './js/machine.mjs';
import { loadLevels, validateLevels } from './js/levels.mjs';

function serializeRing(ring) {
  return ring.map((a) => ({ id: a.id, kind: a.kind }));
}

function serializeState(state) {
  return {
    ring: serializeRing(state.ring),
    history: state.history.map(serializeRing),
    input: state.input
      ? { channel: state.input.channel, snapshot: serializeSnapshot(state.input.snapshot) }
      : null,
    transfer: state.transfer
      ? {
          sourceId: state.transfer.sourceId,
          payloadKind: state.transfer.payloadKind,
          snapshot: serializeSnapshot(state.transfer.snapshot),
        }
      : null,
    lastPointerEpoch: state.lastPointerEpoch,
  };
}

function serializeSnapshot(snap) {
  return {
    ring: serializeRing(snap.ring),
    history: snap.history.map(serializeRing),
    transfer: snap.transfer
      ? { sourceId: snap.transfer.sourceId, payloadKind: snap.transfer.payloadKind }
      : null,
    lastPointerEpoch: snap.lastPointerEpoch,
  };
}

function deserializeState(s) {
  const built = makeState({
    actors: s.ring || [],
    lastPointerEpoch: s.lastPointerEpoch || 0,
  });
  const history = Object.freeze((s.history || []).map((ring) => Object.freeze(ring.map(
    (a) => Object.freeze({ id: a.id, kind: a.kind })))));
  let input = null;
  if (s.input) {
    input = Object.freeze({
      channel: s.input.channel,
      snapshot: deserializeSnapshot(s.input.snapshot),
    });
  }
  let transfer = null;
  if (s.transfer) {
    transfer = Object.freeze({
      sourceId: s.transfer.sourceId,
      payloadKind: s.transfer.payloadKind,
      snapshot: deserializeSnapshot(s.transfer.snapshot),
    });
  }
  return Object.freeze({
    ...built, ring: built.ring, history, input, transfer,
    lastPointerEpoch: s.lastPointerEpoch || 0,
  });
}

function deserializeSnapshot(snap) {
  return Object.freeze({
    ring: Object.freeze((snap.ring || []).map((a) => Object.freeze({ id: a.id, kind: a.kind }))),
    history: Object.freeze((snap.history || []).map((ring) => Object.freeze(ring.map(
      (a) => Object.freeze({ id: a.id, kind: a.kind }))))),
    transfer: snap.transfer
      ? Object.freeze({ sourceId: snap.transfer.sourceId, payloadKind: snap.transfer.payloadKind })
      : null,
    lastPointerEpoch: snap.lastPointerEpoch || 0,
  });
}

let cachedLevels = null;
function levels() {
  if (!cachedLevels) cachedLevels = loadLevels();
  return cachedLevels;
}

function handleRequest(req) {
  switch (req.op) {
    case 'step': {
      const state = deserializeState(req.state);
      const result = step(state, req.event);
      return {
        code: result.code,
        state: serializeState(result.state),
        hash: hashState(result.state),
        frame: frame(result.state, levels()),
      };
    }
    case 'frame': {
      const state = deserializeState(req.state);
      return { frame: frame(state, levels()), hash: hashState(state) };
    }
    case 'levels': {
      if (req.raw) return { levels: validateLevels(req.raw) };
      return { levels: levels() };
    }
    default:
      return { error: `unknown op: ${req.op}` };
  }
}

function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); }
    catch (e) {
      process.stdout.write(JSON.stringify({ error: `parse: ${e.message}` }) + '\n');
      return;
    }
    let resp;
    try { resp = handleRequest(req); }
    catch (e) {
      resp = { error: e.message };
    }
    process.stdout.write(JSON.stringify(resp) + '\n');
  });
}

main();
