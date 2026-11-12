// Pagination: given a card's row count and a shape class, split into pages.
// Header/footer are repeated on every page; rows-per-page is derived from the
// shape's logical height minus header/footer, divided by the leading, so a
// page always fits its capacity (Law L11). If the archetype is marked
// "paginates: false" and rows exceed capacity, we return an error rather
// than silently truncate.
export function paginate({ rows, shapeClass, archetype }) {
  if (!Number.isInteger(rows) || rows < 0) {
    throw new Error('paginate: rows must be a non-negative integer');
  }
  const dims = archetype.shapeDimensions[shapeClass];
  if (!dims) throw new Error(`paginate: archetype ${archetype.id} has no shape ${shapeClass}`);
  const leadingCpt = BigInt(archetype.leadingPt * 100);
  const headerCpt  = BigInt(archetype.headerPt * 100);
  const footerCpt  = BigInt(archetype.footerPt * 100);
  const pageHCpt   = BigInt(dims.hPt * 100);
  const contentCpt = pageHCpt - headerCpt - footerCpt;
  if (contentCpt <= 0n) {
    return { error: `paginate: ${shapeClass} page too short for header + footer` };
  }
  const perPage = contentCpt / leadingCpt;
  if (perPage <= 0n) {
    return { error: `paginate: ${shapeClass} page fits zero rows` };
  }
  const perPageNum = Number(perPage);
  if (rows <= perPageNum) {
    return { pages: [{ from: 0, to: rows }], perPage: perPageNum };
  }
  if (!archetype.paginates) {
    return {
      error: `paginate: card has ${rows} rows, ${archetype.id} does not paginate and fits only ${perPageNum}`,
    };
  }
  const pages = [];
  for (let i = 0; i < rows; i += perPageNum) {
    pages.push({ from: i, to: Math.min(i + perPageNum, rows) });
  }
  // Invariant (L11): page row counts sum exactly to rows.
  let sum = 0;
  for (const p of pages) sum += p.to - p.from;
  if (sum !== rows) {
    return { error: `paginate: page row counts sum ${sum} != ${rows} (internal bug)` };
  }
  return { pages, perPage: perPageNum };
}
