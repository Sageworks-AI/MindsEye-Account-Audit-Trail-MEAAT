// verify-attention fails with "rebuild required" if a source changes without
// a rebuild. Copy the whole attention/ tree to a temp dir, mutate one source,
// run verify-attention as a child process, and require failure. When no wasm
// is committed, construct a fake manifest by hand so the same check applies.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, cp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'meaat-att-manifest-'));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function copyTree(dest) {
  await mkdir(dest, { recursive: true });
  await cp(join(ROOT, 'attention'), join(dest, 'attention'), { recursive: true });
  await mkdir(join(dest, 'scripts'), { recursive: true });
  await cp(join(ROOT, 'scripts', 'verify-attention.mjs'),
           join(dest, 'scripts', 'verify-attention.mjs'));
}

test('manifest: verify-attention passes with no wasm (JS twin in use)', async () => {
  await withTemp(async (dir) => {
    await copyTree(dir);
    await rm(join(dir, 'attention', 'dist'), { recursive: true, force: true });
    await mkdir(join(dir, 'attention', 'dist'), { recursive: true });
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-attention.mjs')], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no wasm built yet/);
  });
});

test('manifest: verify-attention fails with "rebuild required" on a stale source', async () => {
  const wasmExists = existsSync(join(ROOT, 'attention', 'dist', 'attention.wasm'));
  await withTemp(async (dir) => {
    await copyTree(dir);
    // Ensure a manifest + wasm exist so verify-attention does not short-circuit.
    const manifest = {
      version: 1,
      wasmSha256: 'deadbeef'.repeat(8),
      levelsJsonSha256: 'deadbeef'.repeat(8),
      sources: { 'attention/cpp/types.hpp': 'f'.repeat(64) },
    };
    await writeFile(join(dir, 'attention', 'dist', 'manifest.json'),
      JSON.stringify(manifest, null, 2));
    await writeFile(join(dir, 'attention', 'dist', 'attention.wasm'),
      Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    const srcPath = join(dir, 'attention', 'cpp', 'types.hpp');
    const st = await stat(srcPath);
    assert.ok(st.isFile());
    const original = await readFile(srcPath, 'utf8');
    await writeFile(srcPath, original + '\n// tampered\n');
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-attention.mjs')], {
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /rebuild required/);
  });
  void wasmExists;
});
