const CACHE_NAME = "ngombe-herdbook-shell-v4";
const ASSETS = [
  "./","./index.html","./manifest.json","./styles/app.css",
  "./src/main.js","./src/ui.js","./src/config.js",
  "./src/domain/farm-rules.js","./src/domain/validation.js",
  "./src/storage/local-db.js","./src/storage/farm-repository.js",
  "./src/cloud/supabase-adapter.js","./src/sync/sync-engine.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
