// Browser-safe duplicate of the attention state machine. Deliberately does
// NOT import from attention/js/machine.mjs because that module imports
// `node:crypto` at load time for hashState; a browser has no `node:crypto`
// and Vite cannot tree-shake a top-level side-effect import. This file is
// the same state machine with hashState removed (the browser does not need
// it; hashState is a testing primitive used by test/attention/laws.test.mjs
// and conductor/choreo.py, both of which run in Node or Python).
//
// A duplicate is unpleasant; the alternative was to refactor S7's machine
// to move hashState into its own file (README #77). The duplication is
// small and mechanical, and a random-event differential test is noted as a
// follow-up: comparing this module against attention/js/machine.mjs over
// seeded event walks would let a future S14 refactor land with confidence.
import { makeRing, rankOf, moveToFront, insertAtFront, removeById,
         docRank, findById, pairFront } from '../../../attention/js/ring.mjs';
import { makeEvent } from '../../../attention/js/events.mjs';
import { makeHistory, pushHistory, popHistory } from '../../../attention/js/history.mjs';
import { armTransfer } from '../../../attention/js/transfer.mjs';

export const OK = 0;
export const NOOP = 1;
export const POINTER_STALE = 2;
export const ALREADY_FOCUSED = 3;
export const BAD_ACTOR = -1;
export const BAD_EVENT = -2;
export const TRANSFER_INVALID = -3;
export const RING_FULL = -4;
export const LAW_VIOLATION = -5;

const TRANSFER_MATRIX = Object.freeze({
  'entry':  Object.freeze({ DOC: 'impact',        FORM: 'draft-entry', TRAIL: null }),
  'rows':   Object.freeze({ DOC: null,            FORM: 'draft-lines', TRAIL: 'trail-edit' }),
  'row':    Object.freeze({ DOC: null,            FORM: 'draft-lines', TRAIL: 'trail-edit' }),
  'period': Object.freeze({ DOC: 'period-change', FORM: null,          TRAIL: null }),
  'node':   Object.freeze({ DOC: null,            FORM: null,          TRAIL: 'trail-edit' }),
});

export function makeState({ actors = [], lastPointerEpoch = 0 } = {}) {
  return Object.freeze({
    ring: makeRing(actors),
    history: makeHistory(),
    input: null,
    transfer: null,
    lastPointerEpoch,
  });
}

function ok(state, event) { return { state, code: OK, event }; }
function noop(state, event) { return { state, code: NOOP, event }; }
function err(state, code, event) { return { state, code, event }; }

function ringAfterInputFocus(ring, id) {
  const bar = ring[0];
  if (!bar || bar.kind !== 'BAR') throw new Error('ringAfterInputFocus: BAR missing');
  if (ring[1] && ring[1].id === id) return null;
  const x = findById(ring, id);
  const others = [];
  for (let i = 1; i < ring.length; i++) {
    if (ring[i].id === id) continue;
    others.push(ring[i]);
  }
  return Object.freeze([bar, x, ...others]);
}

