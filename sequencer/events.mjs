// Event shape and validation. The wall-clock timestamp lives here and only
// here — everything else in the system is deterministic given the inputs.
// Amounts are integer minor units or null; they are copies from the journal
// and are never read back to produce financial state.
//
// S6: eventFromDraft() lets bridge/measure.mjs hand back a plain draft
// (type, ref, tags, note) without importing sequencer. The bridge stays
// inside its boundary; the caller turns drafts into events by calling this
// function with a fresh id and timestamp.
import { laneFor, LANES } from './lanes.mjs';

export const EVENT_TYPES = Object.freeze(new Set([
  'entry.posted', 'entry.reversed', 'journal.verified',
  'request.received', 'card.opened', 'card.closed',
  'mode.changed', 'period.changed', 'draft.previewed',
  'card.hit', 'card.miss', 'card.built',
  'impact.computed', 'check.failed',
  'trail.node.added', 'trail.link.added', 'trail.saved',
  'space.premeasured', 'space.laid_out', 'space.reconciled',
  'space.degraded', 'space.rejected', 'space.violation', 'space.fallback',
  'attention.shifted', 'attention.input_begin', 'attention.input_end',
  'attention.transfer_armed', 'attention.transfer_pasted',
  'attention.transfer_cancelled', 'attention.rejected',
  'attention.pointer_ignored', 'attention.fallback',
]));

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function makeEvent({ id, type, source, ref, amount, tags, note, ts }) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`event id must be a positive integer, got ${id}`);
  if (!EVENT_TYPES.has(type)) throw new Error(`unknown event type: ${type}`);
  if (typeof source !== 'string' || !source) throw new Error('event source required');
  const timestamp = ts || new Date().toISOString();
  if (!ISO_RE.test(timestamp)) throw new Error(`event ts must be ISO 8601, got ${timestamp}`);
  const lane = laneFor(type);
  if (!LANES.includes(lane)) throw new Error(`bad lane: ${lane}`);

  const r = ref || {};
  if (typeof r !== 'object' || Array.isArray(r)) throw new Error('ref must be a plain object');
  for (const k of Object.keys(r)) {
    if (r[k] === undefined) continue;
    if (k === 'seq' && !Number.isSafeInteger(r[k])) throw new Error('ref.seq must be integer');
    if (k === 'cardKey' && typeof r[k] !== 'string') throw new Error('ref.cardKey must be string');
    if (k === 'trailId' && typeof r[k] !== 'string') throw new Error('ref.trailId must be string');
    if (k === 'requestId' && typeof r[k] !== 'string') throw new Error('ref.requestId must be string');
  }

  let amt = null;
  if (amount !== undefined && amount !== null) {
    if (!Number.isSafeInteger(amount)) throw new Error(`event amount must be integer minor units, got ${amount}`);
    amt = amount;
  }

  const tagList = Array.isArray(tags) ? tags.slice() : [];
  for (const t of tagList) if (typeof t !== 'string') throw new Error('tags must be strings');

  const e = {
    id, ts: timestamp, type, source, lane,
    ref: Object.freeze({ ...r }),
    amount: amt,
    tags: Object.freeze(tagList),
  };
  if (note !== undefined) {
    if (typeof note !== 'string') throw new Error('note must be a string');
    e.note = note;
  }
  return Object.freeze(e);
}

// Bridge-facing helper. The draft is a plain object as returned by
// bridge/measure.mjs; this function is the only place a draft becomes a
// real event. Caller supplies the id and ts (both required for determinism
// outside of the log's auto-numbering).
export function eventFromDraft(draft, { id, ts, source = 'bridge' }) {
  if (!draft || typeof draft !== 'object') throw new Error('eventFromDraft: draft required');
  if (typeof draft.type !== 'string') throw new Error('eventFromDraft: draft.type required');
  return makeEvent({
    id, ts, source,
    type: draft.type,
    ref: draft.ref || {},
    amount: draft.amount,
    tags: draft.tags,
    note: draft.note,
  });
}
