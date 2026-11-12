// Tier selection from rectangle size against a fixed set of thresholds.
// Thresholds are documented constants: below summaryBelow the card shows only
// headline totals; between summaryBelow and standardBelow it shows sections
// with rows; above standardBelow it also exposes account codes and drill refs.
// The chosen tier is raised to the card type's minTier if necessary (for
// example, a receipt cannot render below standard because it needs its line
// table to be legible).
export const TIER_ORDER = Object.freeze(['summary', 'standard', 'full']);

export const THRESHOLDS = Object.freeze({
  summaryBelow:  { w: 320, h: 240 },
  standardBelow: { w: 640, h: 480 },
});

export function tierIndex(tier) {
  const i = TIER_ORDER.indexOf(tier);
  if (i === -1) throw new Error(`unknown tier: ${tier}`);
  return i;
}

export function tierForRect(rect, { minTier = 'summary' } = {}) {
  if (!rect || !Number.isSafeInteger(rect.w) || !Number.isSafeInteger(rect.h)) {
    throw new Error('tierForRect: rect must have integer w and h');
  }
  let tier;
  if (rect.w < THRESHOLDS.summaryBelow.w || rect.h < THRESHOLDS.summaryBelow.h) {
    tier = 'summary';
  } else if (rect.w < THRESHOLDS.standardBelow.w || rect.h < THRESHOLDS.standardBelow.h) {
    tier = 'standard';
  } else {
    tier = 'full';
  }
  if (tierIndex(tier) < tierIndex(minTier)) tier = minTier;
  return tier;
}

// Returns which sections of a card are visible at a given tier. `summary`
// keeps only the totals; `standard` and `full` expose rows. The renderer in
// S10 uses the same shape, so slicing here and slicing there agree.
export function sliceSections(card, tier) {
  if (!card || !Array.isArray(card.sections)) {
    throw new Error('sliceSections: card with sections required');
  }
  const idx = tierIndex(tier);
  if (idx === 0) {
    return card.sections.map((s) => ({
      id: s.id, label: s.label, total: s.total, rows: [],
    }));
  }
  return card.sections.map((s) => ({
    id: s.id, label: s.label, total: s.total, rows: s.rows,
    exposeRefs: idx >= 2,
  }));
}
