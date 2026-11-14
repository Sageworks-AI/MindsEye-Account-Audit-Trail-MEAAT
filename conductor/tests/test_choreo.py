"""Compile a small workflow against the real backend and assert the output
is well-shaped. Does not test specific workflow contents — those are proven
by `python -m conductor build` succeeding against the committed workflows.
The shape assertions guard against a change to `choreo.py` producing JSON
that the S13 `ChoreoPlayer` cannot consume.
"""
import unittest

from conductor.abi import select_backend
from conductor.choreo import compile_workflow
from conductor.workflows import load_all


class ChoreographyShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend, _kind = select_backend()
        cls.workflows = load_all()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls.backend, 'close'):
            cls.backend.close()

    def test_all_workflows_compile(self):
        levels = self.backend.levels()
        for w in self.workflows:
            with self.subTest(workflow=w['id']):
                c = compile_workflow(w, self.backend, levels)
                self.assertEqual(c['id'], w['id'])
                self.assertEqual(c['name'], w['name'])
                self.assertEqual(len(c['steps']), len(w['steps']))
                for step in c['steps']:
                    for key in ('event', 'code', 'ring', 'levels',
                                'stateHash', 'frame'):
                        self.assertIn(key, step)
                    self.assertEqual(len(step['ring']), len(step['levels']))
                    self.assertEqual(len(step['ring']), len(step['frame']))
                    for row in step['frame']:
                        for k in ('id', 'kind', 'rank', 'level',
                                  'docRank', 'slot', 'appearance'):
                            self.assertIn(k, row)

    def test_cancel_variant_length(self):
        levels = self.backend.levels()
        for w in self.workflows:
            cv = w.get('cancelVariant')
            if not cv:
                continue
            with self.subTest(workflow=w['id']):
                c = compile_workflow(w, self.backend, levels)
                self.assertEqual(len(c['cancelVariant']), len(cv['steps']))

    def test_timing_present(self):
        levels = self.backend.levels()
        c = compile_workflow(self.workflows[0], self.backend, levels)
        self.assertIn('timing', c)
        for k in ('focusMs', 'inputBeginMs', 'inputEndMs', 'transferMs', 'easing'):
            self.assertIn(k, c['timing'])

    def test_expectring_mismatch_raises(self):
        levels = self.backend.levels()
        bad = {
            'id': 'BAD',
            'name': 'bad',
            'initialRing': [{'id': 'A', 'kind': 'DOC'}],
            'steps': [
                {'event': {'type': 'FOCUS', 'id': 'A', 'source': 'command'},
                 'expectRing': ['B']},  # wrong id
            ],
        }
        with self.assertRaises(RuntimeError):
            compile_workflow(bad, self.backend, levels)


if __name__ == '__main__':
    unittest.main()
