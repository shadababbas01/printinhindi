// A full-page loading overlay for the gap between tapping a CTA and the
// next screen actually appearing (a network round trip in between) — so the
// tap always gets immediate visual feedback instead of looking like nothing
// happened.
let overlay = null;

export function showLoadingOverlay(message = 'लोड हो रहा है… / Loading…') {
  hideLoadingOverlay();
  overlay = document.createElement('div');
  overlay.id = 'globalLoadingOverlay';
  overlay.className = 'no-print';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:10000;background:rgba(255,255,255,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;';
  overlay.innerHTML = `
    <div style="width:36px;height:36px;border:3px solid #e6e9f0;border-top-color:#4f46e5;border-radius:50%;animation:globalLoadingSpin 0.8s linear infinite;"></div>
    <p style="font-size:14px;color:#1e2433;margin:0;">${message}</p>
  `;
  if (!document.getElementById('globalLoadingSpinKeyframes')) {
    const style = document.createElement('style');
    style.id = 'globalLoadingSpinKeyframes';
    style.textContent = '@keyframes globalLoadingSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
  document.body.appendChild(overlay);
}

export function hideLoadingOverlay() {
  overlay?.remove();
  overlay = null;
}
