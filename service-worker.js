// Versioned app shell only. Farm data stays in IndexedDB; auth/API responses are never cached.
const CACHE_NAME = "ngombe-herdbook-static-20261010-03";
const PREFIX = "ngombe-herdbook-";
const ASSETS = [
  "./index.html", "./manifest.json?v=15", "./styles/app.css?build=20261009-01",
  "./styles/app.css?build=20261010-02", "./assets/vendor/supabase-2.117.3.js",
  "./src/main.js?build=20261010-03", "./src/ui.js?build=20261010-03",
  "./src/auth.js?build=20261010-03", "./src/config.js?build=20261010-03", "./src/farm-access.js", "./src/farm-access.js?build=20261010-03",
  "./src/cloud/supabase-adapter.js?build=20261010-03",
  "./src/domain/animal-nutrition-classification.js?build=20261006-03",
  "./src/domain/farm-rules.js?build=20261010-03", "./src/domain/finance.js?build=20260927-01",
  "./src/domain/milk-ledger.js?build=20261010-01",
  "./src/domain/nutrition-requirement.js?build=20261006-02",
  "./src/domain/validation.js?build=20261009-01",
  "./src/domain/feed/comparison-evidence-currency.js?build=20261007-06",
  "./src/domain/feed/diagnostic-profile.js?build=20261005-03",
  "./src/domain/feed/feed-evidence.js",
  "./src/domain/feed/feed-inventory.js?build=20260928-01",
  "./src/domain/feed/feed-inventory.js?build=20260928-04",
  "./src/domain/feed/feed-math.js",
  "./src/domain/feed/nutrition-evidence-status.js?build=20261007-10",
  "./src/domain/feed/nutrition-profile.js?build=20260928-04",
  "./src/domain/feed/nutrition-selection.js?build=20260928-04",
  "./src/domain/feed/ration-allocation.js?build=20261007-03",
  "./src/domain/feed/ration-contract.js?build=20261005-02",
  "./src/domain/feed/ration-diagnostics.js?build=20261005-03",
  "./src/domain/feed/requirement-ration-comparison.js",
  "./src/domain/feed/requirement-ration-comparison.js?build=20261007-08",
  "./src/storage/farm-repository.js?build=20261010-01",
  "./src/storage/legacy-claim.js?build=20261010-03",
  "./src/storage/local-db.js?build=20260928-02",
  "./src/storage/local-db.js?build=20261010-01",
  "./src/storage/recovery-preflight.js?build=20260927-02",
  "./src/sync/sync-engine.js?build=20261010-03"
];
const allowed = new Set(ASSETS.map((asset) => new URL(asset, self.registration.scope).href));
const offlinePage = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(PREFIX) && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const navigation = request.mode === "navigate";
  if (!navigation && !allowed.has(url.href)) return;

  event.respondWith(fetch(request).then((response) => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (navigation) return caches.match(offlinePage);
    return Response.error();
  }));
});
