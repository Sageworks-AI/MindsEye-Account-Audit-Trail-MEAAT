// Proves core/schema.mjs stays in sync with core/cards/index.mjs REGISTRY.
// The schema is the plain-data surface that bridge/schema.mjs re-exports so
// resolve can read the card type list without importing core internals;
// REGISTRY is the executable registry. If they drift, resolve and the
// actual builders disagree about which card types exist or their period
// kind / minimum tier.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CARD_TYPES, SECTION_IDS, COLUMN_KEYS, MAX_ENTRY_LINES } from '../core/schema.mjs';
import { REGISTRY } from '../core/cards/index.mjs';

test('schema: CARD_TYPES matches REGISTRY exactly on type/period/minTier', () => {
  const schemaKeys = Object.keys(CARD_TYPES).sort();
  const registryKeys = Object.keys(REGISTRY).sort();
  assert.deepEqual(schemaKeys, registryKeys,
    `CARD_TYPES keys ${schemaKeys} != REGISTRY keys ${registryKeys}`);
  for (const type of registryKeys) {
    assert.equal(CARD_TYPES[type].period, REGISTRY[type].period,
      `${type}: period mismatch`);
    assert.equal(CARD_TYPES[type].minTier, REGISTRY[type].minTier,
      `${type}: minTier mismatch`);
  }
});

test('schema: SECTION_IDS declares sections for every card type', () => {
  for (const type of Object.keys(CARD_TYPES)) {
    assert.ok(Array.isArray(SECTION_IDS[type]) && SECTION_IDS[type].length > 0,
      `${type}: SECTION_IDS missing or empty`);
  }
});

test('schema: COLUMN_KEYS declares columns for every card type', () => {
  for (const type of Object.keys(CARD_TYPES)) {
    assert.ok(Array.isArray(COLUMN_KEYS[type]) && COLUMN_KEYS[type].length > 0,
      `${type}: COLUMN_KEYS missing or empty`);
  }
});

test('schema: MAX_ENTRY_LINES is 32 (README #35)', () => {
  assert.equal(MAX_ENTRY_LINES, 32);
});

test('schema: cash_flow section ids include every cf class the builder emits', () => {
  const ids = new Set(SECTION_IDS.cash_flow);
  for (const required of ['cf_operating', 'cf_investing', 'cf_financing',
                          'cf_unclassified', 'cf_change', 'cf_opening', 'cf_closing']) {
    assert.ok(ids.has(required), `cash_flow SECTION_IDS missing ${required}`);
  }
});

test('schema: receipt columns are code, label, debit, credit', () => {
  assert.deepEqual(
    [...COLUMN_KEYS.receipt].sort(),
    ['code', 'credit', 'debit', 'label']);
});
