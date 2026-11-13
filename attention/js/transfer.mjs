// Transfer state: { sourceId, payloadKind, snapshot } | null. The snapshot
// is the pre-arm state (including pre-arm ring and pre-arm history), so
// TRANSFER_CANCEL restores it exactly (Law M5). Pin semantics (Law M7) are
// enforced by arming: the source is moved to rank 0, so it can never fall
// to level 2 while armed.
import { moveToFront, findById } from './ring.mjs';

export function armTransfer({ ring, sourceId, payloadKind, snapshot }) {
  if (!sourceId || typeof sourceId !== 'string') throw new Error('armTransfer: sourceId required');
  if (!payloadKind || typeof payloadKind !== 'string') throw new Error('armTransfer: payloadKind required');
  const source = findById(ring, sourceId);
  if (!source) throw new Error(`armTransfer: no actor ${sourceId}`);
  // Move source to rank 0 so M7 holds trivially from the moment of arming.
  const armedRing = moveToFront(ring, sourceId);
  return {
    ring: armedRing,
    transfer: Object.freeze({ sourceId, payloadKind, snapshot }),
  };
}

export function clearTransfer() { return null; }
