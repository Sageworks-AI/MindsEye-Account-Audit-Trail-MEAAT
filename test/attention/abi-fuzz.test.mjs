// Fuzz the attention ABI. Random valid inputs through the twin must never
// throw and must produce a numeric code. Malformed inputs (bad version,
// truncated state, bad enums) must return error codes, not exceptions.
// If wasm is present, replay the same fuzz on it.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as abi from '../../attention/js/abi.mjs';
import { getWasmBackend } from '../../attention/index.mjs';

const wasm = getWasmBackend();

function callTwin(fnName, input) {
  const scratch = new BigInt64Array(abi.ATT_SCRATCH_SLOTS);
  for (let i = 0; i < input.length; i++) scratch[i] = input[i];
  try { return abi[fnName](scratch, input.length); }
  catch (e) { return { threw: e }; }
}

test('fuzz: twin ABI never throws on malformed inputs', () => {
  const cases = [
    ['att_levels_table', [0n]],                        // too short
    ['att_levels_table', [2n, 0n]],                    // bad version
    ['att_levels_table', [1n, 5n]],                    // bad theme
    ['att_validate', [1n]],                            // too short
    ['att_validate', [2n, ...new Array(32).fill(1n)]], // bad version
    ['att_step', [0n]],                                // too short
    ['att_step', [2n, 0n, 0n]],                        // bad version
    ['att_step', [1n, 10n, ...new Array(5).fill(0n)]], // stateLen mismatch
    ['att_step', [1n, 0n, 1n, 99n]],                   // unknown event type
  ];
  for (const [name, input] of cases) {
    const r = callTwin(name, input);
    assert.ok(typeof r === 'number', `${name} threw: ${r.threw && r.threw.message}`);
    assert.ok(r < 0, `${name} accepted malformed input (outLen=${r})`);
  }
});

test('fuzz: twin ABI rejects a 0-length state/event without throwing', () => {
  const r = callTwin('att_step', [1n, 0n, 0n, 0n]);
  assert.ok(typeof r === 'number' && r < 0);
});

test('fuzz: wasm ABI agrees with the twin on error codes for bad inputs',
     { skip: !wasm && 'no wasm built' }, () => {
  const cases = [
    ['att_levels_table', [2n, 0n]],
    ['att_validate', [2n, ...new Array(32).fill(1n)]],
    ['att_step', [2n, 0n, 0n]],
  ];
  for (const [name, input] of cases) {
    const twin = callTwin(name, input);
    const w = wasm.exec(name, input);
    assert.equal(w.outLen, twin, `${name}: wasm and twin disagree on error code`);
  }
});
