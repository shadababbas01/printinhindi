import { auth } from '../auth/session.js';

// Login modal with three paths:
//  - Email link: a sign-in LINK (click it, no code to type). auth.onChange()
//    picks it up automatically same-device (same-tab redirect, or cross-tab
//    storage sync) — but a link opened on a different device/browser has no
//    shared storage to sync from, so an explicit "I've signed in — Continue"
//    button re-checks the session on demand as a manual fallback.
//  - Mobile: a typed OTP CODE over SMS, for when email delivery is down/slow
//    (phone auth has no clickable-link option in Supabase).
//  - Password: create an id/password once (one confirmation email, same as
//    any signup), then log in with just email+password forever after — no
//    further email/SMS round-trip, so it isn't subject to the auth email
//    provider's rate limit the way the link/OTP paths are.
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
        <button id="authTabPassword" class="btn btn-primary flex-1" type="button">आईडी/पासवर्ड / ID &amp; Password</button>
        <button id="authTabEmail" class="btn btn-secondary flex-1" type="button">ईमेल लिंक / Email link</button>
        <button id="authTabPhone" class="btn btn-secondary flex-1" type="button">मोबाइल / Mobile</button>
      </div>

      <div id="authPasswordPanel">
        <div class="flex gap-2 mb-3">
          <button id="authPwModeLogin" class="btn btn-primary flex-1" type="button">लॉगिन / Log in</button>
          <button id="authPwModeSignup" class="btn btn-secondary flex-1" type="button">नया खाता / Sign up</button>
        </div>
        <label class="field-label block mb-1">ईमेल / Email</label>
        <input id="authPwEmail" type="email" class="field-input mb-3" placeholder="you@example.com" />
        <label class="field-label block mb-1">पासवर्ड / Password</label>
        <input id="authPwPassword" type="password" class="field-input mb-3" placeholder="••••••••" />
        <div id="authPwConfirmWrap" class="hidden">
          <label class="field-label block mb-1">पासवर्ड दोबारा लिखें / Confirm password</label>
          <input id="authPwConfirm" type="password" class="field-input mb-3" placeholder="••••••••" />
        </div>
        <button id="authPwSubmitBtn" class="btn btn-primary w-full">लॉगिन करें / Log in</button>
        <p id="authPwSignupNotice" class="text-xs text-gray-500 mt-2 hidden">
          खाता बन गया — पुष्टि के लिए एक बार अपना ईमेल जाँचें, फिर हमेशा इसी आईडी/पासवर्ड से लॉगिन करें।<br/>
          Account created — check your email once to confirm it, then log in with this id/password from now on.
        </p>
      </div>

      <div id="authEmailPanel" class="hidden">
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

  // Wraps a button's click handler so it's visibly busy (disabled + "…"
  // appended) for the duration of the network call — every handler in this
  // modal does at least one, and without this a tap gave no feedback until
  // the request finished.
  function withBusy(btn, handler) {
    return async (...args) => {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = `${original} …`;
      try {
        await handler(...args);
      } finally {
        // If the modal is still around (didn't succeed()/close), restore
        // the button; if it did, overlay is gone and this is a no-op.
        if (document.body.contains(btn)) {
          btn.disabled = false;
          btn.textContent = original;
        }
      }
    };
  }

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

  const tabPassword = overlay.querySelector('#authTabPassword');
  const tabEmail = overlay.querySelector('#authTabEmail');
  const tabPhone = overlay.querySelector('#authTabPhone');
  const passwordPanel = overlay.querySelector('#authPasswordPanel');
  const emailPanel = overlay.querySelector('#authEmailPanel');
  const phonePanel = overlay.querySelector('#authPhonePanel');

  function setMode(mode) {
    tabPassword.className = `btn ${mode === 'password' ? 'btn-primary' : 'btn-secondary'} flex-1`;
    tabEmail.className = `btn ${mode === 'email' ? 'btn-primary' : 'btn-secondary'} flex-1`;
    tabPhone.className = `btn ${mode === 'phone' ? 'btn-primary' : 'btn-secondary'} flex-1`;
    passwordPanel.classList.toggle('hidden', mode !== 'password');
    emailPanel.classList.toggle('hidden', mode !== 'email');
    phonePanel.classList.toggle('hidden', mode !== 'phone');
    errorBox.classList.add('hidden');
  }
  tabPassword.addEventListener('click', () => setMode('password'));
  tabEmail.addEventListener('click', () => setMode('email'));
  tabPhone.addEventListener('click', () => setMode('phone'));

  // --- Password: log in or create an account ---
  const pwModeLoginBtn = overlay.querySelector('#authPwModeLogin');
  const pwModeSignupBtn = overlay.querySelector('#authPwModeSignup');
  const pwConfirmWrap = overlay.querySelector('#authPwConfirmWrap');
  const pwSubmitBtn = overlay.querySelector('#authPwSubmitBtn');
  const pwSignupNotice = overlay.querySelector('#authPwSignupNotice');
  let pwIsSignup = false;

  function setPwMode(isSignup) {
    pwIsSignup = isSignup;
    pwModeLoginBtn.className = `btn ${!isSignup ? 'btn-primary' : 'btn-secondary'} flex-1`;
    pwModeSignupBtn.className = `btn ${isSignup ? 'btn-primary' : 'btn-secondary'} flex-1`;
    pwConfirmWrap.classList.toggle('hidden', !isSignup);
    pwSubmitBtn.textContent = isSignup ? 'खाता बनाएँ / Create account' : 'लॉगिन करें / Log in';
    pwSignupNotice.classList.add('hidden');
    errorBox.classList.add('hidden');
  }
  pwModeLoginBtn.addEventListener('click', () => setPwMode(false));
  pwModeSignupBtn.addEventListener('click', () => setPwMode(true));

  pwSubmitBtn.addEventListener('click', withBusy(pwSubmitBtn, async () => {
    const email = overlay.querySelector('#authPwEmail').value.trim();
    const password = overlay.querySelector('#authPwPassword').value;
    if (!email || !password) return showError('कृपया ईमेल और पासवर्ड दर्ज करें / Enter email and password');

    if (pwIsSignup) {
      const confirm = overlay.querySelector('#authPwConfirm').value;
      if (password !== confirm) return showError('पासवर्ड मेल नहीं खाते / Passwords do not match');
      if (password.length < 6) return showError('पासवर्ड कम से कम 6 अक्षरों का हो / Password must be at least 6 characters');
      try {
        const result = await auth.signUpWithPassword(email, password);
        if (result.session) {
          // "Confirm email" is off in this project's Auth settings — signup
          // itself returns a session, so there's nothing left to wait on.
          succeed();
        } else {
          pwSignupNotice.classList.remove('hidden');
          errorBox.classList.add('hidden');
        }
      } catch (err) {
        showError(err.message || 'खाता बनाने में त्रुटि / Failed to create account');
      }
      return;
    }

    try {
      await auth.signInWithPassword(email, password);
      succeed();
    } catch (err) {
      showError(err.message || 'गलत ईमेल/पासवर्ड / Incorrect email or password');
    }
  }));

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
  const sendLinkBtn = overlay.querySelector('#authSendLinkBtn');
  const resendLinkBtn = overlay.querySelector('#authEmailResendBtn');
  sendLinkBtn.addEventListener('click', withBusy(sendLinkBtn, sendLink));
  resendLinkBtn.addEventListener('click', withBusy(resendLinkBtn, sendLink));

  const continueBtn = overlay.querySelector('#authEmailContinueBtn');
  continueBtn.addEventListener(
    'click',
    withBusy(continueBtn, async () => {
      const user = await auth.refreshSession();
      if (user) {
        succeed();
      } else {
        showError(
          'अभी साइन-इन नहीं हुआ — पहले ईमेल में लिंक पर क्लिक करें / Not signed in yet — click the link in your email first'
        );
      }
    })
  );

  // --- Mobile: OTP code ---
  let phone = '';
  const sendOtpBtn = overlay.querySelector('#authSendPhoneOtpBtn');
  sendOtpBtn.addEventListener(
    'click',
    withBusy(sendOtpBtn, async () => {
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
    })
  );

  const resendOtpBtn = overlay.querySelector('#authPhoneResendBtn');
  resendOtpBtn.addEventListener(
    'click',
    withBusy(resendOtpBtn, async () => {
      try {
        await auth.sendPhoneOtp(phone);
      } catch (err) {
        showError(err.message);
      }
    })
  );

  const verifyOtpBtn = overlay.querySelector('#authPhoneVerifyBtn');
  verifyOtpBtn.addEventListener(
    'click',
    withBusy(verifyOtpBtn, async () => {
      const code = overlay.querySelector('#authPhoneOtpInput').value.trim();
      if (!code) return showError('कृपया कोड दर्ज करें / Enter the code');
      try {
        await auth.verifyPhoneOtp(phone, code);
        succeed();
      } catch (err) {
        showError(err.message || 'गलत/समाप्त कोड / Invalid or expired code');
      }
    })
  );

  // Covers the email-link path (phone verify above already resolves directly,
  // but this also fires for it — succeed() is idempotent either way).
  const stopWatching = auth.onChange((state) => {
    if (state.user) succeed();
  });

  setPwMode(false);
  setMode('password');

  overlay.querySelector('#authCloseBtn').addEventListener('click', () => {
    stopWatching();
    overlay.remove();
  });
}
