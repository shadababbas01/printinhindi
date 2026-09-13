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

export const adminApi = {
  getPlans: () => apiFetch('/api/v1/plans'),

  listManualPayments: (status = 'pending') => apiFetch(`/api/v1/admin/manual-payments?status=${status}`),
  approveManualPayment: (id, note) =>
    apiFetch(`/api/v1/admin/manual-payments/${id}/approve`, { method: 'POST', body: JSON.stringify({ note }) }),
  rejectManualPayment: (id, note) =>
    apiFetch(`/api/v1/admin/manual-payments/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),

  grantEntitlement: (userId, planId, reason) =>
    apiFetch('/api/v1/admin/entitlement/grant', { method: 'POST', body: JSON.stringify({ userId, planId, reason }) }),
  clearPlan: (userId) => apiFetch(`/api/v1/admin/entitlement/${userId}/clear`, { method: 'POST' }),
  grantCredits: (userId, amount, reason) =>
    apiFetch('/api/v1/admin/credits/grant', { method: 'POST', body: JSON.stringify({ userId, amount, reason }) }),
  getEntitlement: (userId) => apiFetch(`/api/v1/admin/entitlement/${userId}`),
  searchUserByEmail: (email) => apiFetch(`/api/v1/admin/users/search?email=${encodeURIComponent(email)}`),
  revokeDevice: (deviceId) => apiFetch(`/api/v1/admin/devices/${deviceId}/revoke`, { method: 'POST' }),

  getUnlockHistory: (userId) => apiFetch(`/api/v1/admin/unlocks/${userId}`),

  subscribePush: (subscription) =>
    apiFetch('/api/v1/admin/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) }),
  unsubscribePush: (endpoint) =>
    apiFetch('/api/v1/admin/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  testPush: () => apiFetch('/api/v1/admin/push/test', { method: 'POST' }),
};
