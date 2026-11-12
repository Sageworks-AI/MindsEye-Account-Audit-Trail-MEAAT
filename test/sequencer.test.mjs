// Sequencer event validation, lane assignment, and bucket aggregation.
// Validation rejects unknown types, non-integer amounts, non-ISO timestamps,
// and reserved-but-malformed ref fields. Aggregation is deterministic given
// an explicit nowMs.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeEvent, EVENT_TYPES } from '../sequencer/events.mjs';
import { laneFor, LANES } from '../sequencer/lanes.mjs';
import { aggregate, totalsByLane } from '../sequencer/buckets.mjs';

test('lanes: every event type maps to a known lane', () => {
  for (const t of EVENT_TYPES) {
    const lane = laneFor(t);
    assert.ok(LANES.includes(lane), `${t} -> ${lane}`);
  }
});

test('lanes: space.* and attention.* prefixes resolve to their lanes', () => {
  assert.equal(laneFor('space.laid_out'), 'space');
  assert.equal(laneFor('attention.shifted'), 'attention');
});

test('lanes: unknown type is rejected', () => {
  assert.throws(() => laneFor('not.a.real.event'), /no lane for event type/);
});

test('events: a valid event is frozen and carries its lane', () => {
  const e = makeEvent({
    id: 1, type: 'entry.posted', source: 'test', ref: { seq: 5 }, amount: 1000,
    ts: '2026-01-01T00:00:00Z',
  });
  assert.ok(Object.isFrozen(e));
  assert.equal(e.lane, 'journal');
  assert.equal(e.amount, 1000);
});

test('events: unknown type, bad ts, bad amount are all rejected', () => {
  const base = { id: 1, type: 'entry.posted', source: 'test', ts: '2026-01-01T00:00:00Z' };
  assert.throws(() => makeEvent({ ...base, type: 'not.a.type' }), /unknown event type/);
  assert.throws(() => makeEvent({ ...base, ts: '2026/01/01' }), /ISO 8601/);
  assert.throws(() => makeEvent({ ...base, amount: 1.5 }), /integer minor units/);
});

test('events: ref.seq must be an integer when present', () => {
  assert.throws(
    () => makeEvent({
      id: 1, type: 'entry.posted', source: 'test', ref: { seq: 'not-int' },
      ts: '2026-01-01T00:00:00Z',
    }),
    /ref.seq must be integer/);
});

test('buckets: aggregate produces deterministic rows across a fixed window', () => {
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const events = [
    { ts: new Date(t0 + 5_000).toISOString(), lane: 'journal' },
    { ts: new Date(t0 + 65_000).toISOString(), lane: 'cache' },
    { ts: new Date(t0 + 125_000).toISOString(), lane: 'journal' },
  ];
  const result = aggregate(events, {
    bucket: 'minute', sinceMs: t0, nowMs: t0 + 3 * 60_000 - 1,
  });
  assert.equal(result.bucket, 'minute');
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].counts.journal, 1);
  assert.equal(result.rows[1].counts.cache, 1);
  assert.equal(result.rows[2].counts.journal, 1);
});

test('buckets: totalsByLane counts each lane', () => {
  const events = [
    { lane: 'journal' }, { lane: 'journal' }, { lane: 'cache' }, { lane: 'space' },
  ];
  assert.deepEqual(totalsByLane(events), { journal: 2, cache: 1, space: 1 });
});

test('buckets: unknown bucket size rejected', () => {
  assert.throws(() => aggregate([], { bucket: 'week' }), /unknown bucket/);
});
