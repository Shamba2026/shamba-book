import assert from "node:assert/strict";
import { buildNutritionEvidenceStatus, summarizeHerdNutritionEvidence } from "../src/domain/feed/nutrition-evidence-status.js";

const base = {
  animalId: "cow-1",
  classifications: [{ id: "class-2", version: 2, createdAt: "2026-10-07T10:00:00Z" }],
  classificationReviews: [{ id: "class-review", classificationId: "class-2", evidenceDecision: "CONFIRMED",
    reviewerConfirmed: true, reviewedAt: "2026-10-07T10:10:00Z" }],
  requirementProfiles: [{ id: "requirement-profile-1", status: "approved" }],
  requirementCalculations: [{ id: "requirement-2", profileId: "requirement-profile-1", classificationId: "class-2",
    calculatedAt: "2026-10-07T10:15:00Z" }],
  rationReviews: [{ id: "ration-2", profileId: "profile-1", profileVersion: 1, selectionId: "selection-1",
    rationBasis: "DAILY_OFFERED_RATION", rationBasisConfirmed: true, animalGroup: [{ id: "cow-1" }] }],
  allocationReviews: [],
  comparisonReviews: [{ id: "comparison-old", requirementCalculationId: "requirement-2", rationReviewId: "ration-2",
    allocationReviewId: null, reviewedAt: "2026-10-07T10:20:00Z" },
  { id: "comparison-current", requirementCalculationId: "requirement-2", rationReviewId: "ration-2",
    allocationReviewId: null, supersedesReviewId: "comparison-old", reviewedAt: "2026-10-07T10:30:00Z" }],
  selectedDiagnostic: { profile: { id: "profile-1", version: 1 }, selection: { id: "selection-1" } }
};

const status = buildNutritionEvidenceStatus(base);
assert.deepEqual(status.stages.map((row) => row.state), ["CURRENT", "CURRENT", "CURRENT", "CURRENT", "CURRENT"]);
assert.equal(status.stages[4].evidenceId, "comparison-current");
assert.equal(Object.isFrozen(status.stages), true);

const stale = buildNutritionEvidenceStatus({ ...base,
  classifications: [{ id: "class-3", version: 3, createdAt: "2026-10-07T11:00:00Z" }], classificationReviews: [] });
assert.deepEqual(stale.stages.map((row) => row.state), ["CURRENT", "REVIEW_REQUIRED", "STALE", "CURRENT", "REVIEW_REQUIRED"]);

const groupWithoutAllocation = buildNutritionEvidenceStatus({ ...base, rationReviews: [{ ...base.rationReviews[0],
  animalGroup: [{ id: "cow-1" }, { id: "cow-2" }] }] });
assert.equal(groupWithoutAllocation.stages[3].state, "MISSING");
assert.equal(groupWithoutAllocation.stages[4].state, "REVIEW_REQUIRED");

const revokedRequirement = buildNutritionEvidenceStatus({ ...base,
  requirementProfiles: [{ id: "requirement-profile-1", status: "revoked" }] });
assert.equal(revokedRequirement.stages[2].state, "STALE");
assert.equal(revokedRequirement.stages[4].state, "REVIEW_REQUIRED");

const empty = buildNutritionEvidenceStatus({ animalId: "cow-1" });
assert.deepEqual(empty.stages.map((row) => row.state), ["MISSING", "BLOCKED", "MISSING", "MISSING", "REVIEW_REQUIRED"]);

const herd = summarizeHerdNutritionEvidence([
  { animalId: "cow-1", animalCode: "COW-1", stages: status.stages },
  { animalId: "cow-2", animalCode: "COW-2", stages: stale.stages }
]);
assert.deepEqual({ totalAnimals: herd.totalAnimals, completeAnimals: herd.completeAnimals,
  attentionAnimals: herd.attentionAnimals }, { totalAnimals: 2, completeAnimals: 1, attentionAnimals: 1 });
assert.equal(herd.animals[0].evidenceComplete, false, "animals needing review must be listed first");
assert.deepEqual(herd.animals[0].outstanding.map((row) => row.code),
  ["CLASSIFICATION_REVIEW", "REQUIREMENT_CALCULATION", "COMPARISON_REVIEW"]);
assert.equal(Object.isFrozen(herd.animals), true);

console.log("nutrition-evidence-status.test.js: PASS");
