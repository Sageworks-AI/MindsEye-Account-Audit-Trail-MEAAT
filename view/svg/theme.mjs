// Light and dark themes as frozen objects. The SVG renderers inline these
// colours directly (no CSS variables at the SVG boundary), which keeps the
// bytes deterministic and independent of any stylesheet. The attention
// layer (S13) applies level-based opacity/brightness/filter on a wrapper
// element; the SVG itself is level-agnostic.
//
// Font families: Arial/Helvetica for the sans family (metric-compatible
// with the sans advance widths in text.mjs and space/reference/metrics.json);
// Menlo/Consolas monospace for amount columns and the strip. No web fonts:
// every family listed here is expected to be available offline, falling back
// to a system sans-serif or monospace if not (metrics.json's tabular digits
// make the fallback width-stable for the digits that matter).
//
// Metrics are in pt (not cpt) because they are consumed by the SVG
// renderers as `font-size` values, where the SVG viewBox is 1 unit = 1 pt.

export const THEMES = Object.freeze({
  light: Object.freeze({
    name: 'light',
    bg: '#f4f4f2',
    paper: '#ffffff',
    fg: '#1f1f1f',
    muted: '#6b6b6b',
    rule: '#d9d9d9',
    accent: '#2b5fa8',
    danger: '#b00020',
    warning: '#a06000',
    positive: '#1a6b30',
    font: Object.freeze({
      family: 'Arial, Helvetica, sans-serif',
      monospace: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
    }),
    metrics: Object.freeze({
      titlePt: 14,
      headingPt: 13,
      labelPt: 10,
      bodyPt: 10,
      captionPt: 8,
      leadingPt: 12,
    }),
  }),
  dark: Object.freeze({
    name: 'dark',
    bg: '#1a1a1a',
    paper: '#232323',
    fg: '#eaeaea',
    muted: '#9a9a9a',
    rule: '#3a3a3a',
    accent: '#7ba8e0',
    danger: '#ff6b80',
    warning: '#e0b060',
    positive: '#6bd08a',
    font: Object.freeze({
      family: 'Arial, Helvetica, sans-serif',
      monospace: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
    }),
    metrics: Object.freeze({
      titlePt: 14,
      headingPt: 13,
      labelPt: 10,
      bodyPt: 10,
      captionPt: 8,
      leadingPt: 12,
    }),
  }),
});

export function getTheme(name) {
  const t = THEMES[name];
  if (!t) throw new Error(`unknown theme: ${name}`);
  return t;
}
