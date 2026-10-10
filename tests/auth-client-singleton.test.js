import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/auth.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace("export const getAuthClient = loadClient;", "this.getAuthClient = loadClient;");
let created = 0;
const context = vm.createContext({
  APP_CONFIG: { cloud: { supabaseUrl: "https://test.invalid", supabaseAnonKey: "synthetic" } },
  window: { supabase: { createClient() { return { instance: ++created }; } } }
});
vm.runInContext(source, context);
const [first, concurrent] = await Promise.all([context.getAuthClient(), context.getAuthClient()]);
assert.equal(first, concurrent, "concurrent callers must share one auth client");
assert.equal(await context.getAuthClient(), first, "later callers must reuse the same auth client");
assert.equal(created, 1, "repeated reads must not initialize competing auth clients");
let script;
let loadedClients = 0;
const unloadedWindow = { setTimeout: () => 1, clearTimeout() {} };
const unloaded = vm.createContext({
  APP_CONFIG: { cloud: { supabaseUrl: "https://test.invalid", supabaseAnonKey: "synthetic",
    supabaseJsBundle: "./assets/vendor/test.js" } },
  window: unloadedWindow,
  document: { createElement: () => ({}), head: { appendChild(element) { script = element; } } }
});
vm.runInContext(source, unloaded);
const loading = [unloaded.getAuthClient(), unloaded.getAuthClient()];
assert.equal(script.src, "./assets/vendor/test.js");
unloadedWindow.supabase = { createClient() { return { instance: ++loadedClients }; } };
script.onload();
const [loaded, alsoLoaded] = await Promise.all(loading);
assert.equal(loaded, alsoLoaded);
assert.equal(await unloaded.getAuthClient(), loaded);
assert.equal(loadedClients, 1, "script-load and later calls must share the cached client");
console.log("auth-client-singleton.test.js: PASS");
