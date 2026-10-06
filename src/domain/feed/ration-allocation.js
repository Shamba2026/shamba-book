const TOLERANCE_KG = 0.000001;

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required.");
  return text;
}

function nonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(label + " must be a non-negative finite number.");
  return number;
}

function rounded(value) { return Number(value.toFixed(6)); }

function sourceIngredients(rationReview) {
  const rows = rationReview?.ration?.ingredients;
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("The ration review does not retain ingredient-level evidence and cannot be allocated.");
  }
  const ids = rows.map((row) => requiredText(row.feedId, "Ration ingredient feed ID"));
  if (new Set(ids).size !== ids.length) throw new Error("Ration ingredient feed IDs must be unique.");
  return rows.map((row) => {
    const asFedKg = nonNegative(row.asFedKg, "Ration ingredient as-fed weight");
    if (asFedKg <= 0) throw new Error("Ration ingredient as-fed weight must be greater than zero.");
    return Object.freeze({ feedId: row.feedId, feedName: requiredText(row.feedName, "Ration ingredient name"),
      role: requiredText(row.role, "Ration ingredient role"), asFedKg,
      dmPerAsFedKg: nonNegative(row.dmKg, "Ration ingredient dry matter") / asFedKg,
      mePerAsFedKg: nonNegative(row.meMJ, "Ration ingredient ME") / asFedKg,
      cpPerAsFedKg: nonNegative(row.cpKg, "Ration ingredient crude protein") / asFedKg,
      costPerAsFedKg: nonNegative(row.costCents, "Ration ingredient cost") / asFedKg });
  });
}

export function validateRationAllocationEvidence(rationReview, input) {
  if (!rationReview?.id || !rationReview?.farmId) throw new Error("A farm-scoped ration review is required.");
  if (rationReview.rationBasis !== "DAILY_OFFERED_RATION" || rationReview.rationBasisConfirmed !== true) {
    throw new Error("Only confirmed daily offered ration evidence can be allocated.");
  }
  const group = rationReview.animalGroup;
  if (!Array.isArray(group) || group.length < 2) throw new Error("Allocation evidence requires a multi-animal ration review.");
  const groupIds = group.map((animal) => requiredText(animal.id, "Animal ID"));
  if (new Set(groupIds).size !== groupIds.length) throw new Error("Ration animal IDs must be unique.");
  if (input?.allocationMethod !== "DOCUMENTED_INGREDIENT_WEIGHTS") {
    throw new Error("Allocation method must be documented ingredient weights.");
  }
  const rationale = requiredText(input.rationale, "Allocation rationale");
  if (rationale.length < 10 || rationale.length > 1000) throw new Error("Allocation rationale must be between 10 and 1000 characters.");
  const reviewerUserId = requiredText(input.reviewerUserId, "Reviewer user ID");
  if (input.reviewerConfirmed !== true) throw new Error("Reviewer must confirm the documented per-animal ingredient weights.");
  if (!Array.isArray(input.allocations) || input.allocations.length !== group.length) {
    throw new Error("Provide exactly one allocation for every animal in the ration group.");
  }
  const ingredients = sourceIngredients(rationReview);
  const allocationIds = input.allocations.map((row) => requiredText(row.animalId, "Allocated animal ID"));
  if (new Set(allocationIds).size !== allocationIds.length ||
      allocationIds.some((id) => !groupIds.includes(id)) || groupIds.some((id) => !allocationIds.includes(id))) {
    throw new Error("Allocations must match the ration animal group exactly.");
  }
  const totalsByFeed = new Map(ingredients.map((row) => [row.feedId, 0]));
  const allocations = input.allocations.map((row) => {
    if (!Array.isArray(row.ingredients) || row.ingredients.length !== ingredients.length) {
      throw new Error("Each animal allocation must include every ration ingredient exactly once.");
    }
    const byFeed = new Map();
    for (const item of row.ingredients) {
      const feedId = requiredText(item.feedId, "Allocated ingredient feed ID");
      if (!totalsByFeed.has(feedId) || byFeed.has(feedId)) throw new Error("Allocated ingredients must match the ration ingredients exactly.");
      const asFedKg = nonNegative(item.asFedKg, "Allocated ingredient as-fed weight");
      byFeed.set(feedId, asFedKg); totalsByFeed.set(feedId, totalsByFeed.get(feedId) + asFedKg);
    }
    const portions = ingredients.map((source) => {
      const asFedKg = byFeed.get(source.feedId);
      if (asFedKg == null) throw new Error("Each animal allocation must include every ration ingredient exactly once.");
      return Object.freeze({ feedId: source.feedId, feedName: source.feedName, role: source.role, asFedKg: rounded(asFedKg),
        dmKg: rounded(asFedKg * source.dmPerAsFedKg), meMJ: rounded(asFedKg * source.mePerAsFedKg),
        cpKg: rounded(asFedKg * source.cpPerAsFedKg), costCents: Math.round(asFedKg * source.costPerAsFedKg) });
    });
    const totalAsFedKg = portions.reduce((sum, item) => sum + item.asFedKg, 0);
    const totalDMIKg = portions.reduce((sum, item) => sum + item.dmKg, 0);
    if (totalAsFedKg <= 0 || totalDMIKg <= 0) throw new Error("Every animal must receive a positive documented ration allocation.");
    const totalMEMJ = portions.reduce((sum, item) => sum + item.meMJ, 0);
    const totalCPKg = portions.reduce((sum, item) => sum + item.cpKg, 0);
    return Object.freeze({ animalId: row.animalId, ingredients: Object.freeze(portions),
      ration: Object.freeze({ totalAsFedKg: rounded(totalAsFedKg), totalDMIKg: rounded(totalDMIKg),
        forageDMKg: rounded(portions.filter((item) => item.role === "forage").reduce((sum, item) => sum + item.dmKg, 0)),
        totalMEMJ: rounded(totalMEMJ), totalCPKg: rounded(totalCPKg),
        meDensityMJPerKgDM: rounded(totalMEMJ / totalDMIKg), cpPercentDM: rounded(totalCPKg / totalDMIKg * 100),
        totalCostCents: portions.reduce((sum, item) => sum + item.costCents, 0) }) });
  });
  for (const source of ingredients) {
    if (Math.abs(totalsByFeed.get(source.feedId) - source.asFedKg) > TOLERANCE_KG) {
      throw new Error("Per-animal ingredient allocations must reconcile exactly to the reviewed group ration.");
    }
  }
  return Object.freeze({ rationReviewId: rationReview.id, farmId: rationReview.farmId,
    allocationMethod: input.allocationMethod, rationale, reviewerUserId, reviewerConfirmed: true,
    allocations: Object.freeze(allocations) });
}
