// LedgerView.byId resolves ids inside the view only. Invariant: a view never
// returns an entry its own filters (asOfSeq, excludeSeq) hide.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildDemoLedger } from './fixtures/ledger.mjs';

test('byId returns the entry for a valid id', () => {
  const l = buildDemoLedger();
  const e = l.getEntry(3);
  assert.equal(l.view().byId(e.id), e);
});

test('byId respects asOfSeq', () => {
  const l = buildDemoLedger();
  const early = l.getEntry(2);
  const late = l.getEntry(4);
  const v = l.view({ asOfSeq: 2 });
  assert.equal(v.byId(early.id), early);
  assert.throws(() => v.byId(late.id), /no entry with id/);
});

test('byId respects excludeSeq', () => {
  const l = buildDemoLedger();
  const gone = l.getEntry(3);
  const kept = l.getEntry(4);
  const v = l.view({ excludeSeq: 3 });
  assert.throws(() => v.byId(gone.id), /no entry with id/);
  assert.equal(v.byId(kept.id), kept);
});
