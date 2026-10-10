import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";
import { waitForAuthenticatedApp } from "./support/browser-auth-readiness.js";

// Real Supabase browser bundle, synthetic responses, isolated storage and loopback shell.
// No request reaches the configured farm service and no production records are read.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const user = { id: "offline-bundle-member", email: "offline-bundle@example.invalid", role: "authenticated" };
const expiry = Math.floor(Date.now() / 1000) + 7200;
const jwt = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: user.role, exp: expiry })).toString("base64url"),
  "synthetic-signature"
].join(".");
const body = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 7200,
  expires_at: expiry, refresh_token: "synthetic-refresh-token", user });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg" };
const server = createServer(async (request, response) => {
  const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
  const filename = path.resolve(root, relative);
  if (request.method !== "GET" || !filename.startsWith(root + path.sep) ||
      !/^(index\.html|manifest\.json|service-worker\.js|assets\/|src\/|styles\/)/.test(relative)) {
    response.writeHead(404).end(); return;
  }
  try { response.writeHead(200, { "content-type": types[path.extname(filename)] || "application/octet-stream", "cache-control": "no-store" })
    .end(relative === "src/ui.js" ? (await readFile(filename, "utf8"))
      .replace('const setSignedOut = () => {', 'const setSignedOut = () => { console.log("AUTH_TRACE signedOut", new Error().stack);')
      .replace('client.auth.onAuthStateChange((_event, session) => {', 'client.auth.onAuthStateChange((_event, session) => { console.log("AUTH_TRACE event", _event, Boolean(session?.user));')
      : await readFile(filename)); }
  catch { response.writeHead(404).end(); }
});

const browser = await chromium.launch({ headless: true });
let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  context = await browser.newContext();
  const unexpected = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) { await route.continue(); return; }
    if (url.origin === APP_CONFIG.cloud.supabaseUrl && url.pathname === "/auth/v1/token" && request.method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body }); return;
    }
    if (url.origin === APP_CONFIG.cloud.supabaseUrl && url.pathname === "/rest/v1/farm_members" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ farm_id: APP_CONFIG.cloud.farmId }) }); return;
    }
    unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.abort();
  });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.text().startsWith("AUTH_TRACE")) console.log(message.text()); });
  await page.goto(origin);
  await page.locator("#auth-sign-in:not([hidden])").waitFor();
  await page.locator("#auth-email").fill(user.email);
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await waitForAuthenticatedApp(page, { expectedUserId: user.id, farmId: APP_CONFIG.cloud.farmId });
  assert.equal(await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then((registration) => Boolean(registration.active)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("No active shell worker")), 5000))
  ])), true);
  assert.deepEqual(unexpected, []);

  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto(origin, { waitUntil: "domcontentloaded", timeout: 5000 });
  await waitForAuthenticatedApp(reopened, { expectedUserId: user.id, farmId: APP_CONFIG.cloud.farmId });
  assert.equal(await reopened.locator("#auth-card").isVisible(), false);
  assert.deepEqual(unexpected, [], "offline reopen must not issue unrecognized network requests");

  await reopened.evaluate(async (key) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("ngombe-herdbook");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise((resolve, reject) => { const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings"); const get = store.get(key);
      get.onsuccess = () => store.put({ ...get.result, checkedAt: "2020-01-01T00:00:00.000Z" });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
    finally { db.close(); }
  }, `verified-farm:${user.id}:${APP_CONFIG.cloud.farmId}`);
  const stale = await context.newPage();
  await stale.goto(origin, { waitUntil: "domcontentloaded", timeout: 5000 });
  await stale.locator('#app-status:has-text("Farm access unavailable")').waitFor();
  assert.equal(await stale.locator(".bottom-nav").isVisible(), false);
  assert.equal(await stale.locator("#animal-list [data-animal-id]").count(), 0);
  assert.deepEqual(unexpected, []);
  console.log("offline-auth-client.browser.test.js: PASS");
} finally {
  await context?.close(); await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
