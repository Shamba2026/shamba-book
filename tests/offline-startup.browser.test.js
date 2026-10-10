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
export async function getAuthClient() { if (!navigator.onLine) throw new Error("Synthetic auth client unavailable offline"); return { auth, from(table) {
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
      !/^(index\.html|manifest\.json|service-worker\.js|assets\/|src\/|styles\/)/.test(relative)) {
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
  assert.equal(await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then((registration) => Boolean(registration.active)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("No active shell worker")), 5000))
  ])), true);
  assert.equal(await page.evaluate(async () => {
    const cache = await caches.open("ngombe-herdbook-static-20261010-03");
    return Boolean(await cache.match("./styles/app.css?build=20261010-02"));
  }), true, "the separately reviewed landing stylesheet must be available to the offline shell");
  assert.equal(await page.evaluate(async () => {
    const cache = await caches.open("ngombe-herdbook-static-20261010-03");
    const response = await cache.match("./manifest.json?v=15");
    return response?.ok && (await response.json()).name === "Ngombe Herdbook";
  }), true, "the exact manifest URL requested by the page must be cached");
  await page.locator("#auth-email").fill("offline@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await waitForAuthenticatedApp(page, { expectedUserId: "offline-test-member", farmId: APP_CONFIG.cloud.farmId });
  assert.equal(await page.locator("#auth-card").isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("isolated-offline-session")), "offline-test-member");
  assert.equal(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)), true);
  assert.deepEqual(externalRequests, [], "synthetic session must not reach any external endpoint");

  // The shell must load on a second offline tab, but this test does not authorize
  // an offline farm session. The synthetic auth module refuses offline access.
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto(origin, { waitUntil: "domcontentloaded", timeout: 5000 });
  await reopened.locator("#auth-sign-in:not([hidden])").waitFor();
  assert.equal(await reopened.locator("#auth-lock-message").isVisible(), true);
  assert.equal(await reopened.locator(".bottom-nav").isVisible(), false);
  assert.equal(await reopened.locator("#animal-list [data-animal-id]").count(), 0);
  assert.equal(await reopened.evaluate(() => localStorage.getItem("isolated-offline-session")), "offline-test-member",
    "the session marker persists, but does not itself unlock farm data");
  console.log("offline-startup.browser.test.js: PASS (offline shell, farm data locked)");
} finally {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
