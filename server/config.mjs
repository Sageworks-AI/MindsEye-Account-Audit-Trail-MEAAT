// Server defaults and the chart of accounts the server starts with.
// Duplicates demo/demo.ledger.mjs's accounts rather than importing from it
// (README #63 forbids demo -> server both ways; the server cannot import
// demo/ per the boundary matrix). test/server.test.mjs seeds these accounts
// from the demo ledger and asserts the current head matches the demo
// fixture, so drift is caught at test time.
//
// In v1 there is no "create account" endpoint: the chart is fixed. A future
// version would add one; record this in README #69 as a known limitation.
export const DEFAULT_PORT = 4000;
export const DEFAULT_DATA_DIR = './data';
export const DEFAULT_HOST = '127.0.0.1';
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

export const DEMO_ACCOUNTS = Object.freeze([
  Object.freeze({ code: '1000', name: 'Cash', type: 'asset', cash: true }),
  Object.freeze({ code: '1100', name: 'Receivables', type: 'asset', cf: 'operating' }),
  Object.freeze({ code: '1500', name: 'Equipment', type: 'asset', cf: 'investing' }),
  Object.freeze({ code: '2000', name: 'Payables', type: 'liability', cf: 'operating' }),
  Object.freeze({ code: '2100', name: 'Loan', type: 'liability', cf: 'financing' }),
  Object.freeze({ code: '3000', name: 'Capital', type: 'equity', cf: 'financing' }),
  Object.freeze({ code: '4000', name: 'Sales', type: 'revenue', cf: 'operating' }),
  Object.freeze({ code: '5000', name: 'Rent', type: 'expense', cf: 'operating' }),
]);
