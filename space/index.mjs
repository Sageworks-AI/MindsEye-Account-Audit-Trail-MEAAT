// Public API for the space layer. In S4 this is the pure JS twin, synchronous
// and deterministic. S5 will prefer the wasm build when the committed bytes
// load cleanly, falling back to this JS twin with a `space.fallback` event.
export { solve, MIN_BODY_CPT, DISPLAY_MAX, DEFAULT_GUTTER_CPT, TIER_THRESHOLDS } from './js/solve.mjs';
export { apportion } from './js/apportion.mjs';
export {
  textWidth, wrap, truncateWithEllipsis, amountColumnWidth,
  charWidthPpm, maxFormattedLength,
} from './js/metrics.mjs';
export {
  makeClaim, stack, sideBySide, overlay, claimLE, EMPTY,
  withShapeClasses, withRowsUpperBound, scaleClaim,
} from './js/claim.mjs';
export {
  loadDocuments, loadMetrics, validateDocuments, validateMetrics,
  PAPER_DIMS, SHAPE_CLASSES,
} from './reference/loader.mjs';
export { paginate } from './js/paginate.mjs';
export {
  makeRational, compareRational, applyRational, rationalEQ,
} from './js/rational.mjs';
export {
  baseClaimForArchetype, archetypeForCardType,
  tierEffect, compareEffect, focusEffect, drillDepthEffect,
  currencyEffect, weightsForMode,
} from './js/params.mjs';
export { chooseTemplate } from './js/templates.mjs';
