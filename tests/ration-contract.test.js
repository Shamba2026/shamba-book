import assert from "node:assert/strict";
import { buildReadOnlyRation } from "../src/domain/feed/ration-contract.js";

const feed = { id: "feed-a", name: "Synthetic forage", role: "forage", status: "active" };
const batch = { id: "batch-a", feedId: feed.id, status: "active", remainingQuantityKg: 20,
  receivedQuantityKg: 100, totalCostCents: 200000, currencyCode: "KES", costSourceId: "cost-a" };
const source = { id: "source-a", citation: "TEST-LAB-001", status: "active" };
const selected = (nutrientCode, value, unit, basis) => ({ id: "selection-" + nutrientCode,
  rationale: "Reviewed synthetic evidence", observation: { id: "observation-" + nutrientCode,
    feedId: feed.id, nutrientCode, value, unit, basis, status: "active" }, source });
const selections = {
  DM: selected("DM", 250, "G_PER_KG_AS_FED", "AS_FED"),
  ME: selected("ME", 10.5, "MJ_PER_KG_DM", "DRY_MATTER"),
  CP: selected("CP", 140, "G_PER_KG_DM", "DRY_MATTER")
};

const before = structuredClone({ feed, batch, selections });
const result = buildReadOnlyRation([{ feed, batch, selections, asFedKg: 10 }]);
assert.equal(result.totalAsFedKg, 10);
assert.equal(result.totalDMIKg, 2.5);
assert.equal(result.totalMEMJ, 26.25);
assert.ok(Math.abs(result.totalCPKg - 0.35) < 1e-12);
assert.equal(result.totalCostCents, 20000);
assert.equal(result.ingredients[0].evidence.DM.observationId, "observation-DM");
assert.equal(result.ingredients[0].costProvenance.costSourceId, "cost-a");
assert.deepEqual({ feed, batch, selections }, before, "read-only calculation must not mutate its inputs");

assert.throws(() => buildReadOnlyRation([{ feed, batch, selections, asFedKg: 21 }]), /available inventory/);
assert.throws(() => buildReadOnlyRation([{ feed, batch, selections: { ...selections, CP: undefined }, asFedKg: 1 }]), /selected CP/);
assert.throws(() => buildReadOnlyRation([{ feed, batch: { ...batch, feedId: "feed-b" }, selections, asFedKg: 1 }]), /does not belong/);
assert.throws(() => buildReadOnlyRation([{ feed, batch, selections: { ...selections,
  DM: selected("DM", 25, "PERCENT", "DRY_MATTER") }, asFedKg: 1 }]), /selected DM/);
assert.throws(() => buildReadOnlyRation([{ feed, batch, selections, asFedKg: 1 },
  { feed, batch: { ...batch, id: "batch-b", currencyCode: "USD" }, selections, asFedKg: 1 }]), /one recorded currency/);

console.log("ration-contract.test.js: PASS");
