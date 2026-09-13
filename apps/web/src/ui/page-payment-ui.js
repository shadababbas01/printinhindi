import { renderUpiQrDataUrl, upiPayeeId, upiPayeeName } from '../billing/upi-qr.js';
import { billingApi } from '../billing/api.js';
import { billing } from '../billing/entitlement.js';
import { pollPaymentStatus } from '../billing/payment-status-poll.js';
import { showPricingModal } from './pricing-ui.js';
import { wireScreenshotInput } from './screenshot-input.js';

// The simple "pay only for what you print" path: price = per-page rate
// (plans.id='per_page_print') × this document's page count, paid via UPI
// QR. The user submits a UTR/reference (+ optional screenshot) and an admin
// reviews it in /admin.html — this modal polls for that decision and
// continues printing automatically the moment it's approved, so the user
// never has to click Print again themselves.
export async function showPagePaymentModal({ pageCount, clientUnlockKey, onConfirmed }) {
  const existing = document.getElementById('pagePaymentModal');
  if (existing) existing.remove();

  let pricePerPageRupees = 10; // fallback if the plans API is unreachable too
  try {
    const plans = await billing.loadPlans();
    const perPagePlan = plans.find((p) => p.id === 'per_page_print');
    if (perPagePlan) pricePerPageRupees = perPagePlan.amount_paise / 100;
  } catch {
    // Backend unreachable — fall back to the default rate above rather than
    // blocking the whole modal on a price lookup.
  }
  const totalRupees = pricePerPageRupees * pageCount;

  const overlay = document.createElement('div');
  overlay.id = 'pagePaymentModal';
  overlay.className = 'modal-overlay no-print';
  overlay.innerHTML = `
    <div class="modal-box text-sm" style="max-width:420px;">
      <h2 class="font-bold mb-1">पेज के हिसाब से भुगतान करें / Pay per page</h2>
      <p class="text-xs text-gray-500 mb-3">
        इस दस्तावेज़ में ${pageCount} पृष्ठ हैं — ₹${pricePerPageRupees}/पृष्ठ × ${pageCount} = <strong>₹${totalRupees}</strong><br/>
        This document has ${pageCount} page(s) — ₹${pricePerPageRupees}/page × ${pageCount} = <strong>₹${totalRupees}</strong>
      </p>

      <div id="pagePayStep1">
        <div class="flex flex-col items-center mb-3">
          <img id="pagePaymentQrImg" alt="UPI QR" width="220" height="220" style="border-radius:8px;" />
          <p class="text-xs mt-2">${upiPayeeName} · <span class="font-mono">${upiPayeeId}</span></p>
        </div>
        <button id="pagePayIHavePaidBtn" class="btn btn-primary w-full mb-2">मैंने भुगतान कर दिया है / I have paid</button>
        <button id="pagePaymentOtherPlansBtn" class="btn btn-ghost w-full mb-2">अन्य योजनाएं देखें / See other plans</button>
      </div>

      <div id="pagePayStep2" class="hidden">
        <label class="text-xs font-semibold block mb-1">UTR / Transaction ID *</label>
        <input id="pagePaymentUtr" type="text" class="w-full border rounded px-2 py-1 text-sm mb-2" placeholder="e.g. 123456789012" />
        <label class="text-xs font-semibold block mb-1">भुगतान का स्क्रीनशॉट (वैकल्पिक) / Payment screenshot (optional)</label>
        <input id="pagePaymentScreenshot" type="file" accept="image/*" class="w-full text-xs mb-2" />
        <div id="pagePaymentStatus" class="text-xs mb-2 hidden"></div>
        <button id="pagePaymentSubmitBtn" class="btn btn-primary w-full mb-2">सबमिट करें / Submit</button>
        <button id="pagePaymentCloseBtn" class="btn btn-secondary w-full">बंद करें / Close</button>
      </div>

      <div id="pagePayStep3" class="hidden text-center">
        <div id="pagePayPendingSpinner" class="text-2xl mb-2">⏳</div>
        <p id="pagePayPendingText" class="text-sm mb-3">
          भुगतान की पुष्टि हो रही है... Admin आपका भुगतान जांच रहे हैं।<br/>
          Verifying payment... an admin is checking your payment.
        </p>
        <button id="pagePayCloseWhilePendingBtn" class="btn btn-secondary w-full">बंद करें / Close (still processes in background)</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  renderUpiQrDataUrl({ amountRupees: totalRupees, note: `pages:${pageCount}` }).then((dataUrl) => {
    overlay.querySelector('#pagePaymentQrImg').src = dataUrl;
  });

  const step1 = overlay.querySelector('#pagePayStep1');
  const step2 = overlay.querySelector('#pagePayStep2');
  const step3 = overlay.querySelector('#pagePayStep3');
  const statusBox = overlay.querySelector('#pagePaymentStatus');
  const setStatus = (msg) => {
    statusBox.textContent = msg;
    statusBox.classList.remove('hidden');
  };

  let stopPolling = null;
  const cleanup = () => {
    stopPolling?.();
    overlay.remove();
  };

  overlay.querySelector('#pagePaymentOtherPlansBtn').addEventListener('click', () => {
    cleanup();
    showPricingModal({ reason: 'no_entitlement' });
  });

  overlay.querySelector('#pagePayIHavePaidBtn').addEventListener('click', () => {
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
  });

  overlay.querySelector('#pagePaymentCloseBtn').addEventListener('click', cleanup);
  overlay.querySelector('#pagePayCloseWhilePendingBtn').addEventListener('click', cleanup);

  let screenshotBase64 = null;
  wireScreenshotInput(overlay.querySelector('#pagePaymentScreenshot'), (dataUrl) => {
    screenshotBase64 = dataUrl;
  });

  overlay.querySelector('#pagePaymentSubmitBtn').addEventListener('click', async () => {
    const utr = overlay.querySelector('#pagePaymentUtr').value.trim();
    if (!utr) {
      setStatus('कृपया UTR/Transaction ID डालें / Please enter the UTR/Transaction ID');
      return;
    }
    const btn = overlay.querySelector('#pagePaymentSubmitBtn');
    btn.disabled = true;
    try {
      const { request } = await billingApi.submitPagePayment(clientUnlockKey, pageCount, utr, undefined, screenshotBase64);

      step2.classList.add('hidden');
      step3.classList.remove('hidden');

      stopPolling = pollPaymentStatus(request.id, {
        onApproved: () => {
          overlay.querySelector('#pagePayPendingSpinner').textContent = '✅';
          overlay.querySelector('#pagePayPendingText').innerHTML =
            'भुगतान सत्यापित ✅ — प्रिंटिंग शुरू हो रही है...<br/>Payment Verified ✅ — starting print...';
          setTimeout(() => {
            overlay.remove();
            onConfirmed?.();
          }, 1200);
        },
        onRejected: (req) => {
          overlay.querySelector('#pagePayPendingSpinner').textContent = '❌';
          overlay.querySelector('#pagePayPendingText').innerHTML =
            `भुगतान अस्वीकृत / Payment rejected${req.review_note ? `: ${req.review_note}` : ''}`;
        },
        onTimeout: () => {
          overlay.querySelector('#pagePayPendingText').innerHTML =
            'अभी भी pending है — कृपया थोड़ी देर बाद फिर से Print दबाएँ।<br/>Still pending — please press Print again in a while.';
        },
      });
    } catch (err) {
      setStatus(err.message || 'त्रुटि / Error — try again');
      btn.disabled = false;
    }
  });
}
