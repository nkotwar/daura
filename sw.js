/* TASC Connect service worker. Network first, so a new upload shows up on the next open; the saved copy is used only offline.
   Data always comes live from the server. */
importScripts('version.js');
const CACHE = 'daura-v' + APP_VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'version.js', 'core.js', 'auth.js', 'store.js', 'data.js', 'photos.js', 'form.js', 'place.js', 'visits.js', 'dashboard.js', 'staff.js', 'about.js', 'profile.js', 'admin.js', 'nav.js', 'main.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'cbi-emblem.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // server data, Google, CDN: straight to the network
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => { if (r.ok && !u.searchParams.has('t')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

/* Admin notifications: show them, and open the right screen when tapped. */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'TASC Connect', {
    body: d.body || '', tag: d.tag, data: { url: d.url || './' }, icon: 'icon-192.png', badge: 'icon-192.png'
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(w => w.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ deeplink: url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
