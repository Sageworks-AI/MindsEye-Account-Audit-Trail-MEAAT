// Server-sent events stream of Sequencer events.
//
// GET /api/stream opens a `text/event-stream` response. Every event the
// server emits via ctx.emit() is also pushed to every connected client as
// `event: <type>\ndata: <json>\n\n`. A `: ping` comment is sent every 15s
// so a proxy or an idle browser keeps the connection open.
//
// The handler tracks subscribers in a Set. On request close, the subscriber
// is removed. There is a bound (MAX_SUBSCRIBERS) so a leak in a client
// cannot exhaust memory; a new subscriber when the set is full is refused
// with a comment line explaining why.
const MAX_SUBSCRIBERS = 32;
const PING_MS = 15_000;

export function makeStream() {
  const subscribers = new Set();
  return {
    handle(req, res) {
      if (subscribers.size >= MAX_SUBSCRIBERS) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('too many concurrent stream subscribers\n');
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      // Initial comment so the client can detect the open stream.
      res.write(': stream open\n\n');
      const subscriber = { res };
      subscribers.add(subscriber);
      const ping = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { /* gone */ }
      }, PING_MS);
      const cleanup = () => {
        clearInterval(ping);
        subscribers.delete(subscriber);
      };
      req.on('close', cleanup);
      req.on('error', cleanup);
    },
    push(event) {
      const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const s of subscribers) {
        try { s.res.write(payload); } catch { /* gone; cleanup will fire */ }
      }
    },
    size() { return subscribers.size; },
  };
}
