// Proves the ten workflows W1–W10 from Addendum B against the JS twin.
// Each test constructs the initial ring, applies the documented event
// sequence, and asserts the final ring ids (and key state flags). Replaying
// these through S8's wasm and S9's Python ctypes path is the parity story.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  makeState, step, idsInOrder, findById, levelOf, rankOf,
  OK, NOOP, POINTER_STALE, BAD_ACTOR, TRANSFER_INVALID,
} from '../../attention/index.mjs';

function make(actors) { return makeState({ actors }); }
function open(id, kind) { return { type: 'OPEN', actor: { id, kind } }; }
function close(id) { return { type: 'CLOSE', id }; }
function focus(id, source = 'command') { return { type: 'FOCUS', id, source }; }
function focusP(id, epoch) { return { type: 'FOCUS', id, source: 'pointer', pointerEpoch: epoch }; }
function inputBegin(channel = 'text') { return { type: 'INPUT_BEGIN', channel }; }
function inputEnd(outcome) { return { type: 'INPUT_END', outcome }; }
function copy(sourceId, payloadKind) { return { type: 'TRANSFER_COPY', sourceId, payloadKind }; }
function paste(targetId, outcomeKind) { return { type: 'TRANSFER_PASTE', targetId, outcomeKind }; }
function cancel() { return { type: 'TRANSFER_CANCEL' }; }
function back() { return { type: 'BACK' }; }
function stepOk(state, evt) {
  const r = step(state, evt);
  assert.equal(r.code, OK, `expected OK, got ${r.code} for ${JSON.stringify(evt)}`);
  return r.state;
}
function ids(state) { return idsInOrder(state.ring); }
function levelOfId(state, id) { return levelOf(rankOf(state.ring, id)); }

const DOC = (id) => ({ id, kind: 'DOC' });
const FORM = (id) => ({ id, kind: 'FORM' });
const TRAIL = (id) => ({ id, kind: 'TRAIL' });

// W1 — reading and shifting focus
test('W1: open three cards then dwell through them', () => {
  let s = make([]);
  s = stepOk(s, open('BS', 'DOC'));
  assert.deepEqual(ids(s), ['BS']);
  s = stepOk(s, open('CF', 'DOC'));
  assert.deepEqual(ids(s), ['CF', 'BS']);
  s = stepOk(s, open('RC', 'DOC'));
  assert.deepEqual(ids(s), ['RC', 'CF', 'BS']);
  assert.equal(levelOfId(s, 'RC'), 0);
  assert.equal(levelOfId(s, 'CF'), 1);
  assert.equal(levelOfId(s, 'BS'), 2);

  s = stepOk(s, focusP('BS', 1));      // three-way cycle
  assert.deepEqual(ids(s), ['BS', 'RC', 'CF']);
  s = stepOk(s, focusP('CF', 2));      // rank 2 -> front
  assert.deepEqual(ids(s), ['CF', 'BS', 'RC']);
  s = stepOk(s, focusP('BS', 3));      // rank 1 -> swap; far unchanged
  assert.deepEqual(ids(s), ['BS', 'CF', 'RC']);
});

// W2 — input by text
test('W2: INPUT_BEGIN / INPUT_END(cancel) round-trips; commit followed by FOCUS works', () => {
  let s = make([DOC('BS'), DOC('CF'), DOC('RC')]);
  const before = ids(s);
  s = stepOk(s, inputBegin('text'));
  assert.deepEqual(ids(s), ['BAR', 'BS', 'CF', 'RC']);
  assert.equal(levelOfId(s, 'BAR'), 0);
  assert.equal(levelOfId(s, 'BS'), 1);
  assert.equal(levelOfId(s, 'CF'), 2);
  assert.equal(levelOfId(s, 'RC'), 2);

  // Cancel restores the ring.
  const cancelled = stepOk(s, inputEnd('cancel'));
  assert.deepEqual(ids(cancelled), before);

  // Commit: remove BAR, ring [BS, CF, RC]; then FOCUS(RC) -> [RC, BS, CF].
  s = stepOk(s, inputEnd('commit'));
  assert.deepEqual(ids(s), ['BS', 'CF', 'RC']);
  s = stepOk(s, focus('RC'));
  assert.deepEqual(ids(s), ['RC', 'BS', 'CF']);
});

// W3 — voice/document input has the same ring behaviour as W2
test('W3: voice channel behaves like text', () => {
  let s = make([DOC('BS'), DOC('CF'), DOC('RC')]);
  const before = ids(s);
  s = stepOk(s, inputBegin('voice'));
  assert.equal(s.input.channel, 'voice');
  const cancelled = stepOk(s, inputEnd('cancel'));
  assert.deepEqual(ids(cancelled), before);
});

test('W3: document channel behaves like text', () => {
  let s = make([DOC('BS'), DOC('CF')]);
  s = stepOk(s, inputBegin('document'));
  assert.equal(s.input.channel, 'document');
  s = stepOk(s, inputEnd('cancel'));
  assert.deepEqual(ids(s), ['BS', 'CF']);
});

