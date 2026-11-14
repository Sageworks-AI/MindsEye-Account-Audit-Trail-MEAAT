"""Storyboard shape assertions. The full shape is proven by `build` writing
out/storyboards.json and `verify` byte-matching it; these tests guard the
minor: a storyboard step must have index, action, code, ring, levels,
stateHash, and no appearance values (the report renders the frame from the
choreography, not the storyboard).
"""
import unittest

from conductor.abi import select_backend
from conductor.choreo import compile_workflow
from conductor.storyboard import to_storyboard, to_storyboards
from conductor.workflows import load_all


class Storyboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend, _kind = select_backend()
        cls.workflows = load_all()
        cls.levels = cls.backend.levels()
        cls.choreos = [compile_workflow(w, cls.backend, cls.levels)
                       for w in cls.workflows]

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls.backend, 'close'):
            cls.backend.close()

    def test_storyboard_per_workflow(self):
        for c in self.choreos:
            with self.subTest(workflow=c['id']):
                s = to_storyboard(c)
                self.assertEqual(s['id'], c['id'])
                self.assertEqual(len(s['steps']), len(c['steps']))
                for i, step in enumerate(s['steps']):
                    self.assertEqual(step['index'], i)
                    self.assertIsInstance(step['action'], str)
                    self.assertTrue(step['action'])
                    self.assertIsInstance(step['code'], int)
                    self.assertEqual(len(step['ring']), len(step['levels']))
                    self.assertIsInstance(step['stateHash'], str)
                    self.assertEqual(len(step['stateHash']), 16)
                    # No appearance values in the storyboard.
                    self.assertNotIn('frame', step)

    def test_storyboard_cancel_variant(self):
        for c in self.choreos:
            if not c['cancelVariant']:
                continue
            with self.subTest(workflow=c['id']):
                s = to_storyboard(c)
                self.assertEqual(len(s['cancelVariant']), len(c['cancelVariant']))

    def test_to_storyboards_length(self):
        all_s = to_storyboards(self.choreos)
        self.assertEqual(len(all_s), len(self.choreos))

    def test_action_strings_are_stable(self):
        c = self.choreos[0]
        s = to_storyboard(c)
        self.assertEqual(len(s['steps']), len(c['steps']))
        self.assertIn('OPEN', s['steps'][0]['action'])


if __name__ == '__main__':
    unittest.main()
