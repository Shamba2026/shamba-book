const PHYSIOLOGICAL_STAGES = new Set(["GROWING", "MATURE_MAINTENANCE", "PREGNANT", "POSTPARTUM", "OTHER_DOCUMENTED"]);
const LACTATION_STATUSES = new Set(["LACTATING", "DRY", "NOT_APPLICABLE", "UNKNOWN_DOCUMENTED"]);
const LACTATION_STAGES = new Set(["EARLY", "MID", "LATE", "OTHER_DOCUMENTED", "NOT_APPLICABLE"]);
const PRODUCTION_CONTEXTS = new Set(["DAIRY", "BEEF_GROWING", "BEEF_FINISHING", "BREEDING", "MAINTENANCE", "OTHER_DOCUMENTED"]);
const WEIGHT_METHODS = new Set(["SCALE_MEASURED", "WEIGH_TAPE_ESTIMATED", "OTHER_DOCUMENTED"]);
const EVIDENCE_TYPES = new Set(["DIRECT_MEASUREMENT", "FARM_RECORD", "VETERINARY_ASSESSMENT", "DOCUMENTED_GUIDANCE", "OTHER_DOCUMENTED"]);
const EVIDENCE_DECISIONS = new Set(["CONFIRMED", "NEEDS_CORRECTION", "REJECTED"]);
const APPLICABILITY_DECISIONS = new Set(["NOT_ASSESSED", "APPLICABLE", "NOT_APPLICABLE", "NEEDS_REVIEW"]);

function requiredText(value, label, max) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || text.length > max) throw new Error(`${label} is required and must be at most ${max} characters.`);
  return text;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`Select a valid ${label}.`);
  return value;
}

function dateValue(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error("Observation date is required and must be valid.");
  }
  return date;
}

export function validateAnimalNutritionClassification(input) {
  const liveWeightKg = Number(input?.liveWeightKg);
  if (!Number.isFinite(liveWeightKg) || liveWeightKg <= 0 || liveWeightKg > 2500) {
    throw new Error("Live weight must be greater than 0 and no more than 2500 kg.");
  }
  const lactationStatus = enumValue(input?.lactationStatus, LACTATION_STATUSES, "lactation status");
  const lactationStage = enumValue(input?.lactationStage, LACTATION_STAGES, "lactation stage");
  if (lactationStatus === "LACTATING" && lactationStage === "NOT_APPLICABLE") {
    throw new Error("A lactating animal requires a documented lactation stage.");
  }
  if (lactationStatus !== "LACTATING" && lactationStage !== "NOT_APPLICABLE") {
    throw new Error("Lactation stage must be not applicable unless the animal is lactating.");
  }
  const milk = input?.averageDailyMilkLiters;
  const productionWindowDays = input?.productionWindowDays;
  const hasMilk = milk !== "" && milk !== null && milk !== undefined;
  const hasWindow = productionWindowDays !== "" && productionWindowDays !== null && productionWindowDays !== undefined;
  if (hasMilk !== hasWindow) throw new Error("Milk production and its observation window must be recorded together.");
  const averageDailyMilkLiters = hasMilk ? Number(milk) : null;
  const windowDays = hasWindow ? Number(productionWindowDays) : null;
  if (hasMilk && (!Number.isFinite(averageDailyMilkLiters) || averageDailyMilkLiters < 0 || averageDailyMilkLiters > 150)) {
    throw new Error("Average daily milk must be between 0 and 150 litres.");
  }
  if (hasWindow && (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365)) {
    throw new Error("Production observation window must be between 1 and 365 days.");
  }
  const sourceUrl = String(input?.sourceUrl || "").trim();
  if (sourceUrl && !sourceUrl.startsWith("https://")) throw new Error("Evidence link must use HTTPS.");
  return Object.freeze({
    observedAt: dateValue(input?.observedAt),
    liveWeightKg,
    weightMethod: enumValue(input?.weightMethod, WEIGHT_METHODS, "weight method"),
    physiologicalStage: enumValue(input?.physiologicalStage, PHYSIOLOGICAL_STAGES, "physiological stage"),
    lactationStatus,
    lactationStage,
    productionContext: enumValue(input?.productionContext, PRODUCTION_CONTEXTS, "production context"),
    averageDailyMilkLiters,
    productionWindowDays: windowDays,
    evidenceType: enumValue(input?.evidenceType, EVIDENCE_TYPES, "evidence type"),
    sourceTitle: requiredText(input?.sourceTitle, "Evidence source title", 200),
    sourceCitation: requiredText(input?.sourceCitation, "Evidence citation or reference", 500),
    sourceUrl,
    applicabilityNotes: requiredText(input?.applicabilityNotes, "Classification basis and limitations", 1000)
  });
}

export function validateAnimalNutritionReview(input) {
  const evidenceDecision = enumValue(input?.evidenceDecision, EVIDENCE_DECISIONS, "evidence decision");
  const applicabilityDecision = enumValue(input?.applicabilityDecision, APPLICABILITY_DECISIONS, "applicability decision");
  const profileId = String(input?.profileId || "").trim() || null;
  if (profileId && applicabilityDecision === "NOT_ASSESSED") throw new Error("Record an applicability decision for the selected profile.");
  if (!profileId && applicabilityDecision !== "NOT_ASSESSED") throw new Error("Select a diagnostic profile before recording applicability.");
  if (applicabilityDecision === "APPLICABLE" && evidenceDecision !== "CONFIRMED") {
    throw new Error("Only confirmed classification evidence can be marked applicable.");
  }
  if (input?.reviewerConfirmed !== true) throw new Error("Reviewer confirmation is required.");
  return Object.freeze({ evidenceDecision, applicabilityDecision, profileId,
    reviewerUserId: requiredText(input?.reviewerUserId, "Authenticated reviewer", 100),
    rationale: requiredText(input?.rationale, "Review rationale", 1000), reviewerConfirmed: true });
}

export function currentDiagnosticApplicabilityEvidence({ animal, profile, classifications, reviews }) {
  const classification = classifications.filter((row) => row.animalId === animal.id)
    .sort((a, b) => b.version - a.version || String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const review = classification ? reviews.filter((row) => row.animalId === animal.id &&
    row.classificationId === classification.id && row.profileId === profile.id)
    .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)) || b.id.localeCompare(a.id))[0] : null;
  if (!classification || !review || review.evidenceDecision !== "CONFIRMED" ||
    review.applicabilityDecision !== "APPLICABLE" || review.reviewerConfirmed !== true) {
    throw new Error(`${animal.animalCode} requires a confirmed review of its latest classification for this exact diagnostic profile.`);
  }
  return Object.freeze({ animalId: animal.id, animalCode: animal.animalCode, classificationId: classification.id,
    classificationVersion: classification.version, reviewId: review.id, reviewerUserId: review.reviewerUserId,
    reviewedAt: review.reviewedAt });
}
