// The node:http server. Binds 127.0.0.1 by default (see README #73 for the
// no-authentication warning). Serves /api/* through the tiny router, and in
// production mode also serves the built client from app/dist. SSE stream at
// /api/stream. Writes data/journal.jsonl and data/events.jsonl on append.
//
// Usage:
//   node server/index.mjs                        # dev: API only, port 4000
//   node server/index.mjs --port 5000            # dev on another port
//   node server/index.mjs --production           # serve app/dist too
//   node server/index.mjs --data /tmp/data       # override DATA_DIR
//
// The `createServer` factory (below) is what test/server.test.mjs uses; the
// main() entry point only parses argv, starts a server, and installs signal
// handlers. No behaviour lives in main() that a test cannot exercise.
import { createServer as httpCreateServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openJournalFile } from '../store/journalFile.mjs';
import { openEventLog } from '../sequencer/log.mjs';
import { CardStore } from '../store/cardStore.mjs';
import { createTrailStore } from '../store/trailStore.mjs';
import { makeStream } from './sse.mjs';
import { makeRouter } from './router.mjs';
import { jsonError, methodNotAllowed, notFound, errorHandler } from './errors.mjs';
import { tryServeStatic } from './static.mjs';
import {
  DEFAULT_PORT, DEFAULT_HOST, DEFAULT_DATA_DIR, DEMO_ACCOUNTS,
} from './config.mjs';
import { health } from './routes/health.mjs';
import { head as headRoute } from './routes/head.mjs';
import { accounts as accountsRoute } from './routes/accounts.mjs';
import { postEntry, postReverse } from './routes/entries.mjs';
import { cards as cardsRoute } from './routes/cards.mjs';
import { postPlan } from './routes/plan.mjs';
import { postCommand } from './routes/command.mjs';
import { events as eventsRoute, eventsStats } from './routes/events.mjs';
import { listTrails, getTrail, putTrail } from './routes/trails.mjs';
import { verify as verifyRoute } from './routes/verify.mjs';
import { strip as stripRoute } from './routes/strip.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export function createServer(opts = {}) {
  const dataDir = opts.dataDir || DEFAULT_DATA_DIR;
  const production = opts.production === true;
  const staticDir = opts.staticDir || join(ROOT, 'app', 'dist');
  const accounts = opts.accounts || DEMO_ACCOUNTS;

  const journalPath = join(dataDir, 'journal.jsonl');
  const eventsPath = join(dataDir, 'events.jsonl');
  const trailsDir = join(dataDir, 'trails');

  // Fail fast on a corrupt journal. The base spec: on startup, load every
  // line, verify the hash chain, and refuse to run on a broken chain naming
  // the first bad seq and line number. journalFile.open does that already.
  let journal;
  try {
    journal = openJournalFile(journalPath, { accounts });
  } catch (e) {
    console.error(`server: cannot open journal at ${journalPath}: ${e.message}`);
    throw e;
  }
  const events = openEventLog(eventsPath);
  const trails = createTrailStore(trailsDir);
  const stream = makeStream();

  const cards = new CardStore({
    maxEntries: 200,
    onEvent: (e) => {
      const event = events.append({
        type: e.type, source: 'server',
        ref: e.cardKey ? { cardKey: e.cardKey } : {},
        tags: [],
      });
      stream.push(event);
    },
  });

  const ctx = {
    ledger: journal.ledger,
    journal,
    events,
    cards,
    trails,
    dataDir,
    emit(evt) {
      const event = events.append({ source: 'server', ...evt });
      stream.push(event);
      return event;
    },
  };

  const router = makeRouter();
  router.get('/api/health', (req, res) => health(req, res, ctx));
  router.get('/api/head', (req, res) => headRoute(req, res, ctx));
  router.get('/api/accounts', (req, res) => accountsRoute(req, res, ctx));
  router.post('/api/entries', (req, res) => postEntry(req, res, ctx));
  router.post('/api/entries/:seq/reverse', (req, res) => postReverse(req, res, ctx));
  router.get('/api/cards', (req, res) => cardsRoute(req, res, ctx));
  router.post('/api/plan', (req, res) => postPlan(req, res, ctx));
  router.post('/api/command', (req, res) => postCommand(req, res, ctx));
  router.get('/api/events', (req, res) => eventsRoute(req, res, ctx));
  router.get('/api/events/stats', (req, res) => eventsStats(req, res, ctx));
  router.get('/api/trails', (req, res) => listTrails(req, res, ctx));
  router.get('/api/trails/:id', (req, res) => getTrail(req, res, ctx));
  router.put('/api/trails', (req, res) => putTrail(req, res, ctx));
  router.post('/api/verify', (req, res) => verifyRoute(req, res, ctx));
  router.get('/api/strip', (req, res) => stripRoute(req, res, ctx));
  router.get('/api/stream', (req, res) => stream.handle(req, res));

  const server = httpCreateServer(async (req, res) => {
    try {
      const matched = await router.handle(req, res);
      if (matched === true) return;
      if (matched === 'method') {
        return jsonError(res, 405, 'METHOD_NOT_ALLOWED',
          `method ${req.method} not allowed for ${req.url}`);
      }
      if (production) {
        const url = new URL(req.url, 'http://localhost');
        const served = await tryServeStatic(req, res, staticDir, url.pathname);
        if (served) return;
      }
      notFound(req, res);
    } catch (err) {
      errorHandler(err, req, res);
    }
  });

  async function close() {
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    });
    try { journal.close(); } catch {}
    try { events.close(); } catch {}
  }

  return { server, ctx, close, stream };
}

// ----- CLI entry point (not exercised by tests) -----

function parseArgs(argv) {
  const out = {
    port: undefined, host: undefined, dataDir: undefined,
    production: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--production') { out.production = true; continue; }
    if (arg === '--port') { out.port = Number(argv[++i]); continue; }
    if (arg === '--host') { out.host = argv[++i]; continue; }
    if (arg === '--data') { out.dataDir = argv[++i]; continue; }
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`server: ${e.message}`); process.exit(2); }
  if (opts.help) {
    console.log('usage: node server/index.mjs [--port N] [--host H] [--data DIR] [--production]');
    process.exit(0);
  }
  const envPort = process.env.PORT !== undefined ? Number(process.env.PORT) : undefined;
  const port = opts.port ?? (Number.isSafeInteger(envPort) ? envPort : DEFAULT_PORT);
  const host = opts.host || DEFAULT_HOST;
  const dataDir = opts.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR;

  let created;
  try {
    created = createServer({ dataDir, production: opts.production });
  } catch (e) {
    console.error(`server: startup failed: ${e.message}`);
    process.exit(1);
  }
  const { server, close } = created;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address();
  const mode = opts.production ? 'production' : 'dev';
  console.log(`server: listening on http://${addr.address}:${addr.port} (${mode}, data ${dataDir})`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`server: ${signal} received, shutting down`);
    try { await close(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((e) => { console.error(`server: fatal: ${e.message}`); process.exit(1); });
