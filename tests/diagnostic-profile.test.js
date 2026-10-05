import assert from "node:assert/strict";
import { currentDiagnosticProfileSelection, validateDiagnosticProfile,
  validateDiagnosticProfileSelection } from "../src/domain/feed/diagnostic-profile.js";

const valid = {
  name: "Synthetic lactating-cow screen", version: 1, animalClass: "LACTATING_DAIRY_COW",
  applicability: "Synthetic test only: lactating cows under the stated ration basis.",
  sourceTitle: "Synthetic source", sourceCitation: "TEST-CITATION-DIAGNOSTIC-001",
  sourceUrl: "https://example.invalid/source", publicationYear: 2021,
  minimumForageDMFraction: 0.4, minimumMEDensityMJPerKgDM: 10, minimumCPPercentDM: 13
};

assert.deepEqual(validateDiagnosticProfile(valid), valid);
for (const missing of ["animalClass", "applicability", "sourceTitle", "sourceCitation",
  "minimumForageDMFraction", "minimumMEDensityMJPerKgDM", "minimumCPPercentDM"]) {
  const input = { ...valid }; delete input[missing];
  assert.throws(() => validateDiagnosticProfile(input), /required|finite number|select a supported/i, missing);
}
assert.throws(() => validateDiagnosticProfile({ ...valid, animalClass: "ALL_ANIMALS" }), /animal class/i);
assert.throws(() => validateDiagnosticProfile({ ...valid, sourceUrl: "http://example.invalid" }), /HTTPS/i);
assert.deepEqual(validateDiagnosticProfileSelection({ profileId: "profile-1", rationale: "Reviewed for this herd class" }),
  { profileId: "profile-1", rationale: "Reviewed for this herd class" });
assert.throws(() => validateDiagnosticProfileSelection({ profileId: "profile-1" }), /rationale/i);

const selected = currentDiagnosticProfileSelection([
  { id: "a", profileId: "profile-1", selectedAt: "2026-01-01T00:00:00.000Z" },
  { id: "b", profileId: "profile-2", selectedAt: "2026-01-02T00:00:00.000Z" }
]);
assert.equal(selected.profileId, "profile-2");
assert.equal(currentDiagnosticProfileSelection([]), null);
console.log("diagnostic-profile.test.js: PASS");
