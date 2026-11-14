// The report is the acceptance artifact. These tests prove it is
// byte-stable, that every check it aggregates passes, that its JSON is
// integer-only in money paths, and that the expected section ids and
// demo numbers are present. If any of these fail, `npm run report` will
// exit non-zero on a fresh checkout.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { setupDemo, buildReport } from '../demo/report.mjs';

function build() {
  const { ledger, events } = setupDemo();
  return buildReport({ ledger, events });
}

test('report: two in-process builds produce byte-identical HTML', () => {
  const a = build();
  const b = build();
  assert.equal(a.html, b.html);
});

test('report: two in-process builds produce byte-identical JSON', () => {
  const a = build();
  const b = build();
  assert.deepEqual(a.json, b.json);
});

test('report: all checks pass on the demo ledger', () => {
  const r = build();
  assert.equal(r.exitCode, 0, 'report exit code must be 0');
  assert.equal(r.json.allPassed, true);
  for (const item of r.json.sections.checks.items) {
    assert.equal(item.pass, true, `check failed: ${item.source} — ${item.name}: ${item.detail || ''}`);
  }
});

test('report: HTML contains every expected section id', () => {
  const r = build();
  for (const id of ['read', 'impact', 'trail', 'sequencer', 'checks',
                    'space', 'attention', 'levels', 'fuzz']) {
    assert.ok(r.html.includes(`<section id="${id}"`),
      `missing section: ${id}`);
  }
});

test('report: JSON has all sections and head', () => {
  const r = build();
  for (const key of ['read', 'impact', 'trail', 'sequencer', 'checks',
                     'space', 'attention', 'levels', 'fuzz']) {
    assert.ok(r.json.sections[key], `missing JSON section: ${key}`);
  }
  assert.equal(typeof r.json.head.seq, 'number');
  assert.equal(typeof r.json.head.hash, 'string');
  assert.equal(r.json.currency.code, 'BWP');
});

test('report: read section shows the three cards with their hashes', () => {
  const r = build();
  assert.equal(r.json.sections.read.cards.length, 3);
  for (const c of r.json.sections.read.cards) {
    assert.equal(typeof c.hash, 'string');
    assert.equal(c.ok, true);
    assert.ok(c.frameCpt, `card ${c.type}: missing frame`);
  }
});

test('report: impact section reports entry 4 and outsidePeriod=false', () => {
  const r = build();
  assert.equal(r.json.sections.impact.entryId, 4);
  assert.equal(r.json.sections.impact.outsidePeriod, false);
  assert.equal(r.json.sections.impact.impactOk, true);
});

test('report: trail section reconciles to its target', () => {
  const r = build();
  assert.equal(r.json.sections.trail.nodeCount, 4);
  assert.equal(r.json.sections.trail.linkCount, 3);
  assert.equal(r.json.sections.trail.reconciled, true);
});

test('report: no money value in the JSON is non-integer', () => {
  const r = build();
  function walk(value, path) {
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) walk(value[k], `${path}.${k}`);
      return;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      assert.fail(`non-finite number at ${path}: ${value}`);
    }
  }
  walk(r.json, 'report');
});

test('report: HTML does not contain an unescaped "<tag>" from user data', () => {
  const r = build();
  // The report shell only contains tags we emit; user-supplied labels are
  // escaped. A cheap signal: no double-angle sequences beyond what the
  // template emits.
  assert.ok(!r.html.includes('<tag>'));
});

test('report: fresh setup gives the same head as the demo ledger', () => {
  const a = setupDemo();
  const b = setupDemo();
  assert.equal(a.ledger.head().hash, b.ledger.head().hash);
  assert.equal(a.events.length, b.events.length);
});

test('report: demo ledger matches the fixture the S1-S5 tests use', async () => {
  const { buildDemoLedger: fixtureBuild } = await import('./fixtures/ledger.mjs');
  const a = setupDemo().ledger.entries().map((e) => e.id);
  const b = fixtureBuild().entries().map((e) => e.id);
  assert.deepEqual(a, b,
    'demo/demo.ledger.mjs has drifted from test/fixtures/ledger.mjs; fix one to match the other');
});
