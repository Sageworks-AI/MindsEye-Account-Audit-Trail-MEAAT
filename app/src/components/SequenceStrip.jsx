// The read-only "moving numbers" strip. Renders the strip data from
// /api/strip via view/svg/strip.mjs. Read-only by construction: the SVG has
// no links and no focusable elements; the surrounding container has
// aria-readonly="true".
//
// Height: the strip's native height in cpt is derived from the number of
// figures so the SVG fits without clipping. The parent CSS container height
// (var(--strip-h) in tokens.css) is a minimum; the SVG can be taller and
// the container grows.
import { useMemo } from 'react';
import { renderStrip } from '../../../view/svg/strip.mjs';
import { getTheme } from '../../../view/svg/theme.mjs';

const PAD_Y = 400n;
const ROW_H = 1100n;
const FONT = 900n;

function intrinsicHeightCpt(strip) {
  // Must match the layout in view/svg/strip.mjs.
  let h = PAD_Y * 2n + FONT + ROW_H;
  if (strip && strip.figures && strip.figures.length > 0) {
    h += ROW_H * 2n + ROW_H * BigInt(strip.figures.length);
  }
  return h;
}

function themeFromDocument() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function SequenceStrip({ strip, error }) {
  const theme = useMemo(() => getTheme(themeFromDocument()), []);
  const svg = useMemo(() => {
    if (!strip) return null;
    try {
      const w = 90000n; // 900 pt wide; CSS scales it to the container width
      const h = intrinsicHeightCpt(strip);
      return renderStrip(strip, { x: 0n, y: 0n, w, h }, theme, {
        currency: { code: 'BWP', exponent: 2, symbol: 'P' },
      });
    } catch (e) {
      return null;
    }
  }, [strip, theme]);

  return (
    <div className="sequence-strip" aria-readonly="true" aria-label="Sequence strip (read-only)">
      {error
        ? <div className="page-error" role="alert">{error}</div>
        : (svg
            ? <div dangerouslySetInnerHTML={{ __html: svg }} />
            : <div className="page-error">…</div>)}
    </div>
  );
}
