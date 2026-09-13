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
  return 'serviceWorker' in navigator && 'PushManager' in window && !!import.meta.env.VITE_VAPID_PUBLIC_KEY;
}

export async function getExistingPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  await navigator.serviceWorker.ready;

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  });

  await adminApi.subscribePush(subscription.toJSON());
  return subscription;
}

export async function disablePush() {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  await adminApi.unsubscribePush(subscription.endpoint).catch(() => {});
}
