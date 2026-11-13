// S6 sequencer additions: eventFromDraft() turns a bridge-emitted plain
// draft into a real event, and strip's optional `layout` field carries the
// space-layer summary without importing space or core. These tests live in
// their own file so the S2 sequencer tests stay unchanged.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeEvent, eventFromDraft } from '../sequencer/events.mjs';
import { buildStrip } from '../sequencer/strip.mjs';

const HEAD = Object.freeze({ seq: 7, hash: 'a'.repeat(64) });

test('eventFromDraft: produces a valid event with lane from type', () => {
  const draft = {
    type: 'space.premeasured',
    lane: 'space',
    ref: { cardKey: 'k1' },
    tags: ['balance_sheet'],
    note: 'premeasure ok',
  };
  const e = eventFromDraft(draft, { id: 1, ts: '2026-01-01T00:00:00Z' });
  assert.equal(e.id, 1);
  assert.equal(e.type, 'space.premeasured');
  assert.equal(e.lane, 'space'); // derived by makeEvent, not taken from draft
  assert.deepEqual(e.tags, ['balance_sheet']);
  assert.equal(e.note, 'premeasure ok');
  assert.ok(Object.isFrozen(e));
});

test('eventFromDraft: default source is "bridge"; caller may override', () => {
  const draft = { type: 'space.reconciled' };
  const a = eventFromDraft(draft, { id: 1, ts: '2026-01-01T00:00:00Z' });
  assert.equal(a.source, 'bridge');
  const b = eventFromDraft(draft, { id: 2, ts: '2026-01-01T00:00:00Z', source: 'server' });
  assert.equal(b.source, 'server');
});

test('eventFromDraft: rejects an unknown draft type', () => {
  assert.throws(
    () => eventFromDraft({ type: 'not.a.real.event' }, { id: 1, ts: '2026-01-01T00:00:00Z' }),
    /unknown event type/);
});

test('eventFromDraft: rejects a missing draft', () => {
  assert.throws(() => eventFromDraft(null, { id: 1, ts: '2026-01-01T00:00:00Z' }),
    /draft required/);
});

test('strip: backward compatible without layout', () => {
  const strip = buildStrip({
    request: { mode: 'read', cards: [{ type: 'balance_sheet' }], period: { from: '2026-01-01', to: '2026-03-31' } },
    head: HEAD,
    cacheStates: { balance_sheet: 'miss' },
    figures: [{ label: 'Cash', opening: 0, change: 76000, closing: 76000 }],
  });
  assert.equal(strip.layout, undefined);
  assert.equal(strip.request.cards[0].type, 'balance_sheet');
  assert.equal(strip.request.cards[0].cacheState, 'miss');
  assert.equal(strip.figures[0].closing, 76000);
});

test('strip: extended layout carries viewport, per-pane shape, predicted/exact rows', () => {
  const strip = buildStrip({
    request: { mode: 'read', cards: [{ type: 'balance_sheet' }] },
    head: HEAD,
    cacheStates: {},
    figures: [],
    layout: {
      viewport: { w: 1280, h: 720 },
      panes: [{
        type: 'balance_sheet',
        shapeClass: 'HALF',
        scale: { num: 1n, den: 2n },
        predictedRows: 7,
        exactRows: 6,
        cacheState: 'hit',
      }],
    },
  });
  assert.equal(strip.layout.viewport.w, 1280);
  assert.equal(strip.layout.panes.length, 1);
  const p = strip.layout.panes[0];
  assert.equal(p.shapeClass, 'HALF');
  assert.equal(p.scaleNum, '1');
  assert.equal(p.scaleDen, '2');
  assert.equal(p.predictedRows, 7);
  assert.equal(p.exactRows, 6);
  assert.equal(p.cacheState, 'hit');
});

test('strip: rejects a malformed layout', () => {
  assert.throws(
    () => buildStrip({
      request: { mode: 'read', cards: [] },
      head: HEAD,
      figures: [],
      layout: { viewport: {}, panes: [] },
    }),
    /layout\.viewport/);
});
