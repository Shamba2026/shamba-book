export const DIAGNOSTIC_ANIMAL_CLASSES = Object.freeze([
  "LACTATING_DAIRY_COW", "DRY_DAIRY_COW", "GROWING_HEIFER",
  "BEEF_GROWER", "BEEF_FINISHER", "OTHER"
]);

function text(value, label, maximum) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum) throw new Error(label + " is required and must be at most " + maximum + " characters.");
  return normalized;
}

function number(value, label) {
  if (value === "" || value === null || value === undefined) throw new Error(label + " is required.");
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error(label + " must be a finite number.");
  return normalized;
}

export function validateDiagnosticProfile(input) {
  const animalClass = String(input?.animalClass || "");
  if (!DIAGNOSTIC_ANIMAL_CLASSES.includes(animalClass)) throw new Error("Select a supported animal class.");
  const version = number(input?.version, "Profile version");
  const publicationYear = number(input?.publicationYear, "Publication year");
  const sourceUrl = String(input?.sourceUrl || "").trim();
  const forage = number(input?.minimumForageDMFraction, "Minimum forage DM fraction");
  const me = number(input?.minimumMEDensityMJPerKgDM, "Minimum ME density");
  const cp = number(input?.minimumCPPercentDM, "Minimum CP percentage");
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Profile version must be a positive integer.");
  if (!Number.isSafeInteger(publicationYear) || publicationYear < 1800 || publicationYear > 2100) throw new Error("Publication year is outside the supported range.");
  if (sourceUrl && !sourceUrl.startsWith("https://")) throw new Error("Source URL must use HTTPS.");
  if (forage < 0 || forage > 1 || me < 0 || me > 50 || cp < 0 || cp > 100) throw new Error("Diagnostic profile thresholds are outside supported ranges.");
  return {
    name: text(input?.name, "Profile name", 160), version, animalClass,
    applicability: text(input?.applicability, "Applicability", 1000),
    sourceTitle: text(input?.sourceTitle, "Source title", 200),
    sourceCitation: text(input?.sourceCitation, "Source citation", 500),
    sourceUrl, publicationYear, minimumForageDMFraction: forage,
    minimumMEDensityMJPerKgDM: me, minimumCPPercentDM: cp
  };
}

export function validateDiagnosticProfileSelection(input) {
  const profileId = text(input?.profileId, "Diagnostic profile", 100);
  const rationale = text(input?.rationale, "Selection rationale", 500);
  const animalIds = [...new Set(Array.isArray(input?.animalIds) ? input.animalIds.map((id) => String(id).trim()).filter(Boolean) : [])];
  if (!animalIds.length) throw new Error("Select at least one animal for the applicability group.");
  if (input?.applicabilityConfirmed !== true) throw new Error("Confirm that the profile applicability was reviewed against the selected animal group.");
  return { profileId, rationale, animalIds, applicabilityConfirmed: true };
}

export function currentDiagnosticProfileSelection(events) {
  return [...events].sort((a, b) => b.selectedAt.localeCompare(a.selectedAt) || b.id.localeCompare(a.id))[0] || null;
}
