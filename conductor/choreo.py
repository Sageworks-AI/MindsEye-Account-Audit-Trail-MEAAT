"""Compile a workflow into a choreography.

For each step, run the event through the engine, record the exact code,
resulting ring, levels and per-actor frame, plus the duration/easing tokens
from the levels table. A mismatch between the engine's ring and the
workflow's `expectRing` aborts the build. `cancelVariant` is compiled the
same way.

The choreography is the input to the S13 `ChoreoPlayer`, which replays it
byte-for-byte. Because the engine is authoritative and the output is
deterministic, a fresh clone that replays the same JSON produces identical
on-screen movement.
"""
import hashlib
import json

from .abi import select_backend, encode_state, encode_event  # noqa: F401


def _ring_ids(ring):
    return [a['id'] for a in ring]


def _levels_from_ring(ring):
    levels = []
    for idx, _ in enumerate(ring):
        levels.append(0 if idx == 0 else 1 if idx == 1 else 2)
    return levels


def _hash_state(state):
    payload = json.dumps(state, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]


def _apply_initial_ring(state, ring):
    """Replace `state['ring']` with a caller-provided ring, zeroing history."""
    new_state = dict(state)
    new_state['ring'] = [dict(a) for a in ring]
    new_state['history'] = []
    new_state['input'] = None
    new_state['transfer'] = None
    new_state['lastPointerEpoch'] = 0
    return new_state


def _empty_state():
    return {
        'ring': [],
        'history': [],
        'input': None,
        'transfer': None,
        'lastPointerEpoch': 0,
    }


def _compile_steps(backend, start_state, steps, label):
    out_steps = []
    state = start_state
    for i, step in enumerate(steps):
        event = step['event']
        result = backend.step(state, event)
        code = result['code']
        new_state = result['state']
        frame = result['frame']
        ring_ids = _ring_ids(new_state['ring'])
        levels = _levels_from_ring(new_state['ring'])
        expect = step['expectRing']
        expect_code = step.get('expectCode', 0)
        if code != expect_code:
            raise RuntimeError(
                f'{label} step {i}: code {code} != expected {expect_code} '
                f'for event {json.dumps(event, sort_keys=True)}')
        if ring_ids != expect:
            raise RuntimeError(
                f'{label} step {i}: ring {ring_ids} != expected {expect} '
                f'for event {json.dumps(event, sort_keys=True)}')
        out_steps.append({
            'event': event,
            'code': code,
            'ring': ring_ids,
            'levels': levels,
            'stateHash': _hash_state(new_state),
            'frame': frame,
        })
        # On error the engine's returned state is unchanged (see ABI contract).
        # Use it as the next starting point so a later step sees the same
        # state as the engine would.
        state = new_state
    return out_steps


def compile_workflow(workflow, backend, levels):
    start_state = _apply_initial_ring(_empty_state(), workflow['initialRing'])
    steps = _compile_steps(backend, start_state, workflow['steps'], workflow['id'])

    # Run the cancel variant from the same starting ring, but seed it with the
    # state after the primary steps' prefix that matters — the cancelVariant
    # is treated as its own sequence from the initial ring.
    variant_steps = []
    if workflow.get('cancelVariant'):
        variant_start = _apply_initial_ring(_empty_state(), workflow['initialRing'])
        variant_steps = _compile_steps(
            backend, variant_start,
            workflow['cancelVariant']['steps'], f'{workflow["id"]}.cancel')

    duration_ms = levels['timing']['durationMs']
    easing = levels['timing']['easing']

    return {
        'id': workflow['id'],
        'name': workflow['name'],
        'initialRing': workflow['initialRing'],
        'steps': steps,
        'cancelVariant': variant_steps,
        'timing': {
            'focusMs': duration_ms['focus'],
            'inputBeginMs': duration_ms['inputBegin'],
            'inputEndMs': duration_ms['inputEnd'],
            'transferMs': duration_ms['transfer'],
            'easing': easing,
        },
    }


def compile_all(workflows, backend, levels):
    return [compile_workflow(w, backend, levels) for w in workflows]
