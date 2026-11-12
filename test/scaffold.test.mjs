// Confirms the repository skeleton required by S0 is present and that the
// license file was replaced with the real MIT text (not the original
// placeholder note). Also scans every tracked text file for a banned token
// so a forgotten placeholder cannot ship. Runs at every stage, so a future
// regression that deletes a top-level directory is caught immediately.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { stat, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const REQUIRED_DIRS = [
  'core', 'core/cards',
  'store',
  'sequencer',
  'resolve',
  'view', 'view/svg',
  'server', 'server/routes',
  'app', 'app/src', 'app/src/components', 'app/src/layers',
  'app/src/attention', 'app/src/styles',
  'space', 'space/js', 'space/cpp', 'space/cpp/test',
  'space/dist', 'space/reference',
  'attention', 'attention/js', 'attention/cpp', 'attention/cpp/test',
  'attention/dist',
  'conductor', 'conductor/tests', 'conductor/out',
  'conductor/out/choreography', 'conductor/workflows',
  'bridge',
  'demo',
  'test', 'test/space', 'test/attention',
  'scripts',
];

const REQUIRED_FILES = [
  'package.json',
  '.gitignore',
  '.gitattributes',
  '.env.example',
  'README.md',
  'LICENSE',
  'scripts/check-boundaries.mjs',
];

// Directories that legitimately contain large/generated output we do not
// scan for the banned token. `data/`, `out/`, `node_modules/` are gitignored
// but included here in case the test runs against a developer's tree.
const SCAN_SKIP = new Set([
  'node_modules', '.git', 'data', 'out', 'dist', 'coverage', '.vite',
  '__pycache__', 'build', 'cmake-build-debug', 'cmake-build-release',
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SCAN_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

test('scaffold: required directories exist', async () => {
  for (const d of REQUIRED_DIRS) {
    const s = await stat(join(ROOT, d)).catch(() => null);
    assert.ok(s && s.isDirectory(), `missing directory: ${d}`);
  }
});

test('scaffold: required top-level files exist', async () => {
  for (const f of REQUIRED_FILES) {
    const s = await stat(join(ROOT, f)).catch(() => null);
    assert.ok(s && s.isFile(), `missing file: ${f}`);
  }
});

test('scaffold: package.json is ESM, MIT, and Node 20+', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=20');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.scripts && pkg.scripts.test);
  assert.ok(pkg.scripts && pkg.scripts.report);
  assert.ok(pkg.scripts && pkg.scripts.verify);
  // The start script must not inject an inline environment variable, which
  // would be platform-specific (see user correction).
  assert.ok(
    typeof pkg.scripts.start === 'string' &&
    !pkg.scripts.start.includes('='),
    'package.json "start" must not set an inline env var'
  );
});

test('scaffold: .gitattributes exists and pins LF + binary wasm', async () => {
  const text = await readFile(join(ROOT, '.gitattributes'), 'utf8');
  assert.match(text, /^\* text=auto eol=lf$/m);
  assert.match(text, /^\*\.wasm binary$/m);
});

test('scaffold: LICENSE begins with "MIT License"', async () => {
  const text = await readFile(join(ROOT, 'LICENSE'), 'utf8');
  assert.equal(text.split('\n')[0].trim(), 'MIT License');
  assert.match(text, /Copyright \(c\) 2025 Peace Thabiwa/);
});

test('scaffold: no file in the repository contains the banned token', async () => {
  // Built at runtime so this test file itself does not contain the literal.
  const banned = ['PLACE', 'HOLDER'].join('');
  const hits = [];
  for await (const full of walk(ROOT)) {
    const rel = relative(ROOT, full).split(sep).join('/');
    if (rel === 'package-lock.json') continue; // npm may embed arbitrary text
    const text = await readFile(full, 'utf8').catch(() => '');
    if (text.includes(banned)) hits.push(rel);
  }
  assert.deepEqual(hits, [], `files containing "${banned}": ${hits.join(', ')}`);
});