// W4 — impact
test('W4: copy RC, dwell on BS, paste to BS produces pair (BS, RC) at (0, 1)', () => {
  let s = make([DOC('RC'), DOC('BS'), DOC('CF')]);
  s = stepOk(s, copy('RC', 'entry'));
  assert.equal(s.ring[0].id, 'RC');  // pinned at 0
  s = stepOk(s, focus('BS'));
  assert.deepEqual(ids(s), ['BS', 'RC', 'CF']);
  assert.equal(levelOfId(s, 'BS'), 0);
  assert.equal(levelOfId(s, 'RC'), 1);
  assert.equal(levelOfId(s, 'CF'), 2);
  s = stepOk(s, paste('BS', 'impact'));
  assert.deepEqual(ids(s), ['BS', 'RC', 'CF']);
  assert.equal(s.transfer, null);
});

test('W4 cancel variant: BACK restores [RC, BS, CF]', () => {
  let s = make([DOC('RC'), DOC('BS'), DOC('CF')]);
  s = stepOk(s, copy('RC', 'entry'));
  s = stepOk(s, focus('BS'));
  const restored = stepOk(s, back());
  assert.deepEqual(ids(restored), ['RC', 'BS', 'CF']);
  assert.equal(restored.transfer, null);
});

// W5 — entry clone
test('W5: copy RC, paste to FM ends with [FM, RC, ...]', () => {
  let s = make([DOC('RC'), FORM('FM'), DOC('BS')]);
  s = stepOk(s, copy('RC', 'entry'));
  s = stepOk(s, focus('FM'));
  assert.deepEqual(ids(s), ['FM', 'RC', 'BS']);
  s = stepOk(s, paste('FM', 'draft-entry'));
  assert.deepEqual(ids(s), ['FM', 'RC', 'BS']);
});

// W6 — trail building
test('W6: copy BS rows to TR, then CF rows to TR, ends [TR, CF, BS]', () => {
  let s = make([DOC('BS'), DOC('CF'), TRAIL('TR')]);
  s = stepOk(s, copy('BS', 'rows'));
  s = stepOk(s, focus('TR'));
  s = stepOk(s, paste('TR', 'trail-edit'));
  assert.deepEqual(ids(s), ['TR', 'BS', 'CF']);

  s = stepOk(s, copy('CF', 'rows'));
  s = stepOk(s, focus('TR'));
  s = stepOk(s, paste('TR', 'trail-edit'));
  assert.deepEqual(ids(s), ['TR', 'CF', 'BS']);
});

// W7 — period sync
test('W7: copy CF period, paste to BS -> [BS, CF]', () => {
  let s = make([DOC('CF'), DOC('BS')]);
  s = stepOk(s, copy('CF', 'period'));
  s = stepOk(s, focus('BS'));
  s = stepOk(s, paste('BS', 'period-change'));
  assert.deepEqual(ids(s), ['BS', 'CF']);
});

// W8 — opening a fourth pane
test('W8: from [RC, CF, BS], opening FM yields [FM, RC, CF, BS] with levels 0,1,2,2', () => {
  let s = make([DOC('RC'), DOC('CF'), DOC('BS')]);
  s = stepOk(s, open('FM', 'FORM'));
  assert.deepEqual(ids(s), ['FM', 'RC', 'CF', 'BS']);
  assert.equal(levelOfId(s, 'FM'), 0);
  assert.equal(levelOfId(s, 'RC'), 1);
  assert.equal(levelOfId(s, 'CF'), 2);
  assert.equal(levelOfId(s, 'BS'), 2);
});

// W9 — closing
test('W9: close the focus pane; next pane becomes focus, its successor near', () => {
  let s = make([DOC('BS'), DOC('CF'), DOC('RC')]);
  s = stepOk(s, close('BS'));
  assert.deepEqual(ids(s), ['CF', 'RC']);
  assert.equal(levelOfId(s, 'CF'), 0);
  assert.equal(levelOfId(s, 'RC'), 1);
});

test('W9: closing a transfer source cancels the transfer and removes the pane', () => {
  let s = make([DOC('BS'), DOC('CF'), DOC('RC')]);
  s = stepOk(s, copy('BS', 'rows'));
  assert.equal(s.transfer.sourceId, 'BS');
  s = stepOk(s, close('BS'));
  assert.equal(s.transfer, null);
  assert.deepEqual(ids(s), ['CF', 'RC']);
});

// W10 — rejections
test('W10: stationary pointer after layout shift returns POINTER_STALE; state unchanged', () => {
  let s = make([DOC('A'), DOC('B')]);
  s = stepOk(s, focusP('B', 5));
  const before = s;
  const r = step(s, focusP('A', 5)); // same epoch
  assert.equal(r.code, POINTER_STALE);
  assert.equal(r.state, before);
});

test('W10: FOCUS on an unknown pane returns BAD_ACTOR; state unchanged', () => {
  const s = make([DOC('A')]);
  const r = step(s, focus('Z'));
  assert.equal(r.code, BAD_ACTOR);
  assert.equal(r.state, s);
});

test('W10: copy with only one pane open returns TRANSFER_INVALID; state unchanged', () => {
  const s = make([DOC('A')]);
  const r = step(s, copy('A', 'rows'));
  assert.equal(r.code, TRANSFER_INVALID);
  assert.equal(r.state, s);
});

test('W10: invalid paste pairing returns TRANSFER_INVALID; state unchanged', () => {
  let s = make([DOC('A'), DOC('B'), TRAIL('TR')]);
  s = stepOk(s, copy('A', 'entry'));
  s = stepOk(s, focus('TR'));
  // entry -> TRAIL is not a valid pairing in the matrix (null).
  const before = s;
  const r = step(s, paste('TR', 'impact'));
  assert.equal(r.code, TRANSFER_INVALID);
  assert.equal(r.state, before);
});
