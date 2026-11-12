// Append-only event log at data/events.jsonl. Same crash-safety model as the
// journal: one line per event, LF-terminated, fsync'd per append. Truncated
// or corrupt files are refused rather than repaired. Ids are assigned by the
// log as a monotonic positive integer so a reader can tail with `since`.
import {
  readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync,
  existsSync, mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { makeEvent } from './events.mjs';

function parseEvents(raw, path) {
  if (raw === '') return [];
  if (!raw.endsWith('\n')) {
    throw new Error(`${path}: truncated last line (was a write interrupted?)`);
  }
  const lines = raw.slice(0, -1).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    try { out.push(JSON.parse(lines[i])); }
    catch (e) { throw new Error(`${path}: corrupt line ${i + 1}: ${e.message}`); }
  }
  return out;
}

export function openEventLog(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) writeFileSync(path, '', 'utf8');

  const existing = parseEvents(readFileSync(path, 'utf8'), path);
  let next = existing.length + 1;

  const fd = openSync(path, 'a');
  let closed = false;

  return {
    get path() { return path; },
    append({ type, source, ref, amount, tags, note, ts }) {
      if (closed) throw new Error('event log closed');
      const id = next;
      next += 1;
      const event = makeEvent({ id, type, source, ref, amount, tags, note, ts });
      writeSync(fd, JSON.stringify(event) + '\n');
      fsyncSync(fd);
      return event;
    },
    readAll() { return parseEvents(readFileSync(path, 'utf8'), path); },
    tail(n) {
      const all = this.readAll();
      return all.slice(Math.max(0, all.length - n));
    },
    get count() { return next - 1; },
    close() {
      if (closed) return;
      closed = true;
      try { fsyncSync(fd); } catch {}
      try { closeSync(fd); } catch {}
    },
  };
}
