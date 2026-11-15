// `scripts/stages.json` is the constancy guard for the stage list. It must
// stay byte-for-byte consistent (id, title, state) with the README's
// `## Status by stage` table. A stage added to one without the other fails
// here, not silently in a README reader's head.
//
// State normalisation: the README uses `**done**` and
// `**sources done, wasm pending local build**`; the JSON uses the same
// wording without asterisks. Leading and trailing `*` characters are
// stripped before comparison.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function normaliseState(s) {
  return s.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

function parseReadmeTable(md) {
  const start = md.indexOf('## Status by stage');
  if (start < 0) return null;
  const after = md.slice(start);
  const rows = [];
  for (const m of after.matchAll(/^\| (S\d+) \| (.+?) \| (.+?) \|$/gm)) {
    rows.push({
      id: m[1],
      title: m[2].trim(),
      state: normaliseState(m[3]),
    });
  }
  return rows;
}

test('stages: stages.json exists and is valid JSON', () => {
  const raw = readFileSync(join(ROOT, 'scripts', 'stages.json'), 'utf8');
  const data = JSON.parse(raw);
  assert.equal(data.version, 1);
  assert.ok(Array.isArray(data.stages));
  assert.ok(data.stages.length >= 15, `only ${data.stages.length} stages listed`);
});

test('stages: ids are sequential S0..S14 with no gaps or duplicates', () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'scripts', 'stages.json'), 'utf8'));
  const ids = data.stages.map((s) => s.id);
  const expected = Array.from({ length: 15 }, (_, i) => `S${i}`);
  assert.deepEqual(ids, expected);
});

test('stages: every entry has a non-empty title and a known state', () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'scripts', 'stages.json'), 'utf8'));
  const known = new Set([
    'done', 'stabilising', 'sources done, wasm pending local build', 'pending',
  ]);
  for (const s of data.stages) {
    assert.ok(s.title && typeof s.title === 'string', `${s.id}: missing title`);
    assert.ok(known.has(s.state), `${s.id}: unknown state "${s.state}"`);
  }
});

test('stages: stages.json matches the README status table', () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'scripts', 'stages.json'), 'utf8'));
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const readmeRows = parseReadmeTable(readme);
  assert.ok(readmeRows && readmeRows.length > 0,
    'README has no "## Status by stage" table or it is empty');
  assert.equal(readmeRows.length, data.stages.length,
    `README lists ${readmeRows.length} stages, stages.json lists ${data.stages.length}`);
  for (let i = 0; i < data.stages.length; i++) {
    const a = data.stages[i];
    const b = readmeRows[i];
    assert.equal(b.id, a.id, `row ${i}: id ${b.id} != ${a.id}`);
    // Titles can drift cosmetically (backticks, spacing); compare the words.
    const aWords = a.title.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
    const bWords = b.title.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
    assert.equal(bWords, aWords, `${a.id}: title "${bWords}" != "${aWords}"`);
    assert.equal(b.state, a.state, `${a.id}: state "${b.state}" != "${a.state}"`);
  }
});
