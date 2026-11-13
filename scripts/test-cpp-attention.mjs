#!/usr/bin/env node
// Builds and runs the native attention C++ tests via CMake. Exits 0 with a
// skip notice when cmake or a compiler is missing, so `npm test` on a fresh
// clone without a toolchain still passes.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = join(ROOT, 'attention', 'cpp', 'build');

function which(cmd) {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(tool, [cmd], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout.split('\n')[0].trim() || null) : null;
}

function skip(msg) {
  console.log(`test:attention:cpp: skipping — ${msg}`);
  process.exit(0);
}

function main() {
  if (!which('cmake')) skip('cmake not found on PATH');
  if (!which('c++') && !which('g++') && !which('cl') && !which('clang++') && !which('clang')) {
    skip('no C++ compiler found');
  }
  if (!existsSync(BUILD)) mkdirSync(BUILD, { recursive: true });
  const cfgArgs = ['-S', join(ROOT, 'attention', 'cpp'), '-B', BUILD, '-DCMAKE_BUILD_TYPE=Release'];
  let r = spawnSync('cmake', cfgArgs, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`configure failed (${r.status})`); process.exit(1); }
  r = spawnSync('cmake', ['--build', BUILD, '--config', 'Release'], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`build failed (${r.status})`); process.exit(1); }
  r = spawnSync('ctest', ['--test-dir', BUILD, '--output-on-failure', '-C', 'Release'],
                { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`ctest failed (${r.status})`); process.exit(1); }
  console.log('test:attention:cpp: OK');
}

main();
