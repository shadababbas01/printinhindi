// Supabase's email-confirmation link redirects back here with
// `#...type=signup...` in the URL hash (before supabase-js's own
// detectSessionInUrl parses and strips it) — capture that synchronously at
// script-load time, before anything async can clear it, so this tab can
// show a clear "verified" landing instead of silently reloading the normal
// app UI as if the click did nothing. The tab where the user originally
// started signing up picks up the new session on its own via supabase-js's
// cross-tab storage sync (see login-ui.js's auth.onChange watcher) and
// continues automatically — this banner is purely for the confirmation
// link's own tab, which the user can then close.
const cameFromEmailConfirmation = /type=signup/.test(window.location.hash);

export function showEmailVerifiedBannerIfApplicable(user) {
  if (!cameFromEmailConfirmation || !user) return;

  const banner = document.createElement('div');
  banner.className = 'no-print';
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9999;background:#065f46;color:#fff;padding:12px 16px;text-align:center;font-size:14px;';
  banner.innerHTML = `
    ✅ ईमेल सत्यापित हो गया / Email verified — अब आप इस टैब को बंद करके वापस उस टैब पर जाएँ जहाँ से आपने शुरू किया था।<br/>
    You can close this tab and return to where you started — it should continue on its own.
    <button id="emailVerifiedBannerClose" style="margin-left:12px;background:transparent;border:1px solid #fff;color:#fff;border-radius:6px;padding:2px 10px;cursor:pointer;">✕</button>
  `;
  document.body.prepend(banner);
  banner.querySelector('#emailVerifiedBannerClose').addEventListener('click', () => banner.remove());
}
