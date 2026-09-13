import { billing } from '../billing/entitlement.js';
import { startOneTimeCheckout, startSubscriptionCheckout } from '../billing/checkout.js';
import { showManualUpiModal } from './manual-payment-ui.js';

const RECOMMENDED_PLAN_ID = 'professional_annual';

function formatPrice(plan) {
  const rupees = (plan.amount_paise / 100).toLocaleString('en-IN');
  if (plan.billing_type === 'recurring') return `₹${rupees}/${plan.billing_interval}`;
  return `₹${rupees}`;
}

export async function showPricingModal({ reason } = {}) {
  const existing = document.getElementById('pricingModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pricingModal';
  overlay.className = 'modal-overlay no-print';
  overlay.innerHTML = `
    <div class="modal-box text-sm" style="max-width:640px;">
      <h2 class="font-bold mb-1">अनलिमिटेड रजिस्ट्री प्रिंटिंग / Unlock Registry Printing</h2>
      ${reason === 'no_entitlement' ? '<p class="text-orange-600 text-xs mb-3">आपके Document Credits समाप्त हो गए हैं / Your document credits are used up</p>' : ''}
      <div id="pricingPlanList" class="space-y-2 mb-3">लोड हो रहा है... / Loading...</div>
      <div id="pricingStatus" class="text-xs mt-2 hidden"></div>
      <button id="pricingCloseBtn" class="btn btn-secondary w-full mt-2">बंद करें / Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#pricingCloseBtn').addEventListener('click', () => overlay.remove());

  const plans = await billing.loadPlans();
  const list = overlay.querySelector('#pricingPlanList');
  list.innerHTML = plans
    // 'per_page_print' is priced per-page, not a flat amount — it's offered
    // directly from the print button (apps/web/src/ui/page-payment-ui.js),
    // not through this flat-price/Choose-button list.
    .filter((p) => p.billing_type !== 'free' && p.billing_type !== 'per_page')
    .map(
      (p) => `
      <div class="panel-section flex items-center justify-between">
        <div>
          <p class="font-semibold">${p.name}${p.id === RECOMMENDED_PLAN_ID ? ' <span class="text-[10px] text-white bg-purple-600 rounded px-1.5 py-0.5 align-middle">Best Value</span>' : ''}</p>
          <p class="text-xs text-gray-500">${p.description}</p>
        </div>
        <div class="text-right">
          <p class="font-bold">${formatPrice(p)}</p>
          <button class="btn btn-primary text-xs mt-1" data-plan-id="${p.id}" data-billing-type="${p.billing_type}">चुनें / Choose</button>
          <button class="btn btn-secondary text-xs mt-1 block" data-upi-plan-id="${p.id}">UPI QR से भुगतान करें</button>
        </div>
      </div>`
    )
    .join('');

  list.querySelectorAll('button[data-upi-plan-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = plans.find((p) => p.id === btn.dataset.upiPlanId);
      if (plan) showManualUpiModal(plan);
    });
  });

  const statusBox = overlay.querySelector('#pricingStatus');
  const setStatus = (msg) => {
    statusBox.textContent = msg;
    statusBox.classList.remove('hidden');
  };

  list.querySelectorAll('button[data-plan-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const planId = btn.dataset.planId;
      const billingType = btn.dataset.billingType;
      btn.disabled = true;
      try {
        if (billingType === 'recurring') {
          setStatus('UPI mandate confirmation लंबित है... / Waiting for mandate confirmation...');
          const status = await startSubscriptionCheckout(planId, { onStatus: setStatus });
          if (status === 'ACTIVE') {
            setStatus('सक्रिय! / Activated!');
            await billing.refreshEntitlement();
            setTimeout(() => overlay.remove(), 1200);
          } else {
            setStatus('सदस्यता सक्रिय नहीं हुई / Subscription did not activate. Try again.');
          }
        } else {
          setStatus('Payment verify किया जा रहा है… कृपया यह window बंद न करें। / Verifying payment…');
          const status = await startOneTimeCheckout(planId, { onStatus: setStatus });
          if (status === 'PAID') {
            setStatus('सफल! / Success!');
            await billing.refreshEntitlement();
            setTimeout(() => overlay.remove(), 1200);
          } else {
            setStatus('Payment पूरा नहीं हुआ / Payment did not complete. Try again.');
          }
        }
      } catch (err) {
        setStatus(err.message || 'त्रुटि / Error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}
