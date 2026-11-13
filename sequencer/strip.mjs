// Read-only "moving numbers" strip data. Callers pass pre-built cards, the
// current request, and figures already computed by card builders (this
// module never computes money: rule 4). Output is a plain object ready for
// the view/strip renderer.
//
// S6: an optional `layout` field carries the space-layer summary — viewport
// in px, per-pane shape class, scale, predicted vs exact rows. It is
// provided by the caller (resolver / server); the strip itself takes plain
// data and imports nothing from core, space or resolve.
export function buildStrip({ request, head, cacheStates, figures, layout }) {
  if (!request || typeof request !== 'object') throw new Error('buildStrip: request required');
  if (!head || !Number.isSafeInteger(head.seq) || typeof head.hash !== 'string') {
    throw new Error('buildStrip: head {seq, hash} required');
  }
  const cs = cacheStates || {};
  const cardStrip = (request.cards || []).map((c) => ({
    type: c.type,
    cacheState: cs[c.type] || 'unknown',
  }));
  const out = {
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
  if (layout !== undefined) {
    out.layout = normalizeLayout(layout, cs);
  }
  return out;
}

// Normalises the layout summary to a shape that serialises cleanly to JSON
// (BigInt scale converted to string; missing fields defaulted). Unknown
// fields on the input are dropped so the output is stable across callers.
function normalizeLayout(layout, cacheStates) {
  if (!layout || typeof layout !== 'object') {
    throw new Error('buildStrip: layout must be a plain object');
  }
  if (!layout.viewport ||
      typeof layout.viewport.w !== 'number' ||
      typeof layout.viewport.h !== 'number') {
    throw new Error('buildStrip: layout.viewport must be { w: number, h: number }');
  }
  return {
    viewport: { w: layout.viewport.w, h: layout.viewport.h },
    panes: (layout.panes || []).map((p) => {
      const scale = p.scale || {};
      return {
        type: String(p.type),
        shapeClass: p.shapeClass !== undefined ? String(p.shapeClass) : null,
        scaleNum: scale.num !== undefined ? String(scale.num) : null,
        scaleDen: scale.den !== undefined ? String(scale.den) : null,
        predictedRows: p.predictedRows !== undefined ? p.predictedRows : null,
        exactRows: p.exactRows !== undefined ? p.exactRows : null,
        cacheState: p.cacheState || (cacheStates && cacheStates[p.type]) || 'unknown',
      };
    }),
  };
}
