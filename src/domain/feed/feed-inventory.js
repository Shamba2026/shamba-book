const COST_SOURCE_TYPES = new Set(["invoice", "receipt", "farm_production_cost", "market_quote", "opening_balance", "other"]);
const MASS_FACTORS_KG = Object.freeze({ G_AS_FED: 0.001, KG_AS_FED: 1, METRIC_TONNE_AS_FED: 1000 });
const MOVEMENT_SIGNS = Object.freeze({ CONSUMPTION: -1, WASTE: -1, CORRECTION_DECREASE: -1, CORRECTION_INCREASE: 1 });

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
  const receivedMass = input.receivedQuantityKg != null
    ? normalizeAsFedMass({ quantity: input.receivedQuantityKg, unit: "KG_AS_FED" })
    : normalizeAsFedMass({ quantity: input.receivedQuantity, unit: input.inputUnit });
  const receivedQuantityKg = receivedMass.quantityKg;
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
    inputQuantity: receivedMass.inputQuantity,
    inputUnit: receivedMass.inputUnit,
    totalCostCents,
    currencyCode,
    lotReference: optionalText(input.lotReference, 120),
    storageLocation: optionalText(input.storageLocation, 160),
    notes: optionalText(input.notes, 500)
  });
}

export function normalizeAsFedMass(input) {
  const inputUnit = String(input?.unit || "");
  const factor = MASS_FACTORS_KG[inputUnit];
  if (!factor) throw new Error("Unsupported as-fed mass unit.");
  const inputQuantity = positiveNumber(input?.quantity, "Mass quantity");
  const quantityKg = Math.round(inputQuantity * factor * 1000000) / 1000000;
  if (quantityKg < 0.001 || quantityKg > 10000000) throw new Error("Mass quantity is outside the supported range.");
  return Object.freeze({ inputQuantity, inputUnit, quantityKg, canonicalUnit: "KG_AS_FED" });
}

export function validateInventoryMovement(input) {
  if (!input || typeof input !== "object") throw new Error("Inventory movement is required.");
  const movementType = String(input.movementType || "");
  const sign = MOVEMENT_SIGNS[movementType];
  if (!sign) throw new Error("Unsupported inventory movement type.");
  const mass = normalizeAsFedMass({ quantity: input.quantity, unit: input.unit });
  return Object.freeze({ movementType, movementDate: requiredDate(input.movementDate, "Movement date"),
    reason: requiredText(input.reason, "Movement reason", 240), inputQuantity: mass.inputQuantity,
    inputUnit: mass.inputUnit, quantityKg: mass.quantityKg, deltaQuantityKg: sign * mass.quantityKg,
    canonicalUnit: mass.canonicalUnit });
}

export function unitCostPerKg(batch) {
  if (!batch || batch.unit !== "KG_AS_FED" || !Number.isFinite(batch.receivedQuantityKg) ||
      !Number.isSafeInteger(batch.totalCostCents) || batch.receivedQuantityKg <= 0) return null;
  return batch.totalCostCents / batch.receivedQuantityKg;
}

export const feedCostSourceTypes = Object.freeze([...COST_SOURCE_TYPES]);
export const supportedAsFedMassUnits = Object.freeze(Object.keys(MASS_FACTORS_KG));
export const feedInventoryMovementTypes = Object.freeze(Object.keys(MOVEMENT_SIGNS));
