import assert from "node:assert/strict";
import { compareRequirementToRationEvidence, validateComparisonReview } from "../src/domain/feed/requirement-ration-comparison.js";

const requirement = Object.freeze({ id: "req-1", farmId: "farm-1", animalId: "animal-1", profileId: "rp-1",
  profileVersion: 2, sourceCitation: "Requirement source p. 8", classificationId: "class-1",
  calculatedAt: "2026-10-06T10:00:00.000Z", outputs: [
    { outputCode: "DMI_KG_DAY", outputUnit: "kg DM/day", value: 10 },
    { outputCode: "ME_MJ_DAY", outputUnit: "MJ ME/day", value: 100 },
    { outputCode: "CP_KG_DAY", outputUnit: "kg CP/day", value: 1.5 },
    { outputCode: "MP_G_DAY", outputUnit: "g MP/day", value: 900 }
  ] });
const ration = Object.freeze({ id: "ration-1", farmId: "farm-1", profileId: "dp-1", profileVersion: 3,
  sourceCitation: "Feed analysis 2026", selectionId: "selection-1", calculatedAt: "2026-10-06T11:00:00.000Z",
  rationBasis: "DAILY_OFFERED_RATION", rationBasisConfirmed: true,
  animalGroup: [{ id: "animal-1", animalCode: "TEST-COW" }],
  ration: { totalDMIKg: 8, meDensityMJPerKgDM: 11, cpPercentDM: 14, totalAsFedKg: 24,
    forageDMKg: 5, totalCostCents: 1200 } });

const report = compareRequirementToRationEvidence(requirement, ration, "animal-1");
assert.equal(report.comparisons.length, 3);
assert.deepEqual(report.comparisons.map(({ outputCode, suppliedValue, gap, status }) =>
  ({ outputCode, suppliedValue, gap, status })), [
  { outputCode: "DMI_KG_DAY", suppliedValue: 8, gap: -2, status: "BELOW_DOCUMENTED_REQUIREMENT" },
  { outputCode: "ME_MJ_DAY", suppliedValue: 88, gap: -12, status: "BELOW_DOCUMENTED_REQUIREMENT" },
  { outputCode: "CP_KG_DAY", suppliedValue: 1.12, gap: -0.38, status: "BELOW_DOCUMENTED_REQUIREMENT" }
]);
assert.deepEqual(report.uncompared, [{ outputCode: "MP_G_DAY", outputUnit: "g MP/day",
  reason: "No directly compatible ration evidence is retained for this metric." }]);
assert.equal(report.attribution.requirementCalculationId, "req-1");
assert.equal(report.attribution.rationReviewId, "ration-1");
assert.ok(Object.isFrozen(report));

assert.throws(() => compareRequirementToRationEvidence(requirement, { ...ration, farmId: "farm-2" }, "animal-1"), /same farm/);
assert.throws(() => compareRequirementToRationEvidence(requirement, { ...ration, animalGroup: [] }, "animal-1"), /animal group/);
assert.throws(() => compareRequirementToRationEvidence(requirement, { ...ration,
  animalGroup: [{ id: "animal-1" }, { id: "animal-2" }] }, "animal-1"), /per-animal allocation/);
assert.throws(() => compareRequirementToRationEvidence(requirement, { ...ration, rationBasisConfirmed: false }, "animal-1"), /daily offered ration/);
assert.throws(() => compareRequirementToRationEvidence(requirement, { ...ration, rationBasis: undefined }, "animal-1"), /daily offered ration/);
assert.throws(() => compareRequirementToRationEvidence({ ...requirement, outputs: [{ outputCode: "DMI_KG_DAY", outputUnit: "kg/day", value: 10 }] }, ration, "animal-1"), /unit/);

assert.deepEqual(validateComparisonReview({ decision: "ACKNOWLEDGED", rationale: "Reviewed source-attributed arithmetic gaps.",
  reviewerUserId: "reviewer-1", reviewerConfirmed: true }), {
  decision: "ACKNOWLEDGED", rationale: "Reviewed source-attributed arithmetic gaps.", reviewerUserId: "reviewer-1"
});
assert.throws(() => validateComparisonReview({ decision: "APPROVED", rationale: "Not supported", reviewerUserId: "r", reviewerConfirmed: true }), /decision/);
assert.throws(() => validateComparisonReview({ decision: "NEEDS_EVIDENCE_REVIEW", rationale: "Further evidence review is required.", reviewerUserId: "r", reviewerConfirmed: false }), /confirm/);

const groupRation = { ...ration, id: "ration-group", animalGroup: [{ id: "animal-1" }, { id: "animal-2" }],
  ration: { ...ration.ration, totalDMIKg: 16 } };
const allocation = { id: "allocation-1", farmId: "farm-1", rationReviewId: "ration-group",
  allocationMethod: "DOCUMENTED_INGREDIENT_WEIGHTS", reviewerConfirmed: true, reviewedAt: "2026-10-07T08:00:00.000Z",
  allocations: [{ animalId: "animal-1", ration: ration.ration }, { animalId: "animal-2", ration: { ...ration.ration } }] };
const allocatedReport = compareRequirementToRationEvidence(requirement, groupRation, "animal-1", allocation);
assert.equal(allocatedReport.comparisons[0].suppliedValue, 8, "must compare the animal allocation, not the group total");
assert.deepEqual(allocatedReport.attribution.allocation, { allocationReviewId: "allocation-1",
  allocationMethod: "DOCUMENTED_INGREDIENT_WEIGHTS", allocationReviewedAt: "2026-10-07T08:00:00.000Z" });
assert.throws(() => compareRequirementToRationEvidence(requirement, groupRation, "animal-1", { ...allocation, farmId: "farm-2" }), /same farm/);
assert.throws(() => compareRequirementToRationEvidence(requirement, groupRation, "animal-1", { ...allocation,
  allocations: [{ animalId: "animal-2", ration: ration.ration }] }), /selected animal/);

console.log("requirement-ration-comparison.test.js: PASS");
