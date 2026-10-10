import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scope = new URL("https://shell.invalid/shamba-book/");
const stateful = new Set(["src/ui.js", "src/auth.js", "src/storage/farm-repository.js", "src/cloud/supabase-adapter.js"]);
const resolve = (specifier, importer = scope) => {
  const url = new URL(specifier, importer);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) throw new Error("External or out-of-scope shell asset");
  return url;
};
const relative = (url) => decodeURIComponent(url.pathname.slice(scope.pathname.length));
const imports = (source) => [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s*)?["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1]);

// Read-only source inspection: never imports app modules or opens IndexedDB.
export function inspectOfflineShell(root) {
  const worker = readFileSync(path.join(root, "service-worker.js"), "utf8");
  const context = vm.createContext({ URL, self: { registration: { scope: scope.href }, addEventListener() {} } });
  vm.runInContext(worker + "\nthis.shellAssets = ASSETS;", context);
  const assets = Array.from(context.shellAssets, (asset) => resolve(asset));
  const allowed = new Set(assets.map((url) => url.href));
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const entry = html.match(/script\.src\s*=\s*["']([^"']*src\/main\.js[^"']*)["']/)?.[1];
  if (!entry) throw new Error("Startup module entry not found");
  const required = new Set([resolve("./index.html").href]);
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const relation = tag.match(/\brel=["']([^"']+)["']/)?.[1];
    const href = tag.match(/\bhref=["']([^"']+)["']/)?.[1];
    if (["stylesheet", "manifest"].includes(relation) && href) required.add(resolve(href).href);
  }
  const pending = [resolve(entry)];
  const visited = new Set();
  const moduleUrls = new Map();
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href); required.add(url.href);
    const filename = relative(url);
    if (!moduleUrls.has(filename)) moduleUrls.set(filename, new Set());
    moduleUrls.get(filename).add(url.href);
    const source = readFileSync(path.join(root, filename), "utf8");
    for (const specifier of imports(source)) pending.push(resolve(specifier, url));
    if (filename === "src/config.js") {
      const bundle = source.match(/supabaseJsBundle:\s*["']([^"']+)["']/)?.[1];
      if (bundle) required.add(resolve(bundle).href);
    }
  }
  const duplicates = [...moduleUrls].filter(([, urls]) => urls.size > 1)
    .map(([filename, urls]) => ({ filename, urls: [...urls], stateful: stateful.has(filename) }));
  return {
    missing: [...required].filter((url) => !allowed.has(url)),
    missingFiles: assets.filter((url) => !existsSync(path.join(root, relative(url)))).map((url) => url.href),
    duplicates,
    moduleCount: visited.size
  };
}
