// Thin fetch wrappers for the server API. Every call goes to a relative
// `/api/...` path, so the same code works in dev (Vite proxies to
// 127.0.0.1:4000) and in production (the node server serves both the
// client and the API). No absolute URLs, no external hosts.
//
// Errors are raised as ApiError with `status`, `code` and `message` so the
// UI can distinguish "user must fix something" (400 + BAD_ENTRY) from
// "server is broken" (500 + INTERNAL).
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const opts = { method, headers: { accept: 'application/json' } };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new ApiError(0, 'NETWORK', `network error: ${e.message}`);
  }
  const text = await res.text();
  let data;
  try { data = text === '' ? undefined : JSON.parse(text); }
  catch { data = { _raw: text }; }
  if (!res.ok) {
    const code = (data && data.code) || 'HTTP_' + res.status;
    const message = (data && data.error) || `HTTP ${res.status}`;
    throw new ApiError(res.status, code, message);
  }
  return data;
}

export const api = {
  health:       () => request('GET', '/api/health'),
  head:         () => request('GET', '/api/head'),
  accounts:     () => request('GET', '/api/accounts'),
  cards:        (params) => request('GET', '/api/cards?' + new URLSearchParams(params)),
  plan:         (body) => request('POST', '/api/plan', body),
  command:      (text, context) => request('POST', '/api/command', { text, context }),
  postEntry:    (draft) => request('POST', '/api/entries', draft),
  reverseEntry: (seq, { date, memo }) =>
    request('POST', `/api/entries/${encodeURIComponent(seq)}/reverse`, { date, memo }),
  events:       (params) => request('GET', '/api/events?' + new URLSearchParams(params)),
  eventsStats:  (params) => request('GET', '/api/events/stats?' + new URLSearchParams(params)),
  listTrails:   () => request('GET', '/api/trails'),
  readTrail:    (id) => request('GET', `/api/trails/${encodeURIComponent(id)}`),
  saveTrail:    (trail) => request('PUT', '/api/trails', trail),
  verify:       () => request('POST', '/api/verify'),
  strip:        (params) => request('GET', '/api/strip?' + new URLSearchParams(params)),
};

// Open a Server-Sent Events stream. `onEvent` is called for each event;
// `onError` for a stream failure; `onOpen` once the initial `: stream open`
// comment has been seen. Returns a close() function.
export function openEventStream({ onEvent, onError, onOpen }) {
  const es = new EventSource('/api/stream');
  let opened = false;
  es.addEventListener('message', () => { /* SSE default event; we only use named */ });
  // EventSource cannot subscribe to arbitrary event names via one listener;
  // we listen to each type the server can emit. If a new type is added in a
  // future stage, it will not show up here without adding it to this list.
  const TYPES = [
    'entry.posted', 'entry.reversed', 'journal.verified',
    'request.received', 'card.opened', 'card.closed',
    'mode.changed', 'period.changed', 'draft.previewed',
    'card.hit', 'card.miss', 'card.built',
    'impact.computed', 'check.failed',
    'trail.node.added', 'trail.link.added', 'trail.saved',
    'space.premeasured', 'space.laid_out', 'space.reconciled',
    'space.degraded', 'space.rejected', 'space.violation', 'space.fallback',
    'attention.shifted', 'attention.input_begin', 'attention.input_end',
    'attention.transfer_armed', 'attention.transfer_pasted',
    'attention.transfer_cancelled', 'attention.rejected',
    'attention.pointer_ignored', 'attention.fallback',
  ];
  for (const type of TYPES) {
    es.addEventListener(type, (evt) => {
      if (!opened) { opened = true; onOpen && onOpen(); }
      try { onEvent(JSON.parse(evt.data)); }
      catch (e) { onError && onError(e); }
    });
  }
  es.onerror = (e) => { onError && onError(e); };
  return () => es.close();
}
