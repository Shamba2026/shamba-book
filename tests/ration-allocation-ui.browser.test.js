import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const authModule = `
const key = "allocation-ui-auth"; const listeners = new Set(); const user = { id: "allocation-reviewer", email: "allocation@example.invalid" };
const session = () => localStorage.getItem(key) ? { user } : null;
const auth = { onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() {} } } }; },
  async getSession() { return { data: { session: session() }, error: null }; },
  async signInWithPassword({ password }) { if (password !== "TEST-ONLY") return { error: new Error("Rejected") }; localStorage.setItem(key, "1"); listeners.forEach((callback) => callback("SIGNED_IN", session())); return { error: null }; },
  async signOut() { localStorage.removeItem(key); listeners.forEach((callback) => callback("SIGNED_OUT", null)); return { error: null }; } };
export async function getAuthClient() { return { auth, from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { farm_id: "${APP_CONFIG.cloud.farmId}" }, error: null }; } }; } }; }
`;
const server = createServer(async (request, response) => { const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/src/auth.js") return response.writeHead(200, { "content-type": "text/javascript" }).end(authModule);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1); const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || !/^(index\.html|manifest\.json|src\/|styles\/)/.test(relative)) return response.writeHead(404).end();
  try { response.writeHead(200, { "content-type": path.extname(filename) === ".css" ? "text/css" : path.extname(filename) === ".html" ? "text/html" : "text/javascript", "cache-control": "no-store" }).end(await readFile(filename)); }
  catch { response.writeHead(404).end(); } });

async function rows(page, storeName) { return page.evaluate(async (name) => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open("ngombe-herdbook"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { return await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); } }, storeName); }

const browser = await chromium.launch({ headless: true }); let context;
try { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.locator("#auth-email").fill("allocation@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY"); await page.locator("#auth-sign-in").click(); await page.locator("#account-actions:not([hidden])").waitFor();
  await page.evaluate(async (farmId) => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open("ngombe-herdbook"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const review = { id: "group-ration-ui", farmId, profileId: "profile-ui", profileName: "TEST allocation profile", profileVersion: 1,
      animalClass: "LACTATING_DAIRY_COW", sourceCitation: "TEST-ALLOCATION-UI",
      selectionId: "selection-ui", calculatedAt: "2026-10-07T00:00:00Z", rationBasis: "DAILY_OFFERED_RATION", rationBasisConfirmed: true,
      animalGroup: [{ id: "cow-a", animalCode: "TEST-COW-A" }, { id: "cow-b", animalCode: "TEST-COW-B" }], ration: { ingredients: [
        { feedId: "silage", feedName: "Synthetic silage", role: "forage", asFedKg: 20, dmKg: 6, meMJ: 60, cpKg: 0.6, costCents: 2000 },
        { feedId: "meal", feedName: "Synthetic meal", role: "concentrate", asFedKg: 4, dmKg: 3.6, meMJ: 39.6, cpKg: 0.72, costCents: 800 }
      ] }, findingCodes: ["NO_CONFIGURED_THRESHOLD_TRIGGERED"] };
    try { await new Promise((resolve, reject) => { const tx = db.transaction("feed_diagnostic_warning_events", "readwrite"); tx.objectStore("feed_diagnostic_warning_events").put(review); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } finally { db.close(); } }, APP_CONFIG.cloud.farmId);
  await page.reload(); await page.locator("#account-actions:not([hidden])").waitFor(); await page.locator('[data-nav-action="feeds"]').click();
  await page.locator("#ration-allocation-form:visible").waitFor(); await page.locator("#ration-allocation-review").selectOption("group-ration-ui");
  await page.locator('[data-allocation-animal="cow-a"][data-allocation-feed="silage"]').fill("12");
  await page.locator('[data-allocation-animal="cow-a"][data-allocation-feed="meal"]').fill("2.5");
  await page.locator('[data-allocation-animal="cow-b"][data-allocation-feed="silage"]').fill("8");
  await page.locator('[data-allocation-animal="cow-b"][data-allocation-feed="meal"]').fill("1.5");
  await page.locator("#ration-allocation-rationale").fill("Synthetic documented weighing evidence for the UI test.");
  await page.locator("#ration-allocation-confirmed").check(); await page.locator('#ration-allocation-form button[type="submit"]').click();
  await page.locator('#ration-allocation-list:has-text("Synthetic documented weighing evidence")').waitFor();
  assert.equal((await rows(page, "feed_ration_allocation_reviews")).length, 1); assert.equal((await rows(page, "records")).length, 0);
  assert.equal((await rows(page, "sync_queue")).length, 0); assert.equal((await rows(page, "feed_inventory_movements")).length, 0);
  await page.reload(); await page.locator("#account-actions:not([hidden])").waitFor(); await page.locator('[data-nav-action="feeds"]').click();
  await page.locator('#ration-allocation-list:has-text("Synthetic documented weighing evidence")').waitFor();
  await page.locator("#account-actions summary").click(); await page.locator("#auth-sign-out").click(); await page.locator("#auth-sign-in").waitFor();
  assert.equal(await page.locator("#ration-allocation-list").textContent(), ""); assert.equal(await page.locator("#ration-allocation-form").isVisible(), false);
  assert.equal((await rows(page, "feed_ration_allocation_reviews")).length, 1, "sign-out must conceal, not delete, allocation evidence");
  assert.deepEqual(errors, []); console.log("ration-allocation-ui.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
