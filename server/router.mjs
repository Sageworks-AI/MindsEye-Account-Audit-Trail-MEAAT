// Tiny path router. Patterns are strings like '/api/entries/:seq/reverse'
// split into segments; ':name' matches one non-empty segment and becomes a
// param. There is no wildcard, no regex, no middleware: each route is a
// plain async handler. On no match, `handle` returns false so the caller
// (index.mjs) can fall through to static file serving or a JSON 404.
//
// Handlers may return a Promise; the router awaits it. A throw becomes a
// 500 via errors.errorHandler unless the handler itself already wrote a
// response (checked via res.headersSent).
import { errorHandler } from './errors.mjs';

function parsePattern(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`router: pattern must start with "/": ${path}`);
  }
  return path.split('/').filter(Boolean);
}

function match(segments, pattern) {
  if (segments.length !== pattern.length) return null;
  const params = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith(':')) {
      if (!segments[i]) return null;
      params[p.slice(1)] = segments[i];
    } else if (p !== segments[i]) {
      return null;
    }
  }
  return params;
}

export function makeRouter() {
  const routes = [];
  function add(method, path, handler) {
    if (typeof handler !== 'function') throw new Error('router: handler required');
    routes.push({ method, pattern: parsePattern(path), handler });
  }
  return {
    get:  (path, handler) => add('GET', path, handler),
    post: (path, handler) => add('POST', path, handler),
    put:  (path, handler) => add('PUT', path, handler),
    delete: (path, handler) => add('DELETE', path, handler),
    async handle(req, res) {
      const parsed = new URL(req.url, 'http://localhost');
      const segments = parsed.pathname.split('/').filter(Boolean);
      let pathMatched = false;
      for (const route of routes) {
        const params = match(segments, route.pattern);
        if (!params) continue;
        pathMatched = true;
        if (route.method !== req.method) continue;
        req.params = params;
        req.query = Object.fromEntries(parsed.searchParams.entries());
        try {
          await route.handler(req, res);
        } catch (err) {
          if (!res.headersSent) errorHandler(err, req, res);
          else try { res.end(); } catch { /* connection already gone */ }
        }
        return true;
      }
      return pathMatched ? 'method' : false;
    },
  };
}
