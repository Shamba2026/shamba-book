const EVIDENCE_CLASSES = new Set([
  "VERIFIED_LAB",
  "RESEARCH_SUPPORTED",
  "MANUFACTURER_DECLARED",
  "CALCULATED",
  "MODEL_ESTIMATED",
  "RANGE_ESTIMATE",
  "FARM_MEASURED",
  "PROVISIONAL",
  "UNKNOWN"
]);

const NUTRIENT_BASES = new Set(["AS_FED", "DRY_MATTER"]);

export function validateFeedEvidence(input) {
  if (!input || typeof input !== "object") throw new Error("Feed evidence is required.");
  const sourceId = String(input.sourceId || "").trim();
  if (!sourceId) throw new Error("A source ID is required for feed evidence.");
  if (!EVIDENCE_CLASSES.has(input.evidenceClass)) throw new Error("Unsupported evidence class.");
  if (!NUTRIENT_BASES.has(input.basis)) throw new Error("Unsupported nutrient basis.");
  if (input.observedAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.observedAt)) {
    throw new Error("Evidence date must use YYYY-MM-DD.");
  }
  return Object.freeze({
    sourceId,
    evidenceClass: input.evidenceClass,
    basis: input.basis,
    observedAt: input.observedAt || null,
    context: String(input.context || "").trim()
  });
}

export const feedEvidenceClasses = Object.freeze([...EVIDENCE_CLASSES]);
export const feedNutrientBases = Object.freeze([...NUTRIENT_BASES]);
