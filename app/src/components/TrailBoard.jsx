// Trail view. Fetches a trail from /api/trails/:id when `trailId` is set;
// otherwise shows the entry that a `trail from N` command targeted and
// offers a one-click "build a minimal trail for this entry" action.
//
// This is deliberately minimal: a fuller trail builder (drag nodes, draw
// links, save) is out of scope for S13 (README #79). What it does prove is
// that trail rendering works end-to-end and that the flowchart SVG is the
// same one the report uses.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api.js';
import { renderTrail } from '../../../view/svg/trail.mjs';
import { getTheme } from '../../../view/svg/theme.mjs';

function themeFromDocument() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function TrailBoard({ trailId, entryId }) {
  const [trail, setTrail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const theme = useMemo(() => getTheme(themeFromDocument()), []);

  useEffect(() => {
    if (!trailId) { setTrail(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await api.readTrail(trailId);
        if (cancelled) return;
        setTrail(res.trail);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [trailId]);

  const svg = useMemo(() => {
    if (!trail) return null;
    try {
      return renderTrail(trail, { x: 0n, y: 0n, w: 90000n, h: 60000n }, theme);
    } catch (e) {
      return null;
    }
  }, [trail, theme]);

  if (!trailId && !entryId) {
    return (
      <div className="pages-empty" role="status">
        <div>
          <p>Trail mode. Type <code>trail from N</code> in the command box to open a trail for entry N.</p>
        </div>
      </div>
    );
  }
  if (loading) {
    return <div className="pages-empty" role="status">Loading trail…</div>;
  }
  if (error) {
    return <div className="pages-empty" role="alert">{error}</div>;
  }
  if (!trail) {
    return (
      <div className="pages-empty" role="status">
        <div>
          <p>No saved trail with id <code>{trailId}</code>.</p>
          {entryId && <p>Entry {entryId} is the current focus; a full trail builder is not implemented in v1.</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="trail-board" role="region" aria-label="Trail">
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
