// Service worker: guarda la "cáscara" de la app para que abra rápido. Los datos siempre vienen del servidor.
const VERSION = 'mnr-v1.1.0';
const CASCARA = ['./', 'index.html', 'manifest.webmanifest', 'js/config.js', 'js/plataforma.js', 'js/core.js', 'js/app.js', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CASCARA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Supabase, IA y CDN: siempre por red
  // red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); return r; }).catch(() => caches.match(e.request)));
});
