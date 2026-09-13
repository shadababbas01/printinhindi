import { auth } from '../auth/session.js';

// Login modal with two paths:
//  - Email: a sign-in LINK (click it, no code to type). auth.onChange()
//    picks it up automatically same-device (same-tab redirect, or cross-tab
//    storage sync) — but a link opened on a different device/browser has no
//    shared storage to sync from, so an explicit "I've signed in — Continue"
//    button re-checks the session on demand as a manual fallback.
//  - Mobile: a typed OTP CODE over SMS, for when email delivery is down/slow
//    (phone auth has no clickable-link option in Supabase).
// Reuses the host app's existing `.modal-overlay` / `.modal-box` / `.btn`
// classes so it matches visually once mounted into the real page.
export function showLoginModal({ onSuccess } = {}) {
  const existing = document.getElementById('authModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'authModal';
  overlay.className = 'modal-overlay no-print';
  overlay.innerHTML = `
    <div class="modal-box text-sm">
      <h2 class="font-bold mb-3">लॉगिन करें / Login</h2>
      <div class="flex gap-2 mb-3">
        <button id="authTabEmail" class="btn btn-primary flex-1" type="button">ईमेल / Email</button>
        <button id="authTabPhone" class="btn btn-secondary flex-1" type="button">मोबाइल / Mobile</button>
      </div>

      <div id="authEmailPanel">
        <div id="authEmailStep1">
          <label class="field-label block mb-1">ईमेल / Email</label>
          <input id="authEmailInput" type="email" class="field-input mb-3" placeholder="you@example.com" />
          <button id="authSendLinkBtn" class="btn btn-primary w-full">साइन-इन लिंक भेजें / Send sign-in link</button>
        </div>
        <div id="authEmailStep2" class="hidden">
          <p class="text-gray-500 text-xs mb-2">
            साइन-इन लिंक भेजा गया <span id="authEmailEcho"></span> पर — अपना ईमेल खोलें और लिंक पर क्लिक करें। अगर यह
            विंडो अपने आप आगे न बढ़े (जैसे आपने लिंक किसी दूसरे डिवाइस/टैब पर खोला), तो यहाँ वापस आकर "जारी रखें" दबाएँ।<br/>
            Sign-in link sent to <span id="authEmailEcho2"></span> — open your email and click the link. If this
            window doesn't continue on its own (e.g. you opened the link on a different device/tab), come back here
            and press "Continue".
          </p>
          <button id="authEmailContinueBtn" class="btn btn-primary w-full mb-2">साइन-इन कर लिया — जारी रखें / I've signed in — Continue</button>
          <button id="authEmailResendBtn" class="btn btn-ghost w-full">फिर भेजें / Resend</button>
        </div>
      </div>

      <div id="authPhonePanel" class="hidden">
        <div id="authPhoneStep1">
          <label class="field-label block mb-1">मोबाइल नंबर / Mobile Number</label>
          <input id="authPhoneInput" type="tel" class="field-input mb-3" placeholder="10-digit mobile number" />
          <p class="text-xs text-gray-500 mb-3">ईमेल काम न करे तो इसका उपयोग करें / Use this if email isn't working</p>
          <button id="authSendPhoneOtpBtn" class="btn btn-primary w-full">OTP भेजें / Send OTP</button>
        </div>
        <div id="authPhoneStep2" class="hidden">
          <p class="text-gray-500 text-xs mb-2">कोड भेजा गया / Code sent to <span id="authPhoneEcho"></span></p>
          <input id="authPhoneOtpInput" type="text" inputmode="numeric" class="field-input mb-3" placeholder="6-digit code" />
          <button id="authPhoneVerifyBtn" class="btn btn-primary w-full mb-2">सत्यापित करें / Verify</button>
          <button id="authPhoneResendBtn" class="btn btn-ghost w-full">फिर भेजें / Resend</button>
        </div>
      </div>

      <div id="authError" class="text-red-600 text-xs mt-2 hidden"></div>
      <button id="authCloseBtn" class="btn btn-secondary w-full mt-3">बंद करें / Close</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const errorBox = overlay.querySelector('#authError');
  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  };

  // Both the phone-verify handler and the email-link onChange watcher can
  // resolve login — guard so onSuccess only ever fires once.
  let resolved = false;
  const succeed = () => {
    if (resolved) return;
    resolved = true;
    stopWatching();
    overlay.remove();
    onSuccess?.();
  };

  const tabEmail = overlay.querySelector('#authTabEmail');
  const tabPhone = overlay.querySelector('#authTabPhone');
  const emailPanel = overlay.querySelector('#authEmailPanel');
  const phonePanel = overlay.querySelector('#authPhonePanel');

  function setMode(mode) {
    const isEmail = mode === 'email';
    tabEmail.className = `btn ${isEmail ? 'btn-primary' : 'btn-secondary'} flex-1`;
    tabPhone.className = `btn ${!isEmail ? 'btn-primary' : 'btn-secondary'} flex-1`;
    emailPanel.classList.toggle('hidden', !isEmail);
    phonePanel.classList.toggle('hidden', isEmail);
    errorBox.classList.add('hidden');
  }
  tabEmail.addEventListener('click', () => setMode('email'));
  tabPhone.addEventListener('click', () => setMode('phone'));

  // --- Email: sign-in link ---
  const sendLink = async () => {
    const email = overlay.querySelector('#authEmailInput').value.trim();
    if (!email) return showError('कृपया ईमेल दर्ज करें / Enter an email address');
    try {
      await auth.sendMagicLink(email, window.location.href);
      overlay.querySelector('#authEmailStep1').classList.add('hidden');
      overlay.querySelector('#authEmailStep2').classList.remove('hidden');
      overlay.querySelector('#authEmailEcho').textContent = email;
      overlay.querySelector('#authEmailEcho2').textContent = email;
      errorBox.classList.add('hidden');
    } catch (err) {
      showError(err.message || 'लिंक भेजने में त्रुटि / Failed to send link');
    }
  };
  overlay.querySelector('#authSendLinkBtn').addEventListener('click', sendLink);
  overlay.querySelector('#authEmailResendBtn').addEventListener('click', sendLink);

  overlay.querySelector('#authEmailContinueBtn').addEventListener('click', async () => {
    const user = await auth.refreshSession();
    if (user) {
      succeed();
    } else {
      showError(
        'अभी साइन-इन नहीं हुआ — पहले ईमेल में लिंक पर क्लिक करें / Not signed in yet — click the link in your email first'
      );
    }
  });

  // --- Mobile: OTP code ---
  let phone = '';
  overlay.querySelector('#authSendPhoneOtpBtn').addEventListener('click', async () => {
    const raw = overlay.querySelector('#authPhoneInput').value.trim();
    if (!raw) return showError('कृपया मोबाइल नंबर दर्ज करें / Enter a mobile number');
    try {
      phone = await auth.sendPhoneOtp(raw);
      overlay.querySelector('#authPhoneStep1').classList.add('hidden');
      overlay.querySelector('#authPhoneStep2').classList.remove('hidden');
      overlay.querySelector('#authPhoneEcho').textContent = phone;
      errorBox.classList.add('hidden');
    } catch (err) {
      showError(err.message || 'OTP भेजने में त्रुटि / Failed to send OTP');
    }
  });

  overlay.querySelector('#authPhoneResendBtn').addEventListener('click', async () => {
    try {
      await auth.sendPhoneOtp(phone);
    } catch (err) {
      showError(err.message);
    }
  });

  overlay.querySelector('#authPhoneVerifyBtn').addEventListener('click', async () => {
    const code = overlay.querySelector('#authPhoneOtpInput').value.trim();
    if (!code) return showError('कृपया कोड दर्ज करें / Enter the code');
    try {
      await auth.verifyPhoneOtp(phone, code);
      succeed();
    } catch (err) {
      showError(err.message || 'गलत/समाप्त कोड / Invalid or expired code');
    }
  });

  // Covers the email-link path (phone verify above already resolves directly,
  // but this also fires for it — succeed() is idempotent either way).
  const stopWatching = auth.onChange((state) => {
    if (state.user) succeed();
  });

  overlay.querySelector('#authCloseBtn').addEventListener('click', () => {
    stopWatching();
    overlay.remove();
  });
}
