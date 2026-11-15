// Vite config for the client. `root` is pinned to the directory containing
// this file so `vite --config app/vite.config.js` from the repository root
// picks up app/index.html (the default root would be process.cwd()). The
// dev server proxies /api/* to the node server on 127.0.0.1:4000 so the
// client can use same-origin relative URLs and no CORS middleware is
// needed.
//
// No plugins beyond @vitejs/plugin-react. No CDN, no external stylesheets,
// no web fonts. The build output goes to app/dist, which `node
// server/index.mjs --production` serves.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:4000';

export default defineConfig({
  root: HERE,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        // SSE works through Vite's proxy as long as `ws: false` (the
        // /api/stream endpoint is not a WebSocket, it is Server-Sent Events
        // over plain HTTP).
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
