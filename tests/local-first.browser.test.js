import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";

// This server is restricted to loopback and replaces only the authentication module.
// Farm storage, validation, UI and sync modules are served unchanged from the repository.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const animalCode = "TEST-BROWSER-LOCAL-FIRST-001";
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
  await page.locator("#sync-count").filter({ hasText: /^1$/ }).waitFor();
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
  await page.locator("#auth-sign-out:not([hidden])").waitFor();
  await page.locator('button[data-nav="animals"]').click();
  await page.locator("#animal-code").fill(animalCode);
  await page.locator("#animal-type").selectOption("other");
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

  await page.reload();
  await page.locator("#auth-sign-out:not([hidden])").waitFor();
  await visibleAnimal(page);
  await localState(page, id);

  await page.close();
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator("#auth-sign-out:not([hidden])").waitFor();
  await visibleAnimal(page);
  await localState(page, id);

  await page.locator("#auth-sign-out").click();
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  assert.equal(await page.locator("#animal-list [data-animal-id]").count(), 0);
  assert.equal(await page.locator("#animal-list").textContent(), "");
  assert.equal(await page.locator("#profile-photo").getAttribute("src"), null);
  assert.equal(await page.locator("#milk-animal option").count(), 0);
  assert.equal(await page.locator(".bottom-nav").isVisible(), false);
  assert.equal(await page.locator("body").textContent().then((text) => text.includes(animalCode)), false);

  await page.locator("#auth-email").fill("synthetic@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await page.locator("#auth-sign-out:not([hidden])").waitFor();
  await visibleAnimal(page);
  await localState(page, id);
  assert.deepEqual(externalRequests, [], "test must not contact cloud or other external origins");
  assert.deepEqual(pageErrors, [], "application must not throw uncaught errors");
  console.log("local-first.browser.test.js: PASS");
} finally {
  await context?.close();
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
