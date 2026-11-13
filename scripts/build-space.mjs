#!/usr/bin/env node
// Build space/dist/space.wasm from space/cpp/ using Emscripten. Requires
// `emcc` on PATH; exits non-zero with install instructions otherwise.
// Writes space/dist/space.wasm and space/dist/manifest.json. The manifest
// hashes every source file (LF-normalised so CRLF from Windows editors does
// not produce spurious "rebuild required") and the compiled wasm.
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CPP_DIR = join(ROOT, 'space', 'cpp');
const DIST = join(ROOT, 'space', 'dist');

function findEmcc() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(which, ['emcc'], { encoding: 'utf8' });
  if (r.status === 0) {
    const first = r.stdout.split('\n')[0].trim();
    if (first) return first;
  }
  return null;
}

function listSources(dir) {
  const out = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'test') continue; // tests not part of the wasm
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && (entry.name.endsWith('.hpp') || entry.name.endsWith('.cpp'))) {
        out.push(full);
      }
    }
  }
  walk(dir);
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
    console.error('build:space: emcc not found on PATH.');
    console.error('  Install Emscripten (https://emscripten.org/docs/getting_started/downloads.html),');
    console.error('  activate it in your shell, and re-run `npm run build:space`.');
    process.exit(1);
  }
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
  const wasmOut = join(DIST, 'space.wasm');
  const args = [
    join(CPP_DIR, 'api.cpp'),
    '-O2',
    '-std=c++20',
    '-fno-exceptions',
    '-fno-rtti',
    '--no-entry',
    '-sSTANDALONE_WASM=1',
    '-sEXPORT_ALL=1',
    '-sALLOW_MEMORY_GROWTH=0',
    '-sINITIAL_MEMORY=4194304',
    '-sWASM_BIGINT=1',
    '-o', wasmOut,
  ];
  console.log('build:space: emcc', args.slice(1).join(' '));
  const r = spawnSync(emcc, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`build:space: emcc exited with status ${r.status}`);
    process.exit(1);
  }
  if (!existsSync(wasmOut)) {
    console.error(`build:space: emcc did not produce ${wasmOut}`);
    process.exit(1);
  }
  const sources = listSources(CPP_DIR);
  const sourceHashes = {};
  for (const src of sources) {
    const rel = relative(ROOT, src).split('\\').join('/');
    sourceHashes[rel] = hashTextFile(src);
  }
  const manifest = {
    version: 1,
    wasmSha256: hashBinaryFile(wasmOut),
    sources: sourceHashes,
  };
  writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`build:space: wrote ${wasmOut}`);
  console.log(`build:space: wasm sha256 ${manifest.wasmSha256}`);
  console.log(`build:space: ${sources.length} source files hashed into manifest`);
}

main();
