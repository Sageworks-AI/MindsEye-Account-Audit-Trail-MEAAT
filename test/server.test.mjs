// Server integration tests. Each test starts its own server on port 0 in a
// temporary data directory and closes it (force-closing SSE connections) in
// a finally block. No state leaks between tests.
//
// These tests cover: health, head, accounts, entry posting (and journal
// persistence), rejection of bad entries, cards (with and without impact),
// plan, command, events, verify, SSE, 404, production-mode static file
// serving, and the invariant that the server's DEMO_ACCOUNTS matches
// test/fixtures/ledger.mjs so drift is caught.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/index.mjs';
import { DEMO_ACCOUNTS } from '../server/config.mjs';

async function withServer(fn, opts = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'meaat-server-'));
  const built = createServer({ dataDir, production: false, ...opts });
  await new Promise((r) => built.server.listen(0, '127.0.0.1', r));
  const port = built.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    return await fn({ base, dataDir, ...built });
  } finally {
    try { await built.close(); } catch {}
    try { await rm(dataDir, { recursive: true, force: true }); } catch {}
  }
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

const CAPITAL = {
  date: '2026-01-05', memo: 'Owner capital',
  lines: [
    { account: '1000', debit: 100000 },
    { account: '3000', credit: 100000 },
  ],
};

test('server: DEMO_ACCOUNTS matches the fixture used by S1-S5 tests', async () => {
  const { DEMO_ACCOUNTS: fixture } = await import('./fixtures/ledger.mjs');
  assert.equal(
    JSON.stringify(DEMO_ACCOUNTS.map((a) => ({ ...a }))),
    JSON.stringify(fixture.map((a) => ({ ...a }))),
    'server/config.mjs DEMO_ACCOUNTS drifted from test/fixtures/ledger.mjs',
  );
});

test('server: GET /api/health reports an empty journal on a fresh data dir', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.ok, true);
    assert.equal(body.head.seq, 0);
    assert.equal(body.journalSize, 0);
    assert.equal(body.accounts, 8);
    assert.equal(body.eventCount, 0);
  });
});

test('server: GET /api/accounts returns the chart', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/accounts`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.accounts.length, 8);
    const cash = body.accounts.find((a) => a.code === '1000');
    assert.equal(cash.cash, true);
  });
});

test('server: POST /api/entries appends and persists to journal.jsonl', async () => {
  await withServer(async ({ base, dataDir }) => {
    const res = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CAPITAL),
    });
    assert.equal(res.status, 201);
    const body = await json(res);
    assert.equal(body.entry.seq, 1);
    assert.equal(body.entry.lines.length, 2);
    const raw = await readFile(join(dataDir, 'journal.jsonl'), 'utf8');
    assert.match(raw, /"seq":1/);
    // Head reflects the new entry.
    const h = await json(await fetch(`${base}/api/head`));
    assert.equal(h.seq, 1);
    assert.equal(h.hash, body.entry.id);
  });
});

test('server: POST /api/entries rejects an unbalanced entry', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: '2026-01-05', memo: 'bad',
        lines: [
          { account: '1000', debit: 1000 },
          { account: '3000', credit: 999 },
        ],
      }),
    });
    assert.equal(res.status, 400);
    const body = await json(res);
    assert.equal(body.code, 'BAD_ENTRY');
    assert.match(body.error, /unbalanced/);
  });
});

test('server: POST /api/entries rejects a fake date', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...CAPITAL, date: '2026-02-31' }),
    });
    assert.equal(res.status, 400);
    const body = await json(res);
    assert.match(body.error, /real calendar date/);
  });
});

test('server: POST /api/entries/:seq/reverse posts a mirror', async () => {
  await withServer(async ({ base }) => {
    const posted = await json(await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CAPITAL),
    }));
    const res = await fetch(`${base}/api/entries/1/reverse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-01-06', memo: 'reverse' }),
    });
    assert.equal(res.status, 201);
    const body = await json(res);
    assert.equal(body.entry.reverses, 1);
    assert.equal(body.entry.seq, 2);
  });
});

test('server: GET /api/cards returns a balance sheet card', async () => {
  await withServer(async ({ base }) => {
    await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CAPITAL),
    });
    const res = await fetch(`${base}/api/cards?types=balance_sheet&asOf=2026-12-31`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.cards.length, 1);
    assert.equal(body.cards[0].type, 'balance_sheet');
    assert.equal(body.cards[0].cacheState, 'miss');
    assert.equal(body.cards[0].card.ok, true);
  });
});

