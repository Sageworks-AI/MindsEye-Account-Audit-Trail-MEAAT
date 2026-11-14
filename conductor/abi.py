"""Backend selection and marshalling.

Two implementations of the attention state machine are available to the
conductor: the native shared library built by CMake (via ctypes) and the
Node CLI (`attention/cli.mjs`, via `bridge_node.py`). If both are present,
a `DualBackend` runs every step through both and asserts they agree; any
disagreement aborts with the offending step. This makes the Python path a
third independent check on the state machine, not a re-implementation.
"""
import ctypes
import json
import os
from pathlib import Path

from .bridge_node import Bridge

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

KIND_INT = {'DOC': 0, 'FORM': 1, 'TRAIL': 2, 'BAR': 3}
KIND_NAME = ['DOC', 'FORM', 'TRAIL', 'BAR']
PAYLOAD_INT = {'entry': 0, 'rows': 1, 'row': 2, 'period': 3, 'node': 4}
PAYLOAD_NAME = ['entry', 'rows', 'row', 'period', 'node']
CHANNEL_INT = {'text': 0, 'voice': 1, 'document': 2}
CHANNEL_NAME = ['text', 'voice', 'document']

SHARED_LIB_CANDIDATES = [
    'attention/cpp/build/libattention_native.so',
    'attention/cpp/build/libattention_native.dylib',
    'attention/cpp/build/attention_native.dll',
    'attention/cpp/build/Release/attention_native.dll',
    'attention/cpp/build/Debug/attention_native.dll',
]


# ---- Marshalling (Python dict <-> flat int64) ----

def _emit_id(out, s):
    cps = [ord(c) for c in s]
    out.append(len(cps))
    out.extend(cps)


def _emit_ring(out, ring):
    out.append(len(ring))
    for a in ring:
        _emit_id(out, a['id'])
        out.append(KIND_INT[a['kind']])


def _emit_history(out, hist):
    out.append(len(hist))
    for ring in hist:
        _emit_ring(out, ring)


def _emit_basic(out, snap):
    _emit_ring(out, snap['ring'])
    _emit_history(out, snap['history'])
    out.append(snap['lastPointerEpoch'])


def _emit_full(out, snap):
    _emit_ring(out, snap['ring'])
    _emit_history(out, snap['history'])
    out.append(snap['lastPointerEpoch'])
    t = snap.get('transfer')
    if t:
        out.append(1)
        _emit_id(out, t['sourceId'])
        out.append(PAYLOAD_INT[t['payloadKind']])
        _emit_basic(out, t['snapshot'])
    else:
        out.append(0)


def encode_state(state):
    out = [state['lastPointerEpoch']]
    _emit_ring(out, state['ring'])
    _emit_history(out, state['history'])
    t = state.get('transfer')
    if t:
        out.append(1)
        _emit_id(out, t['sourceId'])
        out.append(PAYLOAD_INT[t['payloadKind']])
        _emit_basic(out, t['snapshot'])
    else:
        out.append(0)
    i = state.get('input')
    if i:
        out.append(1)
        out.append(CHANNEL_INT[i['channel']])
        _emit_full(out, i['snapshot'])
    else:
        out.append(0)
    return out


def encode_event(event):
    out = []
    t = event['type']
    if t == 'OPEN':
        out.append(0)
        _emit_id(out, event['actor']['id'])
        out.append(KIND_INT[event['actor']['kind']])
    elif t == 'CLOSE':
        out.append(1)
        _emit_id(out, event['id'])
    elif t == 'FOCUS':
        out.append(2)
        _emit_id(out, event['id'])
        out.append({'pointer': 0, 'keyboard': 1, 'command': 2, 'programmatic': 3}[event['source']])
        if event['source'] == 'pointer':
            out.append(event['pointerEpoch'])
    elif t == 'INPUT_BEGIN':
        out.append(3)
        out.append(CHANNEL_INT[event['channel']])
    elif t == 'INPUT_END':
        out.append(4)
        out.append(0 if event['outcome'] == 'commit' else 1)
    elif t == 'TRANSFER_COPY':
        out.append(5)
        _emit_id(out, event['sourceId'])
        out.append(PAYLOAD_INT[event['payloadKind']])
    elif t == 'TRANSFER_PASTE':
        out.append(6)
        _emit_id(out, event['targetId'])
        out.append({'impact': 0, 'draft-entry': 1, 'draft-lines': 2,
                    'trail-edit': 3, 'period-change': 4}[event['outcomeKind']])
    elif t == 'TRANSFER_CANCEL':
        out.append(7)
    elif t == 'BACK':
        out.append(8)
    elif t == 'RESIZE':
        out.append(9)
    else:
        raise ValueError(f'unknown event type: {t}')
    return out


