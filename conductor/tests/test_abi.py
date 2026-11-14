"""Marshalling round-trip: encode_state -> decode_state must be the identity
for every shape the twin produces, and encode_event must be a bijection on
the (type, fields) it accepts. The two backends are not compared here; that
is the fuzz test's job.
"""
import unittest

from conductor.abi import (
    encode_state, decode_state, encode_event,
    KIND_INT, PAYLOAD_INT, CHANNEL_INT,
)


def _empty():
    return {'ring': [], 'history': [], 'input': None, 'transfer': None,
            'lastPointerEpoch': 0}


class EncodeDecodeState(unittest.TestCase):
    def test_empty(self):
        s = _empty()
        self.assertEqual(decode_state(encode_state(s))[0], s)

    def test_ring_of_three(self):
        s = _empty()
        s['ring'] = [
            {'id': 'A', 'kind': 'DOC'},
            {'id': 'B', 'kind': 'FORM'},
            {'id': 'C', 'kind': 'TRAIL'},
        ]
        self.assertEqual(decode_state(encode_state(s))[0], s)

    def test_with_input(self):
        s = _empty()
        s['ring'] = [
            {'id': 'BAR', 'kind': 'BAR'},
            {'id': 'A', 'kind': 'DOC'},
        ]
        s['input'] = {
            'channel': 'text',
            'snapshot': {'ring': [{'id': 'A', 'kind': 'DOC'}],
                         'history': [],
                         'lastPointerEpoch': 0,
                         'transfer': None},
        }
        self.assertEqual(decode_state(encode_state(s))[0], s)

    def test_with_transfer(self):
        s = _empty()
        s['ring'] = [
            {'id': 'RC', 'kind': 'DOC'},
            {'id': 'BS', 'kind': 'DOC'},
        ]
        s['transfer'] = {
            'sourceId': 'RC',
            'payloadKind': 'entry',
            'snapshot': {'ring': [{'id': 'BS', 'kind': 'DOC'},
                                  {'id': 'RC', 'kind': 'DOC'}],
                         'history': [],
                         'lastPointerEpoch': 0,
                         'transfer': None},
        }
        self.assertEqual(decode_state(encode_state(s))[0], s)


class EncodeEvent(unittest.TestCase):
    def test_all_event_types(self):
        cases = [
            ({'type': 'OPEN', 'actor': {'id': 'A', 'kind': 'DOC'}},
             [0, 1, ord('A'), KIND_INT['DOC']]),
            ({'type': 'CLOSE', 'id': 'A'}, [1, 1, ord('A')]),
            ({'type': 'FOCUS', 'id': 'A', 'source': 'command'},
             [2, 1, ord('A'), 2]),
            ({'type': 'FOCUS', 'id': 'A', 'source': 'pointer', 'pointerEpoch': 7},
             [2, 1, ord('A'), 0, 7]),
            ({'type': 'INPUT_BEGIN', 'channel': 'voice'},
             [3, CHANNEL_INT['voice']]),
            ({'type': 'INPUT_END', 'outcome': 'cancel'}, [4, 1]),
            ({'type': 'TRANSFER_COPY', 'sourceId': 'A', 'payloadKind': 'rows'},
             [5, 1, ord('A'), PAYLOAD_INT['rows']]),
            ({'type': 'TRANSFER_PASTE', 'targetId': 'B', 'outcomeKind': 'impact'},
             [6, 1, ord('B'), 0]),
            ({'type': 'TRANSFER_CANCEL'}, [7]),
            ({'type': 'BACK'}, [8]),
            ({'type': 'RESIZE'}, [9]),
        ]
        for evt, expected in cases:
            self.assertEqual(encode_event(evt), expected, evt['type'])

    def test_unknown_event_type_raises(self):
        with self.assertRaises(ValueError):
            encode_event({'type': 'NOPE'})


if __name__ == '__main__':
    unittest.main()
