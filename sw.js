/* Daura service worker: keeps the app shell available offline. Data always comes live from the server. */
importScripts('version.js');
const CACHE = 'daura-v' + APP_VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'version.js', 'core.js', 'auth.js', 'visits.js', 'profile.js', 'admin.js', 'main.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'cbi-emblem.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.searchParams.has('t')) return;   // server data + update checks go to the network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
