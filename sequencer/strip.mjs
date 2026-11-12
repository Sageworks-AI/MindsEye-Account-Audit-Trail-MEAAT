// Read-only "moving numbers" strip data. Callers pass pre-built cards, the
// current request, and figures already computed by card builders (this
// module never computes money: rule 4). Output is a plain object ready for
// the view/strip renderer.
export function buildStrip({ request, head, cacheStates, figures }) {
  if (!request || typeof request !== 'object') throw new Error('buildStrip: request required');
  if (!head || !Number.isSafeInteger(head.seq) || typeof head.hash !== 'string') {
    throw new Error('buildStrip: head {seq, hash} required');
  }
  const cs = cacheStates || {};
  const cardStrip = (request.cards || []).map((c) => ({
    type: c.type,
    cacheState: cs[c.type] || 'unknown',
  }));
  return {
    request: {
      mode: request.mode || 'read',
      cards: cardStrip,
      period: request.period ? { ...request.period } : null,
      focus: request.focus ? { ...request.focus } : null,
      head: { seq: head.seq, shortHash: head.hash.slice(0, 12) },
    },
    figures: (figures || []).map((f) => ({
      label: String(f.label),
      opening: f.opening,
      change: f.change,
      closing: f.closing,
    })),
  };
}
