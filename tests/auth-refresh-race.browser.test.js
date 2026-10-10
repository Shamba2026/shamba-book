import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_CONFIG } from "../src/config.js";
import { waitForAuthenticatedApp } from "./support/browser-auth-readiness.js";

// Deliberately completes the startup's empty session read after a successful sign-in.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const authModule = `
const user = { id: "auth-race-member", email: "auth-race@example.invalid" };
const listeners = new Set(); let signedIn = false; let initialRead = true;
const session = () => signedIn ? { user } : null;
const auth = {
  onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() {} } } }; },
  async getSession() {
    if (initialRead) { initialRead = false; return new Promise((resolve) => {
      window.releaseInitialSession = () => resolve({ data: { session: null }, error: null });
    }); }
    return { data: { session: session() }, error: null };
  },
  async signInWithPassword({ email, password }) {
    if (email !== user.email || password !== "TEST-ONLY") return { error: new Error("Rejected") };
    signedIn = true; listeners.forEach((callback) => callback("SIGNED_IN", session())); return { error: null };
  },
  async signOut() { signedIn = false; listeners.forEach((callback) => callback("SIGNED_OUT", null)); return { error: null }; }
};
export async function getAuthClient() { return { auth, from(table) {
  if (table !== "farm_members") throw new Error("Unexpected table");
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
  if (relative === "src/auth.js") { response.writeHead(200, { "content-type": "text/javascript" }).end(authModule); return; }
  const type = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg" }[path.extname(filename)];
  try { response.writeHead(200, { "content-type": type || "application/octet-stream" })
    .end(await readFile(filename)); }
  catch { response.writeHead(404).end(); }
});

const browser = await chromium.launch({ headless: true }); let context;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof window.releaseInitialSession === "function");
  await page.locator("#auth-email").fill("auth-race@example.invalid");
  await page.locator("#auth-password").fill("TEST-ONLY");
  await page.locator("#auth-sign-in").click();
  await waitForAuthenticatedApp(page, { expectedUserId: "auth-race-member", farmId: APP_CONFIG.cloud.farmId });
  await page.evaluate(async () => { window.releaseInitialSession(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(await page.locator("#auth-card").isVisible(), false);
  assert.equal(await page.locator(".bottom-nav").isVisible(), true);
  assert.equal(await page.locator("#app-status").textContent(), "Signed in to the farm cloud account.");
  console.log("auth-refresh-race.browser.test.js: PASS");
} finally {
  await context?.close(); await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
