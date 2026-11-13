#!/usr/bin/env node
// Enforces the import rules from the three specification parts. Runs in
// `npm test`. Fails with a list of violations if any are found, exits 0
// otherwise.
//
// S6: adds a file-level rule for the bridge area. bridge may import from
// `core` ONLY the file `core/schema.mjs` (plain data, no ledger). Every
// other route into core from bridge — `core/ledger.mjs`, `core/cards/...`,
// etc — is a violation. This is what lets bridge/schema.mjs re-export the
// type list while preventing the bridge from reaching into the ledger.
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

// The single file in core/ that bridge may import.
const BRIDGE_ALLOWED_CORE_FILE = 'core/schema.mjs';

// Areas are matched by longest prefix first. `paths` lists sibling areas
// whose files may be imported. `bare` lists npm packages allowed as bare
// specifiers. The string 'ANY' means no restriction (test/ and scripts/).
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

function extractImports(source) {
  const specs = new Set();
  for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.add(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  return [...specs];
}

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
      // S6 file-level rule: bridge may import core/schema.mjs only.
      if (area.prefix === 'bridge' && target.prefix === 'core') {
        if (resolved !== BRIDGE_ALLOWED_CORE_FILE) {
          violations.push(
            `${relPath}: bridge may only import ${BRIDGE_ALLOWED_CORE_FILE} from core ` +
            `(got "${resolved}")`);
        }
        continue;
      }
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
      // Bare specifiers cannot name a specific file; the file-level rule
      // for bridge→core applies only to relative imports.
      if (area.prefix === 'bridge' && pkg === 'core') {
        violations.push(
          `${relPath}: bridge may not use bare import "${spec}" to reach core ` +
          `(relative import of ${BRIDGE_ALLOWED_CORE_FILE} only)`);
        continue;
      }
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
