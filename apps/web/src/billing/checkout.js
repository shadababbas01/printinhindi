import { billingApi } from './api.js';

// Cashfree's hosted-checkout JS SDK. Loaded lazily so it never blocks the
// document-editing experience for users who never open the pricing modal.
let cashfreeSdkPromise = null;
function loadCashfreeSdk() {
  if (cashfreeSdkPromise) return cashfreeSdkPromise;
  cashfreeSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.onload = () => resolve(window.Cashfree);
    script.onerror = () => reject(new Error('Failed to load Cashfree SDK'));
    document.head.appendChild(script);
  });
  return cashfreeSdkPromise;
}

const CASHFREE_MODE = import.meta.env.VITE_CASHFREE_MODE || 'sandbox';

// One-time purchase (Flex, Professional Annual, Business Annual).
// Resolves once the "Verifying payment..." polling confirms a terminal
// status — but the ACTUAL entitlement grant already happened server-side via
// the webhook by the time this resolves 'PAID'; this function never grants
// anything itself.
export async function startOneTimeCheckout(planId, { onStatus } = {}) {
  const { orderId, paymentSessionId } = await billingApi.createOrder(planId);

  const Cashfree = await loadCashfreeSdk();
  const cashfree = Cashfree({ mode: CASHFREE_MODE });
  await cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });

  onStatus?.('verifying');
  return pollOrderStatus(orderId, onStatus);
}

async function pollOrderStatus(orderId, onStatus, { intervalMs = 2000, timeoutMs = 60000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status } = await billingApi.getOrderStatus(orderId);
    if (status === 'PAID' || status === 'FAILED' || status === 'EXPIRED') {
      onStatus?.(status.toLowerCase());
      return status;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  onStatus?.('timeout');
  return 'PENDING';
}

// Recurring subscription (Professional/Business Monthly).
export async function startSubscriptionCheckout(planId, { onStatus } = {}) {
  const { subscriptionId, subscriptionSessionId } = await billingApi.createSubscription(planId);

  const Cashfree = await loadCashfreeSdk();
  const cashfree = Cashfree({ mode: CASHFREE_MODE });
  await cashfree.subscriptionsCheckout({ subscriptionSessionId, redirectTarget: '_modal' });

  onStatus?.('verifying');
  return pollSubscriptionStatus(onStatus);
}

async function pollSubscriptionStatus(onStatus, { intervalMs = 2000, timeoutMs = 90000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { subscription } = await billingApi.getCurrentSubscription();
    if (subscription && (subscription.status === 'ACTIVE' || subscription.status === 'CANCELLED')) {
      onStatus?.(subscription.status.toLowerCase());
      return subscription.status;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  onStatus?.('timeout');
  return 'PENDING';
}
