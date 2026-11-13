// Public API for the attention brain. The JS twin is authoritative. S8 adds
// a wasm backend; the JS twin's `step()` remains the oracle.
export {
  OK, NOOP, POINTER_STALE, ALREADY_FOCUSED,
  BAD_ACTOR, BAD_EVENT, TRANSFER_INVALID, RING_FULL, LAW_VIOLATION,
  makeState, step, frame, hashState,
} from './js/machine.mjs';
export { EVENT_TYPES, FOCUS_SOURCES, INPUT_CHANNELS, INPUT_OUTCOMES,
         TRANSFER_PAYLOAD_KINDS, TRANSFER_OUTCOME_KINDS, makeEvent } from './js/events.mjs';
export { ACTOR_KINDS, MAX_ACTORS, levelOf, levelFor, rankOf, docRank,
         findById, idsInOrder, docsInOrder, sameRing } from './js/ring.mjs';
export { HISTORY_DEPTH } from './js/history.mjs';
export {
  CONTRAST_FLOOR, CONTRAST_FLOOR_HIGH, validateLevels, loadLevels,
} from './js/levels.mjs';
export { luminancePpm, contrastPermille, levelContrastPermille } from './js/contrast.mjs';
