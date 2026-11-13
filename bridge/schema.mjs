// The only file bridge/ is allowed to import from core/. Re-exports the
// schema (plain data, no logic) so resolve/ and any future bridge consumer
// can obtain the card type list without importing core internals.
// Enforced by scripts/check-boundaries.mjs, which lists core/schema.mjs in
// the bridge area's filePaths allowlist.
export { CARD_TYPES, SECTION_IDS, COLUMN_KEYS } from '../core/schema.mjs';
