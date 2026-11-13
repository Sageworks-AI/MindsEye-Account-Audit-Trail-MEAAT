#!/usr/bin/env node
// Builds and runs the native C++ tests via CMake. Exits 0 with a skip notice
// when cmake or a compiler is missing, so a fresh clone without a toolchain
// still passes `npm test`. Works on Windows (uses `where` for detection,
// passes --config Release to cmake --build and ctest for multi-config
// generators, does not assume a Unix shell).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = join(ROOT, 'space', 'cpp', 'build');

function which(cmd) {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(tool, [cmd], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout.split('\n')[0].trim() || null) : null;
}

function skip(msg) {
  console.log(`test:cpp: skipping — ${msg}`);
  process.exit(0);
}

function main() {
  if (!which('cmake')) skip('cmake not found on PATH');
  if (!which('c++') && !which('g++') && !which('cl') && !which('clang++') && !which('clang')) {
    skip('no C++ compiler found (c++, g++, cl, or clang)');
  }
  if (!existsSync(BUILD)) mkdirSync(BUILD, { recursive: true });

  const configureArgs = [
    '-S', join(ROOT, 'space'),
    '-B', BUILD,
    '-DCMAKE_BUILD_TYPE=Release',
  ];
  console.log('test:cpp: cmake ' + configureArgs.join(' '));
  let r = spawnSync('cmake', configureArgs, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`test:cpp: configure failed (status ${r.status})`);
    process.exit(1);
  }
  r = spawnSync('cmake', ['--build', BUILD, '--config', 'Release'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`test:cpp: build failed (status ${r.status})`);
    process.exit(1);
  }
  r = spawnSync('ctest', ['--test-dir', BUILD, '--output-on-failure', '-C', 'Release'],
                { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`test:cpp: ctest failed (status ${r.status})`);
    process.exit(1);
  }
  console.log('test:cpp: OK');
}

main();
