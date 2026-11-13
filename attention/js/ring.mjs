// The appearance ring: an ordered list of actors, most recent first.
// Every operation is pure and returns a new frozen array. The ring's
// invariants (unique ids, well-formed kinds) are asserted at each mutation,
// so a bad event surfaces here rather than corrupting later state.
//
// Actor kinds:
//   DOC   — a card pane
//   FORM  — the entry form pane
//   TRAIL — the trail board pane
//   BAR   — the floating input layer (present only while input is active)

export const ACTOR_KINDS = Object.freeze(['DOC', 'FORM', 'TRAIL', 'BAR']);
export const MAX_ACTORS = 8;

function freezeActor(a) {
  return Object.freeze({ id: a.id, kind: a.kind });
}

export function makeRing(initialActors = []) {
  if (!Array.isArray(initialActors)) throw new Error('makeRing: actors must be an array');
  const out = [];
  const seen = new Set();
  for (const a of initialActors) {
    if (!a || typeof a !== 'object') throw new Error('actor must be {id, kind}');
    if (typeof a.id !== 'string' || !a.id) throw new Error('actor.id must be a non-empty string');
    if (!ACTOR_KINDS.includes(a.kind)) throw new Error(`bad actor.kind: ${a.kind}`);
    if (seen.has(a.id)) throw new Error(`duplicate actor id: ${a.id}`);
    seen.add(a.id);
    out.push(freezeActor(a));
  }
  if (out.length > MAX_ACTORS) {
    throw new Error(`ring too large: ${out.length} > ${MAX_ACTORS}`);
  }
  return Object.freeze(out);
}

export function rankOf(ring, id) {
  for (let i = 0; i < ring.length; i++) if (ring[i].id === id) return i;
  return -1;
}

export function findById(ring, id) {
  for (const a of ring) if (a.id === id) return a;
  return null;
}

export function has(ring, id) { return rankOf(ring, id) >= 0; }

// level = min(rank, 2); -1 when the actor is absent.
export function levelOf(rank) {
  if (rank < 0) return -1;
  return rank < 2 ? rank : 2;
}

export function levelFor(ring, id) { return levelOf(rankOf(ring, id)); }

// Move the actor with this id to rank 0, preserving the relative order of
// every other actor. No-op if already first; throws if the id is absent
// (callers should check via has() first, so absence here is a bug).
export function moveToFront(ring, id) {
  const idx = rankOf(ring, id);
  if (idx < 0) throw new Error(`moveToFront: no actor with id ${id}`);
  if (idx === 0) return ring;
  const actor = ring[idx];
  const rest = [];
  for (let i = 0; i < ring.length; i++) if (i !== idx) rest.push(ring[i]);
  return Object.freeze([actor, ...rest]);
}

// Insert a new actor at rank 0. Rejects duplicates and exceeding MAX_ACTORS.
export function insertAtFront(ring, actor) {
  if (!actor || typeof actor !== 'object') throw new Error('actor must be {id, kind}');
  if (typeof actor.id !== 'string' || !actor.id) throw new Error('actor.id must be non-empty');
  if (!ACTOR_KINDS.includes(actor.kind)) throw new Error(`bad actor.kind: ${actor.kind}`);
  if (has(ring, actor.id)) throw new Error(`actor id already present: ${actor.id}`);
  if (ring.length + 1 > MAX_ACTORS) {
    throw new Error(`ring full: ${ring.length + 1} > ${MAX_ACTORS}`);
  }
  return Object.freeze([freezeActor(actor), ...ring]);
}

// Remove an actor. Absence is an error so a typo in an event is not silent.
export function removeById(ring, id) {
  const idx = rankOf(ring, id);
  if (idx < 0) throw new Error(`removeById: no actor with id ${id}`);
  const out = [];
  for (let i = 0; i < ring.length; i++) if (i !== idx) out.push(ring[i]);
  return Object.freeze(out);
}

// Geometry ring: same order with BAR removed. Its rank 0 is the space
// solver's focal pane (Law M8). BAR never appears here.
export function docRank(ring, id) {
  let rank = 0;
  for (const a of ring) {
    if (a.kind === 'BAR') continue;
    if (a.id === id) return rank;
    rank += 1;
  }
  return -1;
}

export function docsInOrder(ring) {
  return Object.freeze(ring.filter((a) => a.kind !== 'BAR'));
}

export function idsInOrder(ring) {
  return ring.map((a) => a.id);
}

export function sameRing(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].kind !== b[i].kind) return false;
  }
  return true;
}

// FOCUS during an armed transfer produces [T, S, ...rest-without-T-and-S].
// Kept here because it is a ring operation, not a state-machine concern.
// Precondition: source and target both exist in the ring and differ.
export function pairFront(ring, targetId, sourceId) {
  if (targetId === sourceId) throw new Error('pairFront: target must differ from source');
  const t = findById(ring, targetId);
  const s = findById(ring, sourceId);
  if (!t) throw new Error(`pairFront: no target ${targetId}`);
  if (!s) throw new Error(`pairFront: no source ${sourceId}`);
  const rest = [];
  for (const a of ring) {
    if (a.id === targetId || a.id === sourceId) continue;
    rest.push(a);
  }
  return Object.freeze([t, s, ...rest]);
}
