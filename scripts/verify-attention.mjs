#!/usr/bin/env node
// Verifies attention/dist/manifest.json against current sources, wasm, and
// levels.json. Exits 0 with a notice if no wasm has been built yet (JS twin
// in use). Exits non-zero with "rebuild required" on any mismatch.
// CRLF-normalised hashing matches scripts/build-attention.mjs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'attention', 'dist');
const MANIFEST_PATH = join(DIST, 'manifest.json');
const WASM_PATH = join(DIST, 'attention.wasm');
const LEVELS_PATH = join(DIST, 'levels.json');
const CPP_DIR = join(ROOT, 'attention', 'cpp');

function hashTextFile(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function hashBinaryFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listCurrentSources() {
  const out = [];
  (function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'test' || entry.name === 'build') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() &&
        (entry.name.endsWith('.hpp') || entry.name.endsWith('.cpp'))) out.push(full);
    }
  })(CPP_DIR);
  return out;
}

function main() {
  if (!existsSync(MANIFEST_PATH) || !existsSync(WASM_PATH)) {
    console.log('verify:attention: no wasm built yet, JS twin in use');
    return;
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); }
  catch (e) {
    console.error(`verify:attention: manifest is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  if (!manifest || typeof manifest.wasmSha256 !== 'string' ||
      !manifest.sources || typeof manifest.sources !== 'object' ||
      typeof manifest.levelsJsonSha256 !== 'string') {
    console.error('verify:attention: manifest missing required fields');
    process.exit(1);
  }
  const problems = [];
  const wasmActual = hashBinaryFile(WASM_PATH);
  if (wasmActual !== manifest.wasmSha256) {
    problems.push(`attention/dist/attention.wasm: hash != manifest`);
  }
  if (existsSync(LEVELS_PATH)) {
    const levelsActual = hashTextFile(LEVELS_PATH);
    if (levelsActual !== manifest.levelsJsonSha256) {
      problems.push(`attention/dist/levels.json: hash != manifest`);
    }
  }
  const current = new Set();
  for (const src of listCurrentSources()) {
    const rel = relative(ROOT, src).split('\\').join('/');
    current.add(rel);
    const expected = manifest.sources[rel];
    if (!expected) { problems.push(`${rel}: not in manifest (rebuild required)`); continue; }
    if (hashTextFile(src) !== expected) {
      problems.push(`${rel}: hash != manifest`);
    }
  }
  for (const rel of Object.keys(manifest.sources)) {
    if (!current.has(rel)) problems.push(`${rel}: listed but missing`);
  }
  if (problems.length === 0) {
    console.log('verify:attention: OK');
    return;
  }
  console.error('verify:attention: rebuild required');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

main();
