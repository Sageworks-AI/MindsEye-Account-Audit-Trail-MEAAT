"""Entry point: python -m conductor {build,verify,test} [args...]."""
import sys
import unittest
from pathlib import Path


def _run_tests(argv):
    start = str(Path(__file__).resolve().parent / 'tests')
    top = str(Path(__file__).resolve().parent.parent)
    suite = unittest.defaultTestLoader.discover(start, top_level_dir=top)
    result = unittest.TextTestRunner(verbosity=2 if '-v' in argv else 1).run(suite)
    return 0 if result.wasSuccessful() else 1


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in ('build', 'verify', 'test'):
        sys.stderr.write('usage: python -m conductor {build|verify|test} [args]\n')
        return 2
    cmd, rest = argv[0], argv[1:]
    if cmd == 'build':
        from conductor.build import build_main
        return build_main(rest) or 0
    if cmd == 'verify':
        from conductor.verify import verify_main
        return verify_main(rest) or 0
    return _run_tests(rest)


if __name__ == '__main__':
    sys.exit(main())
