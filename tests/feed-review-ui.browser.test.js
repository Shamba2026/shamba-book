import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const authModule = `
const key = "feed-review-test-auth"; const listeners = new Set();
const user = { id: "feed-review-user", email: "feed-review@example.invalid" };
const session = () => localStorage.getItem(key) ? { user } : null;
const auth = {
  onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() {} } } }; },
  async getSession() { return { data: { session: session() }, error: null }; },
  async signInWithPassword({ email, password }) { if (email !== user.email || password !== "TEST-ONLY") return { error: new Error("Rejected") }; localStorage.setItem(key, "1"); listeners.forEach((callback) => callback("SIGNED_IN", session())); return { error: null }; },
  async signOut() { localStorage.removeItem(key); listeners.forEach((callback) => callback("SIGNED_OUT", null)); return { error: null }; }
};
export async function getAuthClient() { return { auth, from(table) { if (table !== "farm_members") throw new Error("Unexpected table"); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { farm_id: "${APP_CONFIG.cloud.farmId}" }, error: null }; } }; } }; }
`;
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/src/auth.js") { response.writeHead(200, { "content-type": "text/javascript" }).end(authModule); return; }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1); const filename = path.resolve(root, relative);
  if (request.method !== "GET" || !filename.startsWith(root + path.sep) || !/^(index\.html|manifest\.json|src\/|styles\/)/.test(relative)) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { "content-type": contentTypes[path.extname(filename)] || "application/octet-stream", "cache-control": "no-store" }).end(await readFile(filename)); }
  catch { response.writeHead(404).end(); }
});

async function rows(page, storeName) {
  return page.evaluate(async (name) => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open("ngombe-herdbook"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); } }, storeName);
}

const browser = await chromium.launch({ headless: true }); let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  context = await browser.newContext({ serviceWorkers: "block" }); const page = await context.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(error.message)); await page.goto(origin); await page.locator("#auth-sign-in").waitFor();
  assert.equal(await page.locator('[data-view="feeds"]').isVisible(), false); assert.equal(await page.locator("#feed-list").textContent(), "");
  await page.locator("#auth-email").fill("feed-review@example.invalid"); await page.locator("#auth-password").fill("TEST-ONLY"); await page.locator("#auth-sign-in").click();
  await page.locator("#account-actions:not([hidden])").waitFor(); await page.locator('[data-nav-action="feeds"]').click(); await page.locator('[data-view="feeds"]:visible').waitFor();
  assert.match(await page.locator(".feed-safety").textContent(), /not connected to ration or TMR calculations/i);
  await page.locator("#feed-name").fill("TEST feed evidence"); await page.locator("#feed-role").selectOption("forage"); await page.locator('#feed-form button[type="submit"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#app-status").textContent(), "Feed added to this farm library.");
  await page.locator('[data-feed-id]:has-text("TEST feed evidence")').waitFor();
  await page.locator("#feed-source-title").fill("TEST laboratory report"); await page.locator("#feed-source-type").selectOption("lab_report");
  await page.locator("#feed-source-citation").fill("TEST-CITATION-001"); await page.locator("#feed-source-publisher").fill("Synthetic laboratory");
  await page.locator('#feed-source-form button[type="submit"]').click(); await page.locator('#feed-source-list:has-text("TEST-CITATION-001")').waitFor();
  for (const [value, evidence] of [["80", "VERIFIED_LAB"], ["60", "RESEARCH_SUPPORTED"]]) {
    await page.locator("#feed-observation-source").selectOption({ index: 1 });
    await page.locator("#feed-observation-nutrient").selectOption("CP"); await page.locator("#feed-observation-value").fill(value);
    await page.locator("#feed-observation-evidence").selectOption(evidence); await page.locator("#feed-observation-date").fill("2026-09-28");
    await page.locator('#feed-observation-form button[type="submit"]').click(); await page.locator('#app-status:has-text("Nutrition observation saved")').waitFor();
  }
  await page.locator('.feed-conflict:has-text("Conflicting Crude protein")').waitFor();
  await page.locator("#feed-cost-type").selectOption("receipt"); await page.locator("#feed-cost-date").fill("2026-09-28");
  await page.locator("#feed-cost-reference").fill("TEST-RECEIPT-001"); await page.locator("#feed-cost-counterparty").fill("Synthetic supplier");
  await page.locator('#feed-cost-source-form button[type="submit"]').click(); await page.locator('#feed-cost-source-list:has-text("TEST-RECEIPT-001")').waitFor();
  await page.locator("#feed-batch-feed").selectOption({ index: 1 }); await page.locator("#feed-batch-cost-source").selectOption({ index: 1 });
  await page.locator("#feed-batch-date").fill("2026-09-28"); await page.locator("#feed-batch-quantity").fill("125.5");
  await page.locator("#feed-batch-total-cost").fill("2500.25"); await page.locator("#feed-batch-lot").fill("TEST-LOT-001");
  await page.locator('#feed-batch-form button[type="submit"]').click(); await page.locator('#feed-inventory-list:has-text("125.5 kg as fed")').waitFor();
  assert.equal((await rows(page, "feed_library")).length, 1); assert.equal((await rows(page, "feed_sources")).length, 1); assert.equal((await rows(page, "feed_observations")).length, 2);
  assert.equal((await rows(page, "feed_cost_sources")).length, 1); assert.equal((await rows(page, "feed_inventory_batches")).length, 1);
  assert.equal((await rows(page, "records")).length, 0); assert.equal((await rows(page, "sync_queue")).length, 0);
  await page.reload(); await page.locator("#account-actions:not([hidden])").waitFor(); await page.locator('[data-nav-action="feeds"]').click();
  await page.locator('[data-feed-id]:has-text("TEST feed evidence")').waitFor(); await page.locator('.feed-conflict:has-text("Conflicting Crude protein")').waitFor();
  await page.locator('#feed-inventory-list:has-text("TEST-RECEIPT-001")').waitFor();
  await page.locator("#account-actions summary").click(); await page.locator("#auth-sign-out").click(); await page.locator("#auth-sign-in").waitFor(); await page.waitForTimeout(100);
  assert.equal(await page.locator("#feed-list").textContent(), ""); assert.equal(await page.locator("#feed-source-list").textContent(), ""); assert.equal(await page.locator("#feed-profile").textContent(), "");
  assert.equal(await page.locator("#feed-cost-source-list").textContent(), ""); assert.equal(await page.locator("#feed-inventory-list").textContent(), "");
  assert.equal((await rows(page, "feed_observations")).length, 2, "sign-out must conceal, not delete, local evidence");
  assert.deepEqual(errors, []); console.log("feed-review-ui.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
