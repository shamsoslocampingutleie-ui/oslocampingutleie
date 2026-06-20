const CACHE = 'lp-v1';
const STATIC = ['/app.html', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only cache same-origin GET requests, never API/Supabase calls
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('supabase') || url.hostname.includes('stripe') || url.hostname.includes('nominatim')) return;

  if (url.pathname === '/' || url.pathname === '/app.html') {
    // Network-first for HTML — always fresh
    e.respondWith(
      fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }).catch(() => caches.match('/app.html'))
    );
    return;
  }

  // Cache-first for static assets (fonts, images, CSS)
  if (url.pathname.startsWith('/assets/') || url.hostname.includes('fonts.gstatic') || url.hostname.includes('cdn.jsdelivr')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }))
    );
  }
});
