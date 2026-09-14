import { billingApi } from '../billing/api.js';
import { billing } from '../billing/entitlement.js';
import { gatePrintDocument } from '../registry/print-gate.js';

export async function showDeviceLimitModal(context) {
  const existing = document.getElementById('deviceLimitModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'deviceLimitModal';
  overlay.className = 'modal-overlay no-print';
  overlay.innerHTML = `
    <div class="modal-box text-sm">
      <h2 class="font-bold mb-2">आपकी device limit पूरी हो चुकी है / Device limit reached</h2>
      <div id="deviceLimitList" class="space-y-2 mb-3"></div>
      <button id="deviceLimitCloseBtn" class="btn btn-secondary w-full">बंद करें / Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#deviceLimitCloseBtn').addEventListener('click', () => overlay.remove());

  const { devices } = await billingApi.listDevices();
  const list = overlay.querySelector('#deviceLimitList');
  list.innerHTML = devices
    .filter((d) => !d.revoked_at)
    .map(
      (d) => `
      <div class="flex items-center justify-between border rounded p-2">
        <span>${d.display_name || d.installation_id.slice(0, 8)}</span>
        <button class="btn btn-secondary text-xs" data-device-id="${d.id}">Deactivate</button>
      </div>`
    )
    .join('');

  list.querySelectorAll('button[data-device-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'हटाया जा रहा है… / Removing…';
      try {
        await billingApi.deleteDevice(btn.dataset.deviceId);
        await billing.refreshEntitlement();
        overlay.remove();
        // The whole point of freeing a device slot is to let this print
        // proceed — re-run the gate instead of leaving the user to notice
        // the popup closed and tap Print again themselves.
        if (window.__registryHooks) gatePrintDocument(window.__registryHooks);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = originalText;
        alert(err.message || 'डिवाइस हटाने में त्रुटि / Failed to remove device — try again.');
      }
    });
  });
}
