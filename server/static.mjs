// Static file serving for production mode. In dev mode (Vite serves the
// client separately) this module is not invoked. Serves files from
// app/dist; falls back to app/dist/index.html for any non-/api path so
// client-side routing works. Path traversal is refused; only GET and HEAD
// are served. A missing app/dist in production returns false so the caller
// can render a clear message instead of a silent 404.
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map':  'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
});

function mimeFor(path) {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME[path.slice(dot).toLowerCase()] || 'application/octet-stream';
}

// Returns true when the request was served; false otherwise (caller
// responds 404 or serves an API error). Never throws on a bad path — it
// returns false so the caller controls the response.
export async function tryServeStatic(req, res, staticDir, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (urlPath === '/api' || urlPath.startsWith('/api/')) return false;
  if (!existsSync(staticDir)) {
    // Production mode with no built client: tell the user how to build.
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('app/dist not built; run `npm run build` before `npm start`\n');
    return true;
  }
  // Sanitise the path: strip query (already stripped by caller), split,
  // reject '..' segments, resolve against staticDir, then verify containment.
  const requested = urlPath.split('/').filter(Boolean).filter((s) => s !== '..');
  const candidate = resolve(join(staticDir, ...requested));
  const rootResolved = resolve(staticDir);
  const inside = candidate === rootResolved || candidate.startsWith(rootResolved + sep);
  if (!inside) return false;

  let fileToServe = candidate;
  let statInfo = null;
  try { statInfo = await stat(fileToServe); } catch { statInfo = null; }
  if (!statInfo || !statInfo.isFile()) {
    // SPA fallback for client-side routes.
    fileToServe = join(staticDir, 'index.html');
    try { statInfo = await stat(fileToServe); } catch { statInfo = null; }
    if (!statInfo || !statInfo.isFile()) return false;
  }

  const content = await readFile(fileToServe);
  const isIndex = fileToServe === join(staticDir, 'index.html');
  res.writeHead(200, {
    'content-type': mimeFor(fileToServe),
    'content-length': content.length,
    'cache-control': isIndex ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(content);
  }
  return true;
}
