// The frozen API surface of every public module. `test/api-surface.test.mjs`
// imports each module and asserts its export set matches the list below;
// `node scripts/api-surface.mjs` prints the actual export set for each
// module so a developer can regenerate the list after a deliberate change.
//
// This is the second constancy guard from README #29 (the first is
// scripts/stages.json). It catches an accidental rename or removal of a
// public export long before a downstream failure appears in the client,
// report or conductor.
//
// Adding or removing an export is a public-API change: update this list in
// the same commit that changes the module, run `node scripts/api-surface.mjs`
// to confirm, and note the change in the README changelog (assumption #81).
export const PUBLIC_API = Object.freeze({
  'core/ledger.mjs':        ['Ledger', 'LedgerView'],
  'core/money.mjs':         ['DEFAULT_CURRENCY', 'addMinor', 'assertMinor', 'formatMinor',
                             'negateMinor', 'subMinor', 'sumMinor'],
  'core/time.mjs':          ['addDays', 'compareTick', 'endOfDay', 'isValidDate', 'makeTick',
                             'prevDay', 'quarterRange', 'startOfDay', 'tickEQ', 'tickLE',
                             'tickLT', 'validateDate'],
  'core/canonical.mjs':     ['canonicalize'],
  'core/hash.mjs':          ['GENESIS_HASH', 'hashEntryBody', 'sha256Hex', 'shortHash'],
  'core/accounts.mjs':      ['naturalBalance', 'naturalSide', 'validateAccounts'],
  'core/checks.mjs':        ['allPass', 'makeCheck'],
  'core/schema.mjs':        ['CARD_TYPES', 'COLUMN_KEYS', 'MAX_ENTRY_LINES', 'SECTION_IDS'],
  'core/cards/index.mjs':   ['REGISTRY', 'buildCard', 'open'],
  'core/impact.mjs':        ['computeImpact'],
  'core/trail.mjs':         ['addLink', 'addNode', 'createTrail',
                             'deriveReversalLinks', 'deriveRefLinks',
                             'deriveSameAccountLinks', 'deriveSameEntryLinks',
                             'makeNode', 'setTarget', 'signedAmount', 'validateTrail'],
  'store/journalFile.mjs':  ['openJournalFile'],
  'store/journalMemory.mjs':['openJournalMemory'],
  'store/cardStore.mjs':    ['CardStore'],
  'store/trailStore.mjs':   ['createTrailStore'],
  'sequencer/events.mjs':   ['EVENT_TYPES', 'eventFromDraft', 'makeEvent'],
  'sequencer/lanes.mjs':    ['LANES', 'laneFor'],
  'sequencer/buckets.mjs':  ['aggregate', 'totalsByLane'],
  'sequencer/log.mjs':      ['openEventLog'],
  'sequencer/strip.mjs':    ['buildStrip'],
  'resolve/request.mjs':    ['MAX_CARDS', 'MODES', 'validateRequest'],
  'resolve/layout.mjs':     ['DEFAULT_GUTTER', 'DEFAULT_MIN_SIZE', 'solve'],
  'resolve/tiers.mjs':      ['THRESHOLDS', 'TIER_ORDER', 'sliceSections',
                             'tierForRect', 'tierIndex'],
  'resolve/plan.mjs':       ['plan'],
  'resolve/command.mjs':    ['interpret'],
  'resolve/dates.mjs':      ['isValidDate', 'quarterRange'],
  'view/svg/text.mjs':      ['amountColumnWidth', 'charWidthPpm', 'textWidth',
                             'truncateWithEllipsis', 'wrap'],
  'view/svg/theme.mjs':     ['THEMES', 'getTheme'],
  'view/svg/primitives.mjs':['cptToPt', 'escapeXml', 'group', 'line', 'path',
                             'rect', 'svg', 'text'],
  'view/svg/slip.mjs':      ['renderCard'],
  'view/svg/impact.mjs':    ['renderImpact'],
  'view/svg/trail.mjs':     ['renderTrail'],
  'view/svg/strip.mjs':     ['renderStrip'],
  'space/index.mjs':        ['DEFAULT_GUTTER_CPT', 'DISPLAY_MAX', 'EMPTY',
                             'MIN_BODY_CPT', 'PAPER_DIMS', 'SHAPE_CLASSES',
                             'TIER_THRESHOLDS', 'amountColumnWidth', 'anchorOffset',
                             'apportion', 'applyRational', 'archetypeForCardType',
                             'baseClaimForArchetype', 'charWidthPpm', 'chooseTemplate',
                             'claimLE', 'compareEffect', 'compareRational',
                             'currencyEffect', 'drillDepthEffect', 'focusEffect',
                             'getBackendStatus', 'getWasmBackend', 'loadDocuments',
                             'loadMetrics', 'makeClaim', 'makeRational',
                             'maxFormattedLength', 'overlay', 'paginate',
                             'rationalEQ', 'scaleClaim', 'sideBySide', 'solve',
                             'stack', 'textWidth', 'tierEffect', 'truncateWithEllipsis',
                             'validateDocuments', 'validateMetrics', 'weightsForMode',
                             'withRowsUpperBound', 'withShapeClasses', 'wrap'],
  'attention/index.mjs':    ['ACTOR_KINDS', 'ALREADY_FOCUSED', 'BAD_ACTOR',
                             'BAD_EVENT', 'CONTRAST_FLOOR', 'CONTRAST_FLOOR_HIGH',
                             'EVENT_TYPES', 'FOCUS_SOURCES', 'HISTORY_DEPTH',
                             'INPUT_CHANNELS', 'INPUT_OUTCOMES', 'LAW_VIOLATION',
                             'MAX_ACTORS', 'NOOP', 'OK', 'POINTER_STALE',
                             'RING_FULL', 'TRANSFER_INVALID',
                             'TRANSFER_OUTCOME_KINDS', 'TRANSFER_PAYLOAD_KINDS',
                             'contrastPermille', 'docRank', 'docsInOrder',
                             'findById', 'frame', 'getBackendStatus', 'getWasmBackend',
                             'hashState', 'idsInOrder', 'levelContrastPermille',
                             'levelFor', 'levelOf', 'loadLevels', 'luminancePpm',
                             'makeEvent', 'makeState', 'rankOf', 'sameRing', 'step',
                             'validateLevels'],
  'bridge/schema.mjs':      ['CARD_TYPES', 'COLUMN_KEYS', 'SECTION_IDS'],
  'bridge/measure.mjs':     ['draftLaidOut', 'draftPremeasured', 'predictedRowsFor',
                             'premeasure', 'pxFromCpt', 'reconcile', 'rowBoundsTable'],
  'bridge/attention.mjs':   ['ARCHETYPE_BY_CARD', 'DEFAULT_ROWS',
                             'planFromAttention', 'predictedRowsFor'],
  'server/index.mjs':       ['createServer'],
  'server/config.mjs':      ['DEFAULT_DATA_DIR', 'DEFAULT_HOST', 'DEFAULT_PORT',
                             'DEMO_ACCOUNTS', 'MAX_BODY_BYTES'],
});

// CLI: `node scripts/api-surface.mjs` prints, for each module, the current
// export set alongside the expected one, and exits non-zero if they differ.
// This is the same comparison the test performs; it is convenient for a
// developer making a deliberate change who wants the diff without a failing
// test run.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const isMain = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const ROOT = new URL('..', import.meta.url);
  let bad = 0;
  for (const [rel, expected] of Object.entries(PUBLIC_API)) {
    let mod;
    try {
      mod = await import(new URL(rel, ROOT).href);
    } catch (e) {
      console.error(`${rel}: import failed: ${e.message}`);
      bad += 1;
      continue;
    }
    const actual = Object.keys(mod).sort();
    const want = expected.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(want)) {
      console.error(`${rel}: exports drifted`);
      console.error(`  expected: ${want.join(', ')}`);
      console.error(`  actual:   ${actual.join(', ')}`);
      bad += 1;
    }
  }
  if (bad > 0) process.exit(1);
  console.log(`api-surface: ${Object.keys(PUBLIC_API).length} modules match`);
}
