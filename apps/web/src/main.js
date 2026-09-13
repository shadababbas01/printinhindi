// Vite entry module. Loaded via <script type="module"> at the bottom of
// index.html, AFTER the original app's own <script> has already run — so
// window.__registryHooks exists by the time this executes.
import { auth } from './auth/session.js';
import { gatePrintDocument, setCurrentDocumentSessionKey } from './registry/print-gate.js';

auth.init().then(() => {
  window.__registryHooks.onNewDocumentLoaded = () => setCurrentDocumentSessionKey();

  document.getElementById('printDocBtn').addEventListener('click', () => {
    gatePrintDocument(window.__registryHooks);
  });
});

// TODO (Phase 6, spec section 5): mount the logged-out/trial/Professional/
// Business header states here once the header markup grows account-aware
// slots. For now the print button gate above is the functional core of the
// monetization flow end-to-end.
