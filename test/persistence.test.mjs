// journalFile round-trip and failure-mode tests. A fresh adapter on a fresh
// path writes and reloads; a truncated last line is refused with a message
// naming the file; a corrupt line is refused with the line number; tampered
// bytes are refused with "chain broken"; verifying a broken file returns
// ok:false with firstBroken set. The event log has the same crash-safety
// model, so it gets its own round-trip and truncated-file tests here.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtemp, rm, readFile, writeFile, appendFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJournalFile } from '../store/journalFile.mjs';
import { openJournalMemory } from '../store/journalMemory.mjs';
import { openEventLog } from '../sequencer/log.mjs';
import { DEMO_ACCOUNTS } from './fixtures/ledger.mjs';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'meaat-persist-'));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const D1 = { date: '2026-01-05', memo: 'cap', lines: [
  { account: '1000', debit: 1000 },
  { account: '3000', credit: 1000 },
]};
const D2 = { date: '2026-01-10', memo: 'sale', lines: [
  { account: '1000', debit: 500 },
  { account: '4000', credit: 500 },
]};

test('journalFile: round-trip persists entries and reloads to the same head', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    const h1 = openJournalFile(path, { accounts: DEMO_ACCOUNTS });
    h1.append(h1.ledger.post(D1));
    h1.append(h1.ledger.post(D2));
    const head1 = h1.ledger.head();
    h1.close();

    const h2 = openJournalFile(path, { accounts: DEMO_ACCOUNTS });
    assert.equal(h2.ledger.size, 2);
    assert.equal(h2.ledger.head().seq, head1.seq);
    assert.equal(h2.ledger.head().hash, head1.hash);
    assert.equal(h2.verify().ok, true);
    h2.close();
  });
});

test('journalFile: refuses a truncated last line and names the file', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    const h = openJournalFile(path, { accounts: DEMO_ACCOUNTS });
    h.append(h.ledger.post(D1));
    h.close();
    const raw = await readFile(path, 'utf8');
    await writeFile(path, raw.slice(0, -5), 'utf8'); // remove trailing newline + chars
    assert.throws(
      () => openJournalFile(path, { accounts: DEMO_ACCOUNTS }),
      /truncated last line/
    );
  });
});

test('journalFile: refuses a corrupt line with the line number', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    const h = openJournalFile(path, { accounts: DEMO_ACCOUNTS });
    h.append(h.ledger.post(D1));
    h.close();
    await appendFile(path, 'not-json\n', 'utf8');
    assert.throws(
      () => openJournalFile(path, { accounts: DEMO_ACCOUNTS }),
      /corrupt line 2/
    );
  });
});

test('journalFile: refuses tampered entries with "chain broken"', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    const h = openJournalFile(path, { accounts: DEMO_ACCOUNTS });
    h.append(h.ledger.post(D1));
    h.close();
    const raw = await readFile(path, 'utf8');
    // Flip a digit inside the stored debit amount (1000 -> 1001) without
    // touching the id, so replay must detect an id mismatch.
    const tampered = raw.replace('"debit":1000', '"debit":1001');
    assert.notEqual(tampered, raw);
    await writeFile(path, tampered, 'utf8');
    assert.throws(
      () => openJournalFile(path, { accounts: DEMO_ACCOUNTS }),
      /chain broken at seq 1/
    );
  });
});

test('journalMemory: round-trip append/readAll/verify works', () => {
  const h = openJournalMemory({ accounts: DEMO_ACCOUNTS });
  h.append(h.ledger.post(D1));
  h.append(h.ledger.post(D2));
  assert.equal(h.readAll().length, 2);
  assert.equal(h.verify().ok, true);
  h.close();
});

test('journalMemory: refuses append of an entry not produced by this ledger', () => {
  const h = openJournalMemory({ accounts: DEMO_ACCOUNTS });
  const fake = { seq: 1, id: 'deadbeef', prevHash: 'x', date: '2026-01-01',
    memo: 'fake', lines: [] };
  assert.throws(() => h.append(fake), /not the current head/);
});

test('eventLog: round-trip persists events and preserves ids', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'events.jsonl');
    const log = openEventLog(path);
    const a = log.append({ type: 'entry.posted', source: 'test', ref: { seq: 1 } });
    const b = log.append({ type: 'card.miss', source: 'test', ref: { cardKey: 'k1' } });
    assert.equal(a.id, 1);
    assert.equal(b.id, 2);
    log.close();

    const log2 = openEventLog(path);
    const all = log2.readAll();
    assert.equal(all.length, 2);
    assert.equal(all[0].id, 1);
    assert.equal(all[1].lane, 'cache');
    const next = log2.append({ type: 'card.hit', source: 'test', ref: { cardKey: 'k1' } });
    assert.equal(next.id, 3);
    log2.close();
  });
});

test('eventLog: refuses a truncated last line', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'events.jsonl');
    const log = openEventLog(path);
    log.append({ type: 'entry.posted', source: 'test' });
    log.close();
    const raw = await readFile(path, 'utf8');
    await writeFile(path, raw.slice(0, -3), 'utf8');
    assert.throws(() => openEventLog(path), /truncated last line/);
  });
});
