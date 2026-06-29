const CACHE = 'lp-v5';
const STATIC = ['/app.html', '/manifest.json', '/favicon.svg', '/supabase.min.js', '/faq/index.html', '/hjelp/index.html'];

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
  if (e.request.method !== 'GET') return;
  // Never intercept API calls
  if (url.hostname.includes('supabase') || url.hostname.includes('stripe') ||
      url.hostname.includes('nominatim') || url.hostname.includes('jsdelivr') ||
      url.hostname.includes('ipapi') || url.hostname.includes('ipinfo')) return;

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

  // Cache-first for same-origin static assets and fonts
  if (url.pathname.startsWith('/assets/') || url.pathname === '/supabase.min.js' ||
      url.pathname === '/manifest.json' || url.pathname === '/favicon.svg' ||
      url.hostname.includes('fonts.gstatic')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
  }
});

self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(data.title ?? 'Leieplattform', {
    body: data.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url ?? '/' },
    tag: data.tag ?? 'lp-notif',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url ?? '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(w => w.url.includes(self.location.origin));
    if (c) { c.focus(); return c.navigate(url); }
    return clients.openWindow(url);
  }));
});
