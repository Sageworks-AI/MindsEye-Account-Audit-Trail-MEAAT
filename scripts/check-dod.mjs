#!/usr/bin/env node
// Runs the Definition of Done check sequence and prints a compact report.
// Exits 0 only when every check passes. This is the single command a
// developer runs before declaring the project done.
//
// Sequence, in order:
//   1. npm test                       (all node:test suites + boundary + verify:*)
//   2. rm -rf out/ && npm run report  (run 1)
//   3. sha256 of out/report.html and out/report.json
//   4. npm run report                 (run 2)
//   5. compare the two sha256 pairs   (must be identical)
//   6. npm run verify                 (journal hash chain)
//
// Does NOT run `npm run dev`; that is an interactive command. The developer
// is expected to `npm run dev` and confirm the app opens, but that step is
// not part of this automated check. Documented in the DoD checklist in
// README.md.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'out');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const marker = pass ? 'PASS' : 'FAIL';
  const pad = ' '.repeat(Math.max(0, 32 - name.length));
  console.log(`DOD: ${name} ${pad} ${marker}${detail ? ` (${detail})` : ''}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
  return { code: r.status === null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function stepTest() {
  const r = run(NPM, ['test']);
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout).split('\n').slice(-10).join('\n');
    record('npm test', false, `exit ${r.code}; tail:\n${tail}`);
    return false;
  }
  record('npm test', true);
  return true;
}

function stepReportPair() {
  if (existsSync(OUT)) {
    try { rmSync(OUT, { recursive: true, force: true }); } catch {}
  }
  const r1 = run(NPM, ['run', 'report']);
  if (r1.code !== 0) {
    const tail = (r1.stderr || r1.stdout).split('\n').slice(-10).join('\n');
    record('npm run report (run 1)', false, `exit ${r1.code}; tail:\n${tail}`);
    return false;
  }
  record('npm run report (run 1)', true);
  const htmlPath = join(OUT, 'report.html');
  const jsonPath = join(OUT, 'report.json');
  if (!existsSync(htmlPath) || !existsSync(jsonPath)) {
    record('out/report.* exist', false);
    return false;
  }
  record('out/report.* exist', true);
  const h1 = sha(htmlPath);
  const j1 = sha(jsonPath);

  const r2 = run(NPM, ['run', 'report']);
  if (r2.code !== 0) {
    record('npm run report (run 2)', false, `exit ${r2.code}`);
    return false;
  }
  record('npm run report (run 2)', true);
  const h2 = sha(htmlPath);
  const j2 = sha(jsonPath);

  const sameHtml = h1 === h2;
  const sameJson = j1 === j2;
  record('report byte-identical (HTML)', sameHtml,
    sameHtml ? h1.slice(0, 12) : `${h1.slice(0, 12)} != ${h2.slice(0, 12)}`);
  record('report byte-identical (JSON)', sameJson,
    sameJson ? j1.slice(0, 12) : `${j1.slice(0, 12)} != ${j2.slice(0, 12)}`);
  return sameHtml && sameJson;
}

function stepVerify() {
  const r = run(NPM, ['run', 'verify']);
  if (r.code !== 0 && r.code !== 2) {
    record('npm run verify', false, `exit ${r.code}`);
    return false;
  }
  // `verify` exits 2 when there is no data/journal.jsonl (fresh clone with no
  // posts). That is not a DoD failure; the journal is empty and trivially
  // consistent. In that case print PASS with a note.
  if (r.code === 2) {
    record('npm run verify', true, 'no journal yet; nothing to verify');
    return true;
  }
  record('npm run verify', true);
  return true;
}

function main() {
  console.log(`DOD: running from ${ROOT}`);
  stepTest();
  stepReportPair();
  stepVerify();
  const failed = results.filter((r) => !r.pass);
  console.log('');
  if (failed.length === 0) {
    console.log(`DOD: overall PASS (${results.length}/${results.length} checks)`);
    process.exit(0);
  }
  console.error(`DOD: overall FAIL (${failed.length} of ${results.length} checks failed)`);
  for (const f of failed) console.error(`  - ${f.name}: ${f.detail || 'no detail'}`);
  process.exit(1);
}

main();
