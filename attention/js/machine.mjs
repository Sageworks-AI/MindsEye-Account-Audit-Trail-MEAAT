// The attention state machine. One pure step per event. Returns
// { state, code, frame } where `state` is frozen and byte-identical for
// identical inputs, `code` is the ABI return code, and `frame` is the
// per-actor appearance summary (only on OK / informational codes).
//
// Laws M1–M15 are enforced here or verified in tests. Every error leaves
// the input state unchanged (returned state === input state). Every
// success returns a new frozen state whose ring satisfies M1, M2, M6, M7,
// M8, M14 by construction.
import { makeRing, rankOf, moveToFront, insertAtFront, removeById,
         docRank, findById, idsInOrder, pairFront } from './ring.mjs';
import { makeEvent } from './events.mjs';
import { makeHistory, pushHistory, popHistory } from './history.mjs';
import { armTransfer } from './transfer.mjs';
import { createHash } from 'node:crypto';

// ABI return codes (mirrored in attention/ABI.md).
export const OK = 0;
export const NOOP = 1;
export const POINTER_STALE = 2;
export const ALREADY_FOCUSED = 3;
export const BAD_ACTOR = -1;
export const BAD_EVENT = -2;
export const TRANSFER_INVALID = -3;
export const RING_FULL = -4;
export const LAW_VIOLATION = -5;

export function makeState({ actors = [], lastPointerEpoch = 0 } = {}) {
  return Object.freeze({
    ring: makeRing(actors),
    history: makeHistory(),
    input: null,
    transfer: null,
    lastPointerEpoch,
  });
}

function ok(state, event, extra = {}) { return { state, code: OK, event, ...extra }; }
function noop(state, event) { return { state, code: NOOP, event }; }
function err(state, code, event) { return { state, code, event }; }

function ringAfterInputFocus(ring, id) {
  // BAR stays at rank 0 (M6). X goes to rank 1. Others keep their order.
  const bar = ring[0];
  if (!bar || bar.kind !== 'BAR') throw new Error('ringAfterInputFocus: BAR missing');
  const others = [];
  let alreadyAt1 = false;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i].id === id) {
      if (i === 1) { alreadyAt1 = true; break; }
      continue;
    }
    others.push(ring[i]);
  }
  if (alreadyAt1) return null;
  const x = findById(ring, id);
  return Object.freeze([bar, x, ...others]);
}

function ringAfterTransferFocus(ring, targetId, sourceId) {
  // M13: (target, source) at levels (0, 1); others keep relative order.
  return pairFront(ring, targetId, sourceId);
}

