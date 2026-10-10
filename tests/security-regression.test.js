import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanClientFiles } from "./support/client-secret-guard.js";
import { toCloudPayload } from "../src/cloud/supabase-adapter.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const findings = await scanClientFiles(root);
assert.deepEqual(findings, [], `deployable client files contain forbidden credentials:\n${findings.join("\n")}`);

// Synthetic fixtures prove that the guard fails on privileged credentials while
// accepting a public anon key. These files never enter the deployed tree.
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "ngombe-secret-fixture-"));
try {
  const fakeToken = (role) => ["eyJhbGciOiJIUzI1NiJ9",
    Buffer.from(JSON.stringify({ role })).toString("base64url"), "c2lnbmF0dXJl"].join(".");
  await writeFile(path.join(fixtureRoot, "config.js"), `const key = "${fakeToken("anon")}";`);
  assert.deepEqual(await scanClientFiles(fixtureRoot), [], "public anon token is allowed");
  await writeFile(path.join(fixtureRoot, "config.js"), `const key = "${fakeToken("service_role")}";`);
  assert.match((await scanClientFiles(fixtureRoot)).join("\n"), /config\.js: embedded service_role JWT/);
  await writeFile(path.join(fixtureRoot, "config.js"), 'const service_role_key = "TEST-ONLY-SECRET";');
  assert.match((await scanClientFiles(fixtureRoot)).join("\n"), /config\.js: privileged credential assignment/);
  await writeFile(path.join(fixtureRoot, "config.js"), 'const key = "-----BEGIN PRIVATE KEY-----";');
  assert.match((await scanClientFiles(fixtureRoot)).join("\n"), /config\.js: embedded private key/);
  await mkdir(path.join(fixtureRoot, "tests"));
  await writeFile(path.join(fixtureRoot, "tests", "fixture.js"), 'const service_role_key = "TEST-ONLY-SECRET";');
  await writeFile(path.join(fixtureRoot, "config.js"), "const safe = true;");
  assert.deepEqual(await scanClientFiles(fixtureRoot), [], "test-only fixtures are excluded from the client scan");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

const hostileFields = {
  farmId: "attacker-farm", farm_id: "attacker-farm",
  ownerId: "attacker-owner", user_id: "attacker-user", role: "service_role", arbitrary: "must-not-cross-boundary"
};
const common = { id: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222" };
const records = [
  { ...common, kind: "animal", animalCode: "SECURITY-TEST", type: "dairy_cow", breed: "synthetic" },
  { ...common, kind: "milk", animalId: "animal-1", localDate: "2026-10-10", session: "morning", liters: 4.5 },
  { ...common, kind: "weight", animalId: "animal-1", localDate: "2026-10-10", kilograms: 400 },
  { ...common, kind: "breeding", animalId: "animal-1", eventType: "service", eventDate: "2026-10-10" },
  { ...common, kind: "health", animalId: "animal-1", treatmentType: "review", treatmentDate: "2026-10-10" },
  { ...common, kind: "expense", category: "synthetic", amount: 100, expenseDate: "2026-10-10" },
  { ...common, kind: "income", category: "synthetic", amount: 100, incomeDate: "2026-10-10" },
  { ...common, kind: "payment", paymentType: "synthetic", amount: 100, paymentDate: "2026-10-10" }
];
for (const record of records) {
  const payload = toCloudPayload({ ...record, ...hostileFields }, "trusted-farm");
  assert.equal(payload.farm_id, "trusted-farm", `${record.kind} must use the trusted farm argument`);
  for (const forbidden of ["farmId", "ownerId", "user_id", "role", "arbitrary"]) {
    assert.equal(Object.hasOwn(payload, forbidden), false, `${record.kind} cloud payload leaked ${forbidden}`);
  }
}
assert.throws(() => toCloudPayload({ ...common, ...hostileFields, kind: "unknown" }, "trusted-farm"), /No cloud mapping/);

const repositorySource = await readFile(new URL("../src/storage/farm-repository.js", import.meta.url), "utf8");
for (const exportedRead of ["listAnimals", "listFinanceEntries", "getPendingSyncCount", "getTodayMilkSummary",
  "listMilkRecordsForDate", "listMilkLedgerForDate"]) {
  const start = repositorySource.indexOf(`export async function ${exportedRead}`);
  assert.notEqual(start, -1, `${exportedRead} is missing`);
  const nextExport = repositorySource.indexOf("\nexport ", start + 1);
  const body = repositorySource.slice(start, nextExport === -1 ? undefined : nextExport);
  assert.match(body, /farmRows\s*\(/, `${exportedRead} must retain the active-farm read boundary`);
}

console.log("security-regression.test.js: PASS");
