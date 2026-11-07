const CACHE_NAME = "reequiz-offline-v21";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/reequiz-icon.svg"];

async function assetsForOffline() {
  // The Vite manifest includes dynamic imports (PDF parser) and the PDF
  // worker as an emitted asset; the OCR manifest includes every local
  // Tesseract WASM/worker/language file copied during install/build.
  const [viteResponse, ocrResponse] = await Promise.all([
    fetch("/offline-manifest.json", { cache: "no-store" }),
    fetch("/ocr/precache.json", { cache: "no-store" })
  ]);
  if (!viteResponse.ok || !ocrResponse.ok) {
    throw new Error("Offline asset manifests missing; run npm run build before deploying.");
  }
  const vite = await viteResponse.json();
  const ocr = await ocrResponse.json();
  const paths = new Set(["/offline-manifest.json", "/ocr/precache.json"]);
  for (const item of Object.values(vite)) {
    for (const file of [item.file, ...(item.css || []), ...(item.assets || [])]) {
      if (typeof file === "string" && !file.startsWith("http")) paths.add("/" + file.replace(/^\//, ""));
    }
  }
  for (const file of ocr) paths.add(file);
  return [...paths];
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const assets = await assetsForOffline();
    // Fail installation rather than advertise an offline-capable PWA with
    // missing OCR models or PDF workers. Old SW stays available on failure.
    for (const asset of assets) {
      await cache.add(new Request(asset, { cache: "reload" }));
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
          const cachedCopy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, cachedCopy)));
        }
        return response;
      });
    })
  );
});
