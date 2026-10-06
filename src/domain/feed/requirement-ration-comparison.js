const METRICS = Object.freeze({
  DMI_KG_DAY: Object.freeze({ unit: "kg DM/day", supply: (ration) => ration.totalDMIKg, derivation: "Retained ration dry matter" }),
  ME_MJ_DAY: Object.freeze({ unit: "MJ ME/day", supply: (ration) => ration.totalDMIKg * ration.meDensityMJPerKgDM,
    derivation: "Retained ration dry matter × retained ME density" }),
  CP_KG_DAY: Object.freeze({ unit: "kg CP/day", supply: (ration) => ration.totalDMIKg * ration.cpPercentDM / 100,
    derivation: "Retained ration dry matter × retained CP percentage" })
});

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required.");
  return text;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(label + " must be a non-negative finite number.");
  return number;
}

function rounded(value) { return Number(value.toFixed(6)); }

const REVIEW_DECISIONS = new Set(["ACKNOWLEDGED", "NEEDS_EVIDENCE_REVIEW", "NOT_APPLICABLE"]);

export function validateComparisonReview(input) {
  if (!REVIEW_DECISIONS.has(input?.decision)) throw new Error("Select a supported comparison review decision.");
  const rationale = requiredText(input?.rationale, "Review rationale");
  if (rationale.length < 10 || rationale.length > 1000) throw new Error("Review rationale must be between 10 and 1000 characters.");
  const reviewerUserId = requiredText(input?.reviewerUserId, "Reviewer user ID");
  if (input?.reviewerConfirmed !== true) throw new Error("Reviewer must confirm the exact evidence comparison.");
  return Object.freeze({ decision: input.decision, rationale, reviewerUserId });
}

export function compareRequirementToRationEvidence(requirement, rationReview, animalId) {
  const targetAnimalId = requiredText(animalId, "Animal ID");
  if (!requirement || !rationReview) throw new Error("Requirement and ration evidence are required.");
  if (requiredText(requirement.farmId, "Requirement farm") !== requiredText(rationReview.farmId, "Ration farm")) {
    throw new Error("Requirement and ration evidence must belong to the same farm.");
  }
  if (requirement.animalId !== targetAnimalId) throw new Error("Requirement evidence does not belong to the selected animal.");
  if (!rationReview.animalGroup?.some((animal) => animal.id === targetAnimalId)) {
    throw new Error("The selected animal is not in the ration review animal group.");
  }
  if (rationReview.animalGroup.length !== 1) {
    throw new Error("Ration evidence must represent a single animal until per-animal group allocation is documented.");
  }
  if (rationReview.rationBasis !== "DAILY_OFFERED_RATION" || rationReview.rationBasisConfirmed !== true) {
    throw new Error("Ration evidence must explicitly confirm a daily offered ration basis.");
  }

  const comparisons = []; const uncompared = [];
  for (const output of requirement.outputs || []) {
    const definition = METRICS[output.outputCode];
    if (!definition) {
      uncompared.push(Object.freeze({ outputCode: output.outputCode, outputUnit: output.outputUnit,
        reason: "No directly compatible ration evidence is retained for this metric." }));
      continue;
    }
    if (output.outputUnit !== definition.unit) throw new Error(output.outputCode + " has an incompatible unit.");
    const requiredValue = finite(output.value, output.outputCode + " requirement");
    const suppliedValue = finite(definition.supply(rationReview.ration || {}), output.outputCode + " ration evidence");
    const gap = rounded(suppliedValue - requiredValue);
    comparisons.push(Object.freeze({ outputCode: output.outputCode, outputUnit: definition.unit,
      requiredValue, suppliedValue: rounded(suppliedValue), gap,
      status: gap < 0 ? "BELOW_DOCUMENTED_REQUIREMENT" : gap > 0 ? "ABOVE_DOCUMENTED_REQUIREMENT" : "MATCHES_DOCUMENTED_REQUIREMENT",
      derivation: definition.derivation }));
  }
  if (!comparisons.length) throw new Error("No directly compatible requirement and ration metrics are available.");

  return Object.freeze({ animalId: targetAnimalId, comparisons: Object.freeze(comparisons), uncompared: Object.freeze(uncompared),
    attribution: Object.freeze({ requirementCalculationId: requiredText(requirement.id, "Requirement calculation ID"),
      requirementProfileId: requiredText(requirement.profileId, "Requirement profile ID"),
      requirementProfileVersion: requirement.profileVersion, requirementSourceCitation: requiredText(requirement.sourceCitation, "Requirement citation"),
      classificationId: requiredText(requirement.classificationId, "Classification ID"), requirementCalculatedAt: requirement.calculatedAt,
      rationReviewId: requiredText(rationReview.id, "Ration review ID"), rationProfileId: requiredText(rationReview.profileId, "Ration profile ID"),
      rationProfileVersion: rationReview.profileVersion, rationSourceCitation: requiredText(rationReview.sourceCitation, "Ration citation"),
      rationSelectionId: requiredText(rationReview.selectionId, "Ration selection ID"), rationCalculatedAt: rationReview.calculatedAt }) });
}