export function step(state, rawEvent) {
  let event;
  try { event = makeEvent(rawEvent); }
  catch (e) { return err(state, BAD_EVENT, rawEvent); }

  switch (event.type) {
    case 'OPEN': {
      if (findById(state.ring, event.actor.id)) return err(state, BAD_ACTOR, event);
      // Insert at rank 1 if input is active (BAR stays at 0); else at rank 0.
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
      } catch (e) {
        return err(state, RING_FULL, event);
      }
      return ok(Object.freeze({ ...state, ring: newRing }), event);
    }

    case 'CLOSE': {
      if (event.id === 'BAR' || findById(state.ring, event.id)?.kind === 'BAR') {
        return err(state, BAD_ACTOR, event);
      }
      if (!findById(state.ring, event.id)) return err(state, BAD_ACTOR, event);
      let workingState = state;
      if (state.transfer && state.transfer.sourceId === event.id) {
        // Closing a transfer source cancels the transfer (restore snapshot).
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
      catch (e) { return err(state, BAD_ACTOR, event); }
      return ok(Object.freeze({ ...workingState, ring: newRing }), event);
    }

    case 'FOCUS': {
      const actor = findById(state.ring, event.id);
      if (!actor) return err(state, BAD_ACTOR, event);
      if (actor.kind === 'BAR') return err(state, BAD_ACTOR, event);

      // M10 pointer anti-oscillation.
      if (event.source === 'pointer' && event.pointerEpoch <= state.lastPointerEpoch) {
        return err(state, POINTER_STALE, event);
      }
      const newEpoch = event.source === 'pointer'
        ? event.pointerEpoch : state.lastPointerEpoch;

      // M6 input primacy.
      if (state.input) {
        const newRing = ringAfterInputFocus(state.ring, event.id);
        if (newRing === null) return noop(state, event);
        const newHistory = pushHistory(state.history, state.ring);
        return ok(Object.freeze({ ...state, ring: newRing, history: newHistory,
                                  lastPointerEpoch: newEpoch }), event);
      }

      // M13 transfer pairing.
      if (state.transfer) {
        if (event.id === state.transfer.sourceId) return noop(state, event);
        const newRing = ringAfterTransferFocus(state.ring, event.id, state.transfer.sourceId);
        const newHistory = pushHistory(state.history, state.ring);
        return ok(Object.freeze({ ...state, ring: newRing, history: newHistory,
                                  lastPointerEpoch: newEpoch }), event);
      }

      // Normal case: M4 already-focused is a no-op.
      if (rankOf(state.ring, event.id) === 0) {
        return err(state, ALREADY_FOCUSED, event);
      }
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
      catch (e) { return err(state, RING_FULL, event); }
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
      // commit: remove BAR, keep the ring order (docs may have been reordered
      // by FOCUS events during input; those reorderings persist).
      let newRing;
      try { newRing = removeById(state.ring, 'BAR'); }
      catch (e) { return err(state, LAW_VIOLATION, event); }
      return ok(Object.freeze({ ...state, ring: newRing, input: null }), event);
    }

    case 'TRANSFER_COPY': {
      if (state.transfer) return err(state, TRANSFER_INVALID, event);
      if (state.input) return err(state, TRANSFER_INVALID, event);
      if (!findById(state.ring, event.sourceId)) return err(state, BAD_ACTOR, event);
      const source = findById(state.ring, event.sourceId);
      if (source.kind === 'BAR') return err(state, BAD_ACTOR, event);
      const snapshot = Object.freeze({
        ring: state.ring, history: state.history,
        transfer: state.transfer, lastPointerEpoch: state.lastPointerEpoch,
      });
      let armed;
      try { armed = armTransfer({
        ring: state.ring, sourceId: event.sourceId,
        payloadKind: event.payloadKind, snapshot,
      }); }
      catch (e) { return err(state, TRANSFER_INVALID, event); }
      return ok(Object.freeze({
        ...state, ring: armed.ring, transfer: armed.transfer,
      }), event);
    }

    case 'TRANSFER_PASTE': {
      if (!state.transfer) return err(state, TRANSFER_INVALID, event);
      if (state.input) return err(state, TRANSFER_INVALID, event);
      if (!findById(state.ring, event.targetId)) return err(state, BAD_ACTOR, event);
      if (event.targetId === state.transfer.sourceId) return err(state, TRANSFER_INVALID, event);
      const newRing = ringAfterTransferFocus(state.ring, event.targetId, state.transfer.sourceId);
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
      // M15 priority: input > transfer > history.
      if (state.input) return step(state, { type: 'INPUT_END', outcome: 'cancel' });
      if (state.transfer) return step(state, { type: 'TRANSFER_CANCEL' });
      const { history, top } = popHistory(state.history);
      if (top === null) return noop(state, event);
      return ok(Object.freeze({ ...state, ring: top, history }), event);
    }

    case 'RESIZE': {
      return noop(state, event);
    }
  }
  return err(state, BAD_EVENT, event);
}

// Frame: per-actor appearance summary. Used by the renderer (S13) and by
// the Python ctypes path (S9). Deterministic given state + level table.
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
      id: a.id,
      kind: a.kind,
      rank,
      level,
      docRank: dRank,
      slot,
      appearance: appearance ? { ...appearance } : null,
    });
  }
  return Object.freeze(out);
}

// Stable hash of the ring order + input/transfer flags + history depth.
// Two states with identical hashes must be byte-identical for our purposes;
// M4 and M5 rely on that. Includes the full ring, the current input/transfer
// flags, and the top of history. NOT the pointer epoch — that is metadata
// whose restoration rule is spelled out in INPUT_BEGIN / TRANSFER_COPY.
export function hashState(state) {
  const payload = {
    ring: state.ring.map((a) => ({ id: a.id, kind: a.kind })),
    inputActive: state.input !== null,
    inputChannel: state.input ? state.input.channel : null,
    transfer: state.transfer
      ? { sourceId: state.transfer.sourceId, payloadKind: state.transfer.payloadKind }
      : null,
    historyTop: state.history.length > 0
      ? state.history[state.history.length - 1].map((a) => ({ id: a.id, kind: a.kind }))
      : null,
    historyDepth: state.history.length,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}
