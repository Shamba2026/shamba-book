import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const contentTypes = { ".js": "text/javascript" };
const server = createServer(async (request, response) => {
  const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1);
  const filename = path.resolve(root, relative);
  if (request.method !== "GET" || !filename.startsWith(root + path.sep) || !relative.startsWith("src/")) {
    response.writeHead(404).end(); return;
  }
  try {
    response.writeHead(200, { "content-type": contentTypes[path.extname(filename)] || "application/octet-stream",
      "cache-control": "no-store" }).end(await readFile(filename));
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
    const existingStores = ["animals", "attachments", "records", "sync_queue", "settings"];
    const sentinel = {
      animals: { id: "preserved-animal", animalCode: "PRESERVE-ME", farmId: "farm-a" },
      attachments: { id: "preserved-photo", ownerId: "preserved-animal", bytes: [1, 2, 3] },
      records: { id: "preserved-record", kind: "health", farmId: "farm-a" },
      sync_queue: { id: "preserved-queue", recordId: "preserved-record", status: "pending" },
      settings: { key: "preserved-setting", value: "unchanged" }
    };
    const request = (item) => new Promise((resolve, reject) => {
      item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error);
    });
    const completed = (transaction) => new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("aborted"));
    });
    const remove = async () => { await request(indexedDB.deleteDatabase(databaseName)); };
    const createVersionOne = async () => {
      const open = indexedDB.open(databaseName, 1);
      open.onupgradeneeded = () => existingStores.forEach((name) =>
        open.result.createObjectStore(name, { keyPath: name === "settings" ? "key" : "id" }));
      const db = await request(open);
      const transaction = db.transaction(existingStores, "readwrite");
      existingStores.forEach((name) => transaction.objectStore(name).put(sentinel[name]));
      await completed(transaction); db.close();
    };
    const inspect = async () => {
      const db = await request(indexedDB.open(databaseName));
      const rows = {};
      for (const name of existingStores) rows[name] = await request(db.transaction(name).objectStore(name).getAll());
      const state = { version: db.version, stores: [...db.objectStoreNames], rows };
      db.close(); return state;
    };

    await remove(); await createVersionOne();
    const localDb = await import("/src/storage/local-db.js?feed-upgrade-success");
    const upgraded = await localDb.openLocalDatabase();
    const upgradedState = { version: upgraded.version, stores: [...upgraded.objectStoreNames] };
    upgraded.close();
    const preserved = await inspect();

    await remove(); await createVersionOne();
    const originalCreate = IDBDatabase.prototype.createObjectStore;
    IDBDatabase.prototype.createObjectStore = function (name, ...args) {
      if (name === "feed_library") throw new DOMException("Synthetic upgrade failure", "AbortError");
      return originalCreate.call(this, name, ...args);
    };
    let upgradeRejected = false;
    try { await localDb.openLocalDatabase(); } catch { upgradeRejected = true; }
    finally { IDBDatabase.prototype.createObjectStore = originalCreate; }
    const rolledBack = await inspect();

    await remove();
    const repository = await import("/src/storage/farm-repository.js?feed-library-crud");
    repository.setActiveFarm("farm-a");
    const created = await repository.createFeed({ name: "  Rhodes   grass  ", role: "forage" });
    const updated = await repository.updateFeed(created.id, { name: "Rhodes hay", role: "forage" });
    const farmAList = await repository.listFeeds();
    repository.setActiveFarm("farm-b");
    const hiddenFromFarmB = await repository.getFeed(created.id) === null && (await repository.listFeeds()).length === 0;
    let crossFarmUpdateRejected = false;
    try { await repository.updateFeed(created.id, { name: "Intrusion" }); } catch { crossFarmUpdateRejected = true; }
    const farmBFeed = await repository.createFeed({ name: "Rhodes hay", role: "forage" });
    repository.setActiveFarm("farm-a");

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "feed_library" && value?.id === created.id && value?.name === "Must roll back") {
        throw new DOMException("Synthetic feed write failure", "DataCloneError");
      }
      return originalPut.call(this, value, ...args);
    };
    let writeRejected = false;
    try { await repository.updateFeed(created.id, { name: "Must roll back" }); } catch { writeRejected = true; }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const afterFailedWrite = await repository.getFeed(created.id);
    const archived = await repository.deleteFeed(created.id);
    const activeAfterDelete = await repository.listFeeds();
    const allAfterDelete = await repository.listFeeds({ includeArchived: true });

    return { sentinel, upgradedState, preserved, upgradeRejected, rolledBack, created, updated, farmAList,
      hiddenFromFarmB, crossFarmUpdateRejected, farmBFeed, writeRejected, afterFailedWrite,
      archived, activeAfterDelete, allAfterDelete };
  });

  assert.equal(result.upgradedState.version, 3);
  assert.equal(result.upgradedState.stores.includes("feed_library"), true);
  assert.deepEqual(result.preserved.rows, Object.fromEntries(Object.entries(result.sentinel).map(([name, row]) => [name, [row]])),
    "the additive upgrade must preserve every existing row");
  assert.equal(result.upgradeRejected, true);
  assert.equal(result.rolledBack.version, 1, "a failed upgrade must leave the old database version in place");
  assert.equal(result.rolledBack.stores.includes("feed_library"), false, "a failed upgrade must roll back the new store");
  assert.deepEqual(result.rolledBack.rows, result.preserved.rows, "upgrade rollback must preserve existing rows");
  assert.equal(result.created.name, "Rhodes grass");
  assert.equal(result.created.farmId, "farm-a");
  assert.equal(result.updated.name, "Rhodes hay");
  assert.equal(result.farmAList.length, 1);
  assert.equal(result.hiddenFromFarmB, true);
  assert.equal(result.crossFarmUpdateRejected, true);
  assert.equal(result.farmBFeed.farmId, "farm-b");
  assert.equal(result.writeRejected, true);
  assert.equal(result.afterFailedWrite.name, "Rhodes hay", "a failed update must preserve the prior feed row");
  assert.equal(result.archived.status, "archived");
  assert.equal(result.activeAfterDelete.length, 0);
  assert.equal(result.allAfterDelete.length, 1, "delete must remain recoverable as an archived row");
  console.log("feed-library.browser.test.js: PASS");
} finally {
  await context?.close();
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
