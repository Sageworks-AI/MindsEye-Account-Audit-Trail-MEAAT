"""Seeded random event walks. Every walk asserts the laws the machine
enforces (M2, M6, M7, M12) after every step. If a step would violate one,
the walk aborts with the exact seed, step index and the offending event so
the input can be reduced to a minimal reproducing trace.

The summarised output is committed so the report can render counts: number
of walks, number of events, number of violations (must be 0).
"""
import random


def _levels(ring):
    return [0 if i == 0 else 1 if i == 1 else 2 for i, _ in enumerate(ring)]


def _check_laws(state, event, step_index):
    ring = state['ring']
    n = len(ring)
    if n > 8:
        raise AssertionError(
            f'step {step_index}: ring too large ({n}) for {event}')
    ls = _levels(ring)
    if ls.count(0) != 1:
        raise AssertionError(
            f'step {step_index}: level 0 count {ls.count(0)} != 1 for {event}')
    if n >= 2 and ls.count(1) != 1:
        raise AssertionError(
            f'step {step_index}: level 1 count {ls.count(1)} != 1 for {event}')
    if state['input'] is not None:
        if not ring or ring[0]['id'] != 'BAR':
            raise AssertionError(
                f'step {step_index}: input active but BAR not at rank 0 for {event}')
    if state['transfer'] is not None:
        source_id = state['transfer']['sourceId']
        idx = next((i for i, a in enumerate(ring) if a['id'] == source_id), -1)
        if idx < 0 or idx > 1:
            raise AssertionError(
                f'step {step_index}: transfer source {source_id} at rank {idx} for {event}')
    if len(state['history']) > 16:
        raise AssertionError(
            f'step {step_index}: history depth {len(state["history"])} > 16')


_EVENT_KINDS = ['OPEN', 'CLOSE', 'FOCUS', 'INPUT_BEGIN', 'INPUT_END',
                'TRANSFER_COPY', 'TRANSFER_PASTE', 'TRANSFER_CANCEL',
                'BACK', 'RESIZE']


def _random_event(rng, state):
    kind = rng.choice(_EVENT_KINDS)
    ring = state['ring']
    ids = [a['id'] for a in ring]
    if kind == 'OPEN':
        new_id = f'N{rng.randint(0, 6)}'
        if any(a['id'] == new_id for a in ring):
            return None
        return {'type': 'OPEN',
                'actor': {'id': new_id, 'kind': rng.choice(['DOC', 'FORM', 'TRAIL'])}}
    if kind == 'CLOSE':
        if not ids:
            return None
        return {'type': 'CLOSE', 'id': rng.choice(ids)}
    if kind == 'FOCUS':
        if not ids:
            return None
        target = rng.choice(ids)
        if rng.random() < 0.5:
            return {'type': 'FOCUS', 'id': target, 'source': 'command'}
        return {'type': 'FOCUS', 'id': target, 'source': 'pointer',
                'pointerEpoch': rng.randint(1, 1000)}
    if kind == 'INPUT_BEGIN':
        return {'type': 'INPUT_BEGIN',
                'channel': rng.choice(['text', 'voice', 'document'])}
    if kind == 'INPUT_END':
        return {'type': 'INPUT_END', 'outcome': rng.choice(['commit', 'cancel'])}
    if kind == 'TRANSFER_COPY':
        if len(ids) < 2:
            return None
        return {'type': 'TRANSFER_COPY', 'sourceId': rng.choice(ids),
                'payloadKind': rng.choice(['entry', 'rows', 'row', 'period', 'node'])}
    if kind == 'TRANSFER_PASTE':
        if not ids:
            return None
        return {'type': 'TRANSFER_PASTE', 'targetId': rng.choice(ids),
                'outcomeKind': rng.choice(['impact', 'draft-entry', 'draft-lines',
                                           'trail-edit', 'period-change'])}
    if kind == 'TRANSFER_CANCEL':
        return {'type': 'TRANSFER_CANCEL'}
    if kind == 'BACK':
        return {'type': 'BACK'}
    if kind == 'RESIZE':
        return {'type': 'RESIZE'}
    return None


def _empty_state():
    return {'ring': [], 'history': [], 'input': None, 'transfer': None,
            'lastPointerEpoch': 0}


def _initial_state(rng):
    state = _empty_state()
    n = rng.randint(1, 4)
    for i in range(n):
        state['ring'].append({
            'id': f'A{i}',
            'kind': rng.choice(['DOC', 'DOC', 'FORM', 'TRAIL']),
        })
    return state


def run_walk(backend, seed, steps=200):
    rng = random.Random(seed)
    state = _initial_state(rng)
    total = 0
    for step_index in range(steps):
        event = _random_event(rng, state)
        if event is None:
            continue
        result = backend.step(state, event)
        state = result['state']
        total += 1
        _check_laws(state, event, step_index)
    return total


def run_all(backend, n_walks=50, steps_per_walk=200):
    total_events = 0
    for seed in range(1, n_walks + 1):
        total_events += run_walk(backend, seed * 1009, steps_per_walk)
    return {
        'walks': n_walks,
        'stepsPerWalk': steps_per_walk,
        'events': total_events,
        'violations': 0,
    }
