// The manifest is what makes a committed wasm safe to ship: if a C++ source
// changes without a rebuild, verify-space must fail with "rebuild required".
// We prove it by copying the whole space/ tree to a temp dir, mutating one
// source, and running verify-space against the copy. This exercises the
// real script end-to-end (spawned as a child process) so a subtle change to
// CRLF normalisation or path handling is caught here, not in production.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtemp, rm, cp, readFile, writeFile, mkdir, stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'meaat-manifest-'));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function copySpaceTree(dest) {
  await mkdir(dest, { recursive: true });
  await cp(join(ROOT, 'space'), join(dest, 'space'), { recursive: true });
  await mkdir(join(dest, 'scripts'), { recursive: true });
  await cp(join(ROOT, 'scripts', 'verify-space.mjs'),
           join(dest, 'scripts', 'verify-space.mjs'));
}

test('manifest: verify-space passes on a fresh checkout with no wasm (empty dist)', async () => {
  await withTemp(async (dir) => {
    await copySpaceTree(dir);
    await rm(join(dir, 'space', 'dist'), { recursive: true, force: true });
    await mkdir(join(dir, 'space', 'dist'), { recursive: true });
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-space.mjs')], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no wasm built yet/);
  });
});

test('manifest: verify-space fails with "rebuild required" when a source changes', async () => {
  const wasmExists = existsSync(join(ROOT, 'space', 'dist', 'space.wasm'));
  const manifestExists = existsSync(join(ROOT, 'space', 'dist', 'manifest.json'));
  if (!wasmExists || !manifestExists) {
    // No wasm yet in this checkout; the "rebuild required" path is
    // nonetheless part of the contract. Construct a manifest by hand that
    // references a real source file with a wrong hash — verify-space must
    // refuse to run.
    await withTemp(async (dir) => {
      await copySpaceTree(dir);
      const manifest = {
        version: 1,
        wasmSha256: 'deadbeef'.repeat(8),
        sources: {
          'space/cpp/fixed.hpp': 'f'.repeat(64),
        },
      };
      await writeFile(join(dir, 'space', 'dist', 'manifest.json'),
        JSON.stringify(manifest, null, 2));
      await writeFile(join(dir, 'space', 'dist', 'space.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-space.mjs')], {
        encoding: 'utf8',
      });
      assert.notEqual(r.status, 0, 'verify-space should fail on stale manifest');
      assert.match(r.stderr, /rebuild required/);
    });
    return;
  }
  await withTemp(async (dir) => {
    await copySpaceTree(dir);
    const srcPath = join(dir, 'space', 'cpp', 'fixed.hpp');
    const st = await stat(srcPath);
    assert.ok(st.isFile());
    const original = await readFile(srcPath, 'utf8');
    await writeFile(srcPath, original + '\n// tampered for test\n');
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-space.mjs')], {
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /rebuild required/);
  });
});

test('manifest: verify-space passes on an unmodified copy', async () => {
  const wasmExists = existsSync(join(ROOT, 'space', 'dist', 'space.wasm'));
  if (!wasmExists) {
    // No wasm to verify; the empty-dist case is covered above.
    return;
  }
  await withTemp(async (dir) => {
    await copySpaceTree(dir);
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-space.mjs')], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /verify:space: OK/);
  });
});
