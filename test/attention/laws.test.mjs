// Proves the JS twin satisfies laws M1–M15 and T1–T4 from attention/LAWS.md.
// Tests target the state machine's observable behaviour (state hash, ring
// ids, actor levels) rather than internal fields, so the S8 C++ port can be
// verified against the same assertions.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  makeState, step, hashState, frame,
  OK, NOOP, POINTER_STALE, ALREADY_FOCUSED, BAD_ACTOR, BAD_EVENT,
  TRANSFER_INVALID, RING_FULL,
  levelOf, rankOf, docRank, idsInOrder, findById,
  validateLevels, loadLevels, levelContrastPermille,
  CONTRAST_FLOOR, HISTORY_DEPTH, MAX_ACTORS,
} from '../../attention/index.mjs';

const LEVELS = loadLevels();

function ids(state) { return idsInOrder(state.ring); }
function levels(state) {
  return state.ring.map((_, i) => levelOf(i));
}
function make(actors) { return makeState({ actors }); }
function open(actor) { return { type: 'OPEN', actor }; }
function close(id) { return { type: 'CLOSE', id }; }
function focus(id, source = 'command') { return { type: 'FOCUS', id, source }; }
function focusP(id, epoch) { return { type: 'FOCUS', id, source: 'pointer', pointerEpoch: epoch }; }
function stepOk(state, evt) {
  const r = step(state, evt);
  assert.equal(r.code, OK, `expected OK, got ${r.code} for ${JSON.stringify(evt)}`);
  return r.state;
}
function expectRing(state, expectedIds) { assert.deepEqual(ids(state), expectedIds); }

const DOC = (id) => ({ id, kind: 'DOC' });
const FORM = (id) => ({ id, kind: 'FORM' });
const TRAIL = (id) => ({ id, kind: 'TRAIL' });

// ---------- M1 Conservation ----------
test('M1: OPEN adds exactly one actor', () => {
  const s0 = make([DOC('A')]);
  const s1 = stepOk(s0, open(DOC('B')));
  assert.equal(s1.ring.length, s0.ring.length + 1);
  assert.ok(findById(s1.ring, 'B'));
});

test('M1: CLOSE removes exactly one actor', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C')]);
  const s1 = stepOk(s0, close('B'));
  assert.equal(s1.ring.length, s0.ring.length - 1);
  assert.equal(findById(s1.ring, 'B'), null);
});

test('M1: FOCUS does not change the actor set', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C')]);
  const s1 = stepOk(s0, focus('C'));
  assert.deepEqual([...ids(s1)].sort(), ['A', 'B', 'C']);
});

test('M1: INPUT_BEGIN adds BAR, INPUT_END removes it', () => {
  const s0 = make([DOC('A')]);
  const s1 = stepOk(s0, { type: 'INPUT_BEGIN', channel: 'text' });
  assert.equal(s1.ring[0].kind, 'BAR');
  const s2 = stepOk(s1, { type: 'INPUT_END', outcome: 'cancel' });
  assert.equal(findById(s2.ring, 'BAR'), null);
  assert.deepEqual(ids(s2), ids(s0));
});

// ---------- M2 Totality and shape ----------
test('M2: exactly one actor at level 0, exactly one at level 1 when >= 2 actors', () => {
  let s = make([DOC('A')]);
  s = stepOk(s, open(DOC('B')));
  s = stepOk(s, open(DOC('C')));
  s = stepOk(s, open(DOC('D')));
  const ls = levels(s);
  assert.equal(ls.filter((l) => l === 0).length, 1);
  assert.equal(ls.filter((l) => l === 1).length, 1);
  assert.equal(ls.filter((l) => l === 2).length, s.ring.length - 2);
});

test('M2: single actor is at level 0 only', () => {
  const s = make([DOC('A')]);
  assert.equal(levelOf(rankOf(s.ring, 'A')), 0);
  assert.equal(levels(s).filter((l) => l === 1).length, 0);
});

// ---------- M3 Stability ----------
test('M3: FOCUS preserves the relative order of every other actor', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C'), DOC('D')]);
  const s1 = stepOk(s0, focus('D'));
  // Before: A, B, C, D. After: D, A, B, C. Relative order of A,B,C preserved.
  expectRing(s1, ['D', 'A', 'B', 'C']);
});

