import assert from "node:assert/strict";
import { validateMilk } from "../src/domain/validation.js";

const sample = { animalId: "animal-1", session: "morning", localDate: "2026-10-09", liters: "4.125" };
assert.deepEqual(validateMilk(sample), { ...sample, liters: 4.125, volumeMl: 4125, allowAdditionalCollection: false });
assert.equal(validateMilk({ ...sample, liters: "4.1", allowAdditionalCollection: true }).allowAdditionalCollection, true);
for (const liters of ["", "0", "60.001", "4.1234", "1e1", "NaN"]) {
  assert.throws(() => validateMilk({ ...sample, liters }), /milk|quantity/i);
}
console.log("milk-validation.test.js: PASS");