def _decode_id(arr, off):
    cp_len = arr[off]
    off += 1
    cps = arr[off:off + cp_len]
    off += cp_len
    return ''.join(chr(c) for c in cps), off


def _decode_ring(arr, off):
    n = arr[off]
    off += 1
    ring = []
    for _ in range(n):
        id_, off = _decode_id(arr, off)
        kind = KIND_NAME[arr[off]]
        off += 1
        ring.append({'id': id_, 'kind': kind})
    return ring, off


def _decode_history(arr, off):
    n = arr[off]
    off += 1
    hist = []
    for _ in range(n):
        ring, off = _decode_ring(arr, off)
        hist.append(ring)
    return hist, off


def _decode_basic(arr, off):
    ring, off = _decode_ring(arr, off)
    hist, off = _decode_history(arr, off)
    lpe = arr[off]
    off += 1
    return {'ring': ring, 'history': hist, 'lastPointerEpoch': lpe}, off


def _decode_full(arr, off):
    ring, off = _decode_ring(arr, off)
    hist, off = _decode_history(arr, off)
    lpe = arr[off]
    off += 1
    t_active = arr[off]
    off += 1
    transfer = None
    if t_active:
        sid, off = _decode_id(arr, off)
        pk = PAYLOAD_NAME[arr[off]]
        off += 1
        snap, off = _decode_basic(arr, off)
        transfer = {'sourceId': sid, 'payloadKind': pk, 'snapshot': snap}
    return {'ring': ring, 'history': hist, 'lastPointerEpoch': lpe,
            'transfer': transfer}, off


def decode_state(arr, off=0):
    lpe = arr[off]
    off += 1
    ring, off = _decode_ring(arr, off)
    hist, off = _decode_history(arr, off)
    t_active = arr[off]
    off += 1
    transfer = None
    if t_active:
        sid, off = _decode_id(arr, off)
        pk = PAYLOAD_NAME[arr[off]]
        off += 1
        snap, off = _decode_basic(arr, off)
        transfer = {'sourceId': sid, 'payloadKind': pk, 'snapshot': snap}
    i_active = arr[off]
    off += 1
    input_ = None
    if i_active:
        ch = CHANNEL_NAME[arr[off]]
        off += 1
        snap, off = _decode_full(arr, off)
        input_ = {'channel': ch, 'snapshot': snap}
    return {
        'ring': ring, 'history': hist, 'input': input_,
        'transfer': transfer, 'lastPointerEpoch': lpe,
    }, off


def _decode_frame(arr, off=0):
    n = arr[off]
    off += 1
    rows = []
    for _ in range(n):
        id_, off = _decode_id(arr, off)
        kind = KIND_NAME[arr[off]]
        off += 1
        rank = arr[off]; off += 1
        level = arr[off]; off += 1
        doc_rank = arr[off]; off += 1
        slot = arr[off]; off += 1
        opacity = arr[off]; off += 1
        brightness = arr[off]; off += 1
        saturation = arr[off]; off += 1
        blur = arr[off]; off += 1
        shadow = arr[off]; off += 1
        radius = arr[off]; off += 1
        rows.append({
            'id': id_, 'kind': kind, 'rank': rank, 'level': level,
            'docRank': doc_rank, 'slot': slot,
            'appearance': {'opacity': opacity, 'brightness': brightness,
                           'saturation': saturation, 'blur': blur,
                           'shadow': shadow, 'radius': radius},
        })
    return rows


# ---- Backends ----

