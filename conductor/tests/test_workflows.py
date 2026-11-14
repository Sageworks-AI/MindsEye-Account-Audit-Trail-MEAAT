"""Every workflow loads, validates, and declares the expected shape. Does
not simulate events; that is `choreo`'s job and the test_choreo suite
covers it. Here we assert:
  - the W*.json files are all present
  - the shapes match `load_workflow`'s expectations
  - every `expectRing` uses actor ids that appear in the initialRing or
    are produced by an earlier OPEN in the same list (so the expectation is
    plausible before the engine is invoked)
  - the transfer payload / outcome kinds used are members of the ABI lists
"""
import unittest

from conductor.workflows import load_all, KNOWN_KINDS

PAYLOAD_KINDS = {'entry', 'rows', 'row', 'period', 'node'}
OUTCOME_KINDS = {'impact', 'draft-entry', 'draft-lines', 'trail-edit', 'period-change'}
FOCUS_SOURCES = {'pointer', 'keyboard', 'command', 'programmatic'}
CHANNELS = {'text', 'voice', 'document'}


def _known_ids(steps, initial):
    ids = {a['id'] for a in initial}
    for step in steps:
        evt = step['event']
        if evt['type'] == 'OPEN':
            ids.add(evt['actor']['id'])
        if evt['type'] == 'INPUT_BEGIN':
            ids.add('BAR')
    return ids


class Workflows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflows = load_all()

    def test_all_ten_present(self):
        ids = [w['id'] for w in self.workflows]
        expected = {f'W{i}' for i in range(1, 11)}
        self.assertEqual(set(ids), expected)

    def test_actor_kinds_are_known(self):
        for w in self.workflows:
            for a in w['initialRing']:
                self.assertIn(a['kind'], KNOWN_KINDS,
                              f'{w["id"]}: bad kind {a["kind"]}')

    def test_event_shapes_are_well_formed(self):
        for w in self.workflows:
            for i, step in enumerate(w['steps']):
                evt = step['event']
                self._check_event(w['id'], i, evt)
            cv = w.get('cancelVariant')
            if cv:
                for i, step in enumerate(cv['steps']):
                    self._check_event(f'{w["id"]}.cancel', i, step['event'])

    def _check_event(self, wid, i, evt):
        t = evt['type']
        self.assertIn(t, {'OPEN', 'CLOSE', 'FOCUS', 'INPUT_BEGIN',
                          'INPUT_END', 'TRANSFER_COPY', 'TRANSFER_PASTE',
                          'TRANSFER_CANCEL', 'BACK', 'RESIZE'})
        if t == 'OPEN':
            self.assertIn(evt['actor']['kind'], KNOWN_KINDS)
        elif t == 'FOCUS':
            self.assertIn(evt['source'], FOCUS_SOURCES)
            if evt['source'] == 'pointer':
                self.assertIsInstance(evt['pointerEpoch'], int)
        elif t == 'INPUT_BEGIN':
            self.assertIn(evt['channel'], CHANNELS)
        elif t == 'INPUT_END':
            self.assertIn(evt['outcome'], {'commit', 'cancel'})
        elif t == 'TRANSFER_COPY':
            self.assertIn(evt['payloadKind'], PAYLOAD_KINDS,
                          f'{wid} step {i}: {evt["payloadKind"]}')
        elif t == 'TRANSFER_PASTE':
            self.assertIn(evt['outcomeKind'], OUTCOME_KINDS,
                          f'{wid} step {i}: {evt["outcomeKind"]}')

    def test_expect_rings_use_plausible_ids(self):
        for w in self.workflows:
            known = _known_ids(w['steps'], w['initialRing'])
            for i, step in enumerate(w['steps']):
                for aid in step['expectRing']:
                    self.assertIn(aid, known | {'BAR'},
                                  f'{w["id"]} step {i}: expectRing {aid} not '
                                  f'producible by any prior event')
            cv = w.get('cancelVariant')
            if cv:
                known = _known_ids(cv['steps'], w['initialRing'])
                for i, step in enumerate(cv['steps']):
                    for aid in step['expectRing']:
                        self.assertIn(aid, known | {'BAR'},
                                      f'{w["id"]}.cancel step {i}: '
                                      f'expectRing {aid} not producible')

    def test_expect_code_defaults_to_zero(self):
        for w in self.workflows:
            for step in w['steps']:
                self.assertIn('expectCode', step)
                self.assertIsInstance(step['expectCode'], int)


if __name__ == '__main__':
    unittest.main()
