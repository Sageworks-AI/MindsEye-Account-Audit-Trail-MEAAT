// SVG primitives. Every geometry argument is BigInt cpt (1 cpt = 1/100 pt).
// The viewBox uses pt as its user unit (1 user unit = 1 pt = 100 cpt), so
// an SVG number is a cpt value divided by 100. `cptToPt` produces the exact
// decimal string of that division from a BigInt — no floats anywhere, so
// the emitted SVG is byte-identical across runs and platforms.
//
// All text is escaped. When a caller supplies `title`, the text element is
// wrapped in a <g> carrying an SVG <title>; this is the standard pattern
// for a truncated label whose full text should be available on hover.
// A <title> is only emitted when it differs from the visible content, so
// ordinary full-length labels do not carry redundant titles.

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// cpt (BigInt) -> exact decimal string of pt (1 pt = 100 cpt).
// E.g. 12345n -> "123.45"; 10000n -> "100"; -150n -> "-1.5".
export function cptToPt(cpt) {
  const v = typeof cpt === 'bigint' ? cpt : BigInt(cpt);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const whole = abs / 100n;
  const frac = abs % 100n;
  if (frac === 0n) return `${sign}${whole}`;
  const fracStr = frac.toString().padStart(2, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fracStr}`;
}

function attrsToString(attrs) {
  if (!attrs) return '';
  const parts = [];
  for (const key of Object.keys(attrs)) {
    const v = attrs[key];
    if (v === undefined || v === null) continue;
    parts.push(` ${key}="${escapeXml(String(v))}"`);
  }
  return parts.join('');
}

export function rect({ x, y, w, h, attrs }) {
  return `<rect x="${cptToPt(x)}" y="${cptToPt(y)}" width="${cptToPt(w)}" height="${cptToPt(h)}"${attrsToString(attrs)}/>`;
}

export function line({ x1, y1, x2, y2, attrs }) {
  return `<line x1="${cptToPt(x1)}" y1="${cptToPt(y1)}" x2="${cptToPt(x2)}" y2="${cptToPt(y2)}"${attrsToString(attrs)}/>`;
}

export function path({ d, attrs }) {
  return `<path d="${escapeXml(d)}"${attrsToString(attrs)}/>`;
}

export function text({ x, y, content, attrs, title }) {
  const body = escapeXml(content);
  const attrsStr = attrsToString(attrs);
  if (title !== undefined && title !== null && String(title) !== String(content)) {
    return `<g><title>${escapeXml(title)}</title><text x="${cptToPt(x)}" y="${cptToPt(y)}"${attrsStr}>${body}</text></g>`;
  }
  return `<text x="${cptToPt(x)}" y="${cptToPt(y)}"${attrsStr}>${body}</text>`;
}

export function group(children, attrs) {
  return `<g${attrsToString(attrs)}>${children.join('')}</g>`;
}

export function svg({ widthCpt, heightCpt, children, attrs }) {
  const w = cptToPt(widthCpt);
  const h = cptToPt(heightCpt);
  const rootAttrs = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: `${w}pt`,
    height: `${h}pt`,
    viewBox: `0 0 ${w} ${h}`,
    ...attrs,
  };
  return `<svg${attrsToString(rootAttrs)}>${children.join('')}</svg>`;
}
