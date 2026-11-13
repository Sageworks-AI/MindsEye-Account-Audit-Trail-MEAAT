// Public API for the space layer. The BigInt twin is authoritative: every
// existing export resolves to space/js/*. A wasm backend (space/dist/space.wasm)
// is loaded synchronously if present and its manifest matches; the wasm is
// currently used by the parity tests as a second implementation, and S6's
// bridge may switch to it once the ABI path is validated. getBackendStatus()
// reports which backend is available, so callers (S6, S12) can turn a 'js'
// status into a space.fallback event. This module must not import sequencer.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- BigInt twin exports (unchanged) ---
export { solve, MIN_BODY_CPT, DISPLAY_MAX, DEFAULT_GUTTER_CPT, TIER_THRESHOLDS } from './js/solve.mjs';
export { apportion } from './js/apportion.mjs';
export {
  textWidth, wrap, truncateWithEllipsis, amountColumnWidth,
  charWidthPpm, maxFormattedLength,
} from './js/metrics.mjs';
export {
  makeClaim, stack, sideBySide, overlay, claimLE, EMPTY,
  withShapeClasses, withRowsUpperBound, scaleClaim,
} from './js/claim.mjs';
export {
  loadDocuments, loadMetrics, validateDocuments, validateMetrics,
  PAPER_DIMS, SHAPE_CLASSES,
} from './reference/loader.mjs';
export { paginate } from './js/paginate.mjs';
export {
  makeRational, compareRational, applyRational, rationalEQ,
} from './js/rational.mjs';
export {
  baseClaimForArchetype, archetypeForCardType,
  tierEffect, compareEffect, focusEffect, drillDepthEffect,
  currencyEffect, weightsForMode,
} from './js/params.mjs';
export { chooseTemplate } from './js/templates.mjs';
export { anchorOffset } from './js/anchor.mjs';

// --- backend status ---
const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, 'dist', 'space.wasm');
const MANIFEST_PATH = join(HERE, 'dist', 'manifest.json');

function hashBinaryFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function tryLoadWasm() {
  try {
    if (!existsSync(WASM_PATH) || !existsSync(MANIFEST_PATH)) {
      return { backend: 'js', reason: 'no wasm built yet (space/dist is empty or partial)' };
    }
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (!manifest || typeof manifest.wasmSha256 !== 'string') {
      return { backend: 'js', reason: 'manifest missing wasmSha256' };
    }
    const actual = hashBinaryFile(WASM_PATH);
    if (actual !== manifest.wasmSha256) {
      return { backend: 'js', reason: 'wasm hash does not match manifest (run npm run build:space)' };
    }
    const module = new WebAssembly.Module(readFileSync(WASM_PATH));
    const instance = new WebAssembly.Instance(module, {});
    const exports = instance.exports;
    if (typeof exports.space_version !== 'function') {
      return { backend: 'js', reason: 'wasm missing space_version export' };
    }
    if (Number(exports.space_version()) !== 1) {
      return { backend: 'js', reason: `wasm space_version returned ${exports.space_version()}` };
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

// The wasm backend, marshalled for direct use by parity tests and future
// bridge consumers. Returns null when the wasm is not available. exec()
// copies `input` (array-like of BigInt) into the wasm scratch buffer, calls
// the named export with the input length, and returns { outLen, output }.
// output is a plain Array of BigInt; null on error (outLen < 0).
export function getWasmBackend() {
  if (LOAD.backend !== 'wasm') return null;
  const { exports } = LOAD;
  const memory = exports.memory;
  const scratchPtr = Number(exports.space_scratch_ptr());
  const scratchSize = Number(exports.space_scratch_size());
  function scratchView() {
    return new BigInt64Array(memory.buffer, scratchPtr, scratchSize);
  }
  return {
    version: Number(exports.space_version()),
    scratchSize,
    exec(fnName, input) {
      if (input.length > scratchSize / 2) {
        throw new Error(`space wasm: input of ${input.length} slots exceeds scratch/2`);
      }
      const view = scratchView();
      for (let i = 0; i < input.length; i++) view[i] = input[i];
      const fn = exports[fnName];
      if (typeof fn !== 'function') throw new Error(`space wasm: no export ${fnName}`);
      const outLen = Number(fn(BigInt(input.length)));
      if (outLen < 0) return { outLen, output: null };
      const output = Array.from(view.slice(input.length, input.length + outLen));
      return { outLen, output };
    },
  };
}
