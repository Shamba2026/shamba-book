function reason(code, message) {
  return Object.freeze({ code, message });
}

export function assessComparisonEvidenceCurrency({ requirement, rationReview, requirementProfile,
  latestClassification, selectedDiagnostic }) {
  const reasons = [];
  if (!requirement || !rationReview) reasons.push(reason("MISSING_EVIDENCE", "Requirement and ration evidence are required."));
  if (!requirementProfile || requirementProfile.id !== requirement?.profileId ||
      requirementProfile.version !== requirement?.profileVersion || requirementProfile.status !== "approved") {
    reasons.push(reason("REQUIREMENT_PROFILE_NOT_CURRENT", "The requirement profile is no longer approved at the recorded version."));
  }
  if (!latestClassification || latestClassification.id !== requirement?.classificationId) {
    reasons.push(reason("CLASSIFICATION_SUPERSEDED", "The requirement calculation does not use the latest animal classification."));
  }
  if (!selectedDiagnostic || selectedDiagnostic.profile?.id !== rationReview?.profileId ||
      selectedDiagnostic.profile?.version !== rationReview?.profileVersion ||
      selectedDiagnostic.selection?.id !== rationReview?.selectionId) {
    reasons.push(reason("RATION_REVIEW_NOT_CURRENT", "The ration evidence is not from the current reviewed diagnostic selection."));
  }
  return Object.freeze({ eligible: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function requireCurrentComparisonEvidence(input) {
  const result = assessComparisonEvidenceCurrency(input);
  if (!result.eligible) throw new Error("Comparison evidence is not current: " + result.reasons.map((row) => row.message).join(" "));
  return result;
}
