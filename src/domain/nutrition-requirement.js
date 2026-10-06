const ANIMAL_CLASSES = new Set(["LACTATING_DAIRY_COW", "DRY_DAIRY_COW", "GROWING_BEEF", "FINISHING_BEEF", "BREEDING_BEEF", "OTHER_DOCUMENTED"]);
const FACTORS = new Set(["CONSTANT", "LIVE_WEIGHT_KG", "AVERAGE_DAILY_MILK_LITERS"]);
const OUTPUTS = new Map([["DMI_KG_DAY", "kg DM/day"], ["ME_MJ_DAY", "MJ ME/day"], ["NEL_MCAL_DAY", "Mcal NEL/day"], ["CP_KG_DAY", "kg CP/day"], ["MP_G_DAY", "g MP/day"]]);
const APPLICABILITY_DECISIONS = new Set(["APPLICABLE", "NOT_APPLICABLE", "NEEDS_REVIEW"]);

function text(value, label, max) { const result = String(value || "").trim().replace(/\s+/g, " ");
  if (!result || result.length > max) throw new Error(`${label} is required and must be at most ${max} characters.`); return result; }
function positiveInteger(value, label, max = 3000) { const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${label} must be a positive whole number.`); return number; }

export function validateRequirementProfile(input) {
  if (!ANIMAL_CLASSES.has(input?.animalClass)) throw new Error("Select a supported animal class.");
  const sourceUrl = String(input?.sourceUrl || "").trim();
  if (sourceUrl && !sourceUrl.startsWith("https://")) throw new Error("Source link must use HTTPS.");
  const equations = Array.isArray(input?.equations) ? input.equations.map((equation, equationIndex) => {
    if (!OUTPUTS.has(equation?.outputCode)) throw new Error("Select a supported requirement output.");
    if (equation?.outputUnit !== OUTPUTS.get(equation.outputCode)) throw new Error("Requirement output unit does not match its metric.");
    const terms = Array.isArray(equation?.terms) ? equation.terms.map((term) => {
      if (!FACTORS.has(term?.factor)) throw new Error("Requirement equation uses an unsupported input factor.");
      const coefficient = Number(term?.coefficient); const exponent = Number(term?.exponent);
      if (!Number.isFinite(coefficient) || !Number.isFinite(exponent)) throw new Error("Every equation term requires finite coefficients and exponents.");
      if (term.factor === "CONSTANT" && exponent !== 0) throw new Error("A constant term must use exponent zero.");
      return Object.freeze({ factor: term.factor, coefficient, exponent });
    }) : [];
    if (!terms.length) throw new Error(`Equation ${equationIndex + 1} requires at least one sourced term.`);
    return Object.freeze({ outputCode: equation.outputCode, outputUnit: equation.outputUnit,
      equationReference: text(equation.equationReference, "Equation reference", 500), terms: Object.freeze(terms) });
  }) : [];
  if (!equations.length) throw new Error("At least one sourced requirement equation is required.");
  if (new Set(equations.map((row) => row.outputCode)).size !== equations.length) throw new Error("A profile cannot repeat a requirement output.");
  const supersessionRationale = String(input?.supersessionRationale || "").trim().replace(/\s+/g, " ") || null;
  if (supersessionRationale?.length > 1000) throw new Error("Supersession rationale must be at most 1000 characters.");
  return Object.freeze({ name: text(input?.name, "Profile name", 120), version: positiveInteger(input?.version, "Profile version"),
    animalClass: input.animalClass, applicability: text(input?.applicability, "Applicability and limitations", 1000),
    nutrientSystem: text(input?.nutrientSystem, "Nutrient system", 120), sourceTitle: text(input?.sourceTitle, "Source title", 200),
    sourceCitation: text(input?.sourceCitation, "Source citation", 500), sourceUrl,
    publicationYear: positiveInteger(input?.publicationYear, "Publication year", new Date().getUTCFullYear()),
    supersessionRationale,
    equations: Object.freeze(equations) });
}

export function validateRequirementApproval(input) {
  if (input?.reviewerConfirmed !== true) throw new Error("Reviewer confirmation is required.");
  return Object.freeze({ reviewerUserId: text(input?.reviewerUserId, "Authenticated reviewer", 100),
    rationale: text(input?.rationale, "Approval rationale", 1000), reviewerConfirmed: true });
}

export function validateRequirementReview(input, action) {
  if (!new Set(["REVOKED"]).has(action)) throw new Error("Unsupported requirement-profile review action.");
  if (input?.reviewerConfirmed !== true) throw new Error("Reviewer confirmation is required.");
  return Object.freeze({ reviewerUserId: text(input?.reviewerUserId, "Authenticated reviewer", 100),
    rationale: text(input?.rationale, "Review rationale", 1000), reviewerConfirmed: true });
}

export function validateRequirementApplicability(input) {
  if (!APPLICABILITY_DECISIONS.has(input?.decision)) throw new Error("Select a valid applicability decision.");
  if (input?.reviewerConfirmed !== true) throw new Error("Reviewer confirmation is required.");
  return Object.freeze({ decision: input.decision, reviewerUserId: text(input?.reviewerUserId, "Authenticated reviewer", 100),
    rationale: text(input?.rationale, "Applicability rationale", 1000), reviewerConfirmed: true });
}

export function calculateRequirements({ profile, approval, applicabilityReview, animal, classification, classificationReview, confirmed }) {
  if (profile?.status !== "approved" || approval?.profileId !== profile.id || approval?.reviewerConfirmed !== true)
    throw new Error("An explicitly approved requirement profile is required.");
  if (confirmed !== true) throw new Error("Explicit calculation confirmation is required.");
  if (!animal || classification?.animalId !== animal.id || classificationReview?.classificationId !== classification.id ||
      classificationReview?.evidenceDecision !== "CONFIRMED" || classificationReview?.reviewerConfirmed !== true)
    throw new Error("A confirmed review of the selected animal classification is required.");
  if (applicabilityReview?.profileId !== profile.id || applicabilityReview?.classificationId !== classification.id ||
      applicabilityReview?.decision !== "APPLICABLE" || applicabilityReview?.reviewerConfirmed !== true)
    throw new Error("Explicit applicability approval for this exact profile and classification is required.");
  const inputs = { LIVE_WEIGHT_KG: Number(classification.liveWeightKg),
    AVERAGE_DAILY_MILK_LITERS: classification.averageDailyMilkLiters == null ? null : Number(classification.averageDailyMilkLiters) };
  const outputs = profile.equations.map((equation) => { const value = equation.terms.reduce((sum, term) => {
      if (term.factor === "CONSTANT") return sum + term.coefficient; const input = inputs[term.factor];
      if (!Number.isFinite(input)) throw new Error(`Classification lacks required factor ${term.factor}.`);
      return sum + term.coefficient * (input ** term.exponent); }, 0);
    if (!Number.isFinite(value) || value < 0) throw new Error("Requirement equation produced an invalid result.");
    return Object.freeze({ outputCode: equation.outputCode, outputUnit: equation.outputUnit, value: Number(value.toFixed(6)), equationReference: equation.equationReference }); });
  return Object.freeze({ profileId: profile.id, profileVersion: profile.version, approvalId: approval.id, animalId: animal.id,
    classificationId: classification.id, classificationReviewId: classificationReview.id,
    applicabilityReviewId: applicabilityReview.id, inputs: Object.freeze(inputs), outputs: Object.freeze(outputs) });
}

export const requirementOutputUnits = Object.freeze(Object.fromEntries(OUTPUTS));
