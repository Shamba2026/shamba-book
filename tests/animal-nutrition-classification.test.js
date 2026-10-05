import assert from "node:assert/strict";
import { validateAnimalNutritionClassification } from "../src/domain/animal-nutrition-classification.js";

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
console.log("animal-nutrition-classification.test.js: PASS");
