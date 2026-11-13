// Parity: the JS twin ABI (space/js/abi.mjs) and the wasm backend
// (space/dist/space.wasm) must produce identical output for identical
// inputs. The JS twin is always the oracle — the golden vectors generated
// by scripts/gen-space-golden.mjs are produced from it, so any test here
// that compares twin against wasm effectively compares wasm against the
// last committed goldens. When the wasm is not present, wasm-side
// assertions are skipped (with a notice) so a fresh clone still passes.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as abi from '../../space/js/abi.mjs';
import { getWasmBackend, getBackendStatus } from '../../space/index.mjs';

const wasm = getWasmBackend();
const status = getBackendStatus();

function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s; };
}
function randInt(rng, lo, hi) { return lo + (rng() % (hi - lo + 1)); }

function twinCall(fnName, input) {
  const scratch = new BigInt64Array(abi.SCRATCH_SLOTS);
  for (let i = 0; i < input.length; i++) scratch[i] = input[i];
  const outLen = abi[fnName](scratch, input.length);
  if (outLen < 0) return { outLen, output: null };
  return { outLen, output: Array.from(scratch.slice(input.length, input.length + outLen)) };
}

function runBoth(fnName, input) {
  const twin = twinCall(fnName, input);
  const w = wasm.exec(fnName, input);
  assert.equal(w.outLen, twin.outLen, `${fnName} outLen mismatch`);
  if (twin.outLen >= 0) {
    assert.equal(w.output.length, twin.output.length);
    for (let i = 0; i < twin.output.length; i++) {
      assert.equal(w.output[i], twin.output[i],
        `${fnName}: out[${i}] wasm=${w.output[i]} twin=${twin.output[i]}`);
    }
  }
  return twin;
}

test('parity: backend status is either js or wasm (never crash)', () => {
  assert.ok(['js', 'wasm'].includes(status.backend));
  assert.equal(typeof status.reason, 'string');
});

test('parity: measure_text — 100 random inputs, twin and wasm agree', { skip: !wasm && 'no wasm built; run `npm run build:space`' }, () => {
  const rng = prng(0xABCD);
  for (let t = 0; t < 100; t++) {
    const family = BigInt(randInt(rng, 0, 1));
    const fontSize = BigInt(randInt(rng, 6, 24) * 100);
    const n = randInt(rng, 0, 20);
    const cps = [];
    for (let i = 0; i < n; i++) cps.push(BigInt(randInt(rng, 0x20, 0x7E)));
    runBoth('space_measure_text', [1n, family, fontSize, BigInt(n), ...cps]);
  }
});

test('parity: apportion — 100 random inputs', { skip: !wasm && 'no wasm built' }, () => {
  const rng = prng(0xBEEF);
  for (let t = 0; t < 100; t++) {
    const total = BigInt(randInt(rng, 10, 100000));
    const n = randInt(rng, 1, 8);
    const weights = [];
    for (let i = 0; i < n; i++) weights.push(BigInt(randInt(rng, 1, 1000)));
    runBoth('space_apportion', [1n, total, BigInt(n), ...weights]);
  }
});

test('parity: claim_combine — 50 random inputs', { skip: !wasm && 'no wasm built' }, () => {
  const rng = prng(0xFACE);
  for (let t = 0; t < 50; t++) {
    const op = BigInt(randInt(rng, 0, 2));
    const a = [
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 2000)),
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 2000)),
      BigInt(randInt(rng, 0, 50)),   BigInt(randInt(rng, 1, 15)),
    ];
    const b = [
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 2000)),
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 2000)),
      BigInt(randInt(rng, 0, 50)),   BigInt(randInt(rng, 1, 15)),
    ];
    runBoth('space_claim_combine', [1n, op, ...a, ...b]);
  }
});

test('parity: paginate — 100 random inputs', { skip: !wasm && 'no wasm built' }, () => {
  const rng = prng(0xDEAD);
  for (let t = 0; t < 100; t++) {
    const arch = BigInt(randInt(rng, 0, 8));
    const shape = BigInt(randInt(rng, 0, 3));
    const rows = BigInt(randInt(rng, 0, 200));
    runBoth('space_paginate', [1n, arch, shape, rows]);
  }
});

