import { validateFeedEvidence } from "./feed-evidence.js";

const SOURCE_TYPES = new Set([
  "lab_report", "research_publication", "manufacturer_label",
  "farm_measurement", "documented_model", "other"
]);

const NUTRIENT_UNITS = Object.freeze({
  DM: Object.freeze({ AS_FED: new Set(["PERCENT", "G_PER_KG_AS_FED"]) }),
  ME: Object.freeze({ DRY_MATTER: new Set(["MJ_PER_KG_DM"]) }),
  CP: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) }),
  NDF: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) }),
  ADF: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) }),
  STARCH: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) }),
  FAT: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) }),
  ASH: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) }),
  CA: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) }),
  P: Object.freeze({ DRY_MATTER: new Set(["PERCENT", "G_PER_KG_DM"]) })
});

function text(value, label, maximum) {
  const result = String(value || "").trim().replace(/\s+/g, " ");
  if (!result || result.length > maximum) throw new Error(label + " is required and must not exceed " + maximum + " characters.");
  return result;
}

function finite(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(label + " must be a finite number.");
  return result;
}

function validateMagnitude(value, unit, label) {
  if (value < 0) throw new Error(label + " cannot be negative.");
  if (unit === "PERCENT" && value > 100) throw new Error(label + " cannot exceed 100 percent.");
  if ((unit === "G_PER_KG_DM" || unit === "G_PER_KG_AS_FED") && value > 1000) {
    throw new Error(label + " cannot exceed 1000 g/kg.");
  }
  return value;
}

export function validateNutritionSource(input) {
  if (!input || typeof input !== "object") throw new Error("Nutrition source is required.");
  if (!SOURCE_TYPES.has(input.sourceType)) throw new Error("Unsupported nutrition source type.");
  const url = String(input.url || "").trim();
  if (url && !/^https:\/\//i.test(url)) throw new Error("Source URL must use HTTPS.");
  const publicationYear = input.publicationYear == null || input.publicationYear === "" ? null : Number(input.publicationYear);
  if (publicationYear != null && (!Number.isSafeInteger(publicationYear) || publicationYear < 1800 || publicationYear > 2100)) {
    throw new Error("Publication year is outside the supported range.");
  }
  return Object.freeze({
    title: text(input.title, "Source title", 200),
    sourceType: input.sourceType,
    citation: text(input.citation, "Source citation or reference", 500),
    publisher: String(input.publisher || "").trim().slice(0, 200),
    publicationYear,
    url: url || null
  });
}

export function validateNutritionObservation(input) {
  if (!input || typeof input !== "object") throw new Error("Nutrition observation is required.");
  const nutrientCode = String(input.nutrientCode || "").trim().toUpperCase();
  const basis = input.basis;
  const unit = input.unit;
  const units = NUTRIENT_UNITS[nutrientCode]?.[basis];
  if (!units || !units.has(unit)) throw new Error("Nutrient, basis and unit are not compatible.");
  const evidence = validateFeedEvidence(input);
  const value = validateMagnitude(finite(input.value, "Nutrient value"), unit, "Nutrient value");
  const rangeMin = input.rangeMin == null || input.rangeMin === "" ? null :
    validateMagnitude(finite(input.rangeMin, "Range minimum"), unit, "Range minimum");
  const rangeMax = input.rangeMax == null || input.rangeMax === "" ? null :
    validateMagnitude(finite(input.rangeMax, "Range maximum"), unit, "Range maximum");
  if ((rangeMin == null) !== (rangeMax == null) || (rangeMin != null && (rangeMin > value || rangeMax < value || rangeMin > rangeMax))) {
    throw new Error("Evidence range must include the observed value.");
  }
  const sampleCount = input.sampleCount == null || input.sampleCount === "" ? null : Number(input.sampleCount);
  if (sampleCount != null && (!Number.isSafeInteger(sampleCount) || sampleCount < 1)) {
    throw new Error("Sample count must be a positive integer.");
  }
  return Object.freeze({ nutrientCode, value, unit, rangeMin, rangeMax, sampleCount, ...evidence });
}

export function buildNutritionProfile(feed, observations, sources) {
  if (!feed?.id) throw new Error("Feed identity is required.");
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const nutrients = {};
  for (const observation of observations) {
    const source = sourceById.get(observation.sourceId);
    if (!source) throw new Error("Nutrition evidence has no retained source record.");
    (nutrients[observation.nutrientCode] ||= []).push(Object.freeze({ ...observation, source }));
  }
  const conflicts = Object.entries(nutrients).filter(([, rows]) =>
    new Set(rows.map((row) => [row.value, row.unit, row.basis].join("|"))).size > 1).map(([code]) => code);
  return Object.freeze({ feed, nutrients: Object.freeze(nutrients), conflicts: Object.freeze(conflicts) });
}

export const nutritionSourceTypes = Object.freeze([...SOURCE_TYPES]);
export const nutritionNutrientCodes = Object.freeze(Object.keys(NUTRIENT_UNITS));
