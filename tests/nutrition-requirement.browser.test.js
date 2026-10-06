import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = createServer(async (request, response) => { const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1);
  const filename = path.resolve(root, relative); if (!filename.startsWith(root + path.sep) || !relative.startsWith("src/")) return response.writeHead(404).end();
  try { response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(await readFile(filename)); }
  catch { response.writeHead(404).end(); } });

const browser = await chromium.launch({ headless: true }); let context;
try { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/src/config.js`);
  const result = await page.evaluate(async () => {
    const localDb = await import("/src/storage/local-db.js?requirement-browser"); const repository = await import("/src/storage/farm-repository.js?requirement-browser");
    await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase("ngombe-herdbook"); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    repository.setActiveFarm("farm-a");
    await localDb.put("animals", { id: "cow-a", farmId: "farm-a", animalCode: "TEST-REQ-COW", type: "dairy_cow", status: "active" });
    await localDb.put("animal_nutrition_classifications", { id: "class-a", farmId: "farm-a", animalId: "cow-a", version: 1,
      liveWeightKg: 500, averageDailyMilkLiters: 20, createdAt: "2026-10-06T00:00:00Z" });
    await localDb.put("animal_nutrition_classification_reviews", { id: "review-a", farmId: "farm-a", animalId: "cow-a",
      classificationId: "class-a", evidenceDecision: "CONFIRMED", reviewerConfirmed: true, reviewedAt: "2026-10-06T01:00:00Z" });
    const draft = await repository.createNutritionRequirementProfile({ name: "Synthetic requirement", version: 1,
      animalClass: "LACTATING_DAIRY_COW", applicability: "Synthetic browser test only", nutrientSystem: "TEST SYSTEM",
      sourceTitle: "Synthetic source", sourceCitation: "TEST-REQ-BROWSER-001", publicationYear: 2021,
      equations: [{ outputCode: "DMI_KG_DAY", outputUnit: "kg DM/day", equationReference: "Synthetic A",
        terms: [{ factor: "LIVE_WEIGHT_KG", coefficient: 0.02, exponent: 1 }] }] });
    let draftRejected = false; try { await repository.calculateAnimalNutritionRequirements(draft.id, "cow-a", { confirmed: true, initiatedByUserId: "tester" }); }
    catch { draftRejected = true; }
    const approved = await repository.approveNutritionRequirementProfile(draft.id, { reviewerUserId: "reviewer", rationale: "Synthetic approval", reviewerConfirmed: true });
    const calculation = await repository.calculateAnimalNutritionRequirements(draft.id, "cow-a", { confirmed: true, initiatedByUserId: "tester" });
    repository.setActiveFarm("farm-b"); const hidden = (await repository.listNutritionRequirementProfiles()).length === 0;
    const calculationsHidden = (await repository.listNutritionRequirementCalculations()).length === 0;
    const db = await localDb.openLocalDatabase(); const stores = [...db.objectStoreNames]; const version = db.version; db.close();
    return { version, stores, draftRejected, approved, calculation, hidden, calculationsHidden,
      records: await localDb.getAll("records"), queue: await localDb.getAll("sync_queue"), movements: await localDb.getAll("feed_inventory_movements") };
  });
  assert.equal(result.version, 10); assert.equal(result.stores.includes("nutrition_requirement_profiles"), true);
  assert.equal(result.stores.includes("nutrition_requirement_profile_reviews"), true); assert.equal(result.stores.includes("nutrition_requirement_calculations"), true);
  assert.equal(result.draftRejected, true); assert.equal(result.approved.profile.status, "approved"); assert.equal(result.calculation.outputs[0].value, 10);
  assert.equal(result.hidden, true); assert.equal(result.calculationsHidden, true); assert.equal(result.records.length, 0);
  assert.equal(result.queue.length, 0); assert.equal(result.movements.length, 0);
  console.log("nutrition-requirement.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