test('parity: anchor — 100 random inputs', { skip: !wasm && 'no wasm built' }, () => {
  const rng = prng(0xCAFE);
  for (let t = 0; t < 100; t++) {
    runBoth('space_anchor', [
      1n,
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)),
      BigInt(randInt(rng, 100, 2000)), BigInt(randInt(rng, 100, 2000)),
      BigInt(randInt(rng, 1, 100)), BigInt(randInt(rng, 1, 100)),
      BigInt(randInt(rng, 0, 500)), BigInt(randInt(rng, 0, 500)),
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)),
      BigInt(randInt(rng, 100, 2000)), BigInt(randInt(rng, 100, 2000)),
      BigInt(randInt(rng, 1, 100)), BigInt(randInt(rng, 1, 100)),
      BigInt(randInt(rng, 0, 500)),
      1280n * 75n, 720n * 75n,
    ]);
  }
});

test('parity: solve — 50 random inputs', { skip: !wasm && 'no wasm built' }, () => {
  const rng = prng(0x1234);
  for (let t = 0; t < 50; t++) {
    const vw = BigInt(randInt(rng, 800, 2000)) * 75n;
    const vh = BigInt(randInt(rng, 600, 1500)) * 75n;
    const n = randInt(rng, 1, 3);
    const panes = [];
    for (let i = 0; i < n; i++) {
      panes.push(BigInt(randInt(rng, 0, 6)));
      panes.push(0n);
      panes.push(BigInt(randInt(rng, 0, 30)));
      panes.push(1n);
    }
    runBoth('space_solve', [1n, vw, vh, BigInt(n), ...panes]);
  }
});

test('parity: golden vectors in space/cpp/test/golden/ still match the twin', async () => {
  // Even when the wasm is absent, this proves the JS twin hasn't drifted
  // from the committed goldens. The C++ side proves the same thing from its
  // end (test_vectors.cpp); together they bracket both implementations.
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const GOLDEN = join(dirname(ROOT), 'space', 'cpp', 'test', 'golden');
  if (!existsSync(GOLDEN)) { return; }
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(GOLDEN).filter((f) => f.endsWith('.txt'));
  if (files.length === 0) return;
  for (const file of files) {
    const path = join(GOLDEN, file);
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n').filter((l) => l.startsWith('in:'));
    if (lines.length === 0) continue; // empty file is legal during dev
    for (const line of lines) {
      const m = /^in:([0-9a-f]+) out:([0-9a-f]*)$/.exec(line);
      if (!m) continue;
      const inHex = m[1], outHex = m[2];
      const inLen = inHex.length / 16;
      const inVals = [];
      for (let i = 0; i < inLen; i++) {
        inVals.push(BigInt('0x' + inHex.slice(i * 16, i * 16 + 16)) << 0n);
        // Reinterpret as signed int64.
        const u = BigInt('0x' + inHex.slice(i * 16, i * 16 + 16));
        inVals[inVals.length - 1] = BigInt.asIntN(64, u);
      }
      const fnName = {
        'measure.txt': 'space_measure_text',
        'apportion.txt': 'space_apportion',
        'claim.txt': 'space_claim_combine',
        'paginate.txt': 'space_paginate',
        'anchor.txt': 'space_anchor',
        'solve.txt': 'space_solve',
      }[file];
      if (!fnName) continue;
      const scratch = new BigInt64Array(abi.SCRATCH_SLOTS);
      for (let i = 0; i < inVals.length; i++) scratch[i] = inVals[i];
      const outLen = abi[fnName](scratch, inVals.length);
      assert.ok(outLen >= 0, `${file}: ${fnName} returned ${outLen}`);
      const actual = Array.from(scratch.slice(inVals.length, inVals.length + outLen));
      const expected = [];
      const outCount = outHex.length / 16;
      for (let i = 0; i < outCount; i++) {
        const u = BigInt('0x' + outHex.slice(i * 16, i * 16 + 16));
        expected.push(BigInt.asIntN(64, u));
      }
      assert.equal(actual.length, expected.length, `${file}: length`);
      for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i], expected[i], `${file}: out[${i}]`);
      }
    }
  }
});
