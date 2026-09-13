import { adminApi } from './api.js';

const SW_SCOPE = `${import.meta.env.BASE_URL}admin-push/`;
const SW_URL = `${SW_SCOPE}push-sw.js`;

// Web Push wants the VAPID public key as a raw Uint8Array, not the
// base64url string it's stored/transmitted as.
function urlBase64ToUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    !!import.meta.env.VITE_VAPID_PUBLIC_KEY
  );
}

// `navigator.serviceWorker.ready` resolves for the registration that would
// control the CURRENT page (admin.html, scope '.../'), not necessarily our
// narrower '.../admin-push/' registration — awaiting it here was waiting on
// the wrong worker entirely, which is exactly how "Registering service
// worker…" could hang forever. Wait on THIS registration's own worker
// instead, with a hard timeout so it can never hang silently.
function waitForActive(reg, timeoutMs = 8000) {
  if (reg.active) return Promise.resolve(reg.active);
  const worker = reg.installing || reg.waiting;
  if (!worker) return Promise.reject(new Error('Registration has no installing/waiting/active worker.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for the service worker to activate (state: ${worker.state}).`)),
      timeoutMs
    );
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        clearTimeout(timer);
        resolve(worker);
      } else if (worker.state === 'redundant') {
        clearTimeout(timer);
        reject(new Error('Service worker became redundant before activating.'));
      }
    });
  });
}

export async function getExistingPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return reg ? reg.pushManager.getSubscription() : null;
}

// onStep(message) is called after each stage completes, so the caller can
// show a running log instead of one opaque "Enabling…" — iOS Safari's push
// stack has enough platform-specific failure points (Home Screen install
// required, permission state, subscribe rejecting) that pinpointing exactly
// where it stalls/fails matters more here than on desktop browsers.
export async function enablePush(onStep = () => {}) {
  if (!('Notification' in window)) {
    throw new Error(
      'Notifications API not available — on iPhone this only exists once the page is opened from an icon added to the Home Screen (Share → Add to Home Screen), not a regular Safari tab.'
    );
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push is not supported in this browser (requires iOS 16.4+ if on iPhone).');
  }
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) {
    throw new Error('VITE_VAPID_PUBLIC_KEY is missing from this build.');
  }

  if (Notification.permission === 'denied') {
    throw new Error(
      'Notifications are blocked for this app. On iPhone: Settings → the app name (under installed web apps) → Notifications → Allow.'
    );
  }

  onStep('Requesting notification permission…');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(`Permission was "${permission}", not granted.`);
  onStep('Permission granted.');

  onStep('Registering service worker…');
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  onStep(`Registered (state: ${(reg.installing || reg.waiting || reg.active)?.state ?? 'unknown'}). Waiting for it to activate…`);
  await waitForActive(reg);
  onStep('Service worker active.');

  onStep('Subscribing to push…');
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) {
    // Seen on some WebKit versions: subscribe() resolves but toJSON() comes
    // back without the encryption keys — there's nothing usable to save.
    throw new Error(`Subscription is missing encryption keys (got: ${JSON.stringify(json)}).`);
  }
  onStep('Subscribed. Saving to server…');

  await adminApi.subscribePush(json);
  onStep('Saved. Enabled.');
  return subscription;
}

export async function disablePush() {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  await adminApi.unsubscribePush(subscription.endpoint).catch(() => {});
}
