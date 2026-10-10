import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";
import { collectAuthReadiness, waitForAuthenticatedApp } from "./support/browser-auth-readiness.js";

// This server is restricted to loopback and replaces only the authentication module.
// Farm storage, validation, UI and sync modules are served unchanged from the repository.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const animalCode = "TEST-BROWSER-LOCAL-FIRST-001";
const artifactDir = path.join(root, "test-artifacts");
const authModule = `
const key = "ngombe-isolated-browser-test-auth";
const users = [
  { id: "isolated-test-user", email: "synthetic@example.invalid" },
  { id: "other-test-user", email: "other@example.invalid" },
  { id: "same-farm-user", email: "member@example.invalid" }
];
const listeners = new Set();
const current = () => {
  const user = users.find((candidate) => candidate.id === localStorage.getItem(key));
  return user ? { user } : null;
};
const auth = {
  onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
  async getSession() { return { data: { session: current() }, error: null }; },
  async signInWithPassword({ email, password }) {
    const user = users.find((candidate) => candidate.email === email);
    if (!user || password !== "TEST-ONLY") return { error: new Error("Test credentials rejected.") };
    localStorage.setItem(key, user.id);
    listeners.forEach((callback) => callback("SIGNED_IN", current()));
    return { error: null };
  },
  async signOut() {
    localStorage.removeItem(key);
    listeners.forEach((callback) => callback("SIGNED_OUT", null));
    return { error: null };
  }
};
export async function getAuthClient() { return { auth, from(table) {
  if (table !== "farm_members") throw new Error("Unexpected cloud table: " + table);
  return { select() { return this; }, eq() { return this; }, async maybeSingle() {
    const user = current()?.user;
    return { data: user && user.id !== "other-test-user" ? { farm_id: "${APP_CONFIG.cloud.farmId}" } : null, error: null };
  } };
} }; }
`;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".jpg": "image/jpeg", ".webp": "image/webp" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (request.method !== "GET") { response.writeHead(405).end(); return; }
  if (pathname === "/src/auth.js") {
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(authModule);
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || !/^(index\.html|manifest\.json|assets\/|src\/|styles\/)/.test(relative)) {
    response.writeHead(404).end(); return;
  }
  try {
    const body = await readFile(filename);
    response.writeHead(200, { "content-type": contentTypes[path.extname(filename)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

async function storedRows(page, store) {
  return page.evaluate(async (storeName) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ngombe-herdbook");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return storeName === "attachments" ? Promise.all(rows.map(async (row) => ({
        id: row.id, ownerId: row.ownerId, farmId: row.farmId, blobType: row.blob.type,
        blobText: await row.blob.text()
      }))) : rows;
    } finally {
      db.close();
    }
  }, store);
}

async function visibleAnimal(page) {
  await page.locator('button[data-nav="animals"]').click();
  await page.locator(`#animal-list [data-animal-id]`).filter({ hasText: animalCode }).waitFor();
  assert.equal(await page.locator("#animal-list [data-animal-id]").count(), 1);
  await page.locator("#animal-list [data-animal-id]").click();
  await page.locator("#profile-photo:not([hidden])").waitFor();
  assert.equal(await page.locator("#profile-name").textContent(), animalCode);
  assert.equal(await page.locator("#profile-photo").evaluate((image) => image.complete && image.naturalWidth > 0), true);
}

async function localState(page, expectedId) {
  const animals = await storedRows(page, "animals");
  const attachments = await storedRows(page, "attachments");
  const queue = await storedRows(page, "sync_queue");
  assert.equal(animals.length, 1);
  assert.equal(animals[0].animalCode, animalCode);
  if (expectedId) assert.equal(animals[0].id, expectedId);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].id, animals[0].photoAttachmentId);
  assert.equal(attachments[0].ownerId, animals[0].id);
  assert.equal(attachments[0].blobType, "image/svg+xml");
  assert.match(attachments[0].blobText, /TEST SYNTHETIC/);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, "pending");
  assert.equal(queue[0].recordId, animals[0].id);
  assert.equal(animals[0].farmId, APP_CONFIG.cloud.farmId);
  assert.equal(queue[0].farmId, APP_CONFIG.cloud.farmId);
  await page.waitForFunction(() => document.querySelector("#sync-count")?.textContent === "1");
  assert.equal(await page.locator("#sync-count").textContent(), "1");
  return animals[0].id;
}

async function authenticatedAppReady(page, expectedUserId) {
  return waitForAuthenticatedApp(page, {
    expectedUserId,
    farmId: APP_CONFIG.cloud.farmId,
    artifactPath: path.join(artifactDir, "authentication-readiness-timeout.png")
  });
}

