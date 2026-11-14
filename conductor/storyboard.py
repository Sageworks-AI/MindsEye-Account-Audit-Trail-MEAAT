"""Condensed per-step view for the report.

The storyboard strips a choreography down to what the report needs to draw:
per step, the ring and levels, plus the action label. The full frame (per
actor appearance) stays in the choreography so the client can replay it.
"""
from .choreo import _ring_ids


def _describe(event):
    t = event['type']
    if t == 'OPEN':
        return f'OPEN {event["actor"]["id"]}'
    if t == 'CLOSE':
        return f'CLOSE {event["id"]}'
    if t == 'FOCUS':
        src = event['source']
        if src == 'pointer':
            return f'FOCUS {event["id"]} (pointer e{event["pointerEpoch"]})'
        return f'FOCUS {event["id"]} ({src})'
    if t == 'INPUT_BEGIN':
        return f'INPUT_BEGIN {event["channel"]}'
    if t == 'INPUT_END':
        return f'INPUT_END {event["outcome"]}'
    if t == 'TRANSFER_COPY':
        return f'COPY {event["sourceId"]} ({event["payloadKind"]})'
    if t == 'TRANSFER_PASTE':
        return f'PASTE {event["targetId"]} ({event["outcomeKind"]})'
    if t == 'TRANSFER_CANCEL':
        return 'TRANSFER_CANCEL'
    if t == 'BACK':
        return 'BACK'
    if t == 'RESIZE':
        return 'RESIZE'
    return t


def _steps(choreo_steps):
    out = []
    for i, step in enumerate(choreo_steps):
        out.append({
            'index': i,
            'action': _describe(step['event']),
            'code': step['code'],
            'ring': step['ring'],
            'levels': step['levels'],
            'stateHash': step['stateHash'],
        })
    return out


def to_storyboard(choreo):
    return {
        'id': choreo['id'],
        'name': choreo['name'],
        'initialRing': _ring_ids(choreo['initialRing']),
        'steps': _steps(choreo['steps']),
        'cancelVariant': _steps(choreo['cancelVariant']) if choreo['cancelVariant'] else [],
    }


def to_storyboards(choreos):
    return [to_storyboard(c) for c in choreos]
