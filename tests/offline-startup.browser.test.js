import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";
import { waitForAuthenticatedApp } from "./support/browser-auth-readiness.js";

// Characterizes the current offline launch boundary on a loopback origin.
// This test makes no account, farm, cloud, or production storage changes.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const authModule = `
const user = { id: "offline-test-member", email: "offline@example.invalid" };
const key = "isolated-offline-session";
const listeners = new Set();
const session = () => localStorage.getItem(key) === user.id ? { user } : null;
const auth = {
  onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
  async getSession() { localStorage.setItem("isolated-session-checked", "1"); return { data: { session: session() }, error: null }; },
  async signInWithPassword({ email, password }) {
    if (email !== user.email || password !== "TEST-ONLY") return { error: new Error("Test credentials rejected") };
    localStorage.setItem(key, user.id);
    listeners.forEach((callback) => callback("SIGNED_IN", session()));
    return { error: null };
  },
  async signOut() {
    localStorage.removeItem(key);
    listeners.forEach((callback) => callback("SIGNED_OUT", null));
    return { error: null };
  }
};
export async function getAuthClient() { return { auth, from(table) {
  if (table !== "farm_members") throw new Error("Unexpected table: " + table);
  return { select() { return this; }, eq() { return this; }, async maybeSingle() {
    return { data: { farm_id: "${APP_CONFIG.cloud.farmId}" }, error: null };
  } };
} }; }
`;
const server = createServer(async (request, response) => {
  const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
  const filename = path.resolve(root, relative);
  if (request.method !== "GET" || !filename.startsWith(root + path.sep) ||
      !/^(index\.html|manifest\.json|assets\/|src\/|styles\/)/.test(relative)) {
    response.writeHead(404).end(); return;
  }
  if (relative === "src/auth.js") {
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(authModule); return;
  }
  try {
    response.writeHead(200, { "content-type": types[path.extname(filename)] || "application/octet-stream", "cache-control": "no-store" })
      .end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});

let browser;
let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  const externalRequests = [];
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  await page.waitForFunction(() => localStorage.getItem("isolated-session-checked") === "1" &&
    document.querySelector("#auth-status")?.textContent?.includes("Not signed in"));
  assert.equal(await page.locator(".bottom-nav").isVisible(), false);
  assert.equal(await page.locator("#animal-list [data-animal-id]").count(), 0);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  await page.locator("#auth-email").fill("offline@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await waitForAuthenticatedApp(page, { expectedUserId: "offline-test-member", farmId: APP_CONFIG.cloud.farmId });
  assert.equal(await page.locator("#auth-card").isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("isolated-offline-session")), "offline-test-member");
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  assert.deepEqual(externalRequests, [], "synthetic session must not reach any external endpoint");

  // A second launch with an existing synthetic session cannot load the shell offline.
  await context.setOffline(true);
  const reopened = await context.newPage();
  let navigationFailure = null;
  try { await reopened.goto(origin, { waitUntil: "domcontentloaded", timeout: 5000 }); }
  catch (error) { navigationFailure = String(error); }
  assert.match(navigationFailure || "", /ERR_INTERNET_DISCONNECTED|ERR_FAILED/,
    "cold offline navigation currently fails before the existing session can be examined");
  assert.equal(await reopened.locator(".bottom-nav").count(), 0);
  assert.equal(await reopened.locator("#animal-list [data-animal-id]").count(), 0);
  console.log("offline-startup.browser.test.js: PASS (cold offline launch blocked on current baseline)");
} finally {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
