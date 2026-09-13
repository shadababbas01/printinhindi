import { supabase } from './supabase.js';

// Supabase phone auth requires E.164 (+<country code><number>). This app's
// target market is India-first (spec section: "Target market: India-first"),
// so a bare 10-digit number is assumed to be Indian and gets a +91 prefix
// rather than making every user type a country code.
export function normalizeIndianPhone(raw) {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`; // best-effort fallback for other lengths/countries
}

export const auth = {
  user: null,
  session: null,
  loading: true,
  _listeners: new Set(),

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  _notify() {
    for (const fn of this._listeners) fn(this);
  },

  async init() {
    const { data } = await supabase.auth.getSession();
    this.session = data.session;
    this.user = data.session?.user ?? null;
    this.loading = false;
    this._notify();

    supabase.auth.onAuthStateChange((_event, session) => {
      this.session = session;
      this.user = session?.user ?? null;
      this._notify();
    });
  },

  // Sends a sign-in link (not a typed code) to `email`. Clicking it redirects
  // to `redirectTo` (defaults to the current page) with a session already
  // established — supabase-js picks it up via detectSessionInUrl on load, or
  // via cross-tab storage sync if the link is opened in a different tab,
  // either of which fires onAuthStateChange and this module's onChange().
  async sendMagicLink(email, redirectTo = window.location.href) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  },

  // Creates the account and sends Supabase's one-time email confirmation link.
  // After the user clicks that link once, the account is confirmed and every
  // future login can use signInWithPassword() below — no more email
  // dependency at all. Requires "Confirm email" to stay enabled in Supabase
  // Auth settings; if it's off, the account is usable immediately.
  async signUpWithPassword(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },

  // Ordinary password login — works the moment the account is confirmed,
  // with no email/SMS round-trip and no rate limit tied to the auth email
  // provider.
  async signInWithPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.session = data.session;
    this.user = data.session?.user ?? null;
    this._notify();
    return data;
  },

  // Fallback path for when email delivery is down/slow — a typed OTP code
  // over SMS (phone auth has no clickable-link option). Requires an SMS
  // provider (Twilio/MessageBird/Vonage/etc.)
  // configured in Supabase Auth settings; see docs/DEPLOYMENT.md.
  async sendPhoneOtp(rawPhone) {
    const phone = normalizeIndianPhone(rawPhone);
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
    return phone;
  },

  async verifyPhoneOtp(rawPhone, token) {
    const phone = normalizeIndianPhone(rawPhone);
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw error;
    this.session = data.session;
    this.user = data.session?.user ?? null;
    this._notify();
    return data;
  },

  // Re-reads the session from local storage on demand. Automatic detection
  // (onAuthStateChange / cross-tab storage sync) covers same-device cases,
  // but if the sign-in link was opened on a different device or in an
  // in-app browser with separate storage, nothing here will fire on its
  // own — this gives the UI a manual "I've signed in, continue" action to
  // force a re-check instead of leaving the user stuck waiting.
  async refreshSession() {
    const { data } = await supabase.auth.getSession();
    this.session = data.session;
    this.user = data.session?.user ?? null;
    this._notify();
    return this.user;
  },

  async logout() {
    await supabase.auth.signOut();
    this.session = null;
    this.user = null;
    this._notify();
  },

  async accessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },

  // Resolves once init() has settled; used by requireUser() below and by the
  // print-gate so a page-load-in-progress auth check doesn't race a click.
  async requireUser() {
    if (this.loading) {
      await new Promise((resolve) => {
        const off = this.onChange(() => {
          if (!this.loading) {
            off();
            resolve();
          }
        });
      });
    }
    if (this.user) return this.user;
    return null; // caller shows the login modal and re-invokes after success
  },
};
