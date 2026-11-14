// JSON error responses. Every error is `{ error: <message>, code: <CODE> }`
// so a client can distinguish "user-facing validation error" (400 + code
// BAD_ENTRY, BAD_REVERSAL, etc.) from "unexpected" (500 + INTERNAL). Never
// leak stack traces to the client; log the message (not the stack) to the
// server console for debugging.
export function jsonError(res, status, code, message) {
  if (res.headersSent) return;
  const body = JSON.stringify({ error: String(message), code: String(code) });
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function jsonResponse(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

export function notFound(req, res) {
  jsonError(res, 404, 'NOT_FOUND', `no route for ${req.method} ${req.url}`);
}

export function methodNotAllowed(req, res, allow) {
  if (res.headersSent) return;
  res.setHeader('allow', allow.join(', '));
  jsonError(res, 405, 'METHOD_NOT_ALLOWED', `method ${req.method} not allowed`);
}

export function errorHandler(err, req, res) {
  // The client never sees a stack or an internal path. The message is
  // logged to the console so a developer watching the terminal can debug.
  const msg = (err && err.message) || 'unknown';
  console.error(`[server] ${req.method} ${req.url}: ${msg}`);
  jsonError(res, 500, 'INTERNAL', 'internal error');
}
