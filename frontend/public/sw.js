// ── Service Worker — RosterChirp ───────────────────────────────────────────────
// Push notifications are handled via the standard W3C Push API (`push` event).
// The Firebase SDK is not initialised here — FCM delivers the payload via the
// standard push event and event.data.json() is sufficient to read it.
// Firebase SDK initialisation (for getToken) happens in the main thread (Chat.jsx),
// where the config is fetched at runtime from /api/push/firebase-config.

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_NAME = 'rosterchirp-v1';
const STATIC_ASSETS = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only intercept same-origin requests — never intercept cross-origin calls
  // (Firebase API, Google CDN, socket.io CDN, etc.) or specific local paths.
  // Intercepting cross-origin requests causes Firebase SDK calls to return
  // cached HTML, producing "unsupported MIME type" errors and breaking FCM.
  if (!url.startsWith(self.location.origin)) return;
  if (url.includes('/api/') || url.includes('/socket.io/') || url.includes('/manifest.json')) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Badge counter ─────────────────────────────────────────────────────────────
let badgeCount = 0;

function showRosterChirpNotification(data) {
  console.log('[SW] showRosterChirpNotification:', JSON.stringify(data));
  badgeCount++;
  if (self.navigator?.setAppBadge) self.navigator.setAppBadge(badgeCount).catch(() => {});

  return self.registration.showNotification(data.title || 'New Message', {
    body:    data.body || '',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192-maskable.png',
    data:    { url: data.url || '/' },
    tag:     data.groupId ? `rosterchirp-group-${data.groupId}` : 'rosterchirp-message',
    renotify: true,
    vibrate:  [200, 100, 200],
  });
}

// ── Push handler ──────────────────────────────────────────────────────────────
// Unified handler — always uses event.waitUntil so the mobile OS does not
// terminate the SW before the notification is shown. Parses event.data
// directly (fast, reliable) rather than delegating to the Firebase SDK's
// internal push listener, which can be killed before it finishes on Android.
self.addEventListener('push', (event) => {
  console.log('[SW] Push received, hasData:', !!event.data);

  event.waitUntil((async () => {
    try {
      let payload = null;

      if (event.data) {
        try {
          payload = event.data.json();
          console.log('[SW] Push data:', JSON.stringify({ notification: payload.notification, data: payload.data }));
        } catch (e) {
          console.warn('[SW] Push data not JSON:', e);
        }
      }

      if (payload) {
        const n = payload.notification || {};
        const d = payload.data         || {};
        await showRosterChirpNotification({
          title:   n.title   || d.title   || 'New Message',
          body:    n.body    || d.body    || '',
          url:     d.url     || '/',
          groupId: d.groupId || '',
        });
      } else {
        // Ghost push — keep SW alive and show a generic notification
        await self.registration.showNotification('RosterChirp', {
          body:  'You have a new message.',
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-192-maskable.png',
          tag:   'rosterchirp-fallback',
        });
      }
    } catch (e) {
      console.error('[SW] Push handler error:', e);
    }
  })());
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  badgeCount = 0;
  if (self.navigator?.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const url = event.notification.data?.url || '/';
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ── Badge control messages from main thread ───────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_BADGE') {
    badgeCount = 0;
    if (self.navigator?.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
  }
  if (event.data?.type === 'SET_BADGE') {
    badgeCount = event.data.count || 0;
    if (self.navigator?.setAppBadge) {
      if (badgeCount > 0) {
        self.navigator.setAppBadge(badgeCount).catch(() => {});
      } else {
        self.navigator.clearAppBadge().catch(() => {});
      }
    }
  }
});
