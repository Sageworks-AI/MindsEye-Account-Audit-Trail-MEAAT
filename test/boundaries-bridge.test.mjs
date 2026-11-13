// S6 file-level rule: the bridge may import from core ONLY core/schema.mjs.
// These fixtures prove the rule from both sides — an allowed file passes,
// any other file in core fails, and bridge → space / attention stay allowed.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkRepository } from '../scripts/check-boundaries.mjs';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'meaat-bnd-bridge-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

async function withFixture(files, fn) {
  const root = await fixture(files);
  try { return await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('bridge: may import core/schema.mjs', async () => {
  await withFixture(
    { 'bridge/x.mjs': "import '../core/schema.mjs';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.deepEqual(v, []);
    }
  );
});

test('bridge: may not import core/ledger.mjs', async () => {
  await withFixture(
    { 'bridge/x.mjs': "import '../core/ledger.mjs';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.equal(v.length, 1);
      assert.match(v[0], /bridge may only import core\/schema\.mjs/);
    }
  );
});

test('bridge: may not import core/cards/index.mjs', async () => {
  await withFixture(
    { 'bridge/x.mjs': "import '../core/cards/index.mjs';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.equal(v.length, 1);
      assert.match(v[0], /bridge may only import core\/schema\.mjs/);
    }
  );
});

test('bridge: may import space and attention', async () => {
  await withFixture(
    { 'bridge/x.mjs': "import '../space/index.mjs';\nimport '../attention/foo.mjs';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.deepEqual(v, []);
    }
  );
});

test('bridge: bare import of "core" is rejected with a specific message', async () => {
  await withFixture(
    { 'bridge/x.mjs': "import 'core';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.equal(v.length, 1);
      assert.match(v[0], /bridge may not use bare import/);
    }
  );
});
