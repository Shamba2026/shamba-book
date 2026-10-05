import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = createServer(async (request, response) => {
  const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1);
  const filename = path.resolve(root, relative);
  if (request.method !== "GET" || !filename.startsWith(root + path.sep) || !relative.startsWith("src/")) {
    response.writeHead(404).end(); return;
  }
  try {
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});

const browser = await chromium.launch({ headless: true });
let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(origin + "/src/config.js");
  const result = await page.evaluate(async () => {
    const databaseName = "ngombe-herdbook";
    const v2Stores = ["animals", "attachments", "records", "sync_queue", "settings", "feed_library"];
    const request = (item) => new Promise((resolve, reject) => {
      item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error);
    });
    const complete = (transaction) => new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("aborted"));
    });
    const remove = () => request(indexedDB.deleteDatabase(databaseName));
    const seedV2 = async () => {
      const open = indexedDB.open(databaseName, 2);
      open.onupgradeneeded = () => v2Stores.forEach((name) =>
        open.result.createObjectStore(name, { keyPath: name === "settings" ? "key" : "id" }));
      const db = await request(open);
      const rows = {
        animals: { id: "animal-a", farmId: "farm-a", animalCode: "PRESERVED" },
        attachments: { id: "photo-a", farmId: "farm-a", ownerId: "animal-a", blob: new Blob(["PHOTO-BYTES"], { type: "text/plain" }) },
        records: { id: "record-a", farmId: "farm-a", kind: "health" },
        sync_queue: { id: "queue-a", farmId: "farm-a", status: "pending" },
        settings: { key: "setting-a", value: "preserved" },
        feed_library: { id: "feed-a", farmId: "farm-a", name: "Existing feed", role: "forage", status: "active" }
      };
      const transaction = db.transaction(v2Stores, "readwrite");
      v2Stores.forEach((name) => transaction.objectStore(name).put(rows[name]));
      await complete(transaction); db.close(); return rows;
    };
    const inspect = async () => {
      const db = await request(indexedDB.open(databaseName));
      const rows = {};
      for (const name of v2Stores) {
        rows[name] = await request(db.transaction(name).objectStore(name).getAll());
        if (name === "attachments") rows[name][0].blobText = await rows[name][0].blob.text();
      }
      const state = { version: db.version, stores: [...db.objectStoreNames], rows };
      db.close(); return state;
    };

    await remove(); const seeded = await seedV2();
    const localDb = await import("/src/storage/local-db.js?provenance-upgrade");
    const upgradedDb = await localDb.openLocalDatabase();
    const upgraded = { version: upgradedDb.version, stores: [...upgradedDb.objectStoreNames] };
    upgradedDb.close();
    const preserved = await inspect();

    await remove(); await seedV2();
    const originalCreate = IDBDatabase.prototype.createObjectStore;
    IDBDatabase.prototype.createObjectStore = function (name, ...args) {
      if (name === "feed_observations") throw new DOMException("Synthetic provenance upgrade failure", "AbortError");
      return originalCreate.call(this, name, ...args);
    };
    let upgradeRejected = false;
    try { await localDb.openLocalDatabase(); } catch { upgradeRejected = true; }
    finally { IDBDatabase.prototype.createObjectStore = originalCreate; }
    const rolledBack = await inspect();

    await remove();
    const repository = await import("/src/storage/farm-repository.js?provenance-crud");
    repository.setActiveFarm("farm-a");
    const feed = await repository.createFeed({ name: "Synthetic profile feed", role: "forage" });
    const sourceA = await repository.createNutritionSource({ title: "Synthetic report A", sourceType: "lab_report",
      citation: "TEST-A", publisher: "Synthetic laboratory", publicationYear: 2026 });
    const sourceB = await repository.createNutritionSource({ title: "Synthetic study B", sourceType: "research_publication",
      citation: "TEST-B", publisher: "Synthetic journal", publicationYear: 2025, url: "https://example.invalid/test-b" });
    const common = { nutrientCode: "CP", unit: "G_PER_KG_DM", basis: "DRY_MATTER",
      evidenceClass: "VERIFIED_LAB", observedAt: "2026-09-27", context: "Synthetic browser test" };
    const observationA = await repository.createNutritionObservation(feed.id, { ...common, sourceId: sourceA.id, value: 80 });
    const observationB = await repository.createNutritionObservation(feed.id, { ...common, sourceId: sourceB.id,
      evidenceClass: "RESEARCH_SUPPORTED", value: 60, rangeMin: 50, rangeMax: 70, sampleCount: 5 });
    const profile = await repository.getNutritionProfile(feed.id);

    repository.setActiveFarm("farm-b");
    const farmBEmpty = (await repository.listNutritionSources()).length === 0;
    const hiddenProfile = await repository.getNutritionProfile(feed.id) === null;
    const farmBFeed = await repository.createFeed({ name: "Synthetic profile feed", role: "forage" });
    let crossFarmSourceRejected = false;
    try { await repository.createNutritionObservation(farmBFeed.id, { ...common, sourceId: sourceA.id, value: 90 }); }
    catch { crossFarmSourceRejected = true; }
    repository.setActiveFarm("farm-a");

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "feed_observations" && value?.value === 999) {
        throw new DOMException("Synthetic observation failure", "DataCloneError");
      }
      return originalPut.call(this, value, ...args);
    };
    let failedWriteRejected = false;
    try { await repository.createNutritionObservation(feed.id, { ...common, sourceId: sourceA.id,
      nutrientCode: "ME", unit: "MJ_PER_KG_DM", value: 999 }); } catch { failedWriteRejected = true; }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const afterFailure = await repository.getNutritionProfile(feed.id);
    await repository.archiveNutritionSource(sourceA.id);
    let archivedSourceRejected = false;
    try { await repository.createNutritionObservation(feed.id, { ...common, sourceId: sourceA.id, value: 90 }); }
    catch { archivedSourceRejected = true; }
    const retainedAfterSourceArchive = await repository.getNutritionProfile(feed.id);
    await repository.archiveNutritionObservation(observationA.id);
    const activeAfterArchive = await repository.getNutritionProfile(feed.id);
    const allAfterArchive = await repository.getNutritionProfile(feed.id, { includeArchived: true });

    return { seeded, upgraded, preserved, upgradeRejected, rolledBack, feed, sourceA, sourceB,
      observationA, observationB, profile, farmBEmpty, hiddenProfile, crossFarmSourceRejected,
      failedWriteRejected, afterFailure, archivedSourceRejected, retainedAfterSourceArchive,
      activeAfterArchive, allAfterArchive };
  });

  assert.equal(result.upgraded.version, 6);
  assert.equal(result.upgraded.stores.includes("feed_sources"), true);
  assert.equal(result.upgraded.stores.includes("feed_observations"), true);
  assert.equal(result.preserved.rows.attachments[0].blobText, "PHOTO-BYTES");
  assert.equal(result.preserved.rows.animals[0].animalCode, "PRESERVED");
  assert.equal(result.preserved.rows.records[0].kind, "health");
  assert.equal(result.preserved.rows.sync_queue[0].status, "pending");
  assert.equal(result.preserved.rows.settings[0].value, "preserved");
  assert.equal(result.preserved.rows.feed_library[0].name, "Existing feed");
  assert.equal(result.upgradeRejected, true);
  assert.equal(result.rolledBack.version, 2);
  assert.equal(result.rolledBack.stores.includes("feed_sources"), false);
  assert.equal(result.rolledBack.stores.includes("feed_observations"), false);
  assert.equal(result.rolledBack.rows.attachments[0].blobText, "PHOTO-BYTES");
  assert.equal(result.profile.nutrients.CP.length, 2);
  assert.deepEqual(result.profile.conflicts, ["CP"]);
  assert.equal("average" in result.profile, false, "conflicting evidence must never be silently averaged");
  assert.deepEqual(result.profile.nutrients.CP.map((row) => row.source.citation).sort(), ["TEST-A", "TEST-B"]);
  assert.equal(result.farmBEmpty, true);
  assert.equal(result.hiddenProfile, true);
  assert.equal(result.crossFarmSourceRejected, true);
  assert.equal(result.failedWriteRejected, true);
  assert.equal(result.afterFailure.nutrients.ME, undefined);
  assert.equal(result.archivedSourceRejected, true);
  assert.equal(result.retainedAfterSourceArchive.nutrients.CP.length, 2,
    "archiving a source must retain historical provenance");
  assert.equal(result.activeAfterArchive.nutrients.CP.length, 1);
  assert.equal(result.allAfterArchive.nutrients.CP.length, 2);
  console.log("feed-provenance.browser.test.js: PASS");
} finally {
  await context?.close();
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
