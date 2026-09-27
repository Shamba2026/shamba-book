import assert from "node:assert/strict";
import { buildNutritionProfile, validateNutritionObservation, validateNutritionSource } from "../src/domain/feed/nutrition-profile.js";

const source = validateNutritionSource({ title: "Synthetic laboratory report", sourceType: "lab_report",
  citation: "TEST-REPORT-001", publisher: "Synthetic test laboratory", publicationYear: 2026 });
assert.equal(source.citation, "TEST-REPORT-001");
assert.throws(() => validateNutritionSource({ ...source, citation: "" }), /citation/);
assert.throws(() => validateNutritionSource({ ...source, url: "http://example.invalid" }), /HTTPS/);

const observation = validateNutritionObservation({ nutrientCode: "cp", value: 120, unit: "G_PER_KG_DM",
  basis: "DRY_MATTER", sourceId: "source-a", evidenceClass: "VERIFIED_LAB", sampleCount: 2,
  rangeMin: 110, rangeMax: 130, observedAt: "2026-09-27", context: "Synthetic test only" });
assert.equal(observation.nutrientCode, "CP");
assert.throws(() => validateNutritionObservation({ ...observation, basis: "AS_FED" }), /not compatible/);
assert.throws(() => validateNutritionObservation({ ...observation, rangeMin: 121 }), /include/);

const profile = buildNutritionProfile({ id: "feed-a", name: "Synthetic feed" }, [
  { id: "obs-a", status: "active", ...observation },
  { id: "obs-b", status: "active", ...observation, sourceId: "source-b", value: 150 }
], [
  { id: "source-a", title: "Source A" }, { id: "source-b", title: "Source B" }
]);
assert.equal(profile.nutrients.CP.length, 2);
assert.deepEqual(profile.conflicts, ["CP"]);
assert.equal("average" in profile, false);
assert.throws(() => buildNutritionProfile({ id: "feed-a" }, [{ ...observation, status: "active" }], []), /no retained source/);

console.log("nutrition-profile.test.js: PASS");
