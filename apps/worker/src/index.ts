import { handleMe, handleUpdateProfile } from './routes/me';
import { handlePlans } from './routes/plans';
import { handleEntitlement } from './routes/entitlements';
import { handleRegisterDevice, handleListDevices, handleDeleteDevice } from './routes/devices';
import { handleCreateOrder, handleOrderStatus } from './routes/payments';
import { handleCreateSubscription, handleCurrentSubscription, handleCancelSubscription } from './routes/subscriptions';
import { handleCreateUnlock, handleGetUnlock } from './routes/unlocks';
import { handlePaymentWebhook, handleSubscriptionWebhook } from './routes/webhooks';
import {
  handleCreateManualPayment,
  handleCreatePagePayment,
  handleListMyManualPayments,
  handleGetMyManualPayment,
} from './routes/manual-payments';
import {
  handleListManualPayments,
  handleApproveManualPayment,
  handleRejectManualPayment,
  handleAdminGrantEntitlement,
  handleAdminGrantCredits,
  handleAdminClearPlan,
  handleAdminGetEntitlement,
  handleAdminRevokeDevice,
  handleAdminSearchUser,
  handleAdminGetUnlockHistory,
  handleAdminPushSubscribe,
  handleAdminPushUnsubscribe,
  handleAdminPushTest,
} from './routes/admin';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CASHFREE_CLIENT_ID: string;
  CASHFREE_CLIENT_SECRET: string;
  CASHFREE_API_VERSION: string;
  CASHFREE_ENV: 'sandbox' | 'production';
  APP_BASE_URL: string;
  CORS_ALLOWED_ORIGIN: string;
  ADMIN_EMAIL_ALLOWLIST: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

function withCors(res: Response, origin: string): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = env.CORS_ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    try {
      let res: Response;

      // Webhooks are unauthenticated (Cashfree calls these directly) — they
      // verify the Cashfree signature themselves instead of a Supabase JWT.
      if (path === '/api/v1/webhooks/cashfree/payments' && request.method === 'POST') {
        res = await handlePaymentWebhook(env, request);
      } else if (path === '/api/v1/webhooks/cashfree/subscriptions' && request.method === 'POST') {
        res = await handleSubscriptionWebhook(env, request);
      } else if (path === '/api/v1/plans' && request.method === 'GET') {
        res = await handlePlans(env);
      } else if (path === '/api/v1/me' && request.method === 'GET') {
        res = await handleMe(env, request);
      } else if (path === '/api/v1/me/profile' && request.method === 'PATCH') {
        res = await handleUpdateProfile(env, request);
      } else if (path === '/api/v1/entitlement' && request.method === 'GET') {
        res = await handleEntitlement(env, request);
      } else if (path === '/api/v1/devices/register' && request.method === 'POST') {
        res = await handleRegisterDevice(env, request);
      } else if (path === '/api/v1/devices' && request.method === 'GET') {
        res = await handleListDevices(env, request);
      } else if (path.startsWith('/api/v1/devices/') && request.method === 'DELETE') {
        res = await handleDeleteDevice(env, request, path.split('/').pop()!);
      } else if (path === '/api/v1/payments/order' && request.method === 'POST') {
        res = await handleCreateOrder(env, request);
      } else if (path.startsWith('/api/v1/payments/order/') && path.endsWith('/status') && request.method === 'GET') {
        const orderId = path.split('/')[5];
        res = await handleOrderStatus(env, request, orderId);
      } else if (path === '/api/v1/subscriptions' && request.method === 'POST') {
        res = await handleCreateSubscription(env, request);
      } else if (path === '/api/v1/subscriptions/current' && request.method === 'GET') {
        res = await handleCurrentSubscription(env, request);
      } else if (path.startsWith('/api/v1/subscriptions/') && path.endsWith('/cancel') && request.method === 'POST') {
        const id = path.split('/')[4];
        res = await handleCancelSubscription(env, request, id);
      } else if (path === '/api/v1/unlocks' && request.method === 'POST') {
        res = await handleCreateUnlock(env, request);
      } else if (path.startsWith('/api/v1/unlocks/') && request.method === 'GET') {
        const key = decodeURIComponent(path.split('/').pop()!);
        res = await handleGetUnlock(env, request, key);
      } else if (path === '/api/v1/manual-payments' && request.method === 'POST') {
        res = await handleCreateManualPayment(env, request);
      } else if (path === '/api/v1/manual-payments/per-page' && request.method === 'POST') {
        res = await handleCreatePagePayment(env, request);
      } else if (path === '/api/v1/manual-payments/mine' && request.method === 'GET') {
        res = await handleListMyManualPayments(env, request);
      } else if (path.startsWith('/api/v1/manual-payments/') && request.method === 'GET') {
        const id = path.split('/').pop()!;
        res = await handleGetMyManualPayment(env, request, id);
      } else if (path === '/api/v1/admin/manual-payments' && request.method === 'GET') {
        res = await handleListManualPayments(env, request);
      } else if (path.startsWith('/api/v1/admin/manual-payments/') && path.endsWith('/approve') && request.method === 'POST') {
        const id = path.split('/')[5];
        res = await handleApproveManualPayment(env, request, id);
      } else if (path.startsWith('/api/v1/admin/manual-payments/') && path.endsWith('/reject') && request.method === 'POST') {
        const id = path.split('/')[5];
        res = await handleRejectManualPayment(env, request, id);
      } else if (path === '/api/v1/admin/entitlement/grant' && request.method === 'POST') {
        res = await handleAdminGrantEntitlement(env, request);
      } else if (path === '/api/v1/admin/credits/grant' && request.method === 'POST') {
        res = await handleAdminGrantCredits(env, request);
      } else if (path.startsWith('/api/v1/admin/entitlement/') && path.endsWith('/clear') && request.method === 'POST') {
        const userId = path.split('/')[5];
        res = await handleAdminClearPlan(env, request, userId);
      } else if (path.startsWith('/api/v1/admin/entitlement/') && request.method === 'GET') {
        const userId = path.split('/').pop()!;
        res = await handleAdminGetEntitlement(env, request, userId);
      } else if (path.startsWith('/api/v1/admin/devices/') && path.endsWith('/revoke') && request.method === 'POST') {
        const id = path.split('/')[5];
        res = await handleAdminRevokeDevice(env, request, id);
      } else if (path === '/api/v1/admin/users/search' && request.method === 'GET') {
        res = await handleAdminSearchUser(env, request);
      } else if (path.startsWith('/api/v1/admin/unlocks/') && request.method === 'GET') {
        const userId = path.split('/').pop()!;
        res = await handleAdminGetUnlockHistory(env, request, userId);
      } else if (path === '/api/v1/admin/push/subscribe' && request.method === 'POST') {
        res = await handleAdminPushSubscribe(env, request);
      } else if (path === '/api/v1/admin/push/unsubscribe' && request.method === 'POST') {
        res = await handleAdminPushUnsubscribe(env, request);
      } else if (path === '/api/v1/admin/push/test' && request.method === 'POST') {
        res = await handleAdminPushTest(env, request);
      } else {
        res = new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return withCors(res, origin);
    } catch (err: any) {
      // Never let a raw error (which could contain provider payloads or
      // internal details) leak to the client. Log server-side only.
      console.error('Unhandled Worker error:', err?.message || err);
      return withCors(
        new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
        origin
      );
    }
  },
};
