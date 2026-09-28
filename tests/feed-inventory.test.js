import assert from "node:assert/strict";
import { unitCostPerKg, validateCostSource, validateInventoryBatch } from "../src/domain/feed/feed-inventory.js";

const source = validateCostSource({ sourceType: "receipt", reference: "  TEST   RECEIPT 001 ",
  counterparty: "Synthetic supplier", documentDate: "2026-09-28", notes: "Test only" });
assert.equal(source.reference, "TEST RECEIPT 001");
assert.throws(() => validateCostSource({ ...source, sourceType: "guess" }), /valid cost source type/);
assert.throws(() => validateCostSource({ ...source, documentDate: "28-09-2026" }), /date is required/);
assert.throws(() => validateCostSource({ ...source, documentDate: "2026-02-30" }), /valid calendar date/);

const batchInput = { costSourceId: "source-a", receivedAt: "2026-09-28",
  receivedQuantityKg: "125.5", totalCost: "2500.25", currencyCode: "kes", lotReference: "LOT-A" };
const batch = validateInventoryBatch(batchInput);
assert.equal(batch.unit, "KG_AS_FED");
assert.equal(batch.receivedQuantityKg, 125.5);
assert.equal(batch.remainingQuantityKg, 125.5);
assert.equal(batch.totalCostCents, 250025);
assert.equal(batch.currencyCode, "KES");
assert.equal(unitCostPerKg(batch), 250025 / 125.5);
assert.equal(unitCostPerKg({ ...batch, unit: "BAG" }), null);
assert.throws(() => validateInventoryBatch({ ...batchInput, totalCost: 0 }), /greater than zero/);
assert.throws(() => validateInventoryBatch({ ...batchInput, receivedQuantityKg: -1 }), /greater than zero/);
assert.throws(() => validateInventoryBatch({ ...batchInput, currencyCode: "KSHH" }), /three-letter ISO code/);
assert.throws(() => validateInventoryBatch({ ...batchInput, costSourceId: "" }), /Cost source/);
console.log("feed-inventory.test.js: PASS");
