import assert from "node:assert/strict";
import { currentDiagnosticApplicabilityEvidence, validateAnimalNutritionClassification,
  validateAnimalNutritionReview } from "../src/domain/animal-nutrition-classification.js";

const valid = { observedAt: "2026-10-05", liveWeightKg: "475.5", weightMethod: "SCALE_MEASURED",
  physiologicalStage: "POSTPARTUM", lactationStatus: "LACTATING", lactationStage: "EARLY",
  productionContext: "DAIRY", averageDailyMilkLiters: "18.4", productionWindowDays: "7",
  evidenceType: "FARM_RECORD", sourceTitle: "Seven-day milk and scale review",
  sourceCitation: "TEST-CLASSIFICATION-001", sourceUrl: "https://example.test/evidence",
  applicabilityNotes: "Synthetic test evidence only; not a nutrient requirement or recommendation." };

const result = validateAnimalNutritionClassification(valid);
assert.equal(result.liveWeightKg, 475.5);
assert.equal(result.productionWindowDays, 7);
assert.equal(Object.isFrozen(result), true);
assert.throws(() => validateAnimalNutritionClassification({ ...valid, liveWeightKg: 0 }), /Live weight/);
assert.throws(() => validateAnimalNutritionClassification({ ...valid, lactationStatus: "DRY" }), /not applicable/);
assert.throws(() => validateAnimalNutritionClassification({ ...valid, lactationStage: "NOT_APPLICABLE" }), /requires/);
assert.throws(() => validateAnimalNutritionClassification({ ...valid, productionWindowDays: "" }), /together/);
assert.throws(() => validateAnimalNutritionClassification({ ...valid, sourceUrl: "http://example.test" }), /HTTPS/);
assert.throws(() => validateAnimalNutritionClassification({ ...valid, physiologicalStage: "INFERRED" }), /physiological stage/);

const nonLactating = validateAnimalNutritionClassification({ ...valid, lactationStatus: "NOT_APPLICABLE",
  lactationStage: "NOT_APPLICABLE", averageDailyMilkLiters: "", productionWindowDays: "" });
assert.equal(nonLactating.averageDailyMilkLiters, null);
const review = validateAnimalNutritionReview({ evidenceDecision: "CONFIRMED", applicabilityDecision: "APPLICABLE",
  profileId: "profile-1", reviewerUserId: "reviewer-1", rationale: "Evidence and profile applicability reviewed.", reviewerConfirmed: true });
assert.equal(review.applicabilityDecision, "APPLICABLE");
assert.throws(() => validateAnimalNutritionReview({ ...review, evidenceDecision: "NEEDS_CORRECTION" }), /confirmed/);
assert.throws(() => validateAnimalNutritionReview({ ...review, profileId: "", applicabilityDecision: "APPLICABLE" }), /Select a diagnostic profile/);

const animal = { id: "animal-1", animalCode: "TEST-COW" }; const profile = { id: "profile-1" };
const classifications = [{ id: "classification-1", animalId: animal.id, version: 1, createdAt: "2026-10-05T00:00:00Z" },
  { id: "classification-2", animalId: animal.id, version: 2, createdAt: "2026-10-06T00:00:00Z" }];
const applicableReview = { id: "review-1", animalId: animal.id, classificationId: "classification-2", profileId: profile.id,
  evidenceDecision: "CONFIRMED", applicabilityDecision: "APPLICABLE", reviewerConfirmed: true,
  reviewerUserId: "reviewer-1", reviewedAt: "2026-10-06T01:00:00Z" };
assert.equal(currentDiagnosticApplicabilityEvidence({ animal, profile, classifications, reviews: [applicableReview] }).reviewId, "review-1");
assert.throws(() => currentDiagnosticApplicabilityEvidence({ animal, profile, classifications,
  reviews: [{ ...applicableReview, profileId: "profile-2" }] }), /exact diagnostic profile/);
assert.throws(() => currentDiagnosticApplicabilityEvidence({ animal, profile, classifications,
  reviews: [{ ...applicableReview, classificationId: "classification-1" }] }), /latest classification/);
assert.throws(() => currentDiagnosticApplicabilityEvidence({ animal, profile, classifications,
  reviews: [applicableReview, { ...applicableReview, id: "review-2", applicabilityDecision: "NOT_APPLICABLE",
    reviewedAt: "2026-10-06T02:00:00Z" }] }), /confirmed review/);
assert.throws(() => validateAnimalNutritionReview({ ...review, reviewerConfirmed: false }), /confirmation/);
console.log("animal-nutrition-classification.test.js: PASS");
