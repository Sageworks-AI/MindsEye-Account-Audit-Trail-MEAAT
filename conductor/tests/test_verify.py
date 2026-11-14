"""Verify command behaviour: no out/ -> exit 2; after build, verify passes;
after mutating one output, verify fails and reports the drift. The test
runs a real `build` in a temporary copy of the repository so the user's
working tree is not disturbed.

Note: this test spawns Python to run `python -m conductor build` in a
copy — slow but honest. Skipped when the temp tree is too large to copy
quickly (measured in wall time, not a hard rule; we just accept a few
seconds). The `test_verify_diff_detected` test does the definitive check.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # repo root
CONDUCTOR = ROOT / 'conductor'

# Files and directories that must exist for `build`/`verify` to run.
REQUIRED = [
    'attention/cli.mjs',
    'attention/dist/levels.json',
    'attention/cpp',
    'attention/js',
    'attention/index.mjs',
    'scripts/emit-attention-css.mjs',
    'conductor',
]


def _copy_tree(dst):
    for rel in REQUIRED:
        src = ROOT / rel
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, target, ignore=shutil.ignore_patterns(
                '__pycache__', 'build', '*.pyc'))
        else:
            shutil.copy2(src, target)


def _py_cmd():
    for cmd in ('python3', 'python'):
        if shutil.which(cmd):
            return cmd
    return sys.executable


class Verify(unittest.TestCase):
    maxDiff = None

    def _run(self, cwd, *args):
        return subprocess.run(
            [_py_cmd(), '-m', 'conductor', *args],
            cwd=str(cwd), capture_output=True, text=True, timeout=300,
        )

    def test_verify_without_out_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            _copy_tree(tmp)
            r = self._run(tmp, 'verify')
            self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
            self.assertIn('nothing to verify', r.stderr)

    def test_build_then_verify_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            _copy_tree(tmp)
            r = self._run(tmp, 'build')
            if r.returncode != 0:
                self.fail(f'build failed: {r.stdout}\n{r.stderr}')
            r2 = self._run(tmp, 'verify')
            self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)
            self.assertIn('verify: OK', r2.stdout)

    def test_verify_detects_hand_edit(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            _copy_tree(tmp)
            r = self._run(tmp, 'build')
            if r.returncode != 0:
                self.fail(f'build failed: {r.stdout}\n{r.stderr}')
            # Hand-edit one committed choreography.
            target = tmp / 'conductor' / 'out' / 'choreography' / 'W1.json'
            data = json.loads(target.read_text())
            data['name'] = 'tampered'
            target.write_text(json.dumps(data))
            r2 = self._run(tmp, 'verify')
            self.assertNotEqual(r2.returncode, 0, r2.stdout + r2.stderr)
            self.assertIn('FAILED', r2.stderr)


if __name__ == '__main__':
    unittest.main()
