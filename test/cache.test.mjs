// Card cache behaviour: cache key changes when head changes; LRU eviction
// respects recency; deleting the cache file has no effect on outputs (which
// we simulate by clearing and rebuilding: the rebuilt card hashes are equal).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CardStore } from '../store/cardStore.mjs';
import { buildCard } from '../core/cards/index.mjs';
import { buildDemoLedger, DEMO_PERIOD } from './fixtures/ledger.mjs';

const AS_OF = Object.freeze({ date: '2026-03-31', seq: Number.MAX_SAFE_INTEGER });

function keyFor(ledger, type, params) {
  return CardStore.cacheKey({
    type, params,
    period: params,
    head: ledger.head(),
  });
}

test('cache: hit when head is unchanged', () => {
  const l = buildDemoLedger();
  const events = [];
  const store = new CardStore({ onEvent: (e) => events.push(e) });
  const params = { asOf: AS_OF };
  const key = keyFor(l, 'balance_sheet', params);
  const card = buildCard('balance_sheet', l.view(), params);
  store.set(key, card);
  assert.equal(store.get(key), card);
  assert.equal(events.at(-1).type, 'card.hit');
});

test('cache: miss after a post (new head -> new key)', () => {
  const l = buildDemoLedger();
  const store = new CardStore();
  const params = { asOf: AS_OF };
  const k1 = keyFor(l, 'balance_sheet', params);
  store.set(k1, buildCard('balance_sheet', l.view(), params));

  l.post({ date: '2026-04-01', memo: 'late capital', lines: [
    { account: '1000', debit: 100 },
    { account: '3000', credit: 100 },
  ]});
  const k2 = keyFor(l, 'balance_sheet', params);
  assert.notEqual(k1, k2);
  assert.equal(store.get(k2), undefined);
});

test('cache: deleting cache changes no output (rebuild is byte-identical)', () => {
  const l = buildDemoLedger();
  const params = { asOf: AS_OF };
  const before = buildCard('balance_sheet', l.view(), params);
  const store = new CardStore();
  const key = keyFor(l, 'balance_sheet', params);
  store.set(key, before);
  store.clear();
  assert.equal(store.size(), 0);
  const after = buildCard('balance_sheet', l.view(), params);
  assert.equal(after.hash, before.hash);
});

test('cache: LRU eviction respects recency order', () => {
  const store = new CardStore({ maxEntries: 2 });
  store.set('a', { v: 'a' });
  store.set('b', { v: 'b' });
  store.get('a');            // touch a
  store.set('c', { v: 'c' }); // evicts b (oldest after touch)
  assert.equal(store.has('a'), true);
  assert.equal(store.has('b'), false);
  assert.equal(store.has('c'), true);
});

test('cache: hit and miss counters and card.hit/card.miss events are emitted', () => {
  const events = [];
  const store = new CardStore({ onEvent: (e) => events.push(e.type) });
  store.set('k', { v: 1 });
  store.get('k');
  store.get('missing');
  assert.equal(store.hits, 1);
  assert.equal(store.misses, 1);
  assert.deepEqual(events, ['card.hit', 'card.miss']);
});

test('cache: cacheKey changes when type or params change at the same head', () => {
  const l = buildDemoLedger();
  const a = keyFor(l, 'balance_sheet', { asOf: AS_OF });
  const b = keyFor(l, 'income_statement', { asOf: AS_OF });
  const c = keyFor(l, 'balance_sheet', { asOf: { date: '2026-02-28', seq: 3 } });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('cache: serialization round-trip preserves keys and counters', () => {
  const store = new CardStore({ maxEntries: 4 });
  store.set('a', { v: 'a' });
  store.set('b', { v: 'b' });
  store.get('a');
  const data = store.serialize();
  const store2 = CardStore.deserialize(data);
  assert.equal(store2.size(), 2);
  assert.equal(store2.hits, 1);
  assert.equal(store2.keys.at(-1), 'a'); // most recent
});
