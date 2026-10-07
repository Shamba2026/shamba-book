import { classifyComparisonReviewHistory } from "./requirement-ration-comparison.js";

function stage(code, state, detail, evidenceId = null) {
  return Object.freeze({ code, state, detail, evidenceId });
}

export function buildNutritionEvidenceStatus({ animalId, classifications = [], classificationReviews = [],
  requirementProfiles = [], requirementCalculations = [], rationReviews = [], allocationReviews = [], comparisonReviews = [], selectedDiagnostic = null }) {
  const latestClassification = [...classifications].sort((a, b) => Number(b.version) - Number(a.version) ||
    String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  const latestClassificationReview = latestClassification ? classificationReviews
    .filter((row) => row.classificationId === latestClassification.id)
    .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)) || String(b.id).localeCompare(String(a.id)))[0] || null : null;
  const classificationConfirmed = latestClassificationReview?.evidenceDecision === "CONFIRMED" &&
    latestClassificationReview?.reviewerConfirmed === true;
  const currentCalculation = latestClassification ? [...requirementCalculations]
    .sort((a, b) => String(b.calculatedAt).localeCompare(String(a.calculatedAt)) || String(b.id).localeCompare(String(a.id)))
    .find((row) => row.classificationId === latestClassification.id &&
      requirementProfiles.some((profile) => profile.id === row.profileId && profile.status === "approved")) || null : null;
  const hasStaleCalculation = Boolean(latestClassification && !currentCalculation && requirementCalculations.length);
  const eligibleRations = rationReviews.filter((row) => row.rationBasis === "DAILY_OFFERED_RATION" &&
    row.rationBasisConfirmed === true && row.animalGroup?.some((animal) => animal.id === animalId) &&
    selectedDiagnostic?.profile?.id === row.profileId && selectedDiagnostic?.profile?.version === row.profileVersion &&
    selectedDiagnostic?.selection?.id === row.selectionId);
  const currentRationEvidence = eligibleRations.sort((a, b) =>
    String(b.calculatedAt).localeCompare(String(a.calculatedAt)) || String(b.id).localeCompare(String(a.id))).map((rationReview) => {
    if (rationReview.animalGroup.length === 1) return { rationReview, allocationReviewId: null };
    const allocation = [...allocationReviews].sort((a, b) =>
      String(b.reviewedAt).localeCompare(String(a.reviewedAt)) || String(b.id).localeCompare(String(a.id))).find((row) => row.rationReviewId === rationReview.id &&
      row.allocations?.some((item) => item.animalId === animalId));
    return allocation ? { rationReview, allocationReviewId: allocation.id } : null;
  }).find(Boolean) || null;
  const currentDecisions = classifyComparisonReviewHistory(comparisonReviews).filter((row) => row.isCurrent);
  const reviewedComparison = currentCalculation && currentRationEvidence ? currentDecisions.find((row) =>
    row.requirementCalculationId === currentCalculation.id && row.rationReviewId === currentRationEvidence.rationReview.id &&
    (row.allocationReviewId || null) === currentRationEvidence.allocationReviewId) || null : null;

  return Object.freeze({ animalId, stages: Object.freeze([
    latestClassification ? stage("CLASSIFICATION", "CURRENT", "Latest classification version " + latestClassification.version + " is retained.", latestClassification.id) :
      stage("CLASSIFICATION", "MISSING", "No animal nutrition classification is retained."),
    !latestClassification ? stage("CLASSIFICATION_REVIEW", "BLOCKED", "Classification evidence is required first.") :
      classificationConfirmed ? stage("CLASSIFICATION_REVIEW", "CURRENT", "Latest classification has a confirmed human evidence review.", latestClassificationReview.id) :
        stage("CLASSIFICATION_REVIEW", "REVIEW_REQUIRED", "Latest classification does not have a confirmed human evidence review.", latestClassificationReview?.id || null),
    currentCalculation ? stage("REQUIREMENT_CALCULATION", "CURRENT", "A documented requirement calculation uses the latest classification.", currentCalculation.id) :
      hasStaleCalculation ? stage("REQUIREMENT_CALCULATION", "STALE", "Retained calculations use an older classification version.") :
        stage("REQUIREMENT_CALCULATION", "MISSING", "No documented requirement calculation is retained for the latest classification."),
    currentRationEvidence ? stage("RATION_EVIDENCE", "CURRENT", "Current reviewed daily ration evidence is attributable to this animal.", currentRationEvidence.rationReview.id) :
      stage("RATION_EVIDENCE", "MISSING", "No current reviewed daily ration evidence is attributable to this animal."),
    reviewedComparison ? stage("COMPARISON_REVIEW", "CURRENT", "A current human decision exists for the retained requirement and ration evidence.", reviewedComparison.id) :
      stage("COMPARISON_REVIEW", "REVIEW_REQUIRED", "No current human decision links the retained requirement and ration evidence.")
  ]) });
}

export function summarizeHerdNutritionEvidence(animals) {
  const rows = (Array.isArray(animals) ? animals : []).map((row) => {
    const stages = Array.isArray(row.stages) ? row.stages : [];
    const outstanding = stages.filter((stageRow) => stageRow.state !== "CURRENT");
    return Object.freeze({ animalId: row.animalId, animalCode: row.animalCode,
      evidenceComplete: stages.length > 0 && outstanding.length === 0,
      outstanding: Object.freeze(outstanding.map(({ code, state }) => Object.freeze({ code, state }))) });
  });
  return Object.freeze({ totalAnimals: rows.length,
    completeAnimals: rows.filter((row) => row.evidenceComplete).length,
    attentionAnimals: rows.filter((row) => !row.evidenceComplete).length,
    animals: Object.freeze(rows) });
}