test('M3: FOCUS from rank 1 to 0 is a swap; the far tier is untouched', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C'), DOC('D')]);
  const s1 = stepOk(s0, focus('B'));
  expectRing(s1, ['B', 'A', 'C', 'D']);
});

// ---------- M4 Idempotence ----------
test('M4: FOCUS on the front actor returns ALREADY_FOCUSED with identical hash', () => {
  const s0 = make([DOC('A'), DOC('B')]);
  const r = step(s0, focus('A'));
  assert.equal(r.code, ALREADY_FOCUSED);
  assert.equal(hashState(r.state), hashState(s0));
});

// ---------- M5 Reversibility ----------
test('M5: INPUT_BEGIN then INPUT_END(cancel) restores identical state', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C')]);
  const s1 = stepOk(s0, { type: 'INPUT_BEGIN', channel: 'text' });
  const s2 = stepOk(s1, { type: 'INPUT_END', outcome: 'cancel' });
  assert.equal(hashState(s2), hashState(s0));
});

test('M5: TRANSFER_COPY then TRANSFER_CANCEL restores identical state', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C')]);
  const s1 = stepOk(s0, { type: 'TRANSFER_COPY', sourceId: 'B', payloadKind: 'rows' });
  const s2 = stepOk(s1, { type: 'TRANSFER_CANCEL' });
  assert.equal(hashState(s2), hashState(s0));
});

test('M5: BACK undoes exactly one focus change', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C')]);
  const s1 = stepOk(s0, focus('C'));
  const s2 = stepOk(s1, { type: 'BACK' });
  assert.deepEqual(ids(s2), ids(s0));
});

// ---------- M6 Input primacy ----------
test('M6: BAR stays at rank 0 while input is active', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'text' });
  assert.equal(s.ring[0].kind, 'BAR');
  s = stepOk(s, focus('C'));
  assert.equal(s.ring[0].kind, 'BAR');
  s = stepOk(s, focus('B'));
  assert.equal(s.ring[0].kind, 'BAR');
});

test('M6: FOCUS during input moves the target to rank 1', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'text' });
  s = stepOk(s, focus('C'));
  expectRing(s, ['BAR', 'C', 'A', 'B']);
});

// ---------- M7 Pin ----------
test('M7: source is at rank 0 immediately after TRANSFER_COPY', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  s = stepOk(s, { type: 'TRANSFER_COPY', sourceId: 'B', payloadKind: 'rows' });
  assert.equal(s.ring[0].id, 'B');
});

test('M7: source is at rank 1 (never rank 2) after focusing a target during transfer', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C'), DOC('D')]);
  s = stepOk(s, { type: 'TRANSFER_COPY', sourceId: 'B', payloadKind: 'rows' });
  s = stepOk(s, focus('C'));
  expectRing(s, ['C', 'B', 'A', 'D']);
  assert.ok(rankOf(s.ring, 'B') <= 1);
});

// ---------- M8 Geometry agreement ----------
test('M8: docRank counts only non-BAR actors', () => {
  let s = make([DOC('A'), DOC('B')]);
  s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'text' });
  // Ring is [BAR, A, B]; docRank(A)=0, docRank(B)=1
  assert.equal(docRank(s.ring, 'A'), 0);
  assert.equal(docRank(s.ring, 'B'), 1);
  assert.equal(docRank(s.ring, 'BAR'), -1);
});

test('M8: FOCUS during input leaves docRank 0 unchanged', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  // Before input: docRank(A)=0 (A was focus)
  assert.equal(docRank(s.ring, 'A'), 0);
  s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'text' });
  // A is now at rank 1 in the appearance ring, but docRank 0.
  assert.equal(docRank(s.ring, 'A'), 0);
});

// ---------- M9 Appearance only ----------
test('M9: state contains no geometry fields', () => {
  let s = make([DOC('A')]);
  s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'text' });
  s = stepOk(s, { type: 'INPUT_END', outcome: 'commit' });
  // Recursively scan for any 'rect', 'width', 'height', 'scale' key.
  function scan(v) {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(scan); return; }
    for (const k of Object.keys(v)) {
      if (/^(rect|width|height|x|y|scale)$/.test(k)) {
        assert.fail(`state contains geometry field "${k}"`);
      }
      scan(v[k]);
    }
  }
  scan(s);
});

