// Mode hors ligne : on garde une copie de l'appli dans le navigateur.
// Pense à changer VERSION à chaque mise à jour des fichiers.
const VERSION = 'fb-v7';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './icons/icon.svg',
  './js/app.js',
  './js/attributes.js',
  './js/model.js',
  './js/gdtf.js',
  './js/zip.js',
  './js/unzip.js',
  './js/color.js',
  './js/gdtf-import.js',
  './js/starters.js',
  './js/tester.js',
  './js/print.js',
  './js/storage.js',
];

self.addEventListener('install', e => {
  // cache: 'reload' : on prend les fichiers sur le serveur, pas une vieille copie du navigateur
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (pour avoir la dernière version), copie locale si pas de réseau.
// cache: 'no-cache' : le navigateur redemande toujours au serveur si le fichier a changé
// (GitHub Pages autorise sinon une copie de 10 minutes, ce qui retarde les mises à jour).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
