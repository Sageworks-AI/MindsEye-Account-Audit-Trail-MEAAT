#!/usr/bin/env node
// Runs `python -m conductor <build|verify|test>` with a Python 3.10+
// discovery step. Node-side wrapper so the three package.json scripts
// share one place to find a usable Python on Windows (`python`) and Unix
// (`python3`). Exits 2 with a clear notice when Python is missing and
// MEaat_REQUIRE_PYTHON is not set; exits 1 when it is set and Python is
// missing (useful in CI).
//
// Usage:
//   node scripts/conduct.mjs build
//   node scripts/conduct.mjs verify
//   node scripts/conduct.mjs test
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function findPython() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) {
      const m = /Python (\d+)\.(\d+)/.exec(r.stdout + r.stderr);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10))) {
        return { cmd, version: `${m[1]}.${m[2]}` };
      }
    }
  }
  return null;
}

function main() {
  const sub = process.argv[2];
  if (!['build', 'verify', 'test'].includes(sub)) {
    console.error('conduct: usage: node scripts/conduct.mjs <build|verify|test>');
    process.exit(2);
  }
  if (!existsSync(`${ROOT}/conductor/__main__.py`)) {
    console.error('conduct: conductor/__main__.py missing');
    process.exit(1);
  }
  const py = findPython();
  if (!py) {
    const required = process.env.MEaat_REQUIRE_PYTHON === '1';
    const msg = 'conduct: Python 3.10+ not found on PATH (tried `python3`, `python`)';
    if (required) {
      console.error(msg);
      console.error('  MEaat_REQUIRE_PYTHON=1 set; refusing to skip');
      process.exit(1);
    }
    // `test` is safe to skip; `build` and `verify` are user-initiated,
    // so they should fail loudly so the user knows why nothing happened.
    if (sub === 'test') {
      console.log(`${msg}; skipping (set MEaat_REQUIRE_PYTHON=1 to fail instead)`);
      process.exit(0);
    }
    console.error(msg);
    console.error('  Install Python 3.10+ and re-run. See conductor/README.md.');
    process.exit(2);
  }
  const r = spawnSync(py.cmd, ['-m', 'conductor', sub],
                      { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

main();
