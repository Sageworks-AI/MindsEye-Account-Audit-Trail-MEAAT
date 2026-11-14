// The fixed deterministic demo chart of accounts and entries used by
// `npm run demo` and `npm run report`. The actual ledger is built by
// test/fixtures/ledger.mjs, which the test suite already covers; this
// module re-exports it so a change to the demo data is a single-file change
// and the tests that cover the fixture cover the demo too.
//
// The demo includes: owner capital, equipment purchase, credit sale INV-1,
// cash collection INV-1 (shared refs so trail derivation links them), rent,
// loan drawdown, and a reversal of the loan drawdown. Numbers are round so
// every total is easily hand-checked in the report.
import { pathToFileURL } from 'node:url';
import {
  buildDemoLedger as build,
  DEMO_ACCOUNTS,
  DEMO_PERIOD,
} from '../test/fixtures/ledger.mjs';
import { buildCard } from '../core/cards/index.mjs';

export { DEMO_ACCOUNTS, DEMO_PERIOD };

export function buildDemoLedger() { return build(); }

// Prints a one-line summary per card kind. Used by `npm run demo`.
// Uses card builder output only, so every number is honest.
export function printCardSummaries(ledger) {
  const view = ledger.view();
  const asOf = { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER };
  const cards = [
    buildCard('trial_balance',    view, { asOf }),
    buildCard('balance_sheet',    view, { asOf }),
    buildCard('income_statement', view, { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }),
    buildCard('cash_flow',        view, { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }),
    buildCard('receipt',          view, { entryId: 3 }),
  ];
  for (const c of cards) {
    const totals = c.sections.map((s) => {
      const t = s.total;
      const rendered = typeof t === 'number' ? t : JSON.stringify(t);
      return `${s.id}=${rendered}`;
    }).join(' ');
    console.log(`${c.type.padEnd(16)} ok=${c.ok ? 'yes' : 'NO '} hash=${c.hash} ${totals}`);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  printCardSummaries(buildDemoLedger());
}
