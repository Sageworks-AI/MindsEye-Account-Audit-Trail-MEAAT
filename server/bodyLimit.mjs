// Bounded JSON body reader. Resolves to { ok: true, value } on success, or
// { ok: false, status, code, message } on failure. The caller writes the
// error response (jsonError) so this module has no dependency on the router
// or the response format.
//
// The size limit applies to the raw byte count before parsing, so a huge
// body is rejected even if the JSON parser might have choked on it later.
// `req.destroy()` closes the socket once the limit is exceeded so a slow
// client cannot keep a huge body in flight.
import { MAX_BODY_BYTES } from './config.mjs';

export function readJsonBody(req, { limitBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > limitBytes) {
        done = true;
        resolve({
          ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE',
          message: `body exceeds ${limitBytes} bytes`,
        });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw === '') { resolve({ ok: true, value: undefined }); return; }
      try {
        resolve({ ok: true, value: JSON.parse(raw) });
      } catch (e) {
        resolve({ ok: false, status: 400, code: 'INVALID_JSON',
                  message: `body is not valid JSON: ${e.message}` });
      }
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      resolve({ ok: false, status: 400, code: 'REQUEST_ERROR',
                message: 'request stream failed before the body was complete' });
    });
    req.on('aborted', () => {
      if (done) return;
      done = true;
      resolve({ ok: false, status: 499, code: 'CLIENT_CLOSED',
                message: 'client closed the connection' });
    });
  });
}