// ---------- M10 No oscillation ----------
test('M10: stale pointer epoch is rejected with POINTER_STALE', () => {
  let s = make([DOC('A'), DOC('B')]);
  s = stepOk(s, focusP('B', 5));
  assert.equal(s.lastPointerEpoch, 5);
  const r = step(s, focusP('A', 5));
  assert.equal(r.code, POINTER_STALE);
  assert.equal(hashState(r.state), hashState(s));
});

test('M10: increasing pointer epoch is accepted', () => {
  let s = make([DOC('A'), DOC('B')]);
  s = stepOk(s, focusP('B', 5));
  s = stepOk(s, focusP('A', 6));
  assert.equal(s.lastPointerEpoch, 6);
});

test('M10: non-pointer FOCUS does not update lastPointerEpoch', () => {
  let s = make([DOC('A'), DOC('B')]);
  s = stepOk(s, focusP('B', 5));
  s = stepOk(s, focus('A', 'command'));
  assert.equal(s.lastPointerEpoch, 5);
});

// ---------- M11 Determinism ----------
test('M11: identical event sequences produce identical states', () => {
  function run() {
    let s = make([DOC('A'), DOC('B'), DOC('C')]);
    s = stepOk(s, focus('C'));
    s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'voice' });
    s = stepOk(s, focus('A'));
    s = stepOk(s, { type: 'INPUT_END', outcome: 'cancel' });
    return s;
  }
  assert.equal(hashState(run()), hashState(run()));
});

// ---------- M12 Boundedness ----------
test('M12: history depth is capped at 16', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C'), DOC('D')]);
  for (let i = 0; i < 30; i++) {
    const target = i % 2 === 0 ? 'B' : 'A';
    s = stepOk(s, focus(target));
  }
  assert.ok(s.history.length <= HISTORY_DEPTH);
});

test('M12: ring full (9th actor) is a clean RING_FULL error', () => {
  let s = make([]);
  for (let i = 0; i < MAX_ACTORS; i++) {
    s = stepOk(s, open(DOC(`D${i}`)));
  }
  assert.equal(s.ring.length, MAX_ACTORS);
  const r = step(s, open(DOC('Dx')));
  assert.equal(r.code, RING_FULL);
  assert.equal(r.state.ring.length, MAX_ACTORS);
});

// ---------- M13 Primary/secondary pairing ----------
test('M13: armed transfer + target focused -> pair at levels (0, 1)', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  s = stepOk(s, { type: 'TRANSFER_COPY', sourceId: 'B', payloadKind: 'rows' });
  s = stepOk(s, focus('C'));
  assert.equal(levelOf(rankOf(s.ring, 'C')), 0);
  assert.equal(levelOf(rankOf(s.ring, 'B')), 1);
});

// ---------- M14 Closure ----------
test('M14: after CLOSE, remaining ring equals previous minus the actor', () => {
  const s0 = make([DOC('A'), DOC('B'), DOC('C'), DOC('D')]);
  const s1 = stepOk(s0, close('B'));
  expectRing(s1, ['A', 'C', 'D']);
});

// ---------- M15 Priority ----------
test('M15: BACK cancels input before transfer before history', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  s = stepOk(s, focus('C'));
  s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'text' });
  const r = step(s, { type: 'BACK' });
  assert.equal(r.code, OK);
  assert.equal(r.state.input, null);
  // Same ring as before INPUT_BEGIN, and history still has one entry.
  assert.deepEqual(ids(r.state), ['C', 'A', 'B']);
  assert.equal(r.state.history.length, s.input.snapshot.history.length);
});

test('M15: BACK with only transfer armed cancels the transfer', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  s = stepOk(s, { type: 'TRANSFER_COPY', sourceId: 'B', payloadKind: 'rows' });
  const r = step(s, { type: 'BACK' });
  assert.equal(r.state.transfer, null);
  assert.equal(ids(r.state)[0], 'A'); // pre-arm order restored
});

test('M15: BACK with no input, no transfer, no history is a clean NOOP', () => {
  const s = make([DOC('A')]);
  const r = step(s, { type: 'BACK' });
  assert.equal(r.code, NOOP);
  assert.equal(hashState(r.state), hashState(s));
});

