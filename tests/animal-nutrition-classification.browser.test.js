import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = createServer(async (request, response) => {
  const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1); const filename = path.resolve(root, relative);
  if (request.method !== "GET" || !filename.startsWith(root + path.sep) || !relative.startsWith("src/")) return response.writeHead(404).end();
  try { response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(await readFile(filename)); }
  catch { response.writeHead(404).end(); }
});

const browser = await chromium.launch({ headless: true }); let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/src/config.js`);
  const result = await page.evaluate(async () => {
    const name = "ngombe-herdbook";
    const request = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const complete = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("aborted")); });
    const remove = () => request(indexedDB.deleteDatabase(name));
    const storesV7 = ["animals", "records", "attachments", "sync_queue", "settings", "feed_library", "feed_sources", "feed_observations",
      "feed_cost_sources", "feed_inventory_batches", "feed_inventory_movements", "feed_nutrition_selections", "feed_diagnostic_profiles",
      "feed_diagnostic_profile_selections", "feed_diagnostic_warning_events"];
    const seedV7 = async () => { const open = indexedDB.open(name, 7); open.onupgradeneeded = () => storesV7.forEach((store) =>
      open.result.createObjectStore(store, { keyPath: store === "settings" ? "key" : "id" })); const db = await request(open);
      const tx = db.transaction(["animals", "attachments", "sync_queue"], "readwrite");
      tx.objectStore("animals").put({ id: "preserved", farmId: "farm-a", animalCode: "PRESERVED", status: "active" });
      tx.objectStore("attachments").put({ id: "photo", farmId: "farm-a", blob: new Blob(["PHOTO"]) });
      tx.objectStore("sync_queue").put({ id: "queue", farmId: "farm-a", status: "pending" }); await complete(tx); db.close(); };
    const inspect = async () => { const db = await request(indexedDB.open(name)); const animals = await request(db.transaction("animals").objectStore("animals").getAll());
      const photos = await request(db.transaction("attachments").objectStore("attachments").getAll()); const queues = await request(db.transaction("sync_queue").objectStore("sync_queue").getAll());
      const value = { version: db.version, stores: [...db.objectStoreNames], animal: animals[0], photo: await photos[0].blob.text(), queue: queues[0] }; db.close(); return value; };
    await remove(); await seedV7(); const localDb = await import("/src/storage/local-db.js?classification-upgrade");
    const upgradedDb = await localDb.openLocalDatabase(); upgradedDb.close(); const upgraded = await inspect();
    await remove(); await seedV7(); const originalCreate = IDBDatabase.prototype.createObjectStore;
    IDBDatabase.prototype.createObjectStore = function (store, ...args) { if (store === "animal_nutrition_classification_reviews") throw new DOMException("Synthetic failure", "AbortError"); return originalCreate.call(this, store, ...args); };
    let rollbackRejected = false; try { await localDb.openLocalDatabase(); } catch { rollbackRejected = true; } finally { IDBDatabase.prototype.createObjectStore = originalCreate; }
    const rolledBack = await inspect();
    await remove(); const repository = await import("/src/storage/farm-repository.js?classification-crud"); repository.setActiveFarm("farm-a");
    await localDb.put("animals", { id: "cow-a", farmId: "farm-a", animalCode: "TEST-COW-A", type: "dairy_cow", status: "active" });
    const input = { observedAt: "2026-10-05", liveWeightKg: 480, weightMethod: "SCALE_MEASURED", physiologicalStage: "POSTPARTUM",
      lactationStatus: "LACTATING", lactationStage: "EARLY", productionContext: "DAIRY", averageDailyMilkLiters: 20, productionWindowDays: 7,
      evidenceType: "FARM_RECORD", sourceTitle: "Synthetic classification evidence", sourceCitation: "TEST-CLASS-001", sourceUrl: "",
      applicabilityNotes: "Synthetic test only; no automated applicability or recommendation." };
    const v1 = await repository.createAnimalNutritionClassification("cow-a", input);
    let revisionRejected = false; try { await repository.createAnimalNutritionClassification("cow-a", input); } catch { revisionRejected = true; }
    const v2 = await repository.createAnimalNutritionClassification("cow-a", { ...input, liveWeightKg: 482, revisionReason: "New scale measurement" });
    const profile = await repository.createDiagnosticProfile({ name: "Synthetic classification profile", version: 1,
      animalClass: "LACTATING_DAIRY_COW", applicability: "Synthetic applicability review only", sourceTitle: "Synthetic source",
      sourceCitation: "TEST-REVIEW-PROFILE-001", publicationYear: 2021, sourceUrl: "",
      minimumForageDMFraction: 0.4, minimumMEDensityMJPerKgDM: 10, minimumCPPercentDM: 13 });
    let supersededApplicableRejected = false;
    try { await repository.reviewAnimalNutritionClassification(v1.id, { evidenceDecision: "CONFIRMED", profileId: profile.id,
      applicabilityDecision: "APPLICABLE", reviewerUserId: "reviewer-a", reviewerConfirmed: true, rationale: "Obsolete version" }); }
    catch { supersededApplicableRejected = true; }
    const review = await repository.reviewAnimalNutritionClassification(v2.id, { evidenceDecision: "CONFIRMED", profileId: profile.id,
      applicabilityDecision: "APPLICABLE", reviewerUserId: "reviewer-a", reviewerConfirmed: true,
      rationale: "Synthetic evidence and applicability reviewed explicitly" });
    const noActivation = await repository.getSelectedDiagnosticProfile();
    await repository.selectDiagnosticProfile(profile.id, { rationale: "Explicitly supported activation",
      animalIds: ["cow-a"], applicabilityConfirmed: true });
    const activated = await repository.getSelectedDiagnosticProfile();
    const concurrent = await Promise.allSettled([483, 484].map((liveWeightKg) => repository.createAnimalNutritionClassification("cow-a",
      { ...input, liveWeightKg, revisionReason: "Concurrent synthetic scale measurement" })));
    const staleClassificationDeactivated = await repository.getSelectedDiagnosticProfile() === null;
    const history = await repository.listAnimalNutritionClassifications("cow-a");
    const reviews = await repository.listAnimalNutritionClassificationReviews("cow-a");
    repository.setActiveFarm("farm-b"); const hidden = (await repository.listAnimalNutritionClassifications("cow-a")).length === 0;
    const reviewsHidden = (await repository.listAnimalNutritionClassificationReviews("cow-a")).length === 0;
    let foreignRejected = false; try { await repository.createAnimalNutritionClassification("cow-a", input); } catch { foreignRejected = true; }
    const records = await localDb.getAll("records"); const queue = await localDb.getAll("sync_queue");
    return { upgraded, rollbackRejected, rolledBack, v1, v2, profile, review, noActivation, activated, staleClassificationDeactivated, supersededApplicableRejected,
      concurrent: concurrent.map((row) => row.status), history, reviews, hidden, reviewsHidden, foreignRejected, records, queue };
  });
  assert.equal(result.upgraded.version, 11); assert.equal(result.upgraded.stores.includes("animal_nutrition_classifications"), true);
  assert.equal(result.upgraded.stores.includes("animal_nutrition_classification_reviews"), true);
  assert.equal(result.upgraded.animal.animalCode, "PRESERVED"); assert.equal(result.upgraded.photo, "PHOTO"); assert.equal(result.upgraded.queue.status, "pending");
  assert.equal(result.rollbackRejected, true); assert.equal(result.rolledBack.version, 7); assert.equal(result.rolledBack.stores.includes("animal_nutrition_classifications"), false);
  assert.equal(result.rolledBack.stores.includes("animal_nutrition_classification_reviews"), false);
  assert.equal(result.v1.version, 1); assert.equal(result.v2.version, 2); assert.equal(result.v2.supersedesClassificationId, result.v1.id);
  assert.deepEqual(result.concurrent.sort(), ["fulfilled", "rejected"]); assert.equal(result.history.length, 3); assert.equal(result.history[0].version, 3);
  assert.equal(result.review.classificationId, result.v2.id); assert.equal(result.review.profileId, result.profile.id);
  assert.equal(result.noActivation, null); assert.equal(result.activated.profile.id, result.profile.id);
  assert.equal(result.activated.selection.classificationEvidence[0].reviewId, result.review.id);
  assert.equal(result.staleClassificationDeactivated, true); assert.equal(result.supersededApplicableRejected, true); assert.equal(result.reviews.length, 1);
  assert.equal(result.hidden, true); assert.equal(result.reviewsHidden, true); assert.equal(result.foreignRejected, true);
  assert.equal(result.records.length, 0); assert.equal(result.queue.length, 0);
  console.log("animal-nutrition-classification.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
