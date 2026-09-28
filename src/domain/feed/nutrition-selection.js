function requiredText(value, label, maximum) {
  const result = String(value || "").trim().replace(/\s+/g, " ");
  if (!result || result.length > maximum) throw new Error(label + " is required and must not exceed " + maximum + " characters.");
  return result;
}

export function validateNutritionSelection(input) {
  if (!input || typeof input !== "object") throw new Error("Nutrition evidence selection is required.");
  return Object.freeze({ observationId: requiredText(input.observationId, "Nutrition observation", 100),
    rationale: requiredText(input.rationale, "Selection rationale", 500) });
}

export function currentNutritionSelections(events) {
  const current = new Map();
  for (const event of [...events].sort((a, b) => a.selectedAt.localeCompare(b.selectedAt) || a.id.localeCompare(b.id))) {
    current.set(event.nutrientCode, event);
  }
  return Object.freeze(Object.fromEntries(current));
}
