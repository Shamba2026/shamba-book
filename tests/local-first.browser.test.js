import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";

// This server is restricted to loopback and replaces only the authentication module.
// Farm storage, validation, UI and sync modules are served unchanged from the repository.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const animalCode = "TEST-BROWSER-LOCAL-FIRST-001";
const artifactDir = path.join(root, "test-artifacts");
const authModule = `
const key = "ngombe-isolated-browser-test-auth";
const user = { id: "isolated-test-user", email: "synthetic@example.invalid" };
const listeners = new Set();
const current = () => localStorage.getItem(key) === "signed-in" ? { user } : null;
const auth = {
  onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
  async getSession() { return { data: { session: current() }, error: null }; },
  async signInWithPassword({ email, password }) {
    if (email !== user.email || password !== "TEST-ONLY") return { error: new Error("Test credentials rejected.") };
    localStorage.setItem(key, "signed-in");
    listeners.forEach((callback) => callback("SIGNED_IN", current()));
    return { error: null };
  },
  async signOut() {
    localStorage.removeItem(key);
    listeners.forEach((callback) => callback("SIGNED_OUT", null));
    return { error: null };
  }
};
export async function getAuthClient() { return { auth }; }
`;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (request.method !== "GET") { response.writeHead(405).end(); return; }
  if (pathname === "/src/auth.js") {
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(authModule);
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || !/^(index\.html|manifest\.json|src\/|styles\/)/.test(relative)) {
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
        id: row.id, ownerId: row.ownerId, blobType: row.blob.type,
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
  await page.waitForFunction(() => document.querySelector("#sync-count")?.textContent === "1");
  assert.equal(await page.locator("#sync-count").textContent(), "1");
  return animals[0].id;
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
  assert.equal(await page.locator("#animal-list [data-animal-id]").count(), 0);
  assert.equal(await page.locator("#sync-count").textContent(), "0");
  assert.equal(await page.locator(".bottom-nav").isVisible(), false);

  await page.locator("#auth-email").fill("synthetic@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await page.locator("#account-actions:not([hidden])").waitFor();
  assert.equal(await page.locator("#auth-card").isVisible(), false, "login form should disappear after authentication");
  assert.equal(await page.locator("#auth-restore").isVisible(), false, "cloud restore must stay unavailable");
  assert.equal(await page.locator("#auth-restore").isEnabled(), false, "cloud restore must be disabled");
  const statusBeforeRestoreAttempt = await page.locator("#app-status").textContent();
  await page.locator("#auth-restore").evaluate((button) => button.dispatchEvent(new Event("click")));
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#app-status").textContent(), statusBeforeRestoreAttempt,
    "cloud restore must have no active click handler");
  assert.equal(await page.locator('[data-view="home"]').isVisible(), true);
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

  await page.reload();
  await page.locator("#account-actions:not([hidden])").waitFor();
  assert.equal(await page.locator("#auth-card").isVisible(), false);
  await visibleAnimal(page);
  await localState(page, id);

  await page.close();
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator("#account-actions:not([hidden])").waitFor();
  await visibleAnimal(page);
  await localState(page, id);

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
  await page.locator("#account-actions:not([hidden])").waitFor();
  await visibleAnimal(page);
  await localState(page, id);
  await page.locator('button[data-nav="milk"]').click();
  assert.match(await page.locator("#milk-checklist-summary").textContent(), /1 of 1 active dairy cows have no morning record/);
  await page.locator('[data-milk-session="evening"]').click();
  await page.waitForFunction(() => document.querySelector("#milk-checklist-summary")?.textContent.includes("no evening record"));
  assert.match(await page.locator("#milk-checklist-summary").textContent(), /no evening record/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifactDir, "milk-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#milk-animal").selectOption(id);
  await page.locator("#milk-liters").fill("2.5");
  await page.locator('#milk-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector("#milk-checklist")?.textContent.includes("1 recorded"));
  assert.equal((await storedRows(page, "records")).filter((row) => row.kind === "milk" && row.session === "evening").length, 1);
  assert.equal((await storedRows(page, "sync_queue")).length, 2);
  await page.locator('[data-milk-session="morning"]').click();
  await page.waitForFunction(() => document.querySelector("#milk-checklist-summary")?.textContent.includes("no morning record"));
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
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#finance-count").textContent(), "1 entry",
    "first finance save status: " + await page.locator("#app-status").textContent());
  await page.locator('[data-finance-direction="expense"]').click();
  await page.locator("#finance-category").selectOption("Feed");
  await page.locator("#finance-amount").fill("25.20");
  await page.locator("#finance-details").fill("TEST FINANCE EXPENSE");
  await page.locator("#finance-save").click();
  await page.locator('#finance-count:has-text("2 entries")').waitFor();
  assert.equal(await page.locator("#finance-net").textContent(), "KSh 100.30");
  const financeRows = (await storedRows(page, "records")).filter((row) => row.kind === "finance");
  assert.deepEqual(financeRows.map((row) => row.amountCents).sort((a, b) => a - b), [2520, 12550]);
  assert.equal((await storedRows(page, "sync_queue")).filter((row) => row.recordType === "finance").length, 2);
  await page.reload();
  await page.locator("#account-actions:not([hidden])").waitFor();
  await page.locator('button[data-nav="finance"]').click();
  await page.locator('#finance-count:has-text("2 entries")').waitFor();
  assert.equal(await page.locator("#finance-net").textContent(), "KSh 100.30");
  await page.locator("#account-actions summary").click();
  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  assert.equal(await page.locator("#milk-checklist").textContent(), "");
  assert.equal(await page.locator("#finance-list").textContent(), "");
  assert.equal(await page.locator("body").textContent().then((text) => text.includes("TEST FINANCE INCOME")), false);
  assert.equal(await page.locator("body").textContent().then((text) => text.includes(animalCode)), false);
  assert.deepEqual(externalRequests, [], "test must not contact cloud or other external origins");
  assert.deepEqual(pageErrors, [], "application must not throw uncaught errors");
  console.log("local-first.browser.test.js: PASS");
} finally {
  await context?.close();
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
