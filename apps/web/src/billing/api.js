import { auth } from '../auth/session.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function apiFetch(path, options = {}) {
  const token = await auth.accessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const billingApi = {
  getMe: () => apiFetch('/api/v1/me'),
  updateProfile: (patch) => apiFetch('/api/v1/me/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
  getPlans: () => apiFetch('/api/v1/plans'),
  getEntitlement: () => apiFetch('/api/v1/entitlement'),

  registerDevice: (installationId, displayName) =>
    apiFetch('/api/v1/devices/register', {
      method: 'POST',
      body: JSON.stringify({ installationId, displayName }),
    }),
  listDevices: () => apiFetch('/api/v1/devices'),
  deleteDevice: (deviceId) => apiFetch(`/api/v1/devices/${deviceId}`, { method: 'DELETE' }),

  createOrder: (planId) => apiFetch('/api/v1/payments/order', { method: 'POST', body: JSON.stringify({ planId }) }),
  getOrderStatus: (orderId) => apiFetch(`/api/v1/payments/order/${orderId}/status`),

  createSubscription: (planId) => apiFetch('/api/v1/subscriptions', { method: 'POST', body: JSON.stringify({ planId }) }),
  getCurrentSubscription: () => apiFetch('/api/v1/subscriptions/current'),
  cancelSubscription: (id) => apiFetch(`/api/v1/subscriptions/${id}/cancel`, { method: 'POST' }),

  createUnlock: (clientUnlockKey) =>
    apiFetch('/api/v1/unlocks', { method: 'POST', body: JSON.stringify({ clientUnlockKey }) }),
  getUnlock: (unlockKey) => apiFetch(`/api/v1/unlocks/${encodeURIComponent(unlockKey)}`),

  submitManualPayment: (planId, utrReference, note, screenshotBase64) =>
    apiFetch('/api/v1/manual-payments', {
      method: 'POST',
      body: JSON.stringify({ planId, utrReference, note, screenshotBase64 }),
    }),
  listMyManualPayments: () => apiFetch('/api/v1/manual-payments/mine'),
  getManualPaymentStatus: (requestId) => apiFetch(`/api/v1/manual-payments/${requestId}`),

  submitPagePayment: (clientUnlockKey, pageCount, utrReference, note, screenshotBase64) =>
    apiFetch('/api/v1/manual-payments/per-page', {
      method: 'POST',
      body: JSON.stringify({ clientUnlockKey, pageCount, utrReference, note, screenshotBase64 }),
    }),
};
