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
const users = { "feed-review@example.invalid": { id: "feed-review-user", email: "feed-review@example.invalid" }, "outsider@example.invalid": { id: "outsider-user", email: "outsider@example.invalid" } };
const session = () => { const email = localStorage.getItem(key); return email ? { user: users[email] } : null; };
const auth = {
  onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() {} } } }; },
  async getSession() { return { data: { session: session() }, error: null }; },
  async signInWithPassword({ email, password }) { if (!users[email] || password !== "TEST-ONLY") return { error: new Error("Rejected") }; localStorage.setItem(key, email); listeners.forEach((callback) => callback("SIGNED_IN", session())); return { error: null }; },
  async signOut() { localStorage.removeItem(key); listeners.forEach((callback) => callback("SIGNED_OUT", null)); return { error: null }; }
};
export async function getAuthClient() { return { auth, from(table) { if (table !== "farm_members") throw new Error("Unexpected table"); let requestedUser = null; return { select() { return this; }, eq(column, value) { if (column === "user_id") requestedUser = value; return this; }, async maybeSingle() { return { data: requestedUser === "feed-review-user" ? { farm_id: "${APP_CONFIG.cloud.farmId}" } : null, error: null }; } }; } }; }
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
  await page.evaluate(async (farmId) => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open("ngombe-herdbook"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise((resolve, reject) => { const tx = db.transaction("animals", "readwrite"); tx.objectStore("animals").put({ id: "diagnostic-test-animal", farmId, animalCode: "TEST-DIAGNOSTIC-COW", type: "dairy_cow", status: "active" }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } finally { db.close(); } }, APP_CONFIG.cloud.farmId);
  assert.match(await page.locator(".feed-hero .feed-safety").textContent(), /not connected to ration or TMR calculations/i);
  await page.locator("#feed-name").fill("TEST feed evidence"); await page.locator("#feed-role").selectOption("forage"); await page.locator('#feed-form button[type="submit"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#app-status").textContent(), "Feed added to this farm library.");
  await page.locator('[data-feed-id]:has-text("TEST feed evidence")').waitFor();
  await page.locator("#feed-source-title").fill("TEST laboratory report"); await page.locator("#feed-source-type").selectOption("lab_report");
  await page.locator("#feed-source-citation").fill("TEST-CITATION-001"); await page.locator("#feed-source-publisher").fill("Synthetic laboratory");
  await page.locator('#feed-source-form button[type="submit"]').click(); await page.locator('#feed-source-list:has-text("TEST-CITATION-001")').waitFor();
  for (const [nutrient, value, evidence] of [["CP", "80", "VERIFIED_LAB"], ["CP", "60", "RESEARCH_SUPPORTED"],
    ["DM", "25", "VERIFIED_LAB"], ["ME", "10.5", "VERIFIED_LAB"]]) {
    await page.locator("#feed-observation-source").selectOption({ index: 1 });
    await page.locator("#feed-observation-nutrient").selectOption(nutrient); await page.locator("#feed-observation-value").fill(value);
    await page.locator("#feed-observation-evidence").selectOption(evidence); await page.locator("#feed-observation-date").fill("2026-09-28");
    await page.locator('#feed-observation-form button[type="submit"]').click();
    await page.locator('#feed-profile .observation:has-text("' + value + ' ' + (nutrient === "ME" ? "MJ PER KG DM" : "PERCENT") + '")').waitFor();
  }
  await page.locator('.feed-conflict:has-text("Conflicting Crude protein")').waitFor();
  const proteinObservationId = await page.locator("#feed-selection-observation").evaluate((select) =>
    [...select.options].find((option) => option.textContent.startsWith("Crude protein · 80 "))?.value || "");
  assert.notEqual(proteinObservationId, "", "reviewed crude-protein observation must be selectable");
  await page.locator("#feed-selection-observation").selectOption(proteinObservationId);
  await page.locator("#feed-selection-rationale").fill("Synthetic reviewed laboratory result");
  await page.locator('#feed-selection-form button[type="submit"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#app-status").textContent(), "Nutrition evidence selection recorded for review.");
  await page.locator('#feed-current-selections:has-text("TEST-CITATION-001")').waitFor();
  for (const [nutrientLabel, rationale] of [["Dry matter", "Synthetic reviewed dry matter"], ["Metabolizable energy", "Synthetic reviewed energy"]]) {
    const observationId = await page.locator("#feed-selection-observation").evaluate((select, label) =>
      [...select.options].find((option) => option.textContent.startsWith(label + " ·"))?.value || "", nutrientLabel);
    assert.notEqual(observationId, "", nutrientLabel + " observation must be selectable");
    await page.locator("#feed-selection-observation").selectOption(observationId);
    await page.locator("#feed-selection-rationale").fill(rationale); await page.locator('#feed-selection-form button[type="submit"]').click();
    await page.locator('#feed-current-selections:has-text("' + rationale + '")').waitFor();
  }
  await page.locator("#feed-cost-type").selectOption("receipt"); await page.locator("#feed-cost-date").fill("2026-09-28");
  await page.locator("#feed-cost-reference").fill("TEST-RECEIPT-001"); await page.locator("#feed-cost-counterparty").fill("Synthetic supplier");
  await page.locator('#feed-cost-source-form button[type="submit"]').click(); await page.locator('#feed-cost-source-list:has-text("TEST-RECEIPT-001")').waitFor();
  await page.locator("#feed-batch-feed").selectOption({ index: 1 }); await page.locator("#feed-batch-cost-source").selectOption({ index: 1 });
  await page.locator("#feed-batch-date").fill("2026-09-28"); await page.locator("#feed-batch-quantity").fill("125.5");
  await page.locator("#feed-batch-total-cost").fill("2500.25"); await page.locator("#feed-batch-lot").fill("TEST-LOT-001");
  await page.locator('#feed-batch-form button[type="submit"]').click(); await page.locator('#feed-inventory-list:has-text("125.5 kg remaining")').waitFor();
  await page.locator("#feed-movement-batch").selectOption({ index: 1 }); await page.locator("#feed-movement-type").selectOption("CONSUMPTION");
  await page.locator("#feed-movement-date").fill("2026-09-29"); await page.locator("#feed-movement-quantity").fill("25");
  await page.locator("#feed-movement-unit").selectOption("KG_AS_FED"); await page.locator("#feed-movement-reason").fill("Synthetic feeding review");
  await page.locator('#feed-movement-form button[type="submit"]').click(); await page.locator('#feed-inventory-list:has-text("100.5 kg remaining")').waitFor();
  await page.locator("#feed-movement-batch").selectOption({ index: 1 }); await page.locator("#feed-movement-date").fill("2026-09-29");
  await page.locator("#feed-movement-quantity").fill("101"); await page.locator("#feed-movement-reason").fill("Synthetic overspend rejection");
  await page.locator('#feed-movement-form button[type="submit"]').click(); await page.locator('#app-status:has-text("exceeds the available")').waitFor();
  const rationInput = page.locator("[data-ration-batch-id]");
  if (!await rationInput.isEnabled()) throw new Error("Ration row was disabled: " + await page.locator("#ration-review-rows").textContent() +
    " selections=" + JSON.stringify((await rows(page, "feed_nutrition_selections")).map(({ nutrientCode, rationale }) => ({ nutrientCode, rationale }))));
  await rationInput.fill("10"); await page.locator("#ration-review-calculate").click();
  await page.locator('#ration-review-result:has-text("2.500 kg")').waitFor();
  assert.match(await page.locator("#ration-review-result").textContent(), /No diagnostic profile selected/);
  assert.equal(await page.locator("#diagnostic-forage").inputValue(), "");
  assert.equal(await page.locator("#diagnostic-me").inputValue(), "");
  assert.equal(await page.locator("#diagnostic-cp").inputValue(), "");
  await page.locator("#diagnostic-name").fill("TEST lactating profile"); await page.locator("#diagnostic-version").fill("1");
  await page.locator("#diagnostic-animal-class").selectOption("LACTATING_DAIRY_COW");
  await page.locator("#diagnostic-year").fill("2021"); await page.locator("#diagnostic-applicability").fill("Synthetic lactating-cow test only");
  await page.locator("#diagnostic-source-title").fill("Synthetic nutrition source");
  await page.locator("#diagnostic-citation").fill("TEST-DIAGNOSTIC-CITATION-001");
  await page.locator("#diagnostic-forage").fill("0.4"); await page.locator("#diagnostic-me").fill("11");
  await page.locator("#diagnostic-cp").fill("14"); await page.locator('#diagnostic-profile-form button[type="submit"]').click();
  await page.locator('#diagnostic-profile-list:has-text("TEST-DIAGNOSTIC-CITATION-001")').waitFor();
  await page.locator("#requirement-name").fill("TEST requirement profile"); await page.locator("#requirement-version").fill("1");
  await page.locator("#requirement-animal-class").selectOption("LACTATING_DAIRY_COW"); await page.locator("#requirement-system").fill("TEST SYSTEM");
  await page.locator("#requirement-year").fill("2021"); await page.locator("#requirement-applicability").fill("Synthetic UI applicability only");
  await page.locator("#requirement-source-title").fill("Synthetic requirement source"); await page.locator("#requirement-citation").fill("TEST-REQUIREMENT-UI-001");
  await page.locator("#requirement-equation-reference").fill("Synthetic equation A"); await page.locator("#requirement-weight-coefficient").fill("0.02");
  await page.locator('#requirement-profile-form button[type="submit"]').click();
  await page.locator('#requirement-profile-list:has-text("TEST-REQUIREMENT-UI-001")').waitFor();
  await page.locator("#requirement-approval-profile").selectOption({ index: 1 });
  await page.locator("#requirement-approval-rationale").fill("Synthetic source and equation review");
  await page.locator("#requirement-approval-confirmed").check(); await page.locator('#requirement-approval-form button[type="submit"]').click();
  await page.locator('#requirement-profile-list:has-text("status: approved")').waitFor();
  assert.match(await page.locator("#diagnostic-current-selection").textContent(), /warnings are inactive/i);
  await page.reload(); await page.locator("#account-actions:not([hidden])").waitFor();
  await page.locator('[data-nav="animals"]').click(); await page.locator('[data-animal-id="diagnostic-test-animal"]').click();
  await page.locator("#animal-profile:visible").waitFor();
  await page.locator("#classification-date").fill("2026-10-05"); await page.locator("#classification-weight").fill("480");
  await page.locator("#classification-weight-method").selectOption("SCALE_MEASURED"); await page.locator("#classification-physiology").selectOption("POSTPARTUM");
  await page.locator("#classification-lactation-status").selectOption("LACTATING"); await page.locator("#classification-lactation-stage").selectOption("EARLY");
  await page.locator("#classification-production-context").selectOption("DAIRY"); await page.locator("#classification-milk").fill("20");
  await page.locator("#classification-window").fill("7"); await page.locator("#classification-evidence-type").selectOption("FARM_RECORD");
  await page.locator("#classification-source-title").fill("Synthetic animal evidence"); await page.locator("#classification-citation").fill("TEST-CLASS-UI-001");
  await page.locator("#classification-notes").fill("Synthetic UI evidence only; no automatic applicability or recommendation.");
  await page.locator('#animal-nutrition-classification-form button[type="submit"]').click();
  await page.locator('#classification-list:has-text("TEST-CLASS-UI-001")').waitFor();
  await page.locator("#classification-review-evidence").selectOption("CONFIRMED");
  await page.locator("#classification-review-profile").selectOption({ index: 1 });
  await page.locator("#classification-review-applicability").selectOption("APPLICABLE");
  await page.locator("#classification-review-rationale").fill("Synthetic explicit classification and applicability review");
  await page.locator("#classification-review-confirmed").check();
  await page.locator('#animal-nutrition-review-form button[type="submit"]').click();
  await page.locator('#classification-review-list:has-text("Synthetic explicit classification and applicability review")').waitFor();
  await page.locator("#requirement-applicability-profile").selectOption({ index: 1 });
  await page.locator("#requirement-applicability-decision").selectOption("APPLICABLE");
  await page.locator("#requirement-applicability-rationale").fill("Synthetic explicit requirement applicability review");
  await page.locator("#requirement-applicability-confirmed").check();
  await page.locator('#requirement-applicability-form button[type="submit"]').click();
  await page.locator('#requirement-applicability-list:has-text("Synthetic explicit requirement applicability review")').waitFor();
  await page.locator("#requirement-calculation-profile").selectOption({ index: 1 });
  await page.locator("#requirement-calculation-confirmed").check();
  await page.locator('#requirement-calculation-form button[type="submit"]').click();
  await page.locator('#requirement-calculation-list:has-text("DMI_KG_DAY: 9.6 kg DM/day")').waitFor();
  await page.locator('#requirement-calculation-list:has-text("TEST-REQUIREMENT-UI-001")').waitFor();
  assert.equal((await rows(page, "nutrition_requirement_calculations")).length, 1);
  assert.equal((await rows(page, "feed_inventory_movements")).length, 1, "requirement calculation must not consume inventory");
  assert.equal((await rows(page, "sync_queue")).length, 0, "requirement calculation must not queue a cloud write");
  await page.locator('[data-nav="home"]').click(); await page.locator('[data-nav-action="feeds"]').click();
  await page.locator('[data-view="feeds"]:visible').waitFor();
  await page.locator("#diagnostic-selection-profile").selectOption({ index: 1 });
  await page.locator("#diagnostic-selection-animals").selectOption("diagnostic-test-animal");
  await page.locator("#diagnostic-selection-rationale").fill("Synthetic explicit review decision");
  await page.locator("#diagnostic-applicability-confirmed").check();
  await page.locator('#diagnostic-selection-form button[type="submit"]').click();
  await page.locator('#diagnostic-current-selection:has-text("Synthetic explicit review decision")').waitFor();
  await page.locator("[data-ration-batch-id]").fill("10"); await page.locator("#ration-daily-basis").check();
  await page.locator("#ration-review-calculate").click();
  await page.locator('#ration-review-result:has-text("Applied TEST lactating profile v1")').waitFor();
  await page.locator('#ration-review-result:has-text("minimum ME density")').waitFor();
  await page.locator('#diagnostic-history-list:has-text("TEST-DIAGNOSTIC-COW")').waitFor();
  assert.equal((await rows(page, "feed_library")).length, 1); assert.equal((await rows(page, "feed_sources")).length, 1); assert.equal((await rows(page, "feed_observations")).length, 4);
  assert.equal((await rows(page, "feed_cost_sources")).length, 1); assert.equal((await rows(page, "feed_inventory_batches")).length, 1);
  assert.equal((await rows(page, "feed_inventory_movements")).length, 1); assert.equal((await rows(page, "feed_nutrition_selections")).length, 3);
  assert.equal((await rows(page, "feed_diagnostic_profiles")).length, 1);
  assert.equal((await rows(page, "feed_diagnostic_profile_selections")).length, 1);
  assert.equal((await rows(page, "feed_diagnostic_warning_events")).length, 1);
  assert.equal((await rows(page, "nutrition_requirement_profiles")).length, 1);
  assert.equal((await rows(page, "nutrition_requirement_profile_reviews")).length, 1);
  assert.equal((await rows(page, "nutrition_requirement_applicability_reviews")).length, 1);
  assert.equal((await rows(page, "nutrition_requirement_calculations")).length, 1);
  assert.equal((await rows(page, "records")).length, 0); assert.equal((await rows(page, "sync_queue")).length, 0);
  await page.reload(); await page.locator("#account-actions:not([hidden])").waitFor(); await page.locator('[data-nav-action="feeds"]').click();
  await page.locator('[data-feed-id]:has-text("TEST feed evidence")').waitFor(); await page.locator('.feed-conflict:has-text("Conflicting Crude protein")').waitFor();
  await page.locator('#feed-inventory-list:has-text("TEST-RECEIPT-001")').waitFor();
  await page.locator('#feed-inventory-list:has-text("100.5 kg remaining")').waitFor(); await page.locator('#feed-current-selections:has-text("Synthetic reviewed laboratory result")').waitFor();
  await page.locator('#diagnostic-current-selection:has-text("Synthetic explicit review decision")').waitFor();
  await page.locator('#requirement-profile-list:has-text("status: approved")').waitFor();
  await page.locator("[data-ration-batch-id]").fill("10"); await page.locator("#ration-daily-basis").check();
  await page.locator("#ration-review-calculate").click();
  await page.locator('#ration-review-result:has-text("2.500 kg")').waitFor();
  await page.locator('[data-nav="animals"]').click(); await page.locator('[data-animal-id="diagnostic-test-animal"]').click();
  await page.locator("#animal-profile:visible").waitFor();
  await page.locator('#classification-list:has-text("TEST-CLASS-UI-001")').waitFor();
  assert.equal((await rows(page, "animal_nutrition_classifications")).length, 1);
  await page.locator('#classification-review-list:has-text("Synthetic explicit classification and applicability review")').waitFor();
  await page.locator('#requirement-applicability-list:has-text("Synthetic explicit requirement applicability review")').waitFor();
  await page.locator('#requirement-calculation-list:has-text("DMI_KG_DAY: 9.6 kg DM/day")').waitFor();
  await page.locator("#requirement-ration-calculation").selectOption({ index: 1 });
  await page.locator("#requirement-ration-review").selectOption({ index: 1 });
  await page.locator('#requirement-ration-comparison-form button[type="submit"]').click();
  await page.locator('#requirement-ration-comparison-result:has-text("Below documented requirement")').waitFor();
  assert.match(await page.locator("#requirement-ration-comparison-result").textContent(), /no adequacy judgment or feed recommendation/i);
  await page.locator("#requirement-ration-review-decision").selectOption("NEEDS_EVIDENCE_REVIEW");
  await page.locator("#requirement-ration-review-rationale").fill("Synthetic human review requires additional ration evidence.");
  await page.locator("#requirement-ration-review-confirmed").check();
  await page.locator('#requirement-ration-review-form button[type="submit"]').click();
  await page.locator('#requirement-ration-review-list:has-text("Synthetic human review requires additional ration evidence")').waitFor();
  assert.equal((await rows(page, "nutrition_requirement_ration_reviews")).length, 1);
  await page.locator("#requirement-ration-calculation").selectOption({ index: 1 });
  await page.locator("#requirement-ration-review").selectOption({ index: 1 });
  await page.locator('#requirement-ration-comparison-form button[type="submit"]').click();
  await page.locator("#requirement-ration-review-supersedes:visible").waitFor();
  assert.match(await page.locator("#requirement-ration-review-supersedes").textContent(), /earlier review remains in history/i);
  await page.locator("#requirement-ration-review-decision").selectOption("ACKNOWLEDGED");
  await page.locator("#requirement-ration-review-rationale").fill("Synthetic corrected review explicitly supersedes the earlier decision.");
  await page.locator("#requirement-ration-review-confirmed").check();
  await page.locator('#requirement-ration-review-form button[type="submit"]').click();
  await page.locator('#requirement-ration-review-list:has-text("Synthetic corrected review explicitly supersedes the earlier decision")').waitFor();
  const comparisonReviewRows = await rows(page, "nutrition_requirement_ration_reviews");
  assert.equal(comparisonReviewRows.length, 2);
  assert.ok(comparisonReviewRows.some((row) => row.supersedesReviewId), "new review must explicitly link to the retained prior review");
  assert.match(await page.locator("#requirement-ration-review-current-summary").textContent(), /1 current decision/);
  assert.match(await page.locator("#requirement-ration-review-list").textContent(), /SUPERSEDED/);
  assert.match(await page.locator("#requirement-ration-review-list").textContent(), /CURRENT/);
  assert.match(await page.locator("#nutrition-evidence-status").textContent(), /Classification · current/i);
  assert.match(await page.locator("#nutrition-evidence-status").textContent(), /Comparison review · current/i);
  assert.match(await page.locator("#nutrition-evidence-status").textContent(), /does not approve a ration/i);
  assert.equal((await rows(page, "feed_inventory_movements")).length, 1, "comparison must not consume inventory");
  assert.equal((await rows(page, "sync_queue")).length, 0, "comparison must not queue a cloud write");
  await page.locator('[data-nav="home"]').click(); await page.locator('[data-nav-action="feeds"]').click();
  await page.locator("#requirement-revocation-profile").selectOption({ index: 1 });
  await page.locator("#requirement-revocation-rationale").fill("Synthetic UI revocation review");
  await page.locator("#requirement-revocation-confirmed").check(); await page.locator('#requirement-revocation-form button[type="submit"]').click();
  await page.locator('#requirement-profile-list:has-text("status: revoked")').waitFor();
  await page.locator('[data-nav="animals"]').click(); await page.locator('[data-animal-id="diagnostic-test-animal"]').click();
  await page.locator("#animal-profile:visible").waitFor();
  await page.locator("#requirement-ration-comparison-form").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#requirement-ration-comparison-form").isVisible(), false,
    "revoked requirement evidence must not remain available for a new comparison review");
  assert.equal(await page.locator("#requirement-calculation-form").isVisible(), false, "revoked profile must not remain calculable");
  assert.equal((await rows(page, "animal_nutrition_classification_reviews")).length, 1);
  assert.equal((await rows(page, "feed_diagnostic_profile_selections")).length, 1, "classification review must not activate another profile");
  assert.equal((await rows(page, "records")).length, 0); assert.equal((await rows(page, "sync_queue")).length, 0);
  await page.reload(); await page.locator("#account-actions:not([hidden])").waitFor(); await page.locator('[data-nav="animals"]').click();
  await page.locator('#herd-nutrition-readiness:has-text("1 of 1")').waitFor();
  assert.match(await page.locator("#herd-nutrition-readiness").textContent(), /ATTENTION/,
    "revoked requirement evidence must prevent a complete herd evidence chain");
  await page.locator('[data-animal-id="diagnostic-test-animal"]').click(); await page.locator("#animal-profile:visible").waitFor();
  await page.locator('#classification-list:has-text("TEST-CLASS-UI-001")').waitFor();
  await page.locator('#classification-review-list:has-text("Synthetic explicit classification and applicability review")').waitFor();
  await page.locator('#requirement-ration-review-list:has-text("Synthetic human review requires additional ration evidence")').waitFor();
  await page.locator("#account-actions summary").click(); await page.locator("#auth-sign-out").click(); await page.locator("#auth-sign-in").waitFor(); await page.waitForTimeout(100);
  assert.equal(await page.locator("#feed-list").textContent(), ""); assert.equal(await page.locator("#feed-source-list").textContent(), ""); assert.equal(await page.locator("#feed-profile").textContent(), "");
  assert.equal(await page.locator("#feed-cost-source-list").textContent(), ""); assert.equal(await page.locator("#feed-inventory-list").textContent(), "");
  assert.equal(await page.locator("#feed-movement-list").textContent(), ""); assert.equal(await page.locator("#feed-current-selections").textContent(), "");
  assert.equal(await page.locator("#ration-review-result").textContent(), "");
  assert.equal(await page.locator("#diagnostic-profile-list").textContent(), "");
  assert.equal(await page.locator("#diagnostic-current-selection").textContent(), "");
  assert.equal(await page.locator("#diagnostic-history-list").textContent(), "");
  assert.equal(await page.locator("#classification-list").textContent(), "");
  assert.equal(await page.locator("#classification-review-list").textContent(), "");
  assert.equal(await page.locator("#requirement-profile-list").textContent(), "");
  assert.equal(await page.locator("#requirement-review-list").textContent(), "");
  assert.equal(await page.locator("#requirement-applicability-list").textContent(), "");
  assert.equal(await page.locator("#requirement-calculation-list").textContent(), "");
  assert.equal(await page.locator("#requirement-ration-comparison-result").textContent(), "");
  assert.equal(await page.locator("#requirement-ration-review-list").textContent(), "");
  assert.equal(await page.locator("#requirement-ration-review-current-summary").textContent(), "");
  assert.equal(await page.locator("#nutrition-evidence-status").textContent(), "");
  assert.equal(await page.locator("#herd-nutrition-readiness").textContent(), "");
  assert.equal((await rows(page, "feed_observations")).length, 4, "sign-out must conceal, not delete, local evidence");
  await page.locator("#auth-email").fill("outsider@example.invalid"); await page.locator("#auth-password").fill("TEST-ONLY"); await page.locator("#auth-sign-in").click();
  await page.locator('#app-status:has-text("not a member")').waitFor(); assert.equal(await page.locator('[data-view="feeds"]').isVisible(), false);
  assert.deepEqual(errors, []); console.log("feed-review-ui.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
