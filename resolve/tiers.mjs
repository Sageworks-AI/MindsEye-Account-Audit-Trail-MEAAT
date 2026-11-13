// Tier selection from rectangle size. S6: thresholds are read from
// space/index.mjs so both backends share one source of truth. The exported
// numbers are still in CSS px (space stores them in cpt) so callers see the
// same API as before.
import { TIER_THRESHOLDS as SPACE_THRESHOLDS } from '../space/index.mjs';

const PT_PER_PX = 75n;

export const TIER_ORDER = Object.freeze(['summary', 'standard', 'full']);

export const THRESHOLDS = Object.freeze({
  summaryBelow:  {
    w: Number(SPACE_THRESHOLDS.summaryBelow.w / PT_PER_PX),
    h: Number(SPACE_THRESHOLDS.summaryBelow.h / PT_PER_PX),
  },
  standardBelow: {
    w: Number(SPACE_THRESHOLDS.standardBelow.w / PT_PER_PX),
    h: Number(SPACE_THRESHOLDS.standardBelow.h / PT_PER_PX),
  },
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
