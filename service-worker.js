const CACHE_NAME = "ngombe-herdbook-shell-v15";
const ASSETS = [
  "./","./index.html","./manifest.json","./styles/app.css",
  "./src/main.js?build=20260921-04","./src/ui.js?build=20260921-04","./src/auth.js","./src/config.js",
  "./src/domain/farm-rules.js","./src/domain/validation.js",
  "./src/storage/local-db.js","./src/storage/farm-repository.js",
  "./src/cloud/supabase-adapter.js","./src/sync/sync-engine.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isAppShellRequest =
    event.request.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/service-worker.js") ||
    url.pathname.includes("/src/") ||
    url.pathname.includes("/styles/");

  if (!isAppShellRequest) return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        if (response.ok && event.request.method === "GET") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
