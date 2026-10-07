import assert from "node:assert/strict";
import { assessComparisonEvidenceCurrency, requireCurrentComparisonEvidence } from
  "../src/domain/feed/comparison-evidence-currency.js";

const requirement = { profileId: "req-profile", profileVersion: 2, classificationId: "class-2" };
const rationReview = { profileId: "diag-profile", profileVersion: 3, selectionId: "selection-3" };
const input = { requirement, rationReview,
  requirementProfile: { id: "req-profile", version: 2, status: "approved" },
  latestClassification: { id: "class-2", version: 2 },
  selectedDiagnostic: { profile: { id: "diag-profile", version: 3 }, selection: { id: "selection-3" } } };

assert.deepEqual(assessComparisonEvidenceCurrency(input), { eligible: true, reasons: [] });
assert.equal(Object.isFrozen(assessComparisonEvidenceCurrency(input)), true);
assert.equal(assessComparisonEvidenceCurrency({ ...input,
  requirementProfile: { ...input.requirementProfile, status: "revoked" } }).reasons[0].code, "REQUIREMENT_PROFILE_NOT_CURRENT");
assert.equal(assessComparisonEvidenceCurrency({ ...input,
  latestClassification: { id: "class-3", version: 3 } }).reasons[0].code, "CLASSIFICATION_SUPERSEDED");
assert.equal(assessComparisonEvidenceCurrency({ ...input,
  selectedDiagnostic: { ...input.selectedDiagnostic, selection: { id: "selection-4" } } }).reasons[0].code, "RATION_REVIEW_NOT_CURRENT");
assert.throws(() => requireCurrentComparisonEvidence({ ...input, selectedDiagnostic: null }), /not current/);

console.log("comparison-evidence-currency.test.js: PASS");
