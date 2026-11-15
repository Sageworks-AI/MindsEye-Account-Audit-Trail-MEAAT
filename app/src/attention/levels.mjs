// Bundled levels table for the browser. The JSON is imported directly
// (Vite resolves JSON imports to an object at build time); validateLevels
// is not called here because validateLevels lives in a module that imports
// `node:fs` for loadLevels. The committed JSON is exercised by
// test/attention/laws.test.mjs in Node; the browser trusts it.
import levelsData from '../../../attention/dist/levels.json';

export const LEVELS = Object.freeze(levelsData);
