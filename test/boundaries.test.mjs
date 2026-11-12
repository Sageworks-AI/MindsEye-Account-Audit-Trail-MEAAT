// Proves scripts/check-boundaries.mjs enforces the import matrix from the
// specification parts. Each test writes a minimal fixture tree into a fresh
// temporary directory, invokes checkRepository against it, and asserts the
// presence or absence of violations. This keeps the checker itself under
// test: a future edit that widens or narrows a rule is caught here.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkRepository } from '../scripts/check-boundaries.mjs';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'meaat-bnd-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

async function withFixture(files, fn) {
  const root = await fixture(files);
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('boundary: view may import space (allowed sibling)', async () => {
  await withFixture(
    { 'view/x.mjs': "import '../space/y.mjs';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.deepEqual(v, []);
    }
  );
});

test('boundary: core may not import space', async () => {
  await withFixture(
    { 'core/x.mjs': "import '../space/y.mjs';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.equal(v.length, 1);
      assert.match(v[0], /core\/x\.mjs.*space/);
    }
  );
});

test('boundary: view may not import core', async () => {
  await withFixture(
    { 'view/x.mjs': "import '../core/y.mjs';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.equal(v.length, 1);
      assert.match(v[0], /view\/x\.mjs.*core/);
    }
  );
});

test('boundary: core may only use node: built-ins and its own files', async () => {
  await withFixture(
    {
      'core/x.mjs': "import 'node:fs';\nimport './y.mjs';\n",
    },
    async (root) => {
      const v = await checkRepository(root);
      assert.deepEqual(v, []);
    }
  );
});

test('boundary: app may import scoped @vitejs/plugin-react', async () => {
  await withFixture(
    { 'app/vite.config.js': "import react from '@vitejs/plugin-react';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.deepEqual(v, []);
    }
  );
});

test('boundary: core may not import @vitejs/plugin-react', async () => {
  await withFixture(
    { 'core/x.mjs': "import react from '@vitejs/plugin-react';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.equal(v.length, 1);
      assert.match(v[0], /core\/x\.mjs.*@vitejs\/plugin-react/);
    }
  );
});

test('boundary: subpath of scoped package is matched by package name', async () => {
  await withFixture(
    { 'app/x.js': "import sub from '@vitejs/plugin-react/subpath';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.deepEqual(v, []);
    }
  );
  await withFixture(
    { 'core/x.mjs': "import sub from '@vitejs/plugin-react/subpath';\n" },
    async (root) => {
      const v = await checkRepository(root);
      assert.equal(v.length, 
