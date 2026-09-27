import assert from "node:assert/strict";
import { filterFinanceEntries, formatFinanceMoney, summarizeFinanceEntries } from "../src/domain/finance.js";

const entries = [
  { direction: "income", category: "Milk sale", amountCents: 12550, localDate: "2026-09-22" },
  { direction: "expense", category: "Feed", amountCents: 2520, localDate: "2026-09-23" },
  { direction: "expense", category: "Feed", amountCents: 1000, localDate: "2026-08-31" }
];
const month = filterFinanceEntries(entries, "month", "2026-09-27");
assert.equal(month.length, 2);
assert.equal(filterFinanceEntries(entries, "all", "2026-09-27").length, 3);
assert.throws(() => filterFinanceEntries(entries, "week", "2026-09-27"), /period/i);
assert.deepEqual(summarizeFinanceEntries(month), {
  incomeCents: 12550, expenseCents: 2520, netCents: 10030,
  categoryTotals: [
    { direction: "income", category: "Milk sale", amountCents: 12550 },
    { direction: "expense", category: "Feed", amountCents: 2520 }
  ]
});
assert.equal(formatFinanceMoney(10030), "KSh 100.30");
assert.equal(formatFinanceMoney(-10030), "−KSh 100.30");
assert.throws(() => summarizeFinanceEntries([
  { direction: "income", category: "Milk sale", amountCents: Number.MAX_SAFE_INTEGER },
  { direction: "income", category: "Milk sale", amountCents: 1 }
]), /supported range/i);
assert.throws(() => formatFinanceMoney(Number.MAX_SAFE_INTEGER + 1), /supported range/i);
console.log("finance-domain.test.js: PASS");