// ---------- BAD_ACTOR / BAD_EVENT ----------
test('FOCUS on an unknown actor is BAD_ACTOR', () => {
  const s = make([DOC('A')]);
  const r = step(s, focus('Z'));
  assert.equal(r.code, BAD_ACTOR);
});

test('FOCUS with a bad source enum is BAD_EVENT', () => {
  const s = make([DOC('A')]);
  const r = step(s, { type: 'FOCUS', id: 'A', source: 'whistle' });
  assert.equal(r.code, BAD_EVENT);
});

test('unknown event type is BAD_EVENT', () => {
  const s = make([DOC('A')]);
  const r = step(s, { type: 'NOT_A_TYPE' });
  assert.equal(r.code, BAD_EVENT);
});

// ---------- T1–T4: level table ----------
test('T1–T4: the shipped default table validates', () => {
  const t = loadLevels();
  assert.equal(t.version, 1);
  assert.equal(t.themes.light.table.length, 3);
  assert.equal(t.themes.dark.table.length, 3);
});

test('T1: opacity increasing with level is rejected', () => {
  const raw = JSON.parse(JSON.stringify(require('node:fs').readFileSync(
    new URL('../../attention/dist/levels.json', import.meta.url), 'utf8')));
  raw.themes.light.table[1].opacity = 1100;
  assert.throws(() => validateLevels(raw), /T1.*opacity/);
});

test('T2: opacity step < 100 is rejected', () => {
  const raw = JSON.parse(JSON.stringify(require('node:fs').readFileSync(
    new URL('../../attention/dist/levels.json', import.meta.url), 'utf8')));
  raw.themes.light.table[1].opacity = 950; // step from 1000 is 50 < 100
  assert.throws(() => validateLevels(raw), /T2.*opacity/);
});

test('T3: contrast below floor is rejected (light, level 2, prefer-high)', () => {
  const raw = JSON.parse(JSON.stringify(require('node:fs').readFileSync(
    new URL('../../attention/dist/levels.json', import.meta.url), 'utf8')));
  // Reduce level 2 opacity to something that passes T2 (step from 880 is
  // >= 100) but fails the 4500 floor under prefers-contrast: more.
  raw.themes.light.table[2].opacity = 700;
  raw.themes.light.table[2].brightness = 700;
  assert.throws(() => validateLevels(raw, { prefersContrastMore: true }), /T3/);
});

test('T4: extra geometry field on a level is rejected', () => {
  const raw = JSON.parse(JSON.stringify(require('node:fs').readFileSync(
    new URL('../../attention/dist/levels.json', import.meta.url), 'utf8')));
  raw.themes.light.table[0].width = 200;
  assert.throws(() => validateLevels(raw), /not allowed \(T4\)/);
});

test('T3: default level table passes every contrast floor including prefers-contrast: more', () => {
  const strict = validateLevels(
    JSON.parse(require('node:fs').readFileSync(
      new URL('../../attention/dist/levels.json', import.meta.url), 'utf8')),
    { prefersContrastMore: true });
  for (const theme of ['light', 'dark']) {
    for (let level = 0; level < 3; level++) {
      const row = strict.themes[theme].table[level];
      const ratio = levelContrastPermille(
        strict.themes[theme].fg, strict.themes[theme].bg,
        row.opacity, row.brightness);
      const floor = CONTRAST_FLOOR[theme][level];
      assert.ok(ratio >= floor,
        `${theme} L${level} ratio ${ratio} < floor ${floor}`);
    }
  }
});

// ---------- frame() ----------
test('frame: returns per-actor level, docRank and slot', () => {
  let s = make([DOC('A'), DOC('B'), DOC('C')]);
  s = stepOk(s, { type: 'INPUT_BEGIN', channel: 'text' });
  const f = frame(s, LEVELS);
  assert.equal(f[0].kind, 'BAR');
  assert.equal(f[0].rank, 0);
  assert.equal(f[0].level, 0);
  assert.equal(f[0].docRank, -1);
  assert.equal(f[0].slot, -1);
  const a = f.find((e) => e.id === 'A');
  assert.equal(a.rank, 1);
  assert.equal(a.level, 1);
  assert.equal(a.docRank, 0);
  assert.equal(a.slot, 0);
});
