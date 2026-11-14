"""Recompute every output in memory and compare to disk.

Exit non-zero with a diff summary if anything has drifted. This is what
`npm run conduct:verify` invokes. If a native library is present it is used
(the same dual-backend check as the build), so a source change that breaks
backend agreement fails here, not just at build time.
"""
import sys
import tempfile
from pathlib import Path

from .abi import select_backend
from .build import (
    _generate, OUT, ROOT,
)


def _bytes_of(path):
    return path.read_bytes()


def _diff(actual, expected):
    """Return a short human-readable description of the first difference."""
    a = actual.splitlines(keepends=True)
    b = expected.splitlines(keepends=True)
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            return f'line {i + 1}: {a[i][:80]!r} != {b[i][:80]!r}'
    if len(a) != len(b):
        return f'length {len(a)} != {len(b)} lines'
    return 'identical'


def verify_main(argv):
    if not OUT.exists() or not (OUT / 'manifest.json').exists():
        print(f'conductor: verify: nothing to verify at {OUT} '
              f'(run `npm run conduct` first)', file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(dir=str(OUT)) as tmp:
        tmp_path = Path(tmp)
        backend, kind = select_backend()
        try:
            _generate(tmp_path, backend)
        finally:
            if hasattr(backend, 'close'):
                backend.close()

        problems = []
        tmp_files = sorted(p for p in tmp_path.rglob('*') if p.is_file())
        disk_files = sorted(p for p in OUT.rglob('*')
                            if p.is_file() and not p.name.startswith('tmp'))
        tmp_rel = {str(p.relative_to(tmp_path)).replace('\\', '/'): p for p in tmp_files}
        disk_rel = {str(p.relative_to(OUT)).replace('\\', '/'): p for p in disk_files}

        for rel in sorted(set(tmp_rel) - set(disk_rel)):
            problems.append(f'{rel}: missing on disk')
        for rel in sorted(set(disk_rel) - set(tmp_rel)):
            problems.append(f'{rel}: not expected (stale)')
        for rel in sorted(set(tmp_rel) & set(disk_rel)):
            a = _bytes_of(tmp_rel[rel])
            b = _bytes_of(disk_rel[rel])
            if a != b:
                try:
                    problems.append(f'{rel}: {_diff(a.decode("utf-8"),
                                                    b.decode("utf-8"))}')
                except UnicodeDecodeError:
                    problems.append(f'{rel}: binary differs')

    if problems:
        print('conductor: verify: FAILED', file=sys.stderr)
        for p in problems:
            print(f'  {p}', file=sys.stderr)
        return 1
    print(f'conductor: verify: OK ({len(disk_rel)} files, backend {kind})')
    return 0
