// Browser events -> attention events. Pure mapping (no React, no DOM
// listeners installed here; the caller wires these to window events). The
// only job is translating a browser event's shape into the exact shape
// the state machine accepts, with the correct source label.
//
// Pointer dwell is not implemented in this module; the caller
// (hooks/useAttention.js) owns a pointerEpoch counter and dwell timer. This
// module only exposes the factory functions so the intent is readable at
// the call site.

export function focusEvent({ id, source = 'programmatic', pointerEpoch }) {
  if (source === 'pointer') {
    if (!Number.isSafeInteger(pointerEpoch) || pointerEpoch < 0) {
      throw new Error('focusEvent: pointerEpoch must be a non-negative integer');
    }
    return { type: 'FOCUS', id, source: 'pointer', pointerEpoch };
  }
  return { type: 'FOCUS', id, source };
}

export function openEvent({ id, kind }) {
  return { type: 'OPEN', actor: { id, kind } };
}

export function closeEvent({ id }) {
  return { type: 'CLOSE', id };
}

export function inputBegin({ channel = 'text' } = {}) {
  return { type: 'INPUT_BEGIN', channel };
}

export function inputEnd({ outcome }) {
  return { type: 'INPUT_END', outcome };
}

export function transferCopy({ sourceId, payloadKind }) {
  return { type: 'TRANSFER_COPY', sourceId, payloadKind };
}

export function transferPaste({ targetId, outcomeKind }) {
  return { type: 'TRANSFER_PASTE', targetId, outcomeKind };
}

export function transferCancel() {
  return { type: 'TRANSFER_CANCEL' };
}

export function back() {
  return { type: 'BACK' };
}

// From a React pointer event, derive the minimum information the state
// machine needs. The caller is responsible for verifying the epoch is
// strictly greater than the last accepted one (M10).
export function pointerFocusFromEvent(domEvent, actorId, pointerEpoch) {
  void domEvent;
  return focusEvent({ id: actorId, source: 'pointer', pointerEpoch });
}
