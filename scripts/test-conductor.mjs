#!/usr/bin/env node
// Runs `python -m conductor test` if Python 3.10+ is present; otherwise
// prints a skip notice and exits 0 so a fresh clone without Python still
// passes `npm test`. `MEaat_REQUIRE_PYTHON=1` makes the script fail on a
// missing Python — useful in CI where Python is required.
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
  const py = findPython();
  if (!py) {
    if (process.env.MEaat_REQUIRE_PYTHON === '1') {
      console.error('test:conductor: Python 3.10+ required (MEaat_REQUIRE_PYTHON=1)');
      process.exit(1);
    }
    console.log('test:conductor: skipping — Python 3.10+ not found on PATH');
    process.exit(0);
  }
  if (!existsSync(`${ROOT}/conductor/__main__.py`)) {
    console.error('test:conductor: conductor/__main__.py missing');
    process.exit(1);
  }
  const r = spawnSync(py.cmd, ['-m', 'conductor', 'test'],
                      { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`test:conductor: FAILED (exit ${r.status})`);
    process.exit(r.status || 1);
  }
  console.log('test:conductor: OK');
}

main();
