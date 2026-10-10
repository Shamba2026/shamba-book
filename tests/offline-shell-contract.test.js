import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectOfflineShell } from "./support/offline-shell-contract.js";

const fixture = mkdtempSync(path.join(tmpdir(), "ngombe-shell-contract-"));
try {
  mkdirSync(path.join(fixture, "src"));
  writeFileSync(path.join(fixture, "index.html"), '<link rel="manifest" href="./manifest.json?v=1"><script>script.src="./src/main.js?build=1";</script>');
  writeFileSync(path.join(fixture, "manifest.json"), "{}");
  writeFileSync(path.join(fixture, "src/main.js"), 'import { a } from "./auth.js?build=1";\nimport { b } from "./other.js";');
  writeFileSync(path.join(fixture, "src/other.js"), 'import { a } from "./auth.js?build=2";');
  writeFileSync(path.join(fixture, "src/auth.js"), "export const a = 1;");
  writeFileSync(path.join(fixture, "service-worker.js"), 'const ASSETS=["./index.html", "./manifest.json", "./src/main.js?build=1", "./src/other.js", "./src/auth.js?build=1"];');
  const bad = inspectOfflineShell(fixture);
  assert.equal(bad.missing.some((url) => url.endsWith("manifest.json?v=1")), true, "query strings must match exactly");
  assert.equal(bad.missing.some((url) => url.endsWith("auth.js?build=2")), true, "transitive imports must be cached");
  assert.equal(bad.duplicates.some((row) => row.filename === "src/auth.js" && row.stateful), true,
    "stateful duplicate URLs must be detected");
  writeFileSync(path.join(fixture, "src/other.js"), 'import { a } from "./auth.js?build=1";');
  writeFileSync(path.join(fixture, "service-worker.js"), 'const ASSETS=["./index.html", "./manifest.json?v=1", "./src/main.js?build=1", "./src/other.js", "./src/auth.js?build=1", "./absent.js"];');
  assert.equal(inspectOfflineShell(fixture).missingFiles.length, 1, "a nonexistent precache file must fail the contract");
} finally { rmSync(fixture, { recursive: true, force: true }); }

const root = fileURLToPath(new URL("..", import.meta.url));
const result = inspectOfflineShell(root);
assert.deepEqual(result.missing, [], "every startup dependency and exact stylesheet/manifest URL must be precached");
assert.deepEqual(result.missingFiles, [], "every precache URL must have a local file");
assert.deepEqual(result.duplicates.filter((row) => row.stateful), [], "stateful modules must have one URL per startup graph");
console.log(`offline-shell-contract.test.js: PASS (${result.moduleCount} module URLs; ${result.duplicates.length} stateless duplicate paths retained)`);
