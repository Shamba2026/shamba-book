import assert from "node:assert/strict";
import { validateFinance } from "../src/domain/validation.js";
const sample = { direction: "income", category: "Milk sale", amount: "125.50",
  localDate: "2026-09-22", details: "Synthetic sale", paymentMethod: "M-Pesa", paymentReference: "TEST" };
assert.equal(validateFinance(sample).amountCents, 12550);
assert.equal(validateFinance({ ...sample, direction: "expense", category: "Feed", amount: "0.01" }).amountCents, 1);
for (const amount of ["", "0", "-2", "NaN", "1.999", "1e9", "1000000000"]) {
  assert.throws(() => validateFinance({ ...sample, amount }), /amount/i);
}
assert.throws(() => validateFinance({ ...sample, direction: "expense" }), /category/i);
assert.throws(() => validateFinance({ ...sample, localDate: "2026-02-30" }), /date/i);
assert.throws(() => validateFinance({ ...sample, details: "" }), /Description/i);
console.log("finance-validation.test.js: PASS");
