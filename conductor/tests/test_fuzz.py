"""Small fuzz run against the real backend. The committed fuzz-summary.json
is the full 50-walk x 200-step run; this test does 3 walks x 30 steps so
`python -m conductor test` finishes fast while still exercising the law
checks and the dual-backend path when native is available.
"""
import unittest

from conductor.abi import select_backend
from conductor.fuzz import run_all, run_walk


class Fuzz(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend, _kind = select_backend()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls.backend, 'close'):
            cls.backend.close()

    def test_single_walk_completes_and_checks_laws(self):
        total = run_walk(self.backend, seed=12345, steps=30)
        self.assertGreater(total, 0)

    def test_run_all_returns_summary(self):
        summary = run_all(self.backend, n_walks=3, steps_per_walk=30)
        self.assertEqual(summary['walks'], 3)
        self.assertEqual(summary['stepsPerWalk'], 30)
        self.assertGreater(summary['events'], 0)
        self.assertEqual(summary['violations'], 0)

    def test_deterministic_summary(self):
        a = run_all(self.backend, n_walks=2, steps_per_walk=20)
        b = run_all(self.backend, n_walks=2, steps_per_walk=20)
        self.assertEqual(a, b)


if __name__ == '__main__':
    unittest.main()
