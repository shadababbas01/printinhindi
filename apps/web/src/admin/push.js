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
  await navigator.serviceWorker.ready;
  onStep('Service worker ready.');

  onStep('Subscribing to push…');
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  });
  onStep('Subscribed. Saving to server…');

  await adminApi.subscribePush(subscription.toJSON());
  onStep('Saved. Enabled.');
  return subscription;
}

export async function disablePush() {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  await adminApi.unsubscribePush(subscription.endpoint).catch(() => {});
}
