const COST_SOURCE_TYPES = new Set(["invoice", "receipt", "farm_production_cost", "market_quote", "opening_balance", "other"]);

function requiredText(value, label, maximum) {
  const result = String(value || "").trim().replace(/\s+/g, " ");
  if (!result || result.length > maximum) throw new Error(label + " is required and must not exceed " + maximum + " characters.");
  return result;
}

function optionalText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function positiveNumber(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(label + " must be greater than zero.");
  return result;
}

function requiredDate(value, label) {
  const result = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!match) throw new Error(label + " is required.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== result) throw new Error(label + " must be a valid calendar date.");
  return result;
}

export function validateCostSource(input) {
  if (!input || typeof input !== "object") throw new Error("Cost source is required.");
  if (!COST_SOURCE_TYPES.has(input.sourceType)) throw new Error("Select a valid cost source type.");
  const documentDate = requiredDate(input.documentDate, "Cost source date");
  return Object.freeze({
    sourceType: input.sourceType,
    reference: requiredText(input.reference, "Cost source reference", 160),
    counterparty: optionalText(input.counterparty, 160),
    documentDate,
    notes: optionalText(input.notes, 500)
  });
}

export function validateInventoryBatch(input) {
  if (!input || typeof input !== "object") throw new Error("Inventory batch is required.");
  const receivedAt = requiredDate(input.receivedAt, "Received date");
  const receivedQuantityKg = positiveNumber(input.receivedQuantityKg, "Received quantity");
  if (receivedQuantityKg > 10000000) throw new Error("Received quantity is outside the supported range.");
  const totalCost = positiveNumber(input.totalCost, "Total batch cost");
  const totalCostCents = Math.round(totalCost * 100);
  if (!Number.isSafeInteger(totalCostCents) || totalCostCents > 999999999999) throw new Error("Total batch cost is outside the supported range.");
  const currencyCode = String(input.currencyCode || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Currency must use a three-letter ISO code.");
  return Object.freeze({
    costSourceId: requiredText(input.costSourceId, "Cost source", 100),
    receivedAt,
    receivedQuantityKg,
    remainingQuantityKg: receivedQuantityKg,
    unit: "KG_AS_FED",
    totalCostCents,
    currencyCode,
    lotReference: optionalText(input.lotReference, 120),
    storageLocation: optionalText(input.storageLocation, 160),
    notes: optionalText(input.notes, 500)
  });
}

export function unitCostPerKg(batch) {
  if (!batch || batch.unit !== "KG_AS_FED" || !Number.isFinite(batch.receivedQuantityKg) ||
      !Number.isSafeInteger(batch.totalCostCents) || batch.receivedQuantityKg <= 0) return null;
  return batch.totalCostCents / batch.receivedQuantityKg;
}

export const feedCostSourceTypes = Object.freeze([...COST_SOURCE_TYPES]);
