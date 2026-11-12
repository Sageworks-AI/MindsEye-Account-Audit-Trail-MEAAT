// LRU cache of fully built cards, keyed by a stable hash over
// (type, params, period, head.seq, head.hash[:12]). The cache is
// tier-independent: the full card is stored; slicing by tier or section
// happens at render. Recency order doubles as the packing order for layout,
// so hit/miss counters double as a signal of what the user is actually
// looking at. Persistence to data/cards-cache.json is optional and safe:
// deleting the file changes no output, only hit counts.
import { canonicalize } from '../core/canonical.mjs';
import { sha256Hex } from '../core/hash.mjs';

function cleanParams(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export class CardStore {
  #max;
  #cache = new Map();
  #recency = [];
  #hits = 0;
  #misses = 0;
  #onEvent;

  constructor({ maxEntries = 200, onEvent = () => {} } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive integer');
    }
    this.#max = maxEntries;
    this.#onEvent = onEvent;
  }

  static cacheKey({ type, params, period, head }) {
    if (!type) throw new Error('cacheKey: type required');
    if (!head || !Number.isSafeInteger(head.seq) || typeof head.hash !== 'string') {
      throw new Error('cacheKey: head {seq, hash} required');
    }
    const canonical = canonicalize({
      type,
      params: cleanParams(params),
      period: cleanParams(period),
      headSeq: head.seq,
      headHash: head.hash.slice(0, 12),
    });
    return sha256Hex(canonical).slice(0, 24);
  }

  get(key) {
    if (this.#cache.has(key)) {
      this.#touch(key);
      this.#hits += 1;
      this.#onEvent({ type: 'card.hit', cardKey: key });
      return this.#cache.get(key);
    }
    this.#misses += 1;
    this.#onEvent({ type: 'card.miss', cardKey: key });
    return undefined;
  }

  set(key, card) {
    if (!key) throw new Error('set: key required');
    if (this.#cache.has(key)) {
      this.#cache.set(key, card);
      this.#touch(key);
      return;
    }
    if (this.#cache.size >= this.#max) this.#evict();
    this.#cache.set(key, card);
    this.#recency.push(key);
  }

  has(key) { return this.#cache.has(key); }

  delete(key) {
    if (!this.#cache.has(key)) return false;
    this.#cache.delete(key);
    const i = this.#recency.indexOf(key);
    if (i !== -1) this.#recency.splice(i, 1);
    return true;
  }

  clear() { this.#cache.clear(); this.#recency = []; }

  size() { return this.#cache.size; }
  get hits() { return this.#hits; }
  get misses() { return this.#misses; }
  get keys() { return Object.freeze([...this.#recency]); }

  #touch(key) {
    const i = this.#recency.indexOf(key);
    if (i === -1) return;
    this.#recency.splice(i, 1);
    this.#recency.push(key);
  }

  #evict() {
    const oldest = this.#recency.shift();
    this.#cache.delete(oldest);
  }

  serialize() {
    return {
      maxEntries: this.#max,
      hits: this.#hits,
      misses: this.#misses,
      entries: [...this.#cache.entries()],
      recency: [...this.#recency],
    };
  }

  static deserialize(data, { onEvent = () => {} } = {}) {
    const store = new CardStore({ maxEntries: data.maxEntries || 200, onEvent });
    store.#hits = data.hits || 0;
    store.#misses = data.misses || 0;
    for (const [k, v] of data.entries || []) store.#cache.set(k, v);
    store.#recency = (data.recency || [...store.#cache.keys()]).filter((k) => store.#cache.has(k));
    return store;
  }
}
