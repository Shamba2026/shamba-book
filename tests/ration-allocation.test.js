import assert from "node:assert/strict";
import { validateRationAllocationEvidence } from "../src/domain/feed/ration-allocation.js";

const rationReview = { id: "ration-group", farmId: "farm-a", rationBasis: "DAILY_OFFERED_RATION", rationBasisConfirmed: true,
  animalGroup: [{ id: "cow-a" }, { id: "cow-b" }], ration: { ingredients: [
    { feedId: "silage", feedName: "Synthetic silage", role: "forage", asFedKg: 20, dmKg: 6, meMJ: 60, cpKg: 0.6, costCents: 2000 },
    { feedId: "meal", feedName: "Synthetic meal", role: "concentrate", asFedKg: 4, dmKg: 3.6, meMJ: 39.6, cpKg: 0.72, costCents: 800 }
  ] } };
const input = { allocationMethod: "DOCUMENTED_INGREDIENT_WEIGHTS", rationale: "Observed and weighed individual allocations.",
  reviewerUserId: "reviewer-a", reviewerConfirmed: true, allocations: [
    { animalId: "cow-a", ingredients: [{ feedId: "silage", asFedKg: 12 }, { feedId: "meal", asFedKg: 2.5 }] },
    { animalId: "cow-b", ingredients: [{ feedId: "silage", asFedKg: 8 }, { feedId: "meal", asFedKg: 1.5 }] }
  ] };

const before = structuredClone({ rationReview, input });
const result = validateRationAllocationEvidence(rationReview, input);
assert.equal(result.allocations[0].ration.totalAsFedKg, 14.5);
assert.equal(result.allocations[0].ration.totalDMIKg, 5.85);
assert.equal(result.allocations[0].ration.totalMEMJ, 60.75);
assert.equal(result.allocations[0].ration.totalCPKg, 0.81);
assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.allocations));
assert.deepEqual({ rationReview, input }, before, "allocation validation must not mutate evidence");
assert.throws(() => validateRationAllocationEvidence({ ...rationReview, ration: { totalAsFedKg: 24 } }, input), /ingredient-level evidence/);
assert.throws(() => validateRationAllocationEvidence(rationReview, { ...input, allocations: input.allocations.map((row, index) =>
  ({ ...row, ingredients: row.ingredients.map((item) => item.feedId === "silage" && index === 0 ? { ...item, asFedKg: 11 } : item) })) }), /reconcile exactly/);
assert.throws(() => validateRationAllocationEvidence(rationReview, { ...input, allocations: [input.allocations[0], input.allocations[0]] }), /match the ration animal group exactly/);
assert.throws(() => validateRationAllocationEvidence(rationReview, { ...input, reviewerConfirmed: false }), /must confirm/);
assert.throws(() => validateRationAllocationEvidence({ ...rationReview, animalGroup: [{ id: "cow-a" }] }, input), /multi-animal/);
console.log("ration-allocation.test.js: PASS");
