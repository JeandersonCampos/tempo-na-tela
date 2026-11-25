const scope = self.registration.scope;
const cachePrefix = "tempo-na-tela:" + scope + ":";
const cacheName = cachePrefix + "v17";
const home = new URL("./", scope).href;
const assets = ["./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./remote-control.js", "./qrcode.js", "./jsqr.js"]
  .map(path => new URL(path, scope).href);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([home, ...assets].map(url => new Request(url, { cache: "reload" })));
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(scope)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(home) || Response.error();
    }));
  } else if (assets.includes(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(request) || fetch(request);
    })());
  }
});
