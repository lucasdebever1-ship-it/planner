const CACHE = 'struct-cache-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/overzicht.html',
  '/week.html',
  '/vakken.html',
  '/instellingen.html',
  '/onboarding.html',
  '/afspraken.html',
  '/profiel.html',
  '/manifest.json',
  '/icon.svg',
  '/terugblik.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
      return cached || network;
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lijst => {
      const match = lijst.find(c => new URL(c.url).pathname.match(/\/(index\.html)?$/));
      return match ? match.focus() : clients.openWindow('/index.html');
    })
  );
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'struct-notificaties') {
    event.waitUntil(toonAchtergrondNotificaties());
  }
});

async function toonAchtergrondNotificaties() {
  try {
    const cache = await caches.open('struct-notif-v1');
    const res = await cache.match('/notif-queue');
    if (!res) return;
    const queue = await res.json();
    if (!Array.isArray(queue) || !queue.length) return;
    for (const n of queue) {
      await self.registration.showNotification(n.titel, {
        body: n.body || '', icon: '/icon.svg', tag: n.tag, badge: '/icon.svg'
      });
    }
    await cache.put('/notif-queue', new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
  } catch (_) {}
}
