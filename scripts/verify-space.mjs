#!/usr/bin/env node
// Verifies space/dist/manifest.json against the current sources and wasm.
// Exits 0 with a notice if no wasm has been built yet (the JS twin is in
// use, which is the default state after a fresh clone). Exits non-zero with
// "rebuild required" when a source has changed without a rebuild, when a
// source is missing, or when the wasm hash differs from the manifest.
//
// Hash normalisation matches scripts/build-space.mjs: CRLF -> LF on text
// sources so a Windows checkout and a Unix checkout produce the same hash.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'space', 'dist');
const MANIFEST_PATH = join(DIST, 'manifest.json');
const WASM_PATH = join(DIST, 'space.wasm');
const CPP_DIR = join(ROOT, 'space', 'cpp');

function hashTextFile(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function hashBinaryFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listCurrentSources() {
  const out = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'test') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && (entry.name.endsWith('.hpp') || entry.name.endsWith('.cpp'))) {
        out.push(full);
      }
    }
  }
  walk(CPP_DIR);
  return out;
}

function main() {
  if (!existsSync(MANIFEST_PATH) || !existsSync(WASM_PATH)) {
    console.log('verify:space: no wasm built yet, JS twin in use');
    return;
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); }
  catch (e) {
    console.error(`verify:space: manifest is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  if (!manifest || typeof manifest.wasmSha256 !== 'string' ||
      !manifest.sources || typeof manifest.sources !== 'object') {
    console.error('verify:space: manifest is missing wasmSha256 or sources');
    process.exit(1);
  }
  const problems = [];
  const wasmActual = hashBinaryFile(WASM_PATH);
  if (wasmActual !== manifest.wasmSha256) {
    problems.push(`space/dist/space.wasm: hash ${wasmActual} != manifest ${manifest.wasmSha256}`);
  }
  const currentSources = new Set();
  for (const src of listCurrentSources()) {
    const rel = relative(ROOT, src).split('\\').join('/');
    currentSources.add(rel);
    const expected = manifest.sources[rel];
    if (!expected) {
      problems.push(`${rel}: not in manifest (rebuild required)`);
      continue;
    }
    const actual = hashTextFile(src);
    if (actual !== expected) {
      problems.push(`${rel}: hash ${actual.slice(0, 12)}... != manifest ${expected.slice(0, 12)}...`);
    }
  }
  for (const rel of Object.keys(manifest.sources)) {
    if (!currentSources.has(rel)) {
      problems.push(`${rel}: listed in manifest but missing (rebuild required)`);
    }
  }
  if (problems.length === 0) {
    const n = Object.keys(manifest.sources).length;
    console.log(`verify:space: OK (${n} sources, wasm ${manifest.wasmSha256.slice(0, 12)}...)`);
    return;
  }
  console.error('verify:space: rebuild required');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

main();