test('server: GET /api/cards hits the cache on the second call', async () => {
  await withServer(async ({ base }) => {
    await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CAPITAL),
    });
    const url = `${base}/api/cards?types=balance_sheet&asOf=2026-12-31`;
    await fetch(url);
    const r2 = await json(await fetch(url));
    assert.equal(r2.cards[0].cacheState, 'hit');
  });
});

test('server: POST /api/command returns the interpreted request', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'open balance sheet and cash flow for 2026-01-01 to 2026-03-31',
      }),
    });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.ok, true);
    assert.equal(body.request.cards.length, 2);
  });
});

test('server: POST /api/command never posts an entry', async () => {
  await withServer(async ({ base }) => {
    await fetch(`${base}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'receipt 3' }),
    });
    const h = await json(await fetch(`${base}/api/head`));
    assert.equal(h.seq, 0, 'command must not have posted anything');
  });
});

test('server: POST /api/plan returns a plan with cacheKey and rects', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request: {
          cards: [{ type: 'balance_sheet', params: {} }],
          period: { from: '2026-01-01', to: '2026-03-31' },
          mode: 'read',
        },
        viewport: { w: 1280, h: 720 },
      }),
    });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.ok(body.plan);
    assert.equal(body.plan.cards.length, 1);
    assert.match(body.plan.cards[0].cacheKey, /^[0-9a-f]{24}$/);
  });
});

test('server: GET /api/events returns entry.posted after posting', async () => {
  await withServer(async ({ base }) => {
    await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CAPITAL),
    });
    const res = await fetch(`${base}/api/events?since=0&limit=100`);
    assert.equal(res.status, 200);
    const body = await json(res);
    const posted = body.events.find((e) => e.type === 'entry.posted');
    assert.ok(posted);
    assert.equal(posted.lane, 'journal');
  });
});

test('server: GET /api/events/stats returns per-lane totals', async () => {
  await withServer(async ({ base }) => {
    await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CAPITAL),
    });
    const res = await fetch(`${base}/api/events/stats?bucket=minute&minutes=60`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.ok(body.totals.journal >= 1);
  });
});

test('server: POST /api/verify succeeds on an empty chain', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/verify`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.ok, true);
  });
});

test('server: SSE stream opens and pushes entry.posted', async () => {
  await withServer(async ({ base }) => {
    const ac = new AbortController();
    try {
      const res = await fetch(`${base}/api/stream`, { signal: ac.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
      const reader = res.body.getReader();
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /stream open/);
      await fetch(`${base}/api/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(CAPITAL),
      });
      const second = await reader.read();
      assert.match(new TextDecoder().decode(second.value), /event: entry\.posted/);
    } finally {
      ac.abort();
    }
  });
});

test('server: unknown API path returns 404 JSON', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
    const body = await json(res);
    assert.equal(body.code, 'NOT_FOUND');
  });
});

test('server: GET /api/strip returns figures for a range', async () => {
  await withServer(async ({ base }) => {
    await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CAPITAL),
    });
    const res = await fetch(`${base}/api/strip?types=cash_flow&from=2026-01-01&to=2026-12-31`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.ok(body.strip);
    assert.equal(body.strip.figures.length, 1);
    assert.equal(body.strip.figures[0].label, 'Cash');
  });
});

test('server: production mode serves app/dist/index.html at /', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'meaat-server-static-'));
  const staticDir = await mkdtemp(join(tmpdir(), 'meaat-static-'));
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
  const built = createServer({ dataDir, production: true, staticDir });
  await new Promise((r) => built.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${built.server.address().port}`;
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>app<\/title>/);
    // API routes still take priority over static fallback.
    const api = await fetch(`${base}/api/health`);
    assert.equal(api.status, 200);
  } finally {
    try { await built.close(); } catch {}
    await rm(dataDir, { recursive: true, force: true });
    await rm(staticDir, { recursive: true, force: true });
  }
});

test('server: production mode with no app/dist returns a helpful 503', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'meaat-server-nodist-'));
  const staticDir = join(dataDir, 'app-dist-does-not-exist');
  const built = createServer({ dataDir, production: true, staticDir });
  await new Promise((r) => built.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${built.server.address().port}`;
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /npm run build/);
  } finally {
    try { await built.close(); } catch {}
    await rm(dataDir, { recursive: true, force: true });
  }
});
