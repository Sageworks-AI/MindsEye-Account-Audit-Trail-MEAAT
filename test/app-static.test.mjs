// Static scans of app/. These catch things a runtime test cannot: an
// accidental external URL, a browser-unsafe node: import, a bundle-size
// hazard (three/webgl/canvas), a second dangerouslySetInnerHTML beyond the
// two we allow, and a duplicate .css that would break the "appearance only
// in attention.css" rule already enforced by css-drift.test.mjs.
//
// Runs in the ordinary `npm test` suite with no toolchain; if app/dist is
// missing (fresh clone before `npm run build`) it skips the built-bundle
// checks with a notice rather than failing.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APP_SRC = join(ROOT, 'app', 'src');

const JS_EXT = new Set(['.js', '.jsx', '.mjs']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile()) yield full;
  }
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

const ALLOWED_DANGEROUS_HTML = new Set([
  'app/src/components/PageFrame.jsx',
  'app/src/components/SequenceStrip.jsx',
  'app/src/components/TrailBoard.jsx',
]);

test('app-static: app/src exists and is non-empty', () => {
  assert.ok(existsSync(APP_SRC), 'app/src is missing');
  const files = [...walk(APP_SRC)];
  assert.ok(files.length >= 15, `app/src has only ${files.length} files`);
});

test('app-static: no browser-unsafe node: imports', () => {
  const bad = [];
  for (const f of walk(APP_SRC)) {
    if (!JS_EXT.has(f.slice(f.lastIndexOf('.')))) continue;
    const text = readText(f);
    for (const m of text.matchAll(/from\s+['"](node:[^'"]+)['"]/g)) {
      bad.push(`${relative(ROOT, f)}: imports ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('app-static: dangerouslySetInnerHTML only in the three allowlisted files', () => {
  const bad = [];
  for (const f of walk(APP_SRC)) {
    if (!JS_EXT.has(f.slice(f.lastIndexOf('.')))) continue;
    const text = readText(f);
    if (text.includes('dangerouslySetInnerHTML')) {
      const rel = relative(ROOT, f).split('\\').join('/');
      if (!ALLOWED_DANGEROUS_HTML.has(rel)) bad.push(rel);
    }
  }
  assert.deepEqual(bad, []);
});

test('app-static: no absolute http(s) URLs in fetch or EventSource calls', () => {
  const bad = [];
  for (const f of walk(APP_SRC)) {
    if (!JS_EXT.has(f.slice(f.lastIndexOf('.')))) continue;
    const text = readText(f);
    // Match `fetch('http...` / `new EventSource('http...` / `api.…` with
    // full URL. All our API calls must use relative paths.
    for (const m of text.matchAll(/(?:fetch|EventSource)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/g)) {
      bad.push(`${relative(ROOT, f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('app-static: package.json has no 3D / WebGL / canvas dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const names = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);
  const forbidden = ['three', 'three-stdlib', '@react-three/fiber',
                     '@react-three/drei', 'babylonjs', 'pixi.js',
                     'canvas', 'node-canvas'];
  for (const f of forbidden) {
    assert.ok(!names.has(f), `package.json must not depend on ${f}`);
  }
});

test('app-static: package.json still has only react / react-dom as runtime deps', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {}).sort();
  assert.deepEqual(deps, ['react', 'react-dom']);
});

test('app-static: no three / webgl / canvas imports in app/src', () => {
  const bad = [];
  for (const f of walk(APP_SRC)) {
    if (!JS_EXT.has(f.slice(f.lastIndexOf('.')))) continue;
    const text = readText(f);
    for (const m of text.matchAll(/from\s+['"](three[^'"]*|@react-three[^'"]*|canvas)['"]/g)) {
      bad.push(`${relative(ROOT, f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('app-static: app/src/attention imports only attention, bridge or React', () => {
  const area = join(APP_SRC, 'attention');
  const allowed = new Set([
    'attention', 'bridge', 'react', 'react-dom',
  ]);
  const bad = [];
  for (const f of walk(area)) {
    if (!JS_EXT.has(f.slice(f.lastIndexOf('.')))) continue;
    const text = readText(f);
    for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      const pkg = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
      if (!allowed.has(pkg)) bad.push(`${relative(ROOT, f)}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('app-static: app/dist is checked when present', () => {
  const dist = join(ROOT, 'app', 'dist');
  if (!existsSync(dist)) return; // fresh clone before `npm run build`
  const index = join(dist, 'index.html');
  assert.ok(existsSync(index), 'app/dist exists but index.html is missing');
  const html = readFileSync(index, 'utf8');
  // No external <script src=...>, no external <link rel=stylesheet ...>.
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:\/\//i);
});

test('app-static: attention.css was not edited away from its generator header', () => {
  const css = readFileSync(join(APP_SRC, 'styles', 'attention.css'), 'utf8');
  assert.match(css, /generated from attention\/dist\/levels\.json/);
  assert.match(css, /Do not edit by hand/);
});
