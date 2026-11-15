// Checks that each public module's export set matches scripts/api-surface.mjs.
// A failure here means either (a) a deliberate export change was made without
// updating the snapshot, or (b) an accidental rename/removal happened. In case
// (a), update PUBLIC_API in scripts/api-surface.mjs in the same commit and note
// the change in the README changelog. In case (b), revert.
//
// Imports every module by relative path. This is safe: none of the public
// modules performs a network call, opens a socket or starts a server at
// import time. `server/index.mjs` only defines createServer; its CLI entry
// point is guarded by an isMain check.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { PUBLIC_API } from '../scripts/api-surface.mjs';

const ROOT = new URL('..', import.meta.url);

test('api-surface: every module in PUBLIC_API can be imported', async () => {
  for (const rel of Object.keys(PUBLIC_API)) {
    await assert.doesNotReject(
      import(new URL(rel, ROOT).href),
      `${rel} failed to import`);
  }
});

test('api-surface: each module exports exactly the listed names', async () => {
  for (const [rel, expected] of Object.entries(PUBLIC_API)) {
    const mod = await import(new URL(rel, ROOT).href);
    const actual = Object.keys(mod).sort();
    const want = expected.slice().sort();
    assert.deepEqual(actual, want, `${rel}: exports drifted`);
  }
});

test('api-surface: no duplicate names within a module list', () => {
  for (const [rel, names] of Object.entries(PUBLIC_API)) {
    const seen = new Set();
    for (const n of names) {
      assert.ok(!seen.has(n), `${rel}: duplicate entry "${n}"`);
      seen.add(n);
    }
  }
});
