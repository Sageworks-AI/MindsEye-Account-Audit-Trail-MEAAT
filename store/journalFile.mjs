// JSON-lines journal adapter. One entry per line, LF-terminated, flushed and
// fsync'd per append so a power loss leaves at most a truncated last line —
// which is caught on reopen. Never rewrites the file; corrupt files are
// refused rather than repaired. On successful load, every stored entry has
// been replayed through a fresh Ledger whose ids must match byte-for-byte.
import {
  readFileSync, writeFileSync, appendFileSync, openSync, writeSync, fsyncSync,
  closeSync, existsSync, mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { Ledger } from '../core/ledger.mjs';
import { DEFAULT_CURRENCY } from '../core/money.mjs';

function serializeEntry(e) {
  const obj = {
    seq: e.seq, id: e.id, prevHash: e.prevHash,
    date: e.date, memo: e.memo, lines: e.lines,
  };
  if (e.reverses !== undefined) obj.reverses = e.reverses;
  if (e.refs !== undefined) obj.refs = e.refs;
  return obj;
}

function parseEntries(raw, path) {
  if (raw === '') return [];
  // A well-formed append always ends in '\n'. Anything else indicates a
  // crash mid-write. Reject rather than repair so the caller knows.
  if (!raw.endsWith('\n')) {
    throw new Error(
      `${path}: truncated last line (file does not end in newline; was a write interrupted?)`);
  }
  const lines = raw.slice(0, -1).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    try { out.push(JSON.parse(lines[i])); }
    catch (e) {
      throw new Error(`${path}: corrupt line ${i + 1}: ${e.message}`);
    }
  }
  return out;
}

export function openJournalFile(path, { accounts, currency = DEFAULT_CURRENCY } = {}) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) writeFileSync(path, '', 'utf8');

  const raw = readFileSync(path, 'utf8');
  const stored = parseEntries(raw, path);

  const ledger = new Ledger({ accounts, currency });
  for (let i = 0; i < stored.length; i++) {
    const s = stored[i];
    let replayed;
    try {
      if (s.reverses !== undefined) {
        replayed = ledger.reverse(s.reverses, { date: s.date, memo: s.memo });
      } else {
        replayed = ledger.post({
          date: s.date, memo: s.memo, lines: s.lines,
          ...(s.refs !== undefined ? { refs: s.refs } : {}),
        });
      }
    } catch (e) {
      throw new Error(`${path}: chain broken at seq ${s.seq} (line ${i + 1}): ${e.message}`);
    }
    if (replayed.seq !== s.seq) {
      throw new Error(`${path}: chain broken at line ${i + 1}: seq ${s.seq} expected but replayed ${replayed.seq}`);
    }
    if (replayed.prevHash !== s.prevHash) {
      throw new Error(`${path}: chain broken at seq ${s.seq} (line ${i + 1}): prevHash mismatch`);
    }
    if (replayed.id !== s.id) {
      throw new Error(`${path}: chain broken at seq ${s.seq} (line ${i + 1}): id mismatch (tampered)`);
    }
  }

  const fd = openSync(path, 'a');
  let closed = false;

  return {
    get ledger() { return ledger; },
    get path() { return path; },
    append(entry) {
      if (closed) throw new Error('journal closed');
      const head = ledger.head();
      if (entry.id !== head.hash) {
        throw new Error('append() called with an entry that is not the current head');
      }
      writeSync(fd, JSON.stringify(serializeEntry(entry)) + '\n');
      fsyncSync(fd);
    },
    readAll() {
      return parseEntries(readFileSync(path, 'utf8'), path);
    },
    verify() { return ledger.verify(); },
    close() {
      if (closed) return;
      closed = true;
      try { fsyncSync(fd); } catch {}
      try { closeSync(fd); } catch {}
    },
  };
}
