// Dedicated service worker for admin push notifications, registered at a
// narrow scope (this directory) so it never overlaps with the main app's
// own PWA service worker generated at the site root by vite-plugin-pwa.
//
// Every push sent here is a bare, unencrypted "wake up" ping (see
// apps/worker/src/services/push.ts) — there's no payload to read, so the
// notification text is fixed and the admin opens the panel to see what's
// actually pending.

// Activate immediately instead of sitting in "installed/waiting" until the
// next full page load — without this, navigator.serviceWorker.ready (which
// only resolves once a worker is ACTIVE) can hang indefinitely on a fresh
// registration, which is exactly the symptom of getting stuck on
// "Registering service worker…" and never reaching "Subscribing to push…".
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('नया भुगतान अनुरोध / New payment request', {
      body: 'समीक्षा के लिए admin panel खोलें / Open the admin panel to review it.',
      tag: 'payment-request',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('admin.html') && 'focus' in client) return client.focus();
      }
      return clients.openWindow('../admin.html');
    })
  );
});
