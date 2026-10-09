import assert from "node:assert/strict";
import { effectiveMilkRecords, validateMilkCorrection } from "../src/domain/milk-ledger.js";

const original = { id: "milk-1", farmId: "farm-1", animalId: "cow-1", kind: "milk",
  localDate: "2026-10-10", session: "morning", volumeMl: 4000, liters: 4 };
const replacement = { id: "milk-2", farmId: "farm-1", animalId: "cow-1", kind: "milk",
  localDate: "2026-10-10", session: "morning", eventType: "record", volumeMl: 4500, liters: 4.5 };
const correction = { id: "correction-1", farmId: "farm-1", animalId: "cow-1", kind: "milk_correction",
  action: "correct", targetRecordId: "milk-1", replacementRecordId: "milk-2", reason: "Meter reading typo" };

assert.deepEqual(effectiveMilkRecords([original]), [original], "legacy milk rows remain effective");
assert.deepEqual(effectiveMilkRecords([original, replacement, correction]), [replacement],
  "a correction preserves history while replacing the effective entry");
assert.deepEqual(effectiveMilkRecords([original, { ...correction, action: "void", replacementRecordId: null }]), [],
  "a void removes the target only from effective totals");
assert.throws(() => effectiveMilkRecords([original, correction, { ...correction, id: "correction-2" }]), /already corrected/i);

assert.deepEqual(validateMilkCorrection({ targetRecordId: "milk-1", action: "correct", reason: "Meter reading typo",
  replacementLiters: "4.125", actorUserId: "user-1" }), {
  targetRecordId: "milk-1", action: "correct", reason: "Meter reading typo", replacementLiters: 4.125,
  replacementVolumeMl: 4125, actorUserId: "user-1"
});
assert.deepEqual(validateMilkCorrection({ targetRecordId: "milk-1", action: "void", reason: "Milk was spilled",
  actorUserId: "user-1" }), {
  targetRecordId: "milk-1", action: "void", reason: "Milk was spilled", replacementLiters: null,
  replacementVolumeMl: null, actorUserId: "user-1"
});
for (const input of [
  { targetRecordId: "", action: "void", reason: "Milk was spilled", actorUserId: "user-1" },
  { targetRecordId: "milk-1", action: "delete", reason: "Milk was spilled", actorUserId: "user-1" },
  { targetRecordId: "milk-1", action: "void", reason: "", actorUserId: "user-1" },
  { targetRecordId: "milk-1", action: "correct", reason: "Typo", replacementLiters: "0", actorUserId: "user-1" },
  { targetRecordId: "milk-1", action: "correct", reason: "Typo", replacementLiters: "4.1234", actorUserId: "user-1" },
  { targetRecordId: "milk-1", action: "void", reason: "Milk was spilled", actorUserId: "" }
]) assert.throws(() => validateMilkCorrection(input));

console.log("milk-ledger.test.js: PASS");
