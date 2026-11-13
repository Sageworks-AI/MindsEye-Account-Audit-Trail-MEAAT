#!/usr/bin/env node
// Build attention/dist/attention.wasm from attention/cpp/ using Emscripten.
// Requires `emcc` on PATH; exits non-zero with install instructions otherwise.
// Writes attention/dist/attention.wasm and attention/dist/manifest.json.
// Manifest hashes sources LF-normalised so a Windows checkout produces the
// same hashes as a Unix checkout (see README #32).
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CPP_DIR = join(ROOT, 'attention', 'cpp');
const DIST = join(ROOT, 'attention', 'dist');

function findEmcc() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(which, ['emcc'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout.split('\n')[0].trim() || null) : null;
}

function listSources(dir) {
  const out = [];
  (function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'test' || entry.name === 'build') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() &&
        (entry.name.endsWith('.hpp') || entry.name.endsWith('.cpp'))) out.push(full);
    }
  })(dir);
  return out;
}

function hashTextFile(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function hashBinaryFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main() {
  const emcc = findEmcc();
  if (!emcc) {
    console.error('build:attention: emcc not found on PATH.');
    console.error('  Install Emscripten and re-run `npm run build:attention`.');
    process.exit(1);
  }
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
  const wasmOut = join(DIST, 'attention.wasm');
  const args = [
    join(CPP_DIR, 'api.cpp'),
    '-O2', '-std=c++20',
    '-fno-exceptions', '-fno-rtti',
    '--no-entry',
    '-sSTANDALONE_WASM=1',
    '-sEXPORT_ALL=1',
    '-sALLOW_MEMORY_GROWTH=0',
    '-sINITIAL_MEMORY=1048576',
    '-sWASM_BIGINT=1',
    '-o', wasmOut,
  ];
  console.log('build:attention: emcc', args.slice(1).join(' '));
  const r = spawnSync(emcc, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`build:attention: emcc exited with status ${r.status}`);
    process.exit(1);
  }
  const sources = listSources(CPP_DIR);
  const sourceHashes = {};
  for (const src of sources) {
    sourceHashes[relative(ROOT, src).split('\\').join('/')] = hashTextFile(src);
  }
  const manifest = {
    version: 1,
    wasmSha256: hashBinaryFile(wasmOut),
    levelsJsonSha256: hashTextFile(join(DIST, 'levels.json')),
    sources: sourceHashes,
  };
  writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`build:attention: wrote ${wasmOut}`);
  console.log(`build:attention: wasm sha256 ${manifest.wasmSha256}`);
}

main();
