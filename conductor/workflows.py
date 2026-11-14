"""Loader and validator for `conductor/workflows/W*.json`.

A workflow is { id, name, initialRing, steps, cancelVariant? }. Each step is
{ event, expectRing, expectCode? } where expectCode defaults to 0 (OK).
Validation rejects missing fields and unknown kinds; it does not attempt to
simulate the events — that is the job of `choreo.compile_workflow`.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKFLOW_DIR = HERE / 'workflows'

KNOWN_KINDS = {'DOC', 'FORM', 'TRAIL'}


def load_workflow(path):
    data = json.loads(path.read_text(encoding='utf-8'))
    _validate(data, path)
    return data


def _validate(data, path):
    for field in ('id', 'name', 'initialRing', 'steps'):
        if field not in data:
            raise ValueError(f'{path}: missing {field}')
    for a in data['initialRing']:
        if not isinstance(a, dict) or 'id' not in a or 'kind' not in a:
            raise ValueError(f'{path}: malformed ring actor {a!r}')
        if a['kind'] not in KNOWN_KINDS:
            raise ValueError(f'{path}: unknown kind {a["kind"]!r}')
    for i, step in enumerate(data['steps']):
        if 'event' not in step:
            raise ValueError(f'{path}: step {i} missing event')
        if 'expectRing' not in step:
            raise ValueError(f'{path}: step {i} missing expectRing')
        step.setdefault('expectCode', 0)
    if data.get('cancelVariant'):
        cv = data['cancelVariant']
        for i, step in enumerate(cv.get('steps', [])):
            if 'event' not in step:
                raise ValueError(f'{path}: cancelVariant step {i} missing event')
            if 'expectRing' not in step:
                raise ValueError(f'{path}: cancelVariant step {i} missing expectRing')
            step.setdefault('expectCode', 0)
    return data


def load_all():
    return [load_workflow(p) for p in sorted(WORKFLOW_DIR.glob('W*.json'))]
