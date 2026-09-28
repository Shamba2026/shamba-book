import assert from "node:assert/strict";
import { normalizeAsFedMass, validateInventoryMovement } from "../src/domain/feed/feed-inventory.js";
import { currentNutritionSelections, validateNutritionSelection } from "../src/domain/feed/nutrition-selection.js";

assert.deepEqual(normalizeAsFedMass({ quantity: 1250, unit: "G_AS_FED" }),
  { inputQuantity: 1250, inputUnit: "G_AS_FED", quantityKg: 1.25, canonicalUnit: "KG_AS_FED" });
assert.equal(normalizeAsFedMass({ quantity: 1.5, unit: "METRIC_TONNE_AS_FED" }).quantityKg, 1500);
assert.equal(normalizeAsFedMass({ quantity: 3, unit: "KG_AS_FED" }).quantityKg, 3);
for (const unit of ["BAG", "BALE", "LITRE", "SCOOP"]) {
  assert.throws(() => normalizeAsFedMass({ quantity: 1, unit }), /Unsupported as-fed mass unit/);
}

const movementInput = { movementType: "CONSUMPTION", movementDate: "2026-09-28",
  quantity: 2.5, unit: "KG_AS_FED", reason: "Synthetic feeding test" };
const consumption = validateInventoryMovement(movementInput);
assert.equal(consumption.deltaQuantityKg, -2.5);
const correction = validateInventoryMovement({ movementType: "CORRECTION_INCREASE", movementDate: "2026-09-28",
  quantity: 500, unit: "G_AS_FED", reason: "Synthetic scale reconciliation" });
assert.equal(correction.deltaQuantityKg, 0.5);
assert.throws(() => validateInventoryMovement({ ...movementInput, quantity: 1, reason: "" }), /Movement reason/);
assert.throws(() => validateInventoryMovement({ ...movementInput, movementType: "TRANSFER" }), /Unsupported inventory movement/);

const selection = validateNutritionSelection({ observationId: "observation-a", rationale: "Selected reviewed laboratory result" });
assert.equal(selection.observationId, "observation-a");
assert.throws(() => validateNutritionSelection({ observationId: "observation-a", rationale: "" }), /Selection rationale/);
const current = currentNutritionSelections([
  { id: "a", nutrientCode: "CP", selectedAt: "2026-09-28T00:00:00.000Z", observationId: "old" },
  { id: "b", nutrientCode: "DM", selectedAt: "2026-09-28T00:01:00.000Z", observationId: "dm" },
  { id: "c", nutrientCode: "CP", selectedAt: "2026-09-28T00:02:00.000Z", observationId: "new" }
]);
assert.equal(current.CP.observationId, "new");
assert.equal(current.DM.observationId, "dm");
console.log("feed-inventory-semantics.test.js: PASS");