class BridgeBackend:
    """Node CLI backend (`attention/cli.mjs`). The reference for comparison."""

    def __init__(self):
        self.bridge = Bridge()
        self.levels = self.bridge.levels()

    def step(self, state, event):
        return self.bridge.step(state, event)

    def close(self):
        self.bridge.close()


class NativeBackend:
    """ctypes backend on the shared library built by CMake."""

    def __init__(self, lib_path):
        self.lib = ctypes.CDLL(str(lib_path))
        self.lib.att_version.restype = ctypes.c_int64
        self.lib.att_scratch_ptr.restype = ctypes.c_int64
        self.lib.att_scratch_size.restype = ctypes.c_int64
        self.lib.att_step.restype = ctypes.c_int64
        self.lib.att_step.argtypes = [ctypes.c_int64]
        self.lib.att_levels_table.restype = ctypes.c_int64
        self.lib.att_levels_table.argtypes = [ctypes.c_int64]
        scratch_ptr = self.lib.att_scratch_ptr()
        scratch_size = self.lib.att_scratch_size()
        self._scratch = (ctypes.c_int64 * scratch_size).from_address(scratch_ptr)
        self._scratch_size = scratch_size
        self._levels = None

    def _read_scratch(self, base, n):
        return [self._scratch[base + i] for i in range(n)]

    def levels(self):
        if self._levels is not None:
            return self._levels
        # Use the twin's levels via the bridge; the native att_levels_table
        # returns the same numbers but in flat form, and normalising is
        # more code than the benefit warrants here.
        bridge_levels = Bridge()
        try:
            self._levels = bridge_levels.levels()
        finally:
            bridge_levels.close()
        return self._levels

    def step(self, state, event):
        state_ints = encode_state(state)
        event_ints = encode_event(event)
        in_arr = [1, len(state_ints)] + state_ints + [len(event_ints)] + event_ints
        for i, v in enumerate(in_arr):
            self._scratch[i] = v
        out_len = self.lib.att_step(len(in_arr))
        if out_len < 0:
            raise RuntimeError(f'att_step error: {out_len}')
        base = len(in_arr)
        code = self._scratch[base + 1]
        out_state_len = self._scratch[base + 2]
        state_arr = self._read_scratch(base + 3, out_state_len)
        new_state, _ = decode_state(state_arr)
        frame_off = base + 3 + out_state_len
        frame_len = self._scratch[frame_off]
        frame_arr = self._read_scratch(frame_off + 1, frame_len)
        return {'code': code, 'state': new_state, 'frame': _decode_frame(frame_arr)}


class DualBackend:
    """Runs every step through both backends and aborts on disagreement."""

    def __init__(self, primary, reference):
        self.primary = primary
        self.reference = reference
        self._levels = reference.levels()

    def levels(self):
        return self._levels

    def step(self, state, event):
        a = self.primary.step(state, event)
        b = self.reference.step(state, event)
        if a['code'] != b['code']:
            raise RuntimeError(
                f'backend disagreement: code {a["code"]} != {b["code"]} '
                f'for event {json.dumps(event, sort_keys=True)}')
        ids_a = [x['id'] for x in a['state']['ring']]
        ids_b = [x['id'] for x in b['state']['ring']]
        if ids_a != ids_b:
            raise RuntimeError(
                f'backend disagreement: ring {ids_a} != {ids_b} '
                f'for event {json.dumps(event, sort_keys=True)}')
        return a

    def close(self):
        self.reference.close()
        if hasattr(self.primary, 'close'):
            self.primary.close()


def find_shared_library():
    override = os.environ.get('MEaat_ATTENTION_LIB')
    if override:
        p = Path(override)
        if p.exists():
            return p
    for rel in SHARED_LIB_CANDIDATES:
        p = ROOT / rel
        if p.exists():
            return p
    return None


def select_backend():
    """Return (backend, kind) where kind is 'native+dual' | 'bridge'."""
    lib_path = find_shared_library()
    if lib_path is not None:
        try:
            native = NativeBackend(lib_path)
            reference = BridgeBackend()
            return DualBackend(native, reference), 'native+dual'
        except (OSError, RuntimeError) as exc:
            print(f'conductor: native library unavailable ({exc}); '
                  f'falling back to Node bridge')
    return BridgeBackend(), 'bridge'
