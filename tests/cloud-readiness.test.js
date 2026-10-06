import assert from "node:assert/strict";
import { assessCloudReadiness, CLOUD_ADAPTER_TABLES } from "../src/cloud/cloud-readiness.js";

const columns = {
  animals: ["farm_id", "animal_id", "client_id"], milk_logs: ["farm_id", "animal_id", "client_id", "local_date", "session", "yield_liters"],
  weight_logs: ["farm_id", "animal_id", "client_id", "local_date", "kilograms"], breeding_logs: ["farm_id", "animal_id", "client_id", "event_type", "event_date"],
  health_logs: ["farm_id", "animal_id", "client_id", "treatment_type", "treatment_date"], expense_logs: ["farm_id", "client_id", "category", "amount", "expense_date"],
  income_logs: ["farm_id", "client_id", "category", "amount", "income_date"], payment_logs: ["farm_id", "client_id", "payment_type", "amount", "payment_date"]
};
const complete = { tables: [...CLOUD_ADAPTER_TABLES.map((name) => ({ name, rlsEnabled: true, columns: columns[name] })),
  { name: "farm_members", rlsEnabled: true, columns: ["farm_id", "user_id"] }],
  policies: [...CLOUD_ADAPTER_TABLES.map((table) => ({ table, roles: ["authenticated"], command: "ALL" })),
    { table: "farm_members", roles: ["authenticated"], command: "SELECT" }] };
assert.deepEqual(assessCloudReadiness(complete), { ready: true, issues: [] });

const suppliedLiveEvidence = { tables: [
  { name: "animals", rlsEnabled: true, columns: columns.animals }, { name: "milk_logs", rlsEnabled: true, columns: columns.milk_logs },
  { name: "weight_logs", rlsEnabled: null, columns: columns.weight_logs }, { name: "breeding_logs", rlsEnabled: null, columns: columns.breeding_logs },
  { name: "health_logs", rlsEnabled: null, columns: columns.health_logs }, { name: "expense_logs", rlsEnabled: null, columns: columns.expense_logs },
  { name: "farm_members", rlsEnabled: true, columns: ["farm_id", "user_id"] }
], policies: ["animals", "milk_logs", "weight_logs", "health_logs", "expense_logs"].map((table) =>
  ({ table, roles: ["authenticated"], command: "ALL" })).concat({ table: "farm_members", roles: ["authenticated"], command: "SELECT" }) };
const result = assessCloudReadiness(suppliedLiveEvidence);
assert.equal(result.ready, false);
assert.equal(result.issues.some((row) => row.code === "MISSING_TABLE" && row.table === "income_logs"), true);
assert.equal(result.issues.some((row) => row.code === "MISSING_TABLE" && row.table === "payment_logs"), true);
assert.equal(result.issues.some((row) => row.code === "WRITE_POLICY_NOT_VERIFIED" && row.table === "breeding_logs"), true);
assert.equal(result.issues.some((row) => row.code === "RLS_NOT_VERIFIED" && row.table === "weight_logs"), true);
console.log("cloud-readiness.test.js: PASS");
