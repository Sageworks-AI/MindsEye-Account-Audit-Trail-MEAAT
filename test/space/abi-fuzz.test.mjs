// Fuzz the ABI: random valid inputs go through both the twin and (if
// present) the wasm and neither should ever throw or crash. Malformed
// inputs — bad version, wrong length, out-of-range enum — must produce an
// error code, not an exception. This runs on the twin unconditionally.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as abi from '../../space/js/abi.mjs';
import { getWasmBackend } from '../../space/index.mjs';

const wasm = getWasmBackend();

function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s; };
}
function randInt(rng, lo, hi) { return lo + (rng() % (hi - lo + 1)); }

function callTwin(fnName, input) {
  const scratch = new BigInt64Array(abi.SCRATCH_SLOTS);
  for (let i = 0; i < input.length; i++) scratch[i] = input[i];
  try {
    return abi[fnName](scratch, input.length);
  } catch (e) {
    return { threw: e };
  }
}

test('fuzz: twin ABI never throws on random valid inputs', () => {
  const rng = prng(0xF00D);
  const fns = [
    ['space_measure_text', () => {
      const family = BigInt(randInt(rng, 0, 1));
      const fontSize = BigInt(randInt(rng, 6, 24) * 100);
      const n = randInt(rng, 0, 20);
      const cps = [];
      for (let i = 0; i < n; i++) cps.push(BigInt(randInt(rng, 0x20, 0x7E)));
      return [1n, family, fontSize, BigInt(n), ...cps];
    }],
    ['space_apportion', () => {
      const total = BigInt(randInt(rng, 10, 100000));
      const n = randInt(rng, 1, 8);
      const weights = [];
      for (let i = 0; i < n; i++) weights.push(BigInt(randInt(rng, 1, 1000)));
      return [1n, total, BigInt(n), ...weights];
    }],
    ['space_paginate', () => [1n, BigInt(randInt(rng, 0, 8)),
      BigInt(randInt(rng, 0, 3)), BigInt(randInt(rng, 0, 200))]],
    ['space_anchor', () => [1n,
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)),
      BigInt(randInt(rng, 100, 2000)), BigInt(randInt(rng, 100, 2000)),
      BigInt(randInt(rng, 1, 100)), BigInt(randInt(rng, 1, 100)),
      BigInt(randInt(rng, 0, 500)), BigInt(randInt(rng, 0, 500)),
      BigInt(randInt(rng, 0, 1000)), BigInt(randInt(rng, 0, 1000)),
      BigInt(randInt(rng, 100, 2000)), BigInt(randInt(rng, 100, 2000)),
      BigInt(randInt(rng, 1, 100)), BigInt(randInt(rng, 1, 100)),
      BigInt(randInt(rng, 0, 500)), 96000n, 54000n]],
  ];
  for (const [name, gen] of fns) {
    for (let t = 0; t < 200; t++) {
      const r = callTwin(name, gen());
      assert.ok(typeof r === 'number',
        `${name} threw on random input: ${r.threw && r.threw.message}`);
    }
  }
});

test('fuzz: twin ABI rejects malformed inputs with a negative code', () => {
  const cases = [
    ['space_measure_text', [0n]],                         // too short
    ['space_measure_text', [2n, 0n, 1000n, 0n]],          // bad version
    ['space_measure_text', [1n, 5n, 1000n, 0n]],          // bad family
    ['space_measure_text', [1n, 0n, 1000n, -1n]],         // negative cpLen
    ['space_measure_text', [1n, 0n, 1000n, 300n]],        // cpLen > 256
    ['space_apportion', [1n, 100n, 0n]],                   // n = 0
    ['space_apportion', [1n, 100n, 33n]],                  // n > 32
    ['space_apportion', [1n, 100n, 2n, 1n, 0n]],           // zero weight
    ['space_claim_combine', [1n, 5n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n,
      1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n]],                 // bad op
    ['space_paginate', [1n, 99n, 0n, 10n]],                // bad arch
    ['space_paginate', [1n, 0n, 5n, 10n]],                 // bad shape
    ['space_paginate', [1n, 0n, 0n, -1n]],                 // negative rows
    ['space_anchor', [1n, 0n, 0n, 10n, 10n, 1n, 0n, 0n, 0n,
      0n, 0n, 10n, 10n, 1n, 1n, 300n, 800n, 600n]],         // bad oldScale.den
    ['space_solve', [1n, 0n, 0n, 0n]],                     // zero viewport
    ['space_solve', [1n, 96000n, 54000n, 9n]],             // nPanes > 8
  ];
  for (const [name, input] of cases) {
    const r = callTwin(name, input);
    assert.ok(typeof r === 'number', `${name} threw on malformed input`);
    assert.ok(r < 0, `${name} accepted malformed input (outLen=${r})`);
  }
});

test('fuzz: wasm ABI never throws on the same random inputs', { skip: !wasm && 'no wasm built' }, () => {
  const rng = prng(0xDEADBEEF);
  for (let t = 0; t < 100; t++) {
    const n = randInt(rng, 1, 5);
    const weights = [];
    for (let i = 0; i < n; i++) weights.push(BigInt(randInt(rng, 1, 1000)));
    const r = wasm.exec('space_apportion', [1n, BigInt(randInt(rng, 10, 50000)), BigInt(n), ...weights]);
    assert.ok(typeof r.outLen === 'number');
  }
});

test('fuzz: wasm ABI returns negative codes for bad version', { skip: !wasm && 'no wasm built' }, () => {
  const r = wasm.exec('space_paginate', [2n, 0n, 0n, 10n]);
  assert.ok(r.outLen < 0, `wasm accepted bad version, outLen=${r.outLen}`);
});
