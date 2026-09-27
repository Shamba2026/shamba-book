import assert from "node:assert/strict";
import { calculateRation } from "../src/domain/feed/feed-math.js";

const napier = {
  id: "napier-batch",
  name: "Napier grass",
  role: "forage",
  dmPercent: 20,
  meMJPerKgDM: 9,
  cpPercentDM: 12,
  costPerAsFedTonneCents: 1500000
};

const dairyMeal = {
  id: "dairy-meal-batch",
  name: "Dairy meal",
  role: "concentrate",
  dmPercent: 90,
  meMJPerKgDM: 12,
  cpPercentDM: 18,
  costPerAsFedTonneCents: 4000000
};

const result = calculateRation([
  { feed: napier, asFedKg: 25 },
  { feed: dairyMeal, asFedKg: 4 }
]);

assert.equal(result.totalAsFedKg, 29);
assert.equal(result.totalDMIKg, 8.6);
assert.equal(result.forageDMKg, 5);
assert.equal(result.totalMEMJ, 88.2);
assert.equal(result.totalCPKg, 1.248);
assert.equal(result.meDensityMJPerKgDM, 88.2 / 8.6);
assert.equal(result.cpPercentDM, (1.248 / 8.6) * 100);
assert.equal(result.totalCostCents, 53500);

assert.throws(
  () => calculateRation([{ feed: napier, asFedKg: 0 }]),
  /greater than zero/
);

assert.throws(
  () => calculateRation([{ feed: { ...napier, dmPercent: 101 }, asFedKg: 1 }]),
  /DM percentage/
);

assert.throws(
  () => calculateRation([{ feed: { ...napier, role: "silage" }, asFedKg: 1 }]),
  /feed role/
);

console.log("feed-math.test.js: PASS");
