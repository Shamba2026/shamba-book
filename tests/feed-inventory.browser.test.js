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
  try { response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(await readFile(filename)); }
  catch { response.writeHead(404).end(); }
});

const browser = await chromium.launch({ headless: true }); let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context = await browser.newContext({ serviceWorkers: "block" }); const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/src/config.js`);
  const result = await page.evaluate(async () => {
    const name = "ngombe-herdbook";
    const v3Stores = ["animals", "attachments", "records", "sync_queue", "settings", "feed_library", "feed_sources", "feed_observations"];
    const request = (item) => new Promise((resolve, reject) => { item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error); });
    const complete = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("aborted")); });
    const remove = () => request(indexedDB.deleteDatabase(name));
    const seedV3 = async () => {
      const open = indexedDB.open(name, 3);
      open.onupgradeneeded = () => v3Stores.forEach((store) => open.result.createObjectStore(store, { keyPath: store === "settings" ? "key" : "id" }));
      const db = await request(open); const tx = db.transaction(v3Stores, "readwrite");
      const rows = {
        animals: { id: "animal-a", farmId: "farm-a", animalCode: "PRESERVED" },
        attachments: { id: "photo-a", farmId: "farm-a", ownerId: "animal-a", blob: new Blob(["PHOTO-BYTES"], { type: "text/plain" }) },
        records: { id: "record-a", farmId: "farm-a", kind: "health" },
        sync_queue: { id: "queue-a", farmId: "farm-a", status: "pending" },
        settings: { key: "setting-a", value: "preserved" },
        feed_library: { id: "feed-a", farmId: "farm-a", name: "Existing feed", role: "forage", status: "active" },
        feed_sources: { id: "source-a", farmId: "farm-a", title: "Existing source", status: "active" },
        feed_observations: { id: "observation-a", farmId: "farm-a", feedId: "feed-a", sourceId: "source-a", value: 80 }
      };
      v3Stores.forEach((store) => tx.objectStore(store).put(rows[store])); await complete(tx); db.close(); return rows;
    };
    const inspect = async () => {
      const db = await request(indexedDB.open(name)); const rows = {};
      for (const store of v3Stores) { rows[store] = await request(db.transaction(store).objectStore(store).getAll());
        if (store === "attachments") rows[store][0].blobText = await rows[store][0].blob.text(); }
      const state = { version: db.version, stores: [...db.objectStoreNames], rows }; db.close(); return state;
    };

    await remove(); await seedV3(); const localDb = await import("/src/storage/local-db.js?inventory-upgrade");
    const upgradedDb = await localDb.openLocalDatabase(); const upgraded = { version: upgradedDb.version, stores: [...upgradedDb.objectStoreNames] }; upgradedDb.close();
    const preserved = await inspect();
    await remove(); await seedV3(); const originalCreate = IDBDatabase.prototype.createObjectStore;
    IDBDatabase.prototype.createObjectStore = function (store, ...args) {
      if (store === "feed_inventory_batches") throw new DOMException("Synthetic inventory upgrade failure", "AbortError");
      return originalCreate.call(this, store, ...args);
    };
    let upgradeRejected = false; try { await localDb.openLocalDatabase(); } catch { upgradeRejected = true; }
    finally { IDBDatabase.prototype.createObjectStore = originalCreate; }
    const rolledBack = await inspect();

    await remove(); const repository = await import("/src/storage/farm-repository.js?inventory-crud");
    repository.setActiveFarm("farm-a"); const feed = await repository.createFeed({ name: "Synthetic hay", role: "forage" });
    const source = await repository.createFeedCostSource({ sourceType: "receipt", reference: "TEST-RECEIPT-001",
      counterparty: "Synthetic supplier", documentDate: "2026-09-28" });
    const batch = await repository.createFeedInventoryBatch(feed.id, { costSourceId: source.id, receivedAt: "2026-09-28",
      receivedQuantityKg: "125.5", totalCost: "2500.25", currencyCode: "KES", lotReference: "TEST-LOT-001" });
    const farmA = await repository.listFeedInventoryBatches();
    repository.setActiveFarm("farm-b"); const farmBEmpty = (await repository.listFeedInventoryBatches()).length === 0;
    const farmBFeed = await repository.createFeed({ name: "Synthetic hay", role: "forage" });
    let crossFarmRejected = false;
    try { await repository.createFeedInventoryBatch(farmBFeed.id, { costSourceId: source.id, receivedAt: "2026-09-28",
      receivedQuantityKg: 1, totalCost: 1, currencyCode: "KES" }); } catch { crossFarmRejected = true; }
    repository.setActiveFarm("farm-a"); const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) { if (this.name === "feed_inventory_batches" && value?.lotReference === "FAIL")
      throw new DOMException("Synthetic batch failure", "DataCloneError"); return originalPut.call(this, value, ...args); };
    let writeRejected = false;
    try { await repository.createFeedInventoryBatch(feed.id, { costSourceId: source.id, receivedAt: "2026-09-28",
      receivedQuantityKg: 1, totalCost: 1, currencyCode: "KES", lotReference: "FAIL" }); } catch { writeRejected = true; }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const afterFailure = await repository.listFeedInventoryBatches();
    const records = await localDb.getAll("records"); const queue = await localDb.getAll("sync_queue");
    return { upgraded, preserved, upgradeRejected, rolledBack, source, batch, farmA, farmBEmpty,
      crossFarmRejected, writeRejected, afterFailure, records, queue };
  });
  assert.equal(result.upgraded.version, 10);
  assert.equal(result.upgraded.stores.includes("feed_cost_sources"), true);
  assert.equal(result.upgraded.stores.includes("feed_inventory_batches"), true);
  assert.equal(result.preserved.rows.attachments[0].blobText, "PHOTO-BYTES");
  assert.equal(result.preserved.rows.feed_observations[0].value, 80);
  assert.equal(result.upgradeRejected, true); assert.equal(result.rolledBack.version, 3);
  assert.equal(result.rolledBack.stores.includes("feed_cost_sources"), false);
  assert.equal(result.rolledBack.stores.includes("feed_inventory_batches"), false);
  assert.equal(result.rolledBack.rows.attachments[0].blobText, "PHOTO-BYTES");
  assert.equal(result.batch.unit, "KG_AS_FED"); assert.equal(result.batch.totalCostCents, 250025);
  assert.equal(result.batch.remainingQuantityKg, 125.5); assert.equal(result.farmA[0].costSource.reference, "TEST-RECEIPT-001");
  assert.equal(result.farmBEmpty, true); assert.equal(result.crossFarmRejected, true); assert.equal(result.writeRejected, true);
  assert.equal(result.afterFailure.length, 1); assert.equal(result.records.length, 0); assert.equal(result.queue.length, 0);
  console.log("feed-inventory.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
