// Public API for the attention brain. The JS twin is authoritative. A wasm
// backend (attention/dist/attention.wasm) is loaded synchronously if
// present and its manifest matches; getBackendStatus() reports which
// backend is available so callers (S9 conductor, S12 server) can turn a
// 'js' status into an attention.fallback event. Mirrors space/index.mjs.
//
// Every existing S7 export is unchanged. New exports: getBackendStatus(),
// getWasmBackend().

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---- JS twin (unchanged S7 exports) ----
export {
  OK, NOOP, POINTER_STALE, ALREADY_FOCUSED,
  BAD_ACTOR, BAD_EVENT, TRANSFER_INVALID, RING_FULL, LAW_VIOLATION,
  makeState, step, frame, hashState,
} from './js/machine.mjs';
export { EVENT_TYPES, FOCUS_SOURCES, INPUT_CHANNELS, INPUT_OUTCOMES,
         TRANSFER_PAYLOAD_KINDS, TRANSFER_OUTCOME_KINDS, makeEvent } from './js/events.mjs';
export { ACTOR_KINDS, MAX_ACTORS, levelOf, levelFor, rankOf, docRank,
         findById, idsInOrder, docsInOrder, sameRing } from './js/ring.mjs';
export { HISTORY_DEPTH } from './js/history.mjs';
export {
  CONTRAST_FLOOR, CONTRAST_FLOOR_HIGH, validateLevels, loadLevels,
} from './js/levels.mjs';
export { luminancePpm, contrastPermille, levelContrastPermille } from './js/contrast.mjs';

// ---- backend status ----
const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, 'dist', 'attention.wasm');
const MANIFEST_PATH = join(HERE, 'dist', 'manifest.json');

function hashBinaryFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function tryLoadWasm() {
  try {
    if (!existsSync(WASM_PATH) || !existsSync(MANIFEST_PATH)) {
      return { backend: 'js', reason: 'no wasm built yet (attention/dist is empty or partial)' };
    }
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (!manifest || typeof manifest.wasmSha256 !== 'string') {
      return { backend: 'js', reason: 'manifest missing wasmSha256' };
    }
    if (hashBinaryFile(WASM_PATH) !== manifest.wasmSha256) {
      return { backend: 'js', reason: 'wasm hash does not match manifest (run npm run build:attention)' };
    }
    const module = new WebAssembly.Module(readFileSync(WASM_PATH));
    const instance = new WebAssembly.Instance(module, {});
    const exports = instance.exports;
    if (typeof exports.att_version !== 'function') {
      return { backend: 'js', reason: 'wasm missing att_version export' };
    }
    if (Number(exports.att_version()) !== 1) {
      return { backend: 'js', reason: `wasm att_version returned ${exports.att_version()}` };
    }
    if (!(exports.memory instanceof WebAssembly.Memory)) {
      return { backend: 'js', reason: 'wasm does not export memory' };
    }
    return { backend: 'wasm', reason: 'ok', instance, exports };
  } catch (e) {
    return { backend: 'js', reason: `wasm load failed: ${e.message}` };
  }
}

const LOAD = tryLoadWasm();

export function getBackendStatus() {
  return { backend: LOAD.backend, reason: LOAD.reason };
}

// exec(fnName, input) copies `input` (array-like of BigInt) into the wasm
// scratch buffer, calls the named export with the input length, and returns
// { outLen, output: Array<BigInt> | null }. Returns null backend when wasm
// is not available.
export function getWasmBackend() {
  if (LOAD.backend !== 'wasm') return null;
  const { exports } = LOAD;
  const memory = exports.memory;
  const scratchPtr = Number(exports.att_scratch_ptr());
  const scratchSize = Number(exports.att_scratch_size());
  function scratchView() {
    return new BigInt64Array(memory.buffer, scratchPtr, scratchSize);
  }
  return {
    version: Number(exports.att_version()),
    scratchSize,
    exec(fnName, input) {
      if (input.length > scratchSize / 2) {
        throw new Error(`attention wasm: input of ${input.length} slots exceeds scratch/2`);
      }
      const view = scratchView();
      for (let i = 0; i < input.length; i++) view[i] = input[i];
      const fn = exports[fnName];
      if (typeof fn !== 'function') throw new Error(`attention wasm: no export ${fnName}`);
      const outLen = Number(fn(BigInt(input.length)));
      if (outLen < 0) return { outLen, output: null };
      return { outLen, output: Array.from(view.slice(input.length, input.length + outLen)) };
    },
  };
}
