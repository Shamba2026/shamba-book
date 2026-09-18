import assert from "node:assert/strict";
import {
  calculateExpectedCalving,
  calculateMilkValue,
  getMilkWeekPeriod
} from "../src/domain/farm-rules.js";

assert.equal(calculateExpectedCalving("2026-09-19"), "2027-06-29");
assert.deepEqual(
  getMilkWeekPeriod("2026-09-19"),
  { start: "2026-09-19", end: "2026-09-25", paymentDate: "2026-09-26" }
);
assert.deepEqual(
  getMilkWeekPeriod("2026-09-25"),
  { start: "2026-09-19", end: "2026-09-25", paymentDate: "2026-09-26" }
);
assert.equal(calculateMilkValue(10), 490);
assert.equal(calculateMilkValue(12.5), 612.5);

console.log("farm-rules.test.js: PASS");
