// Trails are JSON files in a directory (data/trails). Writing is atomic:
// write to a temp file then rename, so a crash mid-save leaves the previous
// version intact. The caller validates trail shape; this module only does
// I/O. Listing is sorted for deterministic tests.
import {
  readFileSync, writeFileSync, renameSync, unlinkSync,
  existsSync, mkdirSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';

const ID_RE = /^[A-Za-z0-9_\-]{1,80}$/;

function checkId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`invalid trail id: ${String(id)}`);
  }
  return id;
}

export function createTrailStore(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  function filePath(id) { return join(dir, `${id}.json`); }

  return {
    dir,
    list() {
      return readdirSync(dir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.slice(0, -5))
        .sort();
    },
    exists(id) { return existsSync(filePath(checkId(id))); },
    read(id) {
      const raw = readFileSync(filePath(checkId(id)), 'utf8');
      return JSON.parse(raw);
    },
    write(trail) {
      if (!trail || typeof trail !== 'object') throw new Error('trail must be an object');
      checkId(trail.id);
      const path = filePath(trail.id);
      const tmp = `${path}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(trail), 'utf8');
      renameSync(tmp, path);
    },
    delete(id) {
      const path = filePath(checkId(id));
      if (!existsSync(path)) return false;
      unlinkSync(path);
      return true;
    },
  };
}
