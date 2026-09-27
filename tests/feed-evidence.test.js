import assert from "node:assert/strict";
import { validateFeedEvidence } from "../src/domain/feed/feed-evidence.js";

const evidence = validateFeedEvidence({
  sourceId: "KALRO-MANUAL-2024",
  evidenceClass: "RESEARCH_SUPPORTED",
  basis: "DRY_MATTER",
  observedAt: "2026-09-27",
  context: "Illustrative source value; not a farm batch analysis"
});

assert.equal(evidence.sourceId, "KALRO-MANUAL-2024");
assert.equal(evidence.evidenceClass, "RESEARCH_SUPPORTED");

assert.throws(
  () => validateFeedEvidence({ ...evidence, sourceId: "" }),
  /source ID/
);

assert.throws(
  () => validateFeedEvidence({ ...evidence, evidenceClass: "CERTAIN" }),
  /evidence class/
);

assert.throws(
  () => validateFeedEvidence({ ...evidence, basis: "UNKNOWN_BASIS" }),
  /nutrient basis/
);

console.log("feed-evidence.test.js: PASS");
