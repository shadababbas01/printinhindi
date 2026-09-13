// Vite entry module. Loaded via <script type="module"> at the bottom of
// index.html, AFTER the original app's own <script> has already run — so
// window.__registryHooks exists by the time this executes.
import { auth } from './auth/session.js';
import { gatePrintDocument, setCurrentDocumentSessionKey } from './registry/print-gate.js';
import { mountAccountWidget } from './ui/account-widget.js';

auth.init().then(() => {
  window.__registryHooks.onNewDocumentLoaded = () => setCurrentDocumentSessionKey();

  document.getElementById('printDocBtn').addEventListener('click', () => {
    gatePrintDocument(window.__registryHooks);
  });

  mountAccountWidget(document.getElementById('accountWidget'));
});
