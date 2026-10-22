const CACHE_NAME = "reequiz-offline-v16";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/reequiz-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // Vite emits hashed JS/CSS filenames. Read the built HTML so those exact
    // files are cached on the first online visit too.
    const response = await fetch("/index.html", { cache: "no-cache" });
    if (response.ok) {
      const html = await response.text();
      const assets = new Set();
      for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        const path = match[1];
        if (path.startsWith("/") && !path.startsWith("//")) assets.add(path);
      }
      await Promise.all([...assets].map(async (path) => {
        try { await cache.add(path); } catch { /* optional asset; retry via fetch handler */ }
      }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("reequiz-offline-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          if (response && response.ok) {
            // Clone synchronously before the browser consumes the navigation response.
            const cachedCopy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", cachedCopy)));
          }
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          // Clone before returning the original response to the page.
          const cachedCopy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, cachedCopy)));
        }
        return response;
      });
    })
  );
});