if (APP_CONFIG.cloud.enabled !== false) throw new Error("Browser test requires cloud synchronization disabled.");
const browser = await chromium.launch({ headless: true });
let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  context = await browser.newContext({ serviceWorkers: "block" });
  const externalRequests = [];
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url());
      await route.abort();
    } else {
      await route.continue();
    }
  });
  let page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  assert.equal(await page.locator("#auth-lock-message").isVisible(), true);
  assert.match(await page.locator("#auth-lock-message").textContent(), /Your herd records, clear and close at hand/);
  assert.equal(await page.locator(".landing-ledger article").count(), 4);
  assert.equal(await page.locator(".landing-ledger [aria-hidden='true']").count(), 0,
    "signed-out capability summary should not depend on decorative icon tiles");
  assert.match(await page.locator(".landing-hero").evaluate((el) => getComputedStyle(el).backgroundImage),
    /landing-dairy-farm\.jpg/, "signed-out hero must use the bundled farm visual");
  const farmVisualResponse = await page.request.get(`${origin}/assets/landing-dairy-farm.jpg`);
  assert.equal(farmVisualResponse.status(), 200,
    `bundled farm visual request failed with ${farmVisualResponse.status()}`);
  assert.equal(farmVisualResponse.headers()["content-type"], "image/jpeg");
  assert.ok((await farmVisualResponse.body()).length > 0, "bundled farm visual must not be empty");
  assert.equal(await page.evaluate(() => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = "./assets/landing-dairy-farm.jpg";
  })), true, "bundled farm visual must load and decode");
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, "signed-out-landing.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true,
    "mobile signed-out landing must not overflow horizontally");
  assert.equal(await page.locator(".landing-hero h2").isVisible(), true);
  assert.equal(await page.locator("#auth-email").isVisible(), true);
  assert.equal(await page.locator("#auth-sign-in").isVisible(), true);
  await page.screenshot({ path: path.join(artifactDir, "signed-out-landing-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.locator("#animal-list [data-animal-id]").count(), 0);
  assert.equal(await page.locator("#sync-count").textContent(), "0");
  assert.equal(await page.locator(".bottom-nav").isVisible(), false);

  await page.locator("#auth-sign-in").click();
  assert.match(await page.locator("#app-status").textContent(), /Enter your email and password/);
  assert.equal(await page.locator("#app-status").getAttribute("role"), "alert");
  assert.equal(await page.locator("#app-status").getAttribute("aria-live"), "assertive");
  await page.locator("#auth-email").fill("synthetic@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await authenticatedAppReady(page, "isolated-test-user");
  assert.equal(await page.locator("#app-status").getAttribute("role"), "status");
  assert.equal(await page.locator("#app-status").getAttribute("aria-live"), "polite");
  assert.equal(await page.locator("#auth-status").getAttribute("role"), "status");
  assert.equal(await page.locator("#auth-card").isVisible(), false, "login form should disappear after authentication");
  assert.equal(await page.locator("#auth-lock-message").isVisible(), false, "landing content should disappear after authentication");
  assert.equal(await page.locator("#auth-restore").isVisible(), false, "cloud restore must stay unavailable");
  assert.equal(await page.locator("#auth-restore").isEnabled(), false, "cloud restore must be disabled");
  const statusBeforeRestoreAttempt = await page.locator("#app-status").textContent();
  await page.locator("#auth-restore").evaluate((button) => button.dispatchEvent(new Event("click")));
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#app-status").textContent(), statusBeforeRestoreAttempt,
    "cloud restore must have no active click handler");
  assert.equal(await page.locator('[data-view="home"]').isVisible(), true);
  assert.equal(await page.locator('button[data-nav="home"]').getAttribute("aria-current"), "page");
  assert.equal(await page.locator('button[data-nav][aria-current="page"]').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true,
    "desktop layout must not overflow horizontally");
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, "home-desktop.png"), fullPage: true });
  await page.locator('button[data-nav="animals"]').click();
  await page.locator("#animal-code").fill(animalCode);
  await page.locator("#animal-type").selectOption("dairy_cow");
  await page.locator("#animal-breed").fill("SYNTHETIC-TEST-NOT-REAL");
  await page.locator("#animal-source").fill("Automated local-only test");
  await page.locator("#animal-notes").fill("Synthetic browser test, never a real farm animal.");
  await page.locator("#animal-photo").setInputFiles({
    name: "TEST-SYNTHETIC.svg", mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="white"/><text x="12" y="65" font-size="22">TEST SYNTHETIC</text></svg>')
  });
  await page.locator('#animal-form button[type="submit"]').click();
  await page.locator('#app-status:has-text("Animal saved on this device.")').waitFor();
  await visibleAnimal(page);
  const id = await localState(page);

  const farmSwitchRejected = await page.evaluate(async ({ animalId, farmId }) => {
    const repository = await import("/src/storage/farm-repository.js?build=20260921-05");
    repository.setActiveFarm(farmId);
    const save = repository.saveMilkRecord({ animalId, localDate: "2026-09-21", session: "afternoon", liters: 1 });
    repository.setActiveFarm("00000000-0000-4000-8000-000000000002");
    try { await save; return false; } catch (error) { return /Farm session changed/.test(error.message); }
    finally { repository.setActiveFarm(farmId); }
  }, { animalId: id, farmId: APP_CONFIG.cloud.farmId });
  assert.equal(farmSwitchRejected, true, "a farm switch during validation must abort the record save");
  assert.equal((await storedRows(page, "records")).some((row) => row.session === "afternoon"), false);

  await page.locator("#account-actions summary").click();
  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  await page.locator("#auth-email").fill("other@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await page.locator("#account-actions:not([hidden])").waitFor();
  const outsiderReadiness = await collectAuthReadiness(page, {
    expectedUserId: "other-test-user", farmId: APP_CONFIG.cloud.farmId
  });
  assert.equal(outsiderReadiness.ready, false);
  assert.equal(outsiderReadiness.pending.includes("farm membership"), true);
  assert.equal(outsiderReadiness.pending.includes("farm view"), true);
  assert.equal(await page.locator(".bottom-nav").isVisible(), false, "outsider must remain locked");
  // Give the asynchronous signed-in refresh time to complete before checking for leakage.
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#animal-list [data-animal-id]").count(), 0,
    "another account must not see the first account's animal");
  assert.equal(await page.locator("#profile-photo").getAttribute("src"), null);
  assert.equal(await page.locator("#milk-animal option").count(), 0);
  assert.equal(await page.locator("#sync-count").textContent(), "0",
    "another account must not see the first account's pending queue count");
  assert.equal((await storedRows(page, "animals")).length, 1,
    "account switching must preserve the original local row");
  await page.locator("#account-actions summary").click();
  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  await page.locator("#auth-email").fill("member@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await authenticatedAppReady(page, "same-farm-user");
  await visibleAnimal(page);
  await localState(page, id);
  await page.locator("#account-actions summary").click();
  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  await page.locator("#auth-email").fill("synthetic@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await authenticatedAppReady(page, "isolated-test-user");
  await visibleAnimal(page);
  await localState(page, id);

  const rolledBack = await page.evaluate(async () => {
    const { putAtomically } = await import("/src/storage/local-db.js");
    try {
      await putAtomically([
        { storeName: "animals", value: { id: "TEST-ROLLBACK-ANIMAL" } },
        { storeName: "attachments", value: { id: "TEST-ROLLBACK-PHOTO", blob: new Blob(["SYNTHETIC"]) } },
        { storeName: "sync_queue", value: { id: "TEST-ROLLBACK-QUEUE", payload: () => {} } }
      ]);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rolledBack, true, "a failed queue write must abort all earlier local writes");
  await localState(page, id);
  assert.equal((await storedRows(page, "animals")).some((row) => row.id === "TEST-ROLLBACK-ANIMAL"), false);
  assert.equal((await storedRows(page, "attachments")).some((row) => row.id === "TEST-ROLLBACK-PHOTO"), false);

  const financeRolledBack = await page.evaluate(async () => {
    const { putAtomically } = await import("/src/storage/local-db.js");
    try {
      await putAtomically([
        { storeName: "records", value: { id: "TEST-ROLLBACK-FINANCE", kind: "finance",
          direction: "expense", category: "Feed", amountCents: 100 } },
        { storeName: "sync_queue", value: { id: "TEST-ROLLBACK-FINANCE", payload: () => {} } }
      ]);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(financeRolledBack, true, "a failed finance queue write must abort the finance record write");
  assert.equal((await storedRows(page, "records")).some((row) => row.id === "TEST-ROLLBACK-FINANCE"), false);

  await page.reload();
  await authenticatedAppReady(page, "isolated-test-user");
  assert.equal(await page.locator("#auth-card").isVisible(), false);
  await visibleAnimal(page);
  await localState(page, id);

  await page.close();
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await authenticatedAppReady(page, "isolated-test-user");
  await visibleAnimal(page);
  await localState(page, id);
  await page.evaluate(() => localStorage.setItem("ngombe-test-offline", "1"));
  await context.addInitScript(() => {
    if (localStorage.getItem("ngombe-test-offline") === "1")
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
  await page.reload();
  await authenticatedAppReady(page, "isolated-test-user");
  await visibleAnimal(page);
  await localState(page, id);
  await page.evaluate(() => localStorage.removeItem("ngombe-test-offline"));

  await page.locator("#account-actions summary").click();
  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  assert.equal(await page.locator("#auth-card").isVisible(), true);
  assert.equal(await page.locator("#animal-list [data-animal-id]").count(), 0);
  assert.equal(await page.locator("#animal-list").textContent(), "");
  assert.equal(await page.locator("#profile-photo").getAttribute("src"), null);
  assert.equal(await page.locator("#milk-animal option").count(), 0);
  assert.equal(await page.locator(".bottom-nav").isVisible(), false);
  assert.equal(await page.locator("body").textContent().then((text) => text.includes(animalCode)), false);

  await page.locator("#auth-email").fill("synthetic@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await authenticatedAppReady(page, "isolated-test-user");
  await visibleAnimal(page);
  await localState(page, id);
  await page.locator('button[data-nav="milk"]').click();
  assert.equal(await page.locator('button[data-nav="milk"]').getAttribute("aria-current"), "page");
  assert.equal(await page.locator('button[data-nav="home"]').getAttribute("aria-current"), null);
  assert.match(await page.locator("#milk-checklist-summary").textContent(), /1 of 1 active dairy cows have no morning record/);
  await page.locator('[data-milk-session="evening"]').click();
  await page.waitForFunction(() => document.querySelector("#milk-checklist-summary")?.textContent.includes("no evening record"));
  assert.match(await page.locator("#milk-checklist-summary").textContent(), /no evening record/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true,
    "mobile layout must not overflow horizontally");
  assert.equal(await page.locator("#app-status").evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 12), true,
    "mobile status text must remain at least 12px");
  await page.locator('#milk-form button[type="submit"]').focus();
  const focusedControlClearance = await page.evaluate(() => {
    const focused = document.activeElement.getBoundingClientRect();
    const navigation = document.querySelector(".bottom-nav").getBoundingClientRect();
    return focused.bottom <= navigation.top;
  });
  assert.equal(focusedControlClearance, true, "fixed navigation must not obscure the focused control");
  await page.screenshot({ path: path.join(artifactDir, "milk-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#milk-animal").selectOption(id);
  await page.locator("#milk-liters").fill("2.5");
  await page.locator('#milk-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector("#milk-checklist")?.textContent.includes("1 recorded"));
  let eveningRows = (await storedRows(page, "records")).filter((row) => row.kind === "milk" && row.session === "evening");
  assert.equal(eveningRows.length, 1);
  assert.equal(eveningRows[0].volumeMl, 2500, "milk volume must be stored as integer millilitres");
  assert.equal((await storedRows(page, "sync_queue")).length, 2);

  await page.locator('button[data-milk-correction-action="correct"]').click();
  await page.locator("#milk-correction-form:visible").waitFor();
  await page.locator("#milk-correction-liters").fill("3.125");
  await page.locator("#milk-correction-reason").fill("Synthetic meter-reading correction");
  await page.locator('#milk-correction-form button[type="submit"]').click();
  await page.locator('#app-status:has-text("Milk correction recorded")').waitFor();
  assert.match(await page.locator("#milk-correction-history").textContent(), /Synthetic meter-reading correction/);
  const correctionResult = (await storedRows(page, "records")).find((row) =>
    row.kind === "milk_correction" && row.targetRecordId === eveningRows[0].id);
  assert.equal(correctionResult.kind, "milk_correction");
  assert.equal(correctionResult.targetRecordId, eveningRows[0].id);
  assert.equal(correctionResult.replacementRecordId !== null, true);
  const correctedRawRows = (await storedRows(page, "records")).filter((row) =>
    row.id === eveningRows[0].id || row.id === correctionResult.id || row.id === correctionResult.replacementRecordId);
  assert.equal(correctedRawRows.length, 3, "original, correction and replacement must all be retained");
  assert.equal(correctedRawRows.find((row) => row.id === eveningRows[0].id).volumeMl, 2500,
    "the original milk event must remain unchanged");
  assert.equal(correctedRawRows.find((row) => row.id === correctionResult.replacementRecordId).volumeMl, 3125);
  assert.equal((await storedRows(page, "sync_queue")).find((row) => row.id === eveningRows[0].id).status, "superseded");
  assert.equal((await storedRows(page, "sync_queue")).find((row) => row.id === correctionResult.replacementRecordId).status, "pending");

  const effectiveEvening = await page.evaluate(async (localDate) => {
    const repository = await import("/src/storage/farm-repository.js?build=20261010-01");
    return repository.listMilkRecordsForDate(localDate);
  }, eveningRows[0].localDate);
  assert.deepEqual(effectiveEvening.filter((row) => row.session === "evening").map((row) => row.volumeMl), [3125]);
  const repeatedCorrection = await page.evaluate(async ({ targetRecordId }) => {
    const repository = await import("/src/storage/farm-repository.js?build=20261010-01");
    try {
      await repository.correctMilkRecord({ targetRecordId, action: "void", reason: "Synthetic repeat attempt",
        actorUserId: "isolated-test-user" });
      return null;
    } catch (error) { return error.message; }
  }, { targetRecordId: eveningRows[0].id });
  assert.match(repeatedCorrection, /already corrected/i);

  await page.locator("#milk-animal").selectOption(id);
  await page.locator("#milk-liters").fill("2.5");
  await page.locator('#milk-form button[type="submit"]').click();
  await page.locator('#app-status:has-text("already recorded")').waitFor();
  eveningRows = (await storedRows(page, "records")).filter((row) => row.kind === "milk" && row.session === "evening");
  assert.equal(eveningRows.length, 2, "a rejected duplicate must not add to the retained original and replacement");
  assert.equal((await storedRows(page, "sync_queue")).length, 3, "a rejected duplicate must not create a queue entry");

  await page.locator("#milk-additional").check();
  await page.locator('#milk-form button[type="submit"]').click();
  await page.locator('#app-status:has-text("Milk saved locally")').waitFor();
  eveningRows = (await storedRows(page, "records")).filter((row) => row.kind === "milk" && row.session === "evening");
  assert.equal(eveningRows.length, 3, "an explicitly confirmed separate collection must be retained");
  assert.equal((await storedRows(page, "sync_queue")).length, 4);

  const concurrentResult = await page.evaluate(async ({ animalId, farmId }) => {
    const repository = await import("/src/storage/farm-repository.js?build=20261010-01");
    repository.setActiveFarm(farmId);
    const input = { animalId, localDate: "2026-09-21", session: "afternoon", liters: 1.75, volumeMl: 1750 };
    const results = await Promise.allSettled([repository.saveMilkRecord(input), repository.saveMilkRecord(input)]);
    return results.map((result) => result.status);
  }, { animalId: id, farmId: APP_CONFIG.cloud.farmId });
  assert.deepEqual(concurrentResult.sort(), ["fulfilled", "rejected"],
    "the atomic store guard must permit only one concurrent normal save");
  assert.equal((await storedRows(page, "records")).filter((row) => row.kind === "milk" && row.session === "afternoon").length, 1);
  assert.equal((await storedRows(page, "sync_queue")).length, 5);

  const morningRecord = await page.evaluate(async ({ animalId, localDate }) => {
    const repository = await import("/src/storage/farm-repository.js?build=20261010-01");
    return repository.saveMilkRecord({ animalId, localDate, session: "morning",
      liters: 4.25, volumeMl: 4250 });
  }, { animalId: id, localDate: eveningRows[0].localDate });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreMilkCorrectionPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "sync_queue" && value?.recordType === "milk" && value?.status === "pending" &&
          value?.recordId !== window.__milkCorrectionTarget) {
        throw new DOMException("Synthetic correction queue failure", "DataCloneError");
      }
      return original.call(this, value, ...args);
    };
  });
  await page.evaluate((targetRecordId) => { window.__milkCorrectionTarget = targetRecordId; }, morningRecord.id);
  const beforeFailedCorrection = {
    records: (await storedRows(page, "records")).length,
    queue: (await storedRows(page, "sync_queue")).length
  };
  const failedCorrection = await page.evaluate(async (targetRecordId) => {
    const repository = await import("/src/storage/farm-repository.js?build=20261010-01");
    try {
      await repository.correctMilkRecord({ targetRecordId, action: "correct", replacementLiters: 4,
        reason: "Synthetic rollback proof", actorUserId: "isolated-test-user" });
      return null;
    } catch (error) { return error.message; }
  }, morningRecord.id);
  assert.match(failedCorrection, /Synthetic correction queue failure/);
  assert.equal((await storedRows(page, "records")).length, beforeFailedCorrection.records,
    "a failed replacement queue write must roll back correction and replacement records");
  assert.equal((await storedRows(page, "sync_queue")).length, beforeFailedCorrection.queue);
  assert.equal((await storedRows(page, "sync_queue")).find((row) => row.id === morningRecord.id).status, "pending",
    "a failed correction must leave the original queue entry pending");
  await page.evaluate(() => window.__restoreMilkCorrectionPut());

  await page.evaluate(async (targetRecordId) => {
    const repository = await import("/src/storage/farm-repository.js?build=20261010-01");
    await repository.correctMilkRecord({ targetRecordId, action: "void", reason: "Synthetic void proof",
      actorUserId: "isolated-test-user" });
  }, morningRecord.id);
  const morningLedger = (await storedRows(page, "records")).filter((row) =>
    row.id === morningRecord.id || row.targetRecordId === morningRecord.id);
  assert.equal(morningLedger.length, 2, "void must retain the original and add one correction event");
  assert.equal(morningLedger.find((row) => row.id === morningRecord.id).volumeMl, 4250);
  assert.equal(morningLedger.find((row) => row.kind === "milk_correction").replacementRecordId, null);
  assert.equal((await storedRows(page, "sync_queue")).find((row) => row.id === morningRecord.id).status, "superseded");
  const effectiveMorning = await page.evaluate(async (localDate) => {
    const repository = await import("/src/storage/farm-repository.js?build=20261010-01");
    return repository.listMilkRecordsForDate(localDate);
  }, morningRecord.localDate);
  assert.equal(effectiveMorning.some((row) => row.id === morningRecord.id), false,
    "voided milk must not contribute to effective records");
  await page.locator('[data-milk-session="morning"]').click();
  await page.waitForFunction(() => document.querySelector("#milk-checklist-summary")?.textContent.includes("no morning record"));
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ngombe-herdbook");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(["animals", "attachments", "sync_queue"], "readwrite");
    transaction.objectStore("animals").put({ id: "TEST-LEGACY-ID", animalCode: "TEST-UNOWNED-LEGACY", type: "dairy_cow", breed: "SYNTHETIC", photoAttachmentId: "TEST-LEGACY-PHOTO" });
    transaction.objectStore("attachments").put({ id: "TEST-LEGACY-PHOTO", ownerId: "TEST-LEGACY-ID", blob: new Blob(["SYNTHETIC"]) });
    transaction.objectStore("sync_queue").put({ id: "TEST-LEGACY-ID", recordId: "TEST-LEGACY-ID", recordType: "animal", status: "pending", payload: { id: "TEST-LEGACY-ID" } });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();
  await authenticatedAppReady(page, "isolated-test-user");
  await page.locator('button[data-nav="animals"]').click();
  await page.waitForFunction(() => document.querySelector("#sync-count")?.textContent === "4");
  assert.equal(await page.locator("#animal-list").textContent().then((text) => text.includes("TEST-UNOWNED-LEGACY")), false);
  assert.equal((await storedRows(page, "animals")).some((row) => row.id === "TEST-LEGACY-ID"), true);
  assert.equal((await storedRows(page, "attachments")).some((row) => row.id === "TEST-LEGACY-PHOTO"), true);
  assert.equal((await storedRows(page, "sync_queue")).some((row) => row.id === "TEST-LEGACY-ID"), true);
  const recoveryPreflight = await page.evaluate(async () => {
    const { inspectRecoveryBackup } = await import("/src/storage/recovery-preflight.js");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ngombe-herdbook");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const encode = async (value) => {
      if (value === null || typeof value !== "object") return value;
      if (value instanceof Blob) {
        const bytes = new Uint8Array(await value.arrayBuffer());
        const encoded = { $type: value instanceof File ? "File" : "Blob", mimeType: value.type,
          base64: btoa(String.fromCharCode(...bytes)) };
        if (value instanceof File) { encoded.name = value.name; encoded.lastModified = value.lastModified; }
        return encoded;
      }
      if (Array.isArray(value)) return { $type: "Array", items: await Promise.all(value.map(encode)) };
      return { $type: "Object", entries: await Promise.all(Object.entries(value)
        .map(async ([key, item]) => [key, await encode(item)])) };
    };
    const stores = {};
    for (const name of ["animals", "attachments", "records", "sync_queue", "settings"]) {
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      stores[name] = await Promise.all(rows.map(encode));
    }
    db.close();
    const payload = { format: "ngombe-local-evidence-v1", origin: location.origin + location.pathname,
      database: "ngombe-herdbook", databaseVersion: 1, capturedAt: new Date().toISOString(), stores };
    const hash = async (item) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(JSON.stringify(item))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const file = (data) => new File([JSON.stringify(data)], "synthetic-backup.json", { type: "application/json" });
    const backup = { payload, sha256: await hash(payload) };
    const result = await inspectRecoveryBackup(file(backup));
    const backupJSON = JSON.stringify(backup);
    backup.payload.stores.animals[0].entries.find(([key]) => key === "animalCode")[1] = "ALTERED-BACKUP";
    backup.sha256 = await hash(backup.payload);
    let changedRejected = false;
    try { await inspectRecoveryBackup(file(backup)); } catch { changedRejected = true; }
    backup.sha256 = "0".repeat(64);
    let hashRejected = false;
    try { await inspectRecoveryBackup(file(backup)); } catch { hashRejected = true; }
    return { result, changedRejected, hashRejected, backupJSON };
  });
  assert.equal(recoveryPreflight.result.matched, true);
  assert.equal(recoveryPreflight.result.unownedAnimals.some((item) => item.id === "TEST-LEGACY-ID" &&
    item.photoCount === 1 && item.queueCount === 1 && item.linksValid === true), true,
    "a complete unowned animal, photo, and pending queue group must be identified");
  assert.equal(recoveryPreflight.changedRejected, true, "a self-consistent but stale backup must fail");
  assert.equal(recoveryPreflight.hashRejected, true, "a corrupt checksum must fail");
  await page.locator("#account-actions summary").click();
  const accountGeometry = await page.evaluate(() => {
    const header = document.querySelector(".header").getBoundingClientRect();
    const menu = document.querySelector(".account-menu").getBoundingClientRect();
    return { headerHeight: header.height, menuRight: menu.right, viewportWidth: innerWidth };
  });
  assert.equal(accountGeometry.headerHeight < 100, true, "opening Account must not expand the page header");
  assert.equal(accountGeometry.menuRight <= accountGeometry.viewportWidth, true, "Account menu must stay in the viewport");
  await page.locator("#recovery-backup").setInputFiles({ name: "synthetic-evidence.json",
    mimeType: "application/json", buffer: Buffer.from(recoveryPreflight.backupJSON) });
  await page.locator('#recovery-result:has-text("Backup matches current local records")').waitFor();
  await page.locator("#recovery-code").fill("TEST-UNOWNED-LEGACY");
  await page.locator("#recovery-confirm").check();
  assert.equal(await page.locator("#recovery-claim-button").isEnabled(), true);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreRecoveryPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "sync_queue" && value?.id === "TEST-LEGACY-ID" && value.farmId) {
        throw new DOMException("Synthetic queue write failure", "DataCloneError");
      }
      return original.call(this, value, ...args);
    };
  });
  await page.locator("#recovery-claim-button").click();
  await page.locator('#recovery-result:has-text("Synthetic queue write failure")').waitFor();
  assert.equal((await storedRows(page, "animals")).find((row) => row.id === "TEST-LEGACY-ID").farmId, undefined,
    "animal ownership must roll back when the queue write fails");
  assert.equal((await storedRows(page, "attachments")).find((row) => row.id === "TEST-LEGACY-PHOTO").farmId, undefined);
  assert.equal((await storedRows(page, "sync_queue")).find((row) => row.id === "TEST-LEGACY-ID").farmId, undefined);
  assert.equal((await storedRows(page, "settings")).some((row) => row.key?.startsWith("legacy-claim:")), false);
  await page.evaluate(() => window.__restoreRecoveryPut());
  const staleClaim = await page.evaluate(async ({ json, farmId }) => {
    const { inspectRecoveryBackup } = await import("/src/storage/recovery-preflight.js?build=20260922-03");
    const { claimLegacyAnimalAtomically, get, put } = await import("/src/storage/local-db.js?build=20260922-03");
    const file = new File([json], "synthetic-evidence.json", { type: "application/json" });
    const before = (await inspectRecoveryBackup(file)).unownedAnimals.find((row) => row.id === "TEST-LEGACY-ID");
    const animal = await get("animals", before.id);
    await put("animals", { ...animal, notes: "changed in another tab" });
    let rejected = false;
    try {
      await claimLegacyAnimalAtomically({ animalId: before.id, animalCode: before.animalCode,
        farmId, userId: "isolated-test-user", backupSha256: "synthetic", expectedRows: before.expectedRows,
        assertCurrent() {} });
    } catch (error) { rejected = /changed after backup comparison/.test(error.message); }
    const remainedUnowned = !(await get("animals", before.id)).farmId;
    await put("animals", animal);
    return { rejected, remainedUnowned };
  }, { json: recoveryPreflight.backupJSON, farmId: APP_CONFIG.cloud.farmId });
  assert.deepEqual(staleClaim, { rejected: true, remainedUnowned: true },
    "a row changed after comparison must abort without assigning ownership");
  await page.locator("#recovery-claim-button").click();
  await page.locator('#recovery-result:has-text("claimed locally")').waitFor();
  assert.equal((await storedRows(page, "animals")).find((row) => row.id === "TEST-LEGACY-ID").farmId, APP_CONFIG.cloud.farmId);
  const claimedPhoto = (await storedRows(page, "attachments")).find((row) => row.id === "TEST-LEGACY-PHOTO");
  assert.equal(claimedPhoto.farmId, APP_CONFIG.cloud.farmId);
  assert.equal(claimedPhoto.blobText, "SYNTHETIC", "ownership claim must preserve photo bytes");
  const claimedQueue = (await storedRows(page, "sync_queue")).find((row) => row.id === "TEST-LEGACY-ID");
  assert.equal(claimedQueue.farmId, APP_CONFIG.cloud.farmId);
  assert.equal(claimedQueue.payload.farmId, APP_CONFIG.cloud.farmId);
  assert.equal((await storedRows(page, "settings")).filter((row) => row.key?.startsWith("legacy-claim:")).length, 1);
  await page.locator("#animal-list [data-animal-id]").filter({ hasText: "TEST-UNOWNED-LEGACY" }).waitFor();
  const repeat = await page.evaluate(async (json) => {
    const { claimLegacyAnimal } = await import("/src/storage/legacy-claim.js");
    const { getAuthClient } = await import("/src/auth.js");
    const file = new File([json], "synthetic-evidence.json", { type: "application/json" });
    return claimLegacyAnimal({ client: await getAuthClient(), userId: "isolated-test-user",
      animalId: "TEST-LEGACY-ID", animalCode: "TEST-UNOWNED-LEGACY", file, assertCurrent() {} });
  }, recoveryPreflight.backupJSON);
  assert.equal(repeat.status, "already_claimed");

  await page.locator("#account-actions summary").click();
  await page.locator('button[data-nav="finance"]').click();
  assert.equal(await page.locator("#finance-count").textContent(), "0 entries");
  await page.screenshot({ path: path.join(artifactDir, "finance-desktop.png"), fullPage: true });
  await page.locator("#finance-category").selectOption("Milk sale");
  await page.locator("#finance-amount").fill("125.50");
  await page.locator("#finance-details").fill("TEST FINANCE INCOME");
  await page.locator("#finance-method").selectOption("M-Pesa");
  await page.locator("#finance-reference").fill("TEST-CODE");
  const invalidFinanceFields = await page.locator("#finance-form").evaluate((form) =>
    [...form.elements].filter((field) => field.validity && !field.validity.valid)
      .map((field) => ({ id: field.id, value: field.value, reason: field.validationMessage })));
  assert.deepEqual(invalidFinanceFields, [], "finance form must be valid before synthetic save");
  await page.locator("#finance-save").click();
  await page.locator('#finance-count:has-text("1 entry")').waitFor();
  await page.locator('[data-finance-direction="expense"]').click();
  await page.locator("#finance-category").selectOption("Feed");
  await page.locator("#finance-amount").fill("25.20");
  await page.locator("#finance-details").fill("TEST FINANCE EXPENSE");
  await page.locator("#finance-save").click();
  await page.locator('#finance-count:has-text("2 entries")').waitFor();
  assert.equal(await page.locator("#finance-net").textContent(), "KSh 100.30");
  assert.match(await page.locator("#finance-category-summary").textContent(), /Milk sale\s+KSh 125\.50/);
  assert.match(await page.locator("#finance-category-summary").textContent(), /Feed\s+KSh 25\.20/);
  await page.locator("#finance-period").selectOption("all");
  const financeRows = (await storedRows(page, "records")).filter((row) => row.kind === "finance");
  assert.deepEqual(financeRows.map((row) => row.amountCents).sort((a, b) => a - b), [2520, 12550]);
  assert.equal(financeRows.every((row) => row.farmId === APP_CONFIG.cloud.farmId), true);
  assert.equal((await storedRows(page, "sync_queue")).filter((row) => row.recordType === "finance" &&
    row.farmId === APP_CONFIG.cloud.farmId).length, 2);
  await page.reload();
  await authenticatedAppReady(page, "isolated-test-user");
  await page.locator('button[data-nav="milk"]').click();
  await page.locator('[data-milk-session="evening"]').click();
  await page.waitForFunction(() => document.querySelector("#milk-correction-history")?.textContent.includes("Synthetic meter-reading correction"));
  assert.match(await page.locator("#milk-correction-history").textContent(), /Synthetic meter-reading correction/,
    "correction history must survive reload");
  await page.locator('button[data-nav="finance"]').click();
  await page.locator('#finance-count:has-text("2 entries")').waitFor();
  await page.close();
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await authenticatedAppReady(page, "isolated-test-user");
  await page.locator('button[data-nav="finance"]').click();
  await page.locator('#finance-count:has-text("2 entries")').waitFor();
  assert.equal((await storedRows(page, "records")).filter((row) => row.kind === "finance").length, 2,
    "reopening must not duplicate finance rows");
  assert.equal((await storedRows(page, "animals")).length, 2);
  assert.equal((await storedRows(page, "sync_queue")).length, 9);
  await page.locator("#account-actions summary").click();
  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  assert.equal(await page.locator("#recovery-result").textContent(), "",
    "signed-out DOM must not retain the backup digest or recovery status");
  assert.equal(await page.locator("body").textContent().then((text) => text.includes("TEST-UNOWNED-LEGACY")), false,
    "signed-out DOM must not retain the claimed animal code");
  assert.equal(await page.locator("#milk-checklist").textContent(), "");
  assert.equal(await page.locator("#milk-correction-history").textContent(), "");
  assert.equal(await page.locator("#finance-list").textContent(), "");
  assert.equal(await page.locator("body").textContent().then((text) => text.includes("TEST FINANCE INCOME")), false);
  assert.equal(await page.locator("body").textContent().then((text) => text.includes(animalCode)), false);
  await page.locator("#auth-email").fill("other@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await page.locator("#account-actions:not([hidden])").waitFor();
  const laterOutsiderReadiness = await collectAuthReadiness(page, {
    expectedUserId: "other-test-user", farmId: APP_CONFIG.cloud.farmId
  });
  assert.equal(laterOutsiderReadiness.ready, false);
  assert.equal(laterOutsiderReadiness.pending.includes("farm membership"), true);
  assert.equal(await page.locator("#recovery-evidence").isVisible(), false);
  assert.equal(await page.locator("#finance-list").textContent(), "");
  const outsiderClaim = await page.evaluate(async (json) => {
    const { claimLegacyAnimal } = await import("/src/storage/legacy-claim.js");
    const { getAuthClient } = await import("/src/auth.js");
    try {
      await claimLegacyAnimal({ client: await getAuthClient(), userId: "other-test-user",
        animalId: "TEST-LEGACY-ID", animalCode: "TEST-UNOWNED-LEGACY",
        file: new File([json], "synthetic.json"), assertCurrent() {} });
      return "permitted";
    } catch { return "denied"; }
  }, recoveryPreflight.backupJSON);
  assert.equal(outsiderClaim, "denied");
  assert.equal((await storedRows(page, "animals")).find((row) => row.id === "TEST-LEGACY-ID").farmId,
    APP_CONFIG.cloud.farmId, "outsider attempt must leave ownership unchanged");
  await page.locator("#account-actions summary").click();
  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-email").fill("member@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await authenticatedAppReady(page, "same-farm-user");
  await page.locator('button[data-nav="animals"]').click();
  await page.locator("#animal-list [data-animal-id]").filter({ hasText: "TEST-UNOWNED-LEGACY" }).waitFor();
  await page.locator('button[data-nav="finance"]').click();
  await page.locator('#finance-count:has-text("2 entries")').waitFor();
  const sameFarmRepeat = await page.evaluate(async (json) => {
    const { claimLegacyAnimal } = await import("/src/storage/legacy-claim.js");
    const { getAuthClient } = await import("/src/auth.js");
    return claimLegacyAnimal({ client: await getAuthClient(), userId: "same-farm-user",
      animalId: "TEST-LEGACY-ID", animalCode: "TEST-UNOWNED-LEGACY",
      file: new File([json], "synthetic.json"), assertCurrent() {} });
  }, recoveryPreflight.backupJSON);
  assert.equal(sameFarmRepeat.status, "already_claimed");
  assert.deepEqual(externalRequests, [], "test must not contact cloud or other external origins");
  assert.deepEqual(pageErrors, [], "application must not throw uncaught errors");
  console.log("local-first.browser.test.js: PASS");
} finally {
  await context?.close();
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
