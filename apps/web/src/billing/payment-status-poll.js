import { billingApi } from './api.js';

// Polls a submitted manual-payment request's status so the UI can notice an
// admin's approval/rejection on its own, instead of the user needing to
// come back and check manually. Stops on the first terminal status or after
// timeoutMs (whichever comes first) — the caller decides what "timeout"
// means for its own UI (e.g. "still pending, check back later").
export function pollPaymentStatus(requestId, { onApproved, onRejected, onTimeout, intervalMs = 4000, timeoutMs = 10 * 60 * 1000 } = {}) {
  const start = Date.now();
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const { request } = await billingApi.getManualPaymentStatus(requestId);
      if (request.status === 'approved') {
        stopped = true;
        onApproved?.(request);
        return;
      }
      if (request.status === 'rejected') {
        stopped = true;
        onRejected?.(request);
        return;
      }
    } catch {
      // Transient network issue — just try again next tick rather than
      // giving up on the whole poll for one failed request.
    }
    if (Date.now() - start > timeoutMs) {
      stopped = true;
      onTimeout?.();
      return;
    }
    timer = setTimeout(tick, intervalMs);
  }

  tick();

  return function stopPolling() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
