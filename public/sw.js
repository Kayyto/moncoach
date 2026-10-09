// Service worker de MonCoach : rend l'app installable (Chrome exige un service worker avec un
// gestionnaire « fetch ») et affiche la dernière page connue si on ouvre l'app sans réseau.
// Rien d'autre n'est mis en cache : les données (/api/...), les photos et la connexion passent
// toujours par le réseau.
const CACHE_NAME = 'moncoach-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.add('/')).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // le reste : réseau normal
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname !== '/') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // On ne garde que la vraie page (jamais une redirection vers la connexion)
        if (res.ok && !res.redirected && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('/', copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match('/').then((r) => r || Response.error()))
  );
});
