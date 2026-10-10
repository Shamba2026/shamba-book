import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/farm-access.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace("export async function", "async function");
const now = Date.parse("2026-10-10T12:00:00.000Z");
class FixedDate extends Date { static now() { return now; } }
let cached;
const context = vm.createContext({ Date: FixedDate, navigator: { onLine: false },
  APP_CONFIG: { cloud: { farmId: "test-farm" } },
  get: async () => cached,
  put: async () => { throw new Error("Offline verification must not mutate storage"); }
});
vm.runInContext(source + "\nthis.verify = verifyFarmAccess;", context);
const row = (age) => ({ authorized: true, userId: "test-user", farmId: "test-farm",
  checkedAt: new Date(now - age).toISOString() });
const day = 24 * 60 * 60 * 1000;
for (const age of [0, 14 * day, -5 * 60 * 1000]) {
  cached = row(age);
  assert.equal(await context.verify({}, { id: "test-user" }), "test-farm");
}
for (const invalid of [null, row(14 * day + 1), row(-5 * 60 * 1000 - 1),
  { ...row(0), checkedAt: "invalid" }, { ...row(0), authorized: false },
  { ...row(0), userId: "other-user" }, { ...row(0), farmId: "other-farm" }]) {
  cached = invalid;
  const before = structuredClone(cached);
  await assert.rejects(context.verify({}, { id: "test-user" }), /Locally saved records are preserved/);
  assert.deepEqual(cached, before);
}
await assert.rejects(context.verify({}, null), /signed-in farm member/);
console.log("offline-membership.test.js: PASS");