export function step(state, rawEvent) {
  let event;
  try { event = makeEvent(rawEvent); }
  catch (e) { return err(state, BAD_EVENT, rawEvent); }

  switch (event.type) {
    case 'OPEN': {
      if (findById(state.ring, event.actor.id)) return err(state, BAD_ACTOR, event);
      let newRing;
      try {
        if (state.input) {
          const bar = state.ring[0];
          const rest = state.ring.slice(1);
          const fresh = Object.freeze({ id: event.actor.id, kind: event.actor.kind });
          newRing = Object.freeze([bar, fresh, ...rest]);
          if (newRing.length > 8) return err(state, RING_FULL, event);
        } else {
          newRing = insertAtFront(state.ring, event.actor);
        }
      } catch { return err(state, RING_FULL, event); }
      return ok(Object.freeze({ ...state, ring: newRing }), event);
    }
    case 'CLOSE': {
      const target = findById(state.ring, event.id);
      if (!target || target.kind === 'BAR') return err(state, BAD_ACTOR, event);
      let workingState = state;
      if (state.transfer && state.transfer.sourceId === event.id) {
        workingState = {
          ...state,
          ring: state.transfer.snapshot.ring,
          history: state.transfer.snapshot.history,
          transfer: null,
          lastPointerEpoch: state.transfer.snapshot.lastPointerEpoch,
        };
      }
      let newRing;
      try { newRing = removeById(workingState.ring, event.id); }
      catch { return err(state, BAD_ACTOR, event); }
      return ok(Object.freeze({ ...workingState, ring: newRing }), event);
    }
    case 'FOCUS': {
      const actor = findById(state.ring, event.id);
      if (!actor || actor.kind === 'BAR') return err(state, BAD_ACTOR, event);
      if (event.source === 'pointer' && event.pointerEpoch <= state.lastPointerEpoch) {
        return err(state, POINTER_STALE, event);
      }
      const newEpoch = event.source === 'pointer' ? event.pointerEpoch : state.lastPointerEpoch;

      if (state.input) {
        const newRing = ringAfterInputFocus(state.ring, event.id);
        if (newRing === null) return noop(state, event);
        const newHistory = pushHistory(state.history, state.ring);
        return ok(Object.freeze({ ...state, ring: newRing, history: newHistory,
                                  lastPointerEpoch: newEpoch }), event);
      }
      if (state.transfer) {
        if (event.id === state.transfer.sourceId) return noop(state, event);
        const newRing = pairFront(state.ring, event.id, state.transfer.sourceId);
        const newHistory = pushHistory(state.history, state.ring);
        return ok(Object.freeze({ ...state, ring: newRing, history: newHistory,
                                  lastPointerEpoch: newEpoch }), event);
      }
      if (rankOf(state.ring, event.id) === 0) return err(state, ALREADY_FOCUSED, event);
      const newRing = moveToFront(state.ring, event.id);
      const newHistory = pushHistory(state.history, state.ring);
      return ok(Object.freeze({ ...state, ring: newRing, history: newHistory,
                                lastPointerEpoch: newEpoch }), event);
    }
    case 'INPUT_BEGIN': {
      if (state.input) return err(state, BAD_EVENT, event);
      if (findById(state.ring, 'BAR')) return err(state, LAW_VIOLATION, event);
      const snapshot = Object.freeze({
        ring: state.ring, history: state.history,
        transfer: state.transfer, lastPointerEpoch: state.lastPointerEpoch,
      });
      let newRing;
      try { newRing = insertAtFront(state.ring, { id: 'BAR', kind: 'BAR' }); }
      catch { return err(state, RING_FULL, event); }
      return ok(Object.freeze({
        ...state, ring: newRing, input: Object.freeze({ channel: event.channel, snapshot }),
      }), event);
    }
    case 'INPUT_END': {
      if (!state.input) return err(state, BAD_EVENT, event);
      if (event.outcome === 'cancel') {
        const snap = state.input.snapshot;
        return ok(Object.freeze({
          ring: snap.ring, history: snap.history, transfer: snap.transfer,
          input: null, lastPointerEpoch: snap.lastPointerEpoch,
        }), event);
      }
      let newRing;
      try { newRing = removeById(state.ring, 'BAR'); }
      catch { return err(state, LAW_VIOLATION, event); }
      return ok(Object.freeze({ ...state, ring: newRing, input: null }), event);
    }
    case 'TRANSFER_COPY': {
      if (state.transfer || state.input) return err(state, TRANSFER_INVALID, event);
      const nonBar = state.ring.filter((a) => a.kind !== 'BAR').length;
      if (nonBar < 2) return err(state, TRANSFER_INVALID, event);
      const source = findById(state.ring, event.sourceId);
      if (!source || source.kind === 'BAR') return err(state, BAD_ACTOR, event);
      const snapshot = Object.freeze({
        ring: state.ring, history: state.history,
        transfer: state.transfer, lastPointerEpoch: state.lastPointerEpoch,
      });
      let armed;
      try { armed = armTransfer({
        ring: state.ring, sourceId: event.sourceId,
        payloadKind: event.payloadKind, snapshot,
      }); }
      catch { return err(state, TRANSFER_INVALID, event); }
      return ok(Object.freeze({
        ...state, ring: armed.ring, transfer: armed.transfer,
      }), event);
    }
    case 'TRANSFER_PASTE': {
      if (!state.transfer || state.input) return err(state, TRANSFER_INVALID, event);
      const target = findById(state.ring, event.targetId);
      if (!target) return err(state, BAD_ACTOR, event);
      if (event.targetId === state.transfer.sourceId) return err(state, TRANSFER_INVALID, event);
      const expected = TRANSFER_MATRIX[state.transfer.payloadKind]?.[target.kind];
      if (!expected || expected !== event.outcomeKind) return err(state, TRANSFER_INVALID, event);
      const newRing = pairFront(state.ring, event.targetId, state.transfer.sourceId);
      const newHistory = pushHistory(state.history, state.ring);
      return ok(Object.freeze({
        ...state, ring: newRing, history: newHistory, transfer: null,
      }), event);
    }
    case 'TRANSFER_CANCEL': {
      if (!state.transfer) return noop(state, event);
      const snap = state.transfer.snapshot;
      return ok(Object.freeze({
        ring: snap.ring, history: snap.history, input: null, transfer: null,
        lastPointerEpoch: snap.lastPointerEpoch,
      }), event);
    }
    case 'BACK': {
      if (state.input) return step(state, { type: 'INPUT_END', outcome: 'cancel' });
      if (state.transfer) return step(state, { type: 'TRANSFER_CANCEL' });
      const { history, top } = popHistory(state.history);
      if (top === null) return noop(state, event);
      return ok(Object.freeze({ ...state, ring: top, history }), event);
    }
    case 'RESIZE':
      return noop(state, event);
  }
  return err(state, BAD_EVENT, event);
}

export function frame(state, levelTable) {
  const out = [];
  for (let rank = 0; rank < state.ring.length; rank++) {
    const a = state.ring[rank];
    const level = rank < 2 ? rank : 2;
    const isBar = a.kind === 'BAR';
    const dRank = isBar ? -1 : docRank(state.ring, a.id);
    const slot = isBar ? -1 : (dRank === 0 ? 0 : dRank === 1 ? 1 : 2);
    const themeTable = levelTable && levelTable.themes ? levelTable.themes.light : null;
    const appearance = themeTable ? themeTable.table[level] : null;
    out.push({
      id: a.id, kind: a.kind, rank, level, docRank: dRank, slot,
      appearance: appearance ? { ...appearance } : null,
    });
  }
  return Object.freeze(out);
}
