// The actual monetization gate (spec section 23), wired to real modules.
// This wraps whatever the original app's "Print Document" click handler
// does — it must run BEFORE openChecklistModal()/buildPrintDOM(), and must
// never itself inspect or transmit the document content.
import { auth } from '../auth/session.js';
import { billing } from './../billing/entitlement.js';
import { billingApi } from '../billing/api.js';
import { getInstallationId } from '../billing/device.js';
import { showLoginModal } from '../ui/login-ui.js';
import { showPagePaymentModal } from '../ui/page-payment-ui.js';
import { showDeviceLimitModal } from '../ui/device-limit-ui.js';

// A random id for "this loaded document in this browser session" — NEVER
// derived from the document's bytes, filename, or parsed content. Regenerate
// it whenever a genuinely different document is loaded so unlocks are
// scoped per-document, not shared across unrelated files.
let currentDocumentSessionKey = null;
export function setCurrentDocumentSessionKey(key) {
  currentDocumentSessionKey = key ?? crypto.randomUUID();
}
export function getCurrentDocumentSessionKey() {
  if (!currentDocumentSessionKey) currentDocumentSessionKey = crypto.randomUUID();
  return currentDocumentSessionKey;
}

/**
 * Call this from the existing "Print Document" button handler INSTEAD of
 * calling openChecklistModal() directly. On success it invokes
 * openChecklistModal itself so the existing print flow is unchanged.
 *
 * @param {{ hasDocumentLoaded: () => boolean, getPageCount?: () => number, showStatus: (msg: string, type: string) => void, openChecklistModal: () => void }} hooks
 *   Thin adapter into the existing app's own functions/state, so this module
 *   never needs to know the app's internal DOM structure.
 */
export async function gatePrintDocument(hooks) {
  if (!hooks.hasDocumentLoaded()) {
    hooks.showStatus('कृपया पहले फ़ाइल अपलोड करें / Please upload a file first', 'error');
    return;
  }

  const user = await auth.requireUser();
  if (!user) {
    showLoginModal({ onSuccess: () => gatePrintDocument(hooks) });
    return;
  }

  const clientUnlockKey = getCurrentDocumentSessionKey();
  const openPagePaymentModal = () =>
    showPagePaymentModal({
      pageCount: hooks.getPageCount?.() ?? 1,
      clientUnlockKey,
      onConfirmed: () => hooks.openChecklistModal(),
    });

  // Best-effort: if the backend entitlement system (credits/plan) is
  // configured and reachable, honor it. But NEVER let a backend error block
  // printing entirely — any failure here (network, misconfigured
  // Supabase/Worker, etc.) falls through to the pay-per-page flow below
  // instead of throwing.
  try {
    const entitlement = await billing.getEntitlement({ forceRefresh: true });

    if (entitlement.currentDeviceAllowed === false) {
      showDeviceLimitModal(entitlement);
      return;
    }

    try {
      await billingApi.registerDevice(getInstallationId(), navigator.userAgent.slice(0, 60));
    } catch (err) {
      if (err.status === 409) {
        showDeviceLimitModal(err.body);
        return;
      }
      throw err;
    }

    if (entitlement.unlimitedDocuments) {
      hooks.openChecklistModal();
      return;
    }

    const unlock = await billingApi.createUnlock(clientUnlockKey);
    if (unlock.allowed) {
      hooks.openChecklistModal();
      return;
    }
  } catch {
    // Backend unreachable/erroring, or no entitlement — either way, fall
    // through to the pay-per-page flow.
  }

  openPagePaymentModal();
}
