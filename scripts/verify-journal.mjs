#!/usr/bin/env node
// Verifies data/journal.jsonl end-to-end. Reads the file, replays every
// entry through a fresh Ledger, and reports the first broken seq with the
// line number and reason. Exits non-zero on any failure. Also writes
// `journal.verified` to events.jsonl so the Sequencer records the run.
//
// Usage: node scripts/verify-journal.mjs [--data DIR] [--quiet]
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJournalFile } from '../store/journalFile.mjs';
import { openEventLog } from '../sequencer/log.mjs';
import { DEMO_ACCOUNTS } from '../test/fixtures/ledger.mjs';

function parseArgs(argv) {
  const out = { dataDir: process.env.DATA_DIR || './data', quiet: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--data' && argv[i + 1]) { out.dataDir = argv[++i]; }
    else if (argv[i] === '--quiet') { out.quiet = true; }
  }
  return out;
}

async function main() {
  const { dataDir, quiet } = parseArgs(process.argv);
  const journalPath = resolve(dataDir, 'journal.jsonl');
  const eventsPath = resolve(dataDir, 'events.jsonl');
  if (!existsSync(journalPath)) {
    console.error(`verify-journal: no journal at ${journalPath}`);
    process.exit(2);
  }

  let handle;
  try {
    handle = openJournalFile(journalPath, { accounts: DEMO_ACCOUNTS });
  } catch (e) {
    console.error(`verify-journal: FAILED — ${e.message}`);
    process.exit(1);
  }

  const result = handle.verify();
  const head = handle.ledger.head();
  handle.close();

  let eventLog = null;
  try {
    eventLog = openEventLog(eventsPath);
    eventLog.append({
      type: 'journal.verified',
      source: 'scripts/verify-journal',
      ref: { seq: head.seq },
      tags: result.ok ? ['ok'] : ['fail', result.reason || 'unknown'],
    });
  } catch {
    // event logging is advisory; a verify pass should not fail on it.
  } finally {
    if (eventLog) eventLog.close();
  }

  if (!result.ok) {
    console.error(`verify-journal: FAILED at seq ${result.firstBroken}: ${result.reason}`);
    process.exit(1);
  }
  if (!quiet) {
    console.log(`verify-journal: OK (head seq ${head.seq}, hash ${head.hash.slice(0, 12)})`);
  }
}

const isMain = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main().catch((e) => { console.error(`verify-journal: ERROR — ${e.message}`); process.exit(2); });
