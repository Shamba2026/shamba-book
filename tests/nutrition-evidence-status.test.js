import assert from "node:assert/strict";
import { buildNutritionEvidenceStatus } from "../src/domain/feed/nutrition-evidence-status.js";

const base = {
  animalId: "cow-1",
  classifications: [{ id: "class-2", version: 2, createdAt: "2026-10-07T10:00:00Z" }],
  classificationReviews: [{ id: "class-review", classificationId: "class-2", evidenceDecision: "CONFIRMED",
    reviewerConfirmed: true, reviewedAt: "2026-10-07T10:10:00Z" }],
  requirementCalculations: [{ id: "requirement-2", classificationId: "class-2" }],
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

const empty = buildNutritionEvidenceStatus({ animalId: "cow-1" });
assert.deepEqual(empty.stages.map((row) => row.state), ["MISSING", "BLOCKED", "MISSING", "MISSING", "REVIEW_REQUIRED"]);

console.log("nutrition-evidence-status.test.js: PASS");
