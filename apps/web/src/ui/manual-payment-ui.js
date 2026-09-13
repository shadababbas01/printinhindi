import { renderUpiQrDataUrl, upiPayeeId, upiPayeeName } from '../billing/upi-qr.js';
import { billingApi } from '../billing/api.js';
import { billing } from '../billing/entitlement.js';
import { pollPaymentStatus } from '../billing/payment-status-poll.js';
import { wireScreenshotInput } from './screenshot-input.js';

// Fallback/launch-phase purchase path: the customer pays a UPI QR directly
// and submits the reference number (+ optional screenshot) for manual admin
// review (see apps/worker/src/routes/admin.ts + admin.html). Nothing here
// grants access by itself — it only creates a 'pending' request row, then
// polls for the admin's decision so the user sees it resolve on its own.
export async function showManualUpiModal(plan) {
  const existing = document.getElementById('manualUpiModal');
  if (existing) existing.remove();

  const amountRupees = plan.amount_paise / 100;

  const overlay = document.createElement('div');
  overlay.id = 'manualUpiModal';
  overlay.className = 'modal-overlay no-print';
  overlay.innerHTML = `
    <div class="modal-box text-sm" style="max-width:420px;">
      <h2 class="font-bold mb-1">UPI से भुगतान करें / Pay via UPI</h2>
      <p class="text-xs text-gray-500 mb-3">${plan.name} — ₹${amountRupees.toLocaleString('en-IN')}</p>

      <div id="manualUpiStep1">
        <div class="flex flex-col items-center mb-3">
          <img id="manualUpiQrImg" alt="UPI QR" width="220" height="220" style="border-radius:8px;" />
          <p class="text-xs mt-2">${upiPayeeName} · <span class="font-mono">${upiPayeeId}</span></p>
        </div>
        <button id="manualUpiIHavePaidBtn" class="btn btn-primary w-full mb-2">मैंने भुगतान कर दिया है / I have paid</button>
        <button id="manualUpiCloseBtn1" class="btn btn-secondary w-full">बंद करें / Close</button>
      </div>

      <div id="manualUpiStep2" class="hidden">
        <label class="text-xs font-semibold block mb-1">UTR / Transaction ID *</label>
        <input id="manualUpiUtr" type="text" class="w-full border rounded px-2 py-1 text-sm mb-2" placeholder="e.g. 123456789012" />
        <label class="text-xs font-semibold block mb-1">भुगतान का स्क्रीनशॉट (वैकल्पिक) / Payment screenshot (optional)</label>
        <input id="manualUpiScreenshot" type="file" accept="image/*" class="w-full text-xs mb-2" />
        <div id="manualUpiStatus" class="text-xs mb-2 hidden"></div>
        <button id="manualUpiSubmitBtn" class="btn btn-primary w-full mb-2">सबमिट करें / Submit</button>
        <button id="manualUpiCloseBtn2" class="btn btn-secondary w-full">बंद करें / Close</button>
      </div>

      <div id="manualUpiStep3" class="hidden text-center">
        <div id="manualUpiPendingSpinner" class="text-2xl mb-2">⏳</div>
        <p id="manualUpiPendingText" class="text-sm mb-3">
          भुगतान की पुष्टि हो रही है... Admin आपका भुगतान जांच रहे हैं।<br/>
          Verifying payment... an admin is checking your payment.
        </p>
        <button id="manualUpiCloseBtn3" class="btn btn-secondary w-full">बंद करें / Close (still processes in background)</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  renderUpiQrDataUrl({ amountRupees, note: plan.id }).then((dataUrl) => {
    overlay.querySelector('#manualUpiQrImg').src = dataUrl;
  });

  const step1 = overlay.querySelector('#manualUpiStep1');
  const step2 = overlay.querySelector('#manualUpiStep2');
  const step3 = overlay.querySelector('#manualUpiStep3');
  const statusBox = overlay.querySelector('#manualUpiStatus');
  const setStatus = (msg) => {
    statusBox.textContent = msg;
    statusBox.classList.remove('hidden');
  };

  let stopPolling = null;
  const cleanup = () => {
    stopPolling?.();
    overlay.remove();
  };
  overlay.querySelector('#manualUpiCloseBtn1').addEventListener('click', cleanup);
  overlay.querySelector('#manualUpiCloseBtn2').addEventListener('click', cleanup);
  overlay.querySelector('#manualUpiCloseBtn3').addEventListener('click', cleanup);

  overlay.querySelector('#manualUpiIHavePaidBtn').addEventListener('click', () => {
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
  });

  let screenshotBase64 = null;
  wireScreenshotInput(overlay.querySelector('#manualUpiScreenshot'), (dataUrl) => {
    screenshotBase64 = dataUrl;
  });

  overlay.querySelector('#manualUpiSubmitBtn').addEventListener('click', async () => {
    const utr = overlay.querySelector('#manualUpiUtr').value.trim();
    if (!utr) {
      setStatus('कृपया UTR/Transaction ID डालें / Please enter the UTR/Transaction ID');
      return;
    }
    const btn = overlay.querySelector('#manualUpiSubmitBtn');
    btn.disabled = true;
    try {
      const { request } = await billingApi.submitManualPayment(plan.id, utr, undefined, screenshotBase64);

      step2.classList.add('hidden');
      step3.classList.remove('hidden');

      stopPolling = pollPaymentStatus(request.id, {
        onApproved: async () => {
          overlay.querySelector('#manualUpiPendingSpinner').textContent = '✅';
          overlay.querySelector('#manualUpiPendingText').innerHTML =
            'भुगतान सत्यापित ✅ — आपका plan सक्रिय हो गया है।<br/>Payment Verified ✅ — your plan is now active.';
          await billing.refreshEntitlement();
          setTimeout(() => overlay.remove(), 1800);
        },
        onRejected: (req) => {
          overlay.querySelector('#manualUpiPendingSpinner').textContent = '❌';
          overlay.querySelector('#manualUpiPendingText').innerHTML =
            `भुगतान अस्वीकृत / Payment rejected${req.review_note ? `: ${req.review_note}` : ''}`;
        },
        onTimeout: () => {
          overlay.querySelector('#manualUpiPendingText').innerHTML =
            'अभी भी pending है — बाद में फिर से जांचें।<br/>Still pending — check back later.';
        },
      });
    } catch (err) {
      setStatus(err.message || 'त्रुटि / Error — try again');
      btn.disabled = false;
    }
  });
}
