import assert from "node:assert/strict";
import { calculateRequirements, validateRequirementApproval, validateRequirementProfile } from "../src/domain/nutrition-requirement.js";

const profile = validateRequirementProfile({ name: "Synthetic governed profile", version: 1, animalClass: "LACTATING_DAIRY_COW",
  applicability: "Synthetic tests only; source-specific applicability must be reviewed.", nutrientSystem: "TEST SYSTEM",
  sourceTitle: "Synthetic source", sourceCitation: "TEST-REQ-001", sourceUrl: "https://example.test/source", publicationYear: 2021,
  equations: [{ outputCode: "DMI_KG_DAY", outputUnit: "kg DM/day", equationReference: "Synthetic equation A",
    terms: [{ factor: "CONSTANT", coefficient: 1, exponent: 0 }, { factor: "LIVE_WEIGHT_KG", coefficient: 0.02, exponent: 1 }] }] });
assert.equal(profile.equations[0].terms.length, 2);
assert.throws(() => validateRequirementProfile({ ...profile, sourceUrl: "http://unsafe.test" }), /HTTPS/);
assert.throws(() => validateRequirementProfile({ ...profile, equations: [{ ...profile.equations[0], outputUnit: "kg/day" }] }), /unit/);
assert.throws(() => validateRequirementProfile({ ...profile, equations: [{ ...profile.equations[0], terms: [{ factor: "BCS", coefficient: 1, exponent: 1 }] }] }), /unsupported/);
assert.throws(() => validateRequirementApproval({ reviewerUserId: "reviewer", rationale: "Reviewed", reviewerConfirmed: false }), /confirmation/);

const approved = { id: "profile-1", ...profile, status: "approved" };
const approval = { id: "approval-1", profileId: approved.id, reviewerConfirmed: true };
const animal = { id: "cow-1" };
const classification = { id: "class-1", animalId: animal.id, liveWeightKg: 500, averageDailyMilkLiters: 20 };
const classificationReview = { id: "class-review-1", classificationId: classification.id, evidenceDecision: "CONFIRMED", reviewerConfirmed: true };
assert.throws(() => calculateRequirements({ profile: approved, approval, animal, classification, classificationReview, confirmed: false }), /confirmation/);
const result = calculateRequirements({ profile: approved, approval, animal, classification, classificationReview, confirmed: true });
assert.deepEqual(result.outputs, [{ outputCode: "DMI_KG_DAY", outputUnit: "kg DM/day", value: 11, equationReference: "Synthetic equation A" }]);
assert.equal(result.classificationReviewId, classificationReview.id);
console.log("nutrition-requirement.test.js: PASS");
