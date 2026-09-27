import assert from "node:assert/strict";
import { evaluateRation } from "../src/domain/feed/ration-diagnostics.js";

const profile = {
  id: "synthetic-dairy-screen-v1",
  version: 1,
  minimumForageDMFraction: 0.4,
  minimumMEDensityMJPerKgDM: 10,
  minimumCPPercentDM: 13
};

const findings = evaluateRation({
  totalDMIKg: 10,
  forageDMKg: 3,
  meDensityMJPerKgDM: 9.5,
  cpPercentDM: 12
}, profile);

assert.deepEqual(findings.map((finding) => finding.code), [
  "LOW_FORAGE_DM_SHARE",
  "LOW_ME_DENSITY",
  "LOW_CP_PERCENT_DM"
]);
assert.equal(findings.every((finding) => finding.profileId === profile.id), true);

assert.deepEqual(evaluateRation({
  totalDMIKg: 10,
  forageDMKg: 5,
  meDensityMJPerKgDM: 10.5,
  cpPercentDM: 14
}, profile), [{
  code: "NO_CONFIGURED_THRESHOLD_TRIGGERED",
  severity: "info",
  profileId: profile.id,
  profileVersion: profile.version
}]);

assert.throws(
  () => evaluateRation({ totalDMIKg: 10, forageDMKg: 5, meDensityMJPerKgDM: 10, cpPercentDM: 13 }, {}),
  /diagnostic profile/
);

console.log("ration-diagnostics.test.js: PASS");
