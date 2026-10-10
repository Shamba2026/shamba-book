import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// A fresh browser context and loopback origin contain only synthetic rows.
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

let browser;
let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/src/config.js`);
  const result = await page.evaluate(async () => {
    const storage = await import("/src/storage/local-db.js?runtime-farm-test");
    const repository = await import("/src/storage/farm-repository.js?runtime-farm-test");
    const date = "2026-10-10";
    const animal = (farmId, id) => ({ id, farmId, animalCode: id, kind: "animal", type: "dairy_cow",
      status: "active", photoAttachmentId: `photo-${id}` });
    const milk = (farmId, id, animalId, liters) => ({ id, farmId, animalId, kind: "milk", localDate: date,
      session: "morning", liters, volumeMl: liters * 1000, eventType: "record" });
    const finance = (farmId, id, direction) => ({ id, farmId, kind: "finance", direction,
      amountCents: 10000, localDate: date, createdAt: `${date}T00:00:00Z` });
    await storage.putAtomically([
      { storeName: "animals", value: animal("farm-a", "cow-a") },
      { storeName: "animals", value: animal("farm-b", "cow-b") },
      { storeName: "attachments", value: { id: "photo-cow-a", ownerId: "cow-a", farmId: "farm-a",
        blob: new Blob(["A PHOTO"]) } },
      { storeName: "attachments", value: { id: "photo-cow-b", ownerId: "cow-b", farmId: "farm-b",
        blob: new Blob(["B PHOTO"]) } },
      { storeName: "records", value: milk("farm-a", "milk-a", "cow-a", 4.5) },
      { storeName: "records", value: milk("farm-b", "milk-b", "cow-b", 9) },
      { storeName: "records", value: finance("farm-a", "finance-a", "income") },
      { storeName: "records", value: finance("farm-b", "finance-b", "expense") },
      { storeName: "sync_queue", value: { id: "queue-a", farmId: "farm-a", status: "pending" } },
      { storeName: "sync_queue", value: { id: "queue-b", farmId: "farm-b", status: "failed" } }
    ]);
    const snapshot = async () => ({
      animals: (await repository.listAnimals()).map((row) => row.id),
      morningLiters: (await repository.getTodayMilkSummary(date)).bySession.morning,
      milkIds: (await repository.listMilkRecordsForDate(date)).map((row) => row.id),
      ledgerIds: (await repository.listMilkLedgerForDate(date)).map((row) => row.id),
      financeIds: (await repository.listFinanceEntries()).map((row) => row.id),
      pending: await repository.getPendingSyncCount()
    });
    repository.setActiveFarm("farm-a");
    const farmA = await snapshot();
    const otherAnimalHidden = await repository.getAnimal("cow-b") === null;
    const ownPhoto = await (await repository.getAnimal("cow-a")).photo.text();
    let otherMilkRejected = false;
    try { await repository.saveMilkRecord({ animalId: "cow-b", localDate: date, session: "evening", liters: 1 }); }
    catch { otherMilkRejected = true; }
    let otherCorrectionRejected = false;
    try { await repository.correctMilkRecord({ targetRecordId: "milk-b", action: "void", reason: "Synthetic boundary test",
      actorUserId: "test-user" }); } catch { otherCorrectionRejected = true; }
    repository.setActiveFarm("farm-b");
    const farmB = await snapshot();
    const farmBPhoto = await (await repository.getAnimal("cow-b")).photo.text();
    repository.setActiveFarm(null);
    let signedOutReadRejected = false;
    try { await repository.listAnimals(); } catch { signedOutReadRejected = true; }
    return { farmA, farmB, otherAnimalHidden, ownPhoto, farmBPhoto, otherMilkRejected,
      otherCorrectionRejected, signedOutReadRejected,
      totalRecordRows: (await storage.getAll("records")).length,
      totalQueueRows: (await storage.getAll("sync_queue")).length };
  });
  assert.deepEqual(result.farmA, { animals: ["cow-a"], morningLiters: 4.5, milkIds: ["milk-a"],
    ledgerIds: ["milk-a"], financeIds: ["finance-a"], pending: 1 });
  assert.deepEqual(result.farmB, { animals: ["cow-b"], morningLiters: 9, milkIds: ["milk-b"],
    ledgerIds: ["milk-b"], financeIds: ["finance-b"], pending: 1 });
  assert.equal(result.otherAnimalHidden, true);
  assert.equal(result.ownPhoto, "A PHOTO");
  assert.equal(result.farmBPhoto, "B PHOTO");
  assert.equal(result.otherMilkRejected, true);
  assert.equal(result.otherCorrectionRejected, true);
  assert.equal(result.signedOutReadRejected, true);
  assert.equal(result.totalRecordRows, 4, "cross-farm attempts must not add rows");
  assert.equal(result.totalQueueRows, 2, "cross-farm attempts must not add queue entries");
  console.log("core-farm-isolation.browser.test.js: PASS");
} finally {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
