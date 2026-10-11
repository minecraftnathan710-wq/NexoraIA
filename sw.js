// Service Worker do NEXORA AI. Faz cache só de arquivos estáticos públicos da interface.
// Nunca cacheia /api/* (conversas, buscas, credenciais) nem dados do usuário (ficam no IndexedDB).
const VERSION = 'nexora-v1';
const SHELL = ['/', '/index.html', '/offline.html', '/styles.css', '/manifest.webmanifest',
  '/js/app.js', '/js/db.js', '/js/ai.js', '/js/voice.js', '/js/face.js', '/js/tools.js', '/js/util.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/offline.html'))));
    return;
  }
  // modelos faciais (grandes) e demais estáticos: cache-first com atualização em segundo plano
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
