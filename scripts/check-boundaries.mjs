#!/usr/bin/env node
// Enforces the import rules from the three specification parts. Runs in `npm test`.
// Fails with a list of violations if any are found, exits 0 otherwise.
//
// The matrix below is the union of the base prompt's import rules with the
// extensions Addendum A and Addendum B require. See README §Assumptions #1
// and #19: the base rule "app imports view and its own api.js only" would
// make the space and attention layers unreachable from the client, so app
// is allowed to import view, resolve, space, attention, bridge and its own
// files. core is still restricted to node:* built-ins; space and attention
// import nothing outside their own folders.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep, posix, resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'data', 'out', 'dist', 'coverage', '.vite',
  '__pycache__', 'build', 'cmake-build-debug', 'cmake-build-release',
]);
const CODE_EXT = new Set(['.mjs', '.js', '.jsx', '.ts', '.tsx']);

// Areas are matched by longest prefix first. `paths` lists sibling areas whose
// files may be imported. `bare` lists npm packages allowed as bare specifiers.
// The string 'ANY' means no restriction (used for test/ and scripts/ tooling).
const AREA_RULES = [
  ['app/src/attention', { paths: ['attention', 'bridge'], bare: ['react', 'react-dom'] }],
  ['app/src',           { paths: ['view', 'resolve', 'space', 'attention', 'bridge'],
                          bare: ['react', 'react-dom', 'vite', '@vitejs/plugin-react'] }],
  ['app',               { paths: ['view', 'resolve', 'space', 'attention', 'bridge'],
                          bare: ['react', 'react-dom', 'vite', '@vitejs/plugin-react'] }],
  ['core',              { paths: [], bare: [] }],
  ['store',             { paths: ['core'], bare: [] }],
  ['sequencer',         { paths: [], bare: [] }],
  ['resolve',           { paths: ['space', 'bridge'], bare: [] }],
  ['view',              { paths: ['space', 'bridge'], bare: [] }],
  ['space',             { paths: [], bare: [] }],
  ['attention',         { paths: [], bare: [] }],
  ['bridge',            { paths: ['space', 'core', 'attention'], bare: [] }],
  ['server',            { paths: ['core', 'store', 'sequencer', 'resolve', 'view',
                                   'space', 'attention', 'bridge'], bare: [] }],
  ['demo',              { paths: ['core', 'store', 'sequencer', 'resolve', 'view',
                                   'space', 'attention', 'bridge'], bare: [] }],
  ['test',              'ANY'],
  ['scripts',           'ANY'],
];

const SORTED_AREAS = [...AREA_RULES].sort((a, b) => b[0].length - a[0].length);
const AREA_NAMES = new Set(AREA_RULES.map(([p]) => p));

function areaOf(relPath) {
  for (const [prefix, rules] of SORTED_AREAS) {
    if (relPath === prefix || relPath.startsWith(prefix + '/')) {
      return { prefix, rules };
    }
  }
  return null;
}

// Heuristic static scanner for import specifiers. Errs on the strict side:
// a string that looks like a `from "..."` clause is treated as an import even
// if it appears in a comment. In this repo that is acceptable — comments
// rarely contain import syntax, and false positives are easy to fix.
function extractImports(source) {
  const specs = new Set();
  for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.add(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  return [...specs];
}

// A scoped package's name is @scope/name; anything after the next slash is a
// subpath. For unscoped packages the name is the segment up to the first slash.
function barePackageName(spec) {
  if (spec.startsWith('@')) {
    const first = spec.indexOf('/');
    if (first === -1) return spec;
    const second = spec.indexOf('/', first + 1);
    return second === -1 ? spec : spec.slice(0, second);
  }
  const first = spec.indexOf('/');
  return first === -1 ? spec : spec.slice(0, first);
}

function resolveRelImport(spec, fromRelPath) {
  return posix.normalize(posix.join(posix.dirname(fromRelPath), spec));
}

export function checkFile(relPath, source) {
  const violations = [];
  const area = areaOf(relPath);
  if (!area) return violations;
  if (area.rules === 'ANY') return violations;
  const { paths, bare } = area.rules;

  for (const spec of extractImports(source)) {
    if (spec.startsWith('node:')) continue;

    if (spec.startsWith('.') || spec.startsWith('/')) {
      const resolved = resolveRelImport(spec, relPath);
      if (resolved.startsWith('..') || posix.isAbsolute(resolved)) {
        violations.push(`${relPath}: import "${spec}" escapes the repository`);
        continue;
      }
      const target = areaOf(resolved);
      if (!target) {
        violations.push(
          `${relPath}: import "${spec}" -> "${resolved}" is outside any known area`);
        continue;
      }
      if (target.prefix === area.prefix) continue;
      if (area.prefix.startsWith(target.prefix + '/')) continue;
      if (paths.includes(target.prefix)) continue;
      violations.push(
        `${relPath}: import "${spec}" -> area "${target.prefix}" ` +
        `not allowed from "${area.prefix}" ` +
        `(allowed siblings: ${paths.length ? paths.join(', ') : 'none'})`);
      continue;
    }

    const pkg = barePackageName(spec);
    if (bare.includes(pkg)) continue;
    if (AREA_NAMES.has(pkg)) {
      if (paths.includes(pkg)) continue;
      if (pkg === area.prefix) continue;
      if (area.prefix.startsWith(pkg + '/')) continue;
      violations.push(
        `${relPath}: bare import "${spec}" reaches into area "${pkg}" ` +
        `not allowed from "${area.prefix}"`);
      continue;
    }
    violations.push(
      `${relPath}: unknown bare import "${spec}" from area "${area.prefix}"`);
  }
  return violations;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot <= 0) continue;
      if (!CODE_EXT.has(entry.name.slice(dot))) continue;
      yield full;
    }
  }
}

export async function checkRepository(root) {
  const violations = [];
  const files = [];
  try {
    for await (const f of walk(root)) {
      if (f === SELF) continue;
      files.push(f);
    }
  } catch (e) {
    return [`boundary check: cannot scan ${root}: ${e.message}`];
  }
  for (const f of files) {
    const rel = relative(root, f).split(sep).join('/');
    const src = await readFile(f, 'utf8');
    violations.push(...checkFile(rel, src));
  }
  return violations;
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return pathToFileURL(pathResolve(process.argv[1])).href === import.meta.url; }
  catch { return false; }
}

async function main() {
  const violations = await checkRepository(DEFAULT_ROOT);
  if (violations.length === 0) {
    console.log('boundary check: OK');
    return;
  }
  console.error('boundary check: FAILED');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}

if (isMain()) main();
