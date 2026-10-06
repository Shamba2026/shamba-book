import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = createServer(async (request, response) => {
  const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1); const filename = path.resolve(root, relative);
  if (request.method !== "GET" || !filename.startsWith(root + path.sep) || !relative.startsWith("src/")) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(await readFile(filename)); }
  catch { response.writeHead(404).end(); }
});

const browser = await chromium.launch({ headless: true }); let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/src/config.js`);
  const result = await page.evaluate(async () => {
    const dbName = "ngombe-herdbook";
    const v5Stores = ["animals", "attachments", "records", "sync_queue", "settings", "feed_library", "feed_sources",
      "feed_observations", "feed_cost_sources", "feed_inventory_batches", "feed_inventory_movements", "feed_nutrition_selections"];
    const request = (item) => new Promise((resolve, reject) => { item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error); });
    const complete = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("aborted")); });
    const remove = () => request(indexedDB.deleteDatabase(dbName));
    const seedV5 = async () => { const open = indexedDB.open(dbName, 5);
      open.onupgradeneeded = () => v5Stores.forEach((store) => open.result.createObjectStore(store, { keyPath: store === "settings" ? "key" : "id" }));
      const db = await request(open); const tx = db.transaction(v5Stores, "readwrite");
      tx.objectStore("animals").put({ id: "preserved-animal", farmId: "farm-a", animalCode: "PRESERVED" });
      tx.objectStore("attachments").put({ id: "preserved-photo", farmId: "farm-a", blob: new Blob(["PRESERVED-PHOTO"]) });
      tx.objectStore("feed_inventory_batches").put({ id: "preserved-batch", farmId: "farm-a", receivedQuantityKg: 4 });
      await complete(tx); db.close(); };
    const inspect = async () => { const db = await request(indexedDB.open(dbName));
      const animals = await request(db.transaction("animals").objectStore("animals").getAll());
      const photos = await request(db.transaction("attachments").objectStore("attachments").getAll());
      const result = { version: db.version, stores: [...db.objectStoreNames], animal: animals[0], photo: await photos[0].blob.text() }; db.close(); return result; };

    await remove(); await seedV5(); const localDb = await import("/src/storage/local-db.js?semantics-upgrade");
    const upgradedDb = await localDb.openLocalDatabase(); const upgraded = { version: upgradedDb.version, stores: [...upgradedDb.objectStoreNames] }; upgradedDb.close();
    const preserved = await inspect();
    await remove(); await seedV5(); const originalCreate = IDBDatabase.prototype.createObjectStore;
    IDBDatabase.prototype.createObjectStore = function (name, ...args) { if (name === "feed_diagnostic_profile_selections")
      throw new DOMException("Synthetic selection upgrade failure", "AbortError"); return originalCreate.call(this, name, ...args); };
    let upgradeRejected = false; try { await localDb.openLocalDatabase(); } catch { upgradeRejected = true; }
    finally { IDBDatabase.prototype.createObjectStore = originalCreate; }
    const rolledBack = await inspect();

    await remove(); const repository = await import("/src/storage/farm-repository.js?semantics-crud"); repository.setActiveFarm("farm-a");
    const feed = await repository.createFeed({ name: "Synthetic semantics feed", role: "forage" });
    const cost = await repository.createFeedCostSource({ sourceType: "receipt", reference: "TEST-COST", documentDate: "2026-09-28" });
    const batch = await repository.createFeedInventoryBatch(feed.id, { costSourceId: cost.id, receivedAt: "2026-09-28",
      receivedQuantity: 0.01, inputUnit: "METRIC_TONNE_AS_FED", totalCost: 100, currencyCode: "KES" });
    const concurrent = await Promise.allSettled([8, 8].map((quantity) => repository.recordFeedInventoryMovement(batch.id,
      { movementType: "CONSUMPTION", movementDate: "2026-09-28", quantity, unit: "KG_AS_FED", reason: "Synthetic concurrency test" })));
    await repository.recordFeedInventoryMovement(batch.id, { movementType: "CORRECTION_INCREASE", movementDate: "2026-09-28",
      quantity: 500, unit: "G_AS_FED", reason: "Synthetic correction" });
    const inventory = await repository.listFeedInventoryBatches();

    const source = await repository.createNutritionSource({ title: "Synthetic laboratory", sourceType: "lab_report", citation: "TEST-LAB" });
    const base = { sourceId: source.id, nutrientCode: "CP", unit: "PERCENT", basis: "DRY_MATTER", evidenceClass: "VERIFIED_LAB" };
    const observationA = await repository.createNutritionObservation(feed.id, { ...base, value: 14 });
    const observationB = await repository.createNutritionObservation(feed.id, { ...base, value: 16 });
    const noAutomaticSelection = await repository.getNutritionSelections(feed.id);
    await repository.selectNutritionObservation(feed.id, { observationId: observationA.id, rationale: "Initial reviewed result" });
    await repository.selectNutritionObservation(feed.id, { observationId: observationB.id, rationale: "Newer reviewed result" });
    const selections = await repository.getNutritionSelections(feed.id);
    await localDb.put("animals", { id: "diagnostic-animal", farmId: "farm-a", animalCode: "TEST-DIAGNOSTIC-ANIMAL", type: "dairy_cow", status: "active" });
    const profile = await repository.createDiagnosticProfile({ name: "Synthetic lactating profile", version: 1,
      animalClass: "LACTATING_DAIRY_COW", applicability: "Synthetic browser test only", sourceTitle: "Synthetic source",
      sourceCitation: "TEST-DIAGNOSTIC-001", sourceUrl: "", publicationYear: 2021,
      minimumForageDMFraction: 0.4, minimumMEDensityMJPerKgDM: 10, minimumCPPercentDM: 13 });
    const noAutomaticDiagnostic = await repository.getSelectedDiagnosticProfile();
    let unreviewedDiagnosticRejected = false;
    try { await repository.selectDiagnosticProfile(profile.id, { rationale: "Missing classification review",
      animalIds: ["diagnostic-animal"], applicabilityConfirmed: true }); } catch { unreviewedDiagnosticRejected = true; }
    const classificationInput = { observedAt: "2026-10-05", liveWeightKg: 480, weightMethod: "SCALE_MEASURED",
      physiologicalStage: "POSTPARTUM", lactationStatus: "LACTATING", lactationStage: "EARLY", productionContext: "DAIRY",
      averageDailyMilkLiters: 20, productionWindowDays: 7, evidenceType: "FARM_RECORD", sourceTitle: "Synthetic animal evidence",
      sourceCitation: "TEST-CLASSIFICATION", sourceUrl: "", applicabilityNotes: "Synthetic activation-gate evidence only" };
    const classification = await repository.createAnimalNutritionClassification("diagnostic-animal", classificationInput);
    await repository.reviewAnimalNutritionClassification(classification.id, { evidenceDecision: "CONFIRMED", profileId: profile.id,
      applicabilityDecision: "APPLICABLE", reviewerUserId: "reviewer-a", reviewerConfirmed: true,
      rationale: "Synthetic reviewed applicability" });
    await repository.selectDiagnosticProfile(profile.id, { rationale: "Synthetic reviewed applicability",
      animalIds: ["diagnostic-animal"], applicabilityConfirmed: true });
    const selectedDiagnostic = await repository.getSelectedDiagnosticProfile();
    repository.setActiveFarm("farm-b"); const hiddenInventory = (await repository.listFeedInventoryBatches()).length === 0;
    const hiddenSelections = await repository.getNutritionSelections(feed.id) === null;
    const hiddenDiagnostic = await repository.getSelectedDiagnosticProfile() === null;
    let crossFarmDiagnosticRejected = false;
    try { await repository.selectDiagnosticProfile(profile.id, { rationale: "Cross farm", animalIds: ["diagnostic-animal"],
      applicabilityConfirmed: true }); } catch { crossFarmDiagnosticRejected = true; }
    let crossFarmSelectionRejected = false;
    try { await repository.selectNutritionObservation(feed.id, { observationId: observationB.id, rationale: "Cross farm" }); }
    catch { crossFarmSelectionRejected = true; }
    repository.setActiveFarm("farm-a"); await repository.archiveNutritionObservation(observationB.id);
    let archivedSelectionRejected = false;
    try { await repository.selectNutritionObservation(feed.id, { observationId: observationB.id, rationale: "Archived" }); }
    catch { archivedSelectionRejected = true; }
    const revision = { name: "Synthetic lactating profile", version: 2,
      animalClass: "LACTATING_DAIRY_COW", applicability: "Synthetic browser test only, revision two", sourceTitle: "Synthetic source",
      sourceCitation: "TEST-DIAGNOSTIC-002", sourceUrl: "", publicationYear: 2022,
      minimumForageDMFraction: 0.45, minimumMEDensityMJPerKgDM: 10.5, minimumCPPercentDM: 14,
      supersessionReason: "New reviewed synthetic evidence" };
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) { if (value?.supersedesProfileId)
      throw new DOMException("Synthetic supersession failure", "AbortError"); return originalPut.call(this, value, ...args); };
    let supersessionRollbackRejected = false;
    try { await repository.supersedeDiagnosticProfile(profile.id, revision); } catch { supersessionRollbackRejected = true; }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const afterFailedSupersession = await repository.listDiagnosticProfiles({ includeArchived: true });
    const profileV2 = await repository.supersedeDiagnosticProfile(profile.id, revision);
    const oldSelectionDeactivated = await repository.getSelectedDiagnosticProfile() === null;
    await repository.reviewAnimalNutritionClassification(classification.id, { evidenceDecision: "CONFIRMED", profileId: profileV2.id,
      applicabilityDecision: "APPLICABLE", reviewerUserId: "reviewer-a", reviewerConfirmed: true,
      rationale: "Revision two applicability reviewed" });
    await repository.selectDiagnosticProfile(profileV2.id, { rationale: "Revision two approved", animalIds: ["diagnostic-animal"],
      applicabilityConfirmed: true });
    await repository.recordDiagnosticWarningReview({ totalAsFedKg: 10, totalDMIKg: 4, forageDMKg: 1,
      meDensityMJPerKgDM: 9, cpPercentDM: 12, totalCostCents: 100 }, [{ code: "LOW_ME_DENSITY" }]);
    await repository.archiveDiagnosticProfile(profileV2.id, "Synthetic retirement");
    const archivedSelectionDeactivated = await repository.getSelectedDiagnosticProfile() === null;
    const profileHistory = await repository.listDiagnosticProfiles({ includeArchived: true });
    const warningHistory = await repository.listDiagnosticWarningHistory();
    const records = await localDb.getAll("records"); const queue = await localDb.getAll("sync_queue");
    const selectionEvents = await localDb.getAll("feed_nutrition_selections");
    return { upgraded, preserved, upgradeRejected, rolledBack, batch, concurrent: concurrent.map((x) => x.status), inventory,
      noAutomaticSelection, selections, noAutomaticDiagnostic, unreviewedDiagnosticRejected, selectedDiagnostic, hiddenInventory, hiddenSelections,
      hiddenDiagnostic, crossFarmDiagnosticRejected, crossFarmSelectionRejected,
      archivedSelectionRejected, supersessionRollbackRejected, afterFailedSupersession, oldSelectionDeactivated,
      archivedSelectionDeactivated, profileHistory, warningHistory,
      records, queue, selectionEvents };
  });
  assert.equal(result.upgraded.version, 11); assert.equal(result.upgraded.stores.includes("feed_diagnostic_profiles"), true);
  assert.equal(result.upgraded.stores.includes("feed_diagnostic_warning_events"), true);
  assert.equal(result.upgraded.stores.includes("feed_diagnostic_profile_selections"), true);
  assert.equal(result.upgraded.stores.includes("feed_nutrition_selections"), true); assert.equal(result.preserved.photo, "PRESERVED-PHOTO");
  assert.equal(result.preserved.animal.animalCode, "PRESERVED"); assert.equal(result.upgradeRejected, true);
  assert.equal(result.rolledBack.version, 5); assert.equal(result.rolledBack.stores.includes("feed_diagnostic_profiles"), false);
  assert.equal(result.rolledBack.stores.includes("feed_diagnostic_profile_selections"), false); assert.equal(result.rolledBack.photo, "PRESERVED-PHOTO");
  assert.equal(result.batch.receivedQuantityKg, 10); assert.deepEqual(result.concurrent.sort(), ["fulfilled", "rejected"]);
  assert.equal(result.inventory[0].remainingQuantityKg, 2.5); assert.deepEqual(result.noAutomaticSelection, {});
  assert.equal(result.selections.CP.observation.value, 16); assert.equal(result.selections.CP.source.citation, "TEST-LAB");
  assert.equal(result.noAutomaticDiagnostic, null); assert.equal(result.selectedDiagnostic.profile.version, 1);
  assert.equal(result.unreviewedDiagnosticRejected, true);
  assert.equal(result.selectedDiagnostic.selection.rationale, "Synthetic reviewed applicability");
  assert.equal(result.hiddenDiagnostic, true); assert.equal(result.crossFarmDiagnosticRejected, true);
  assert.equal(result.supersessionRollbackRejected, true); assert.equal(result.afterFailedSupersession.length, 1);
  assert.equal(result.afterFailedSupersession[0].status, "active");
  assert.equal(result.oldSelectionDeactivated, true); assert.equal(result.archivedSelectionDeactivated, true);
  assert.equal(result.profileHistory.length, 2); assert.equal(result.profileHistory.every((row) => row.status === "archived"), true);
  assert.equal(result.warningHistory.length, 1); assert.deepEqual(result.warningHistory[0].findingCodes, ["LOW_ME_DENSITY"]);
  assert.equal(result.selectionEvents.length, 2, "selection history must be retained"); assert.equal(result.hiddenInventory, true);
  assert.equal(result.hiddenSelections, true); assert.equal(result.crossFarmSelectionRejected, true);
  assert.equal(result.archivedSelectionRejected, true); assert.equal(result.records.length, 0); assert.equal(result.queue.length, 0);
  console.log("feed-inventory-semantics.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
