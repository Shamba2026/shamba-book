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
    const animal = { id: "cow-a", farmId, animalCode: "TEST-COW-A", type: "dairy_cow", breed: "SYNTHETIC", status: "active" };
    const animalB = { id: "cow-b", farmId, animalCode: "TEST-COW-B", type: "dairy_cow", breed: "SYNTHETIC", status: "active" };
    const requirement = { id: "requirement-cow-a", farmId, animalId: "cow-a", profileId: "requirement-profile", profileVersion: 1,
      sourceTitle: "TEST requirement profile", sourceCitation: "TEST-REQUIREMENT-UI", classificationId: "classification-cow-a",
      calculatedAt: "2026-10-07T00:30:00Z", inputs: { LIVE_WEIGHT_KG: 500 }, outputs: [
        { outputCode: "DMI_KG_DAY", outputUnit: "kg DM/day", value: 6 },
        { outputCode: "ME_MJ_DAY", outputUnit: "MJ ME/day", value: 65 },
        { outputCode: "CP_KG_DAY", outputUnit: "kg CP/day", value: 0.9 }
      ] };
    const classifications = [{ id: "classification-cow-a", farmId, animalId: "cow-a", version: 1, createdAt: "2026-10-06T22:00:00Z" },
      { id: "classification-cow-b", farmId, animalId: "cow-b", version: 1, createdAt: "2026-10-06T22:00:00Z" }];
    const classificationReviews = classifications.map((row) => ({ id: "review-" + row.animalId, farmId, animalId: row.animalId,
      classificationId: row.id, profileId: "profile-ui", evidenceDecision: "CONFIRMED", applicabilityDecision: "APPLICABLE",
      reviewerConfirmed: true, reviewerUserId: "allocation-reviewer", reviewedAt: "2026-10-06T22:30:00Z" }));
    const diagnosticProfile = { id: "profile-ui", farmId, version: 1, animalClass: "LACTATING_DAIRY_COW", status: "active" };
    const diagnosticSelection = { id: "selection-ui", farmId, profileId: "profile-ui", applicabilityConfirmed: true,
      selectedAt: "2026-10-06T23:00:00Z", animalGroup: [{ id: "cow-a" }, { id: "cow-b" }],
      classificationEvidence: classifications.map((row) => ({ animalId: row.animalId, classificationId: row.id,
        reviewId: "review-" + row.animalId })) };
    const requirementProfile = { id: "requirement-profile", farmId, version: 1, status: "approved" };
    const stores = ["feed_diagnostic_warning_events", "animals", "nutrition_requirement_calculations",
      "animal_nutrition_classifications", "animal_nutrition_classification_reviews", "feed_diagnostic_profiles",
      "feed_diagnostic_profile_selections", "nutrition_requirement_profiles"];
    try { await new Promise((resolve, reject) => { const tx = db.transaction(stores, "readwrite");
      tx.objectStore("feed_diagnostic_warning_events").put(review); tx.objectStore("animals").put(animal); tx.objectStore("animals").put(animalB);
      tx.objectStore("nutrition_requirement_calculations").put(requirement); classifications.forEach((row) => tx.objectStore("animal_nutrition_classifications").put(row));
      classificationReviews.forEach((row) => tx.objectStore("animal_nutrition_classification_reviews").put(row));
      tx.objectStore("feed_diagnostic_profiles").put(diagnosticProfile); tx.objectStore("feed_diagnostic_profile_selections").put(diagnosticSelection);
      tx.objectStore("nutrition_requirement_profiles").put(requirementProfile); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } finally { db.close(); } }, APP_CONFIG.cloud.farmId);
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
  await page.locator('[data-nav="animals"]').click(); await page.locator('[data-animal-id="cow-a"]').click();
  await page.locator("#requirement-ration-comparison-form:visible").waitFor();
  await page.locator("#requirement-ration-calculation").selectOption("requirement-cow-a");
  await page.locator("#requirement-ration-review").selectOption({ index: 1 });
  await page.locator('#requirement-ration-comparison-form button[type="submit"]').click();
  await page.locator('#requirement-ration-comparison-result:has-text("allocation review")').waitFor();
  assert.match(await page.locator("#requirement-ration-comparison-result").textContent(), /ration evidence: 5.85 kg DM\/day/);
  await page.reload(); await page.locator("#account-actions:not([hidden])").waitFor(); await page.locator('[data-nav-action="feeds"]').click();
  await page.locator('#ration-allocation-list:has-text("Synthetic documented weighing evidence")').waitFor();
  await page.locator("#account-actions summary").click(); await page.locator("#auth-sign-out").click(); await page.locator("#auth-sign-in").waitFor();
  assert.equal(await page.locator("#ration-allocation-list").textContent(), ""); assert.equal(await page.locator("#ration-allocation-form").isVisible(), false);
  assert.equal((await rows(page, "feed_ration_allocation_reviews")).length, 1, "sign-out must conceal, not delete, allocation evidence");
  assert.deepEqual(errors, []); console.log("ration-allocation-ui.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
