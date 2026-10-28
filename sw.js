// Blink & Glow HQ service worker: lets the app install and open quickly.
// It only touches this site's own files. Business data (Supabase) is never cached here,
// so nothing private is stored by the worker.
const VERSION = 'bghq-v1';
const SHELL = ['/', '/index.html', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // never touch Supabase or CDNs
  // Always try the network first so a new release shows up straight away; fall back to the saved copy when offline.
  e.respondWith(fetch(req).then(res => {
    if (res && res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('/index.html'))));
});
