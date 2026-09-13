import { auth } from '../auth/session.js';
import { adminApi } from './api.js';
import { pushSupported, getExistingPushSubscription, enablePush, disablePush } from './push.js';

const $ = (id) => document.getElementById(id);

function fmtPaise(paise) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

async function loadManualPayments() {
  const table = $('manualPaymentsTable');
  table.textContent = 'Loading…';
  const status = $('manualPaymentsFilter').value;
  try {
    const { requests } = await adminApi.listManualPayments(status);
    if (!requests.length) {
      table.innerHTML = '<p class="text-sm text-gray-500">No requests.</p>';
      return;
    }
    table.innerHTML = `
      <table>
        <thead><tr><th>When</th><th>User</th><th>Plan</th><th>Amount</th><th>UTR</th><th>Note</th><th>Proof</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${requests
            .map(
              (r) => `
            <tr data-request-id="${r.id}">
              <td>${new Date(r.created_at).toLocaleString()}</td>
              <td>${r.user_email || r.user_id}</td>
              <td>${r.plan_id}${r.page_count ? ` (${r.page_count} pages)` : ''}</td>
              <td>${fmtPaise(r.amount_paise)}</td>
              <td class="font-mono">${r.utr_reference}</td>
              <td>${r.note || ''}</td>
              <td>${r.screenshot_base64 ? `<img src="${r.screenshot_base64}" alt="payment screenshot" style="max-width:80px;max-height:80px;border-radius:4px;cursor:pointer;" data-action="viewScreenshot" />` : ''}</td>
              <td><span class="pill pill-${r.status}">${r.status}</span></td>
              <td>
                ${
                  r.status === 'pending'
                    ? `<button class="btn btn-primary" data-action="approve">Approve</button>
                       <button class="btn btn-danger" data-action="reject">Reject</button>`
                    : (r.review_note || '')
                }
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
    table.querySelectorAll('img[data-action="viewScreenshot"]').forEach((img) => {
      // window.open() with a data: URL is blocked by some browsers'
      // popup/navigation policies — show it in a simple inline lightbox
      // instead of relying on that.
      img.addEventListener('click', () => {
        const lightbox = document.createElement('div');
        lightbox.style.cssText =
          'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out;';
        lightbox.innerHTML = `<img src="${img.src}" style="max-width:90vw;max-height:90vh;border-radius:8px;" />`;
        lightbox.addEventListener('click', () => lightbox.remove());
        document.body.appendChild(lightbox);
      });
    });
    table.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = row.dataset.requestId;
        btn.disabled = true;
        try {
          if (btn.dataset.action === 'approve') {
            await adminApi.approveManualPayment(id);
          } else {
            const note = prompt('Reason for rejection (optional)') || undefined;
            await adminApi.rejectManualPayment(id, note);
          }
          await loadManualPayments();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    table.innerHTML = `<p class="text-sm text-red-600">${err.message}</p>`;
  }
}

async function populatePlanSelect() {
  const select = $('grantPlanId');
  try {
    const { plans } = await adminApi.getPlans();
    select.innerHTML = plans
      // 'per_page_print' is never granted through this generic form — it's
      // approved per-request from the table above (page_count present).
      .filter((p) => p.billing_type !== 'free' && p.billing_type !== 'per_page')
      .map((p) => `<option value="${p.id}">${p.name} (${fmtPaise(p.amount_paise)})</option>`)
      .join('');
  } catch (err) {
    select.innerHTML = `<option value="">Failed to load plans</option>`;
  }
}

async function refreshPushButtons({ preserveStatus = false } = {}) {
  const enableBtn = $('pushEnableBtn');
  const disableBtn = $('pushDisableBtn');
  const status = $('pushStatus');

  if (!pushSupported()) {
    enableBtn.disabled = true;
    if (!preserveStatus) status.textContent = 'Not supported in this browser — on iPhone, add to Home Screen first (see above).';
    return;
  }
  const existing = await getExistingPushSubscription();
  enableBtn.classList.toggle('hidden', !!existing);
  disableBtn.classList.toggle('hidden', !existing);
  if (!preserveStatus) status.textContent = existing ? 'Enabled on this device.' : '';
}

// Formats any thrown value into something guaranteed non-empty. DOMException
// (what pushManager.subscribe() rejects with on WebKit) can have an EMPTY
// .message, so `err.message` alone can render as a blank-looking status that
// reads as "nothing happened" instead of the real failure it is.
function describeError(err) {
  const name = err?.name && err.name !== 'Error' ? err.name : null;
  const message = err?.message || '';
  if (name && message) return `${name}: ${message}`;
  return name || message || String(err);
}

function formatTestResults(results) {
  if (!results.length) return 'No devices are subscribed yet.';
  return results
    .map((r) => (r.ok ? `✅ delivered (HTTP ${r.status})` : `❌ HTTP ${r.status}${r.error ? ` — ${r.error}` : ''}${r.body ? ` — ${r.body}` : ''}`))
    .join(' | ');
}

function wirePushControls() {
  $('pushEnableBtn').addEventListener('click', async () => {
    const status = $('pushStatus');
    const log = [];
    const onStep = (msg) => {
      log.push(msg);
      status.textContent = log.join(' → ');
    };
    onStep('Enabling…');
    try {
      await enablePush(onStep);
      await refreshPushButtons({ preserveStatus: true });
      // Immediately prove the subscription actually landed and can receive a
      // real push — rather than trusting the client-side "subscribed"
      // state, which can be true even when the save to the server silently
      // didn't stick.
      onStep('Verifying with a real test push…');
      const { results } = await adminApi.testPush();
      onStep(formatTestResults(results));
    } catch (err) {
      onStep(`FAILED: ${describeError(err)}`);
    }
  });

  $('pushDisableBtn').addEventListener('click', async () => {
    const status = $('pushStatus');
    status.textContent = 'Disabling…';
    try {
      await disablePush();
      await refreshPushButtons();
    } catch (err) {
      status.textContent = describeError(err);
    }
  });

  $('pushTestBtn').addEventListener('click', async () => {
    const status = $('pushTestStatus');
    status.textContent = 'Sending…';
    try {
      const { results } = await adminApi.testPush();
      status.textContent = formatTestResults(results);
    } catch (err) {
      status.textContent = describeError(err);
    }
  });

  refreshPushButtons();
}

function wireForms() {
  $('manualPaymentsFilter').addEventListener('change', loadManualPayments);
  wirePushControls();

  $('grantSubmitBtn').addEventListener('click', async () => {
    const userId = $('grantUserId').value.trim();
    const planId = $('grantPlanId').value;
    const reason = $('grantReason').value.trim();
    const status = $('grantStatus');
    if (!userId || !planId) {
      status.textContent = 'User ID and plan are required.';
      return;
    }
    status.textContent = 'Granting…';
    try {
      await adminApi.grantEntitlement(userId, planId, reason);
      status.textContent = 'Granted.';
    } catch (err) {
      status.textContent = err.message;
    }
  });

  $('clearPlanSubmitBtn').addEventListener('click', async () => {
    const userId = $('clearPlanUserId').value.trim();
    const status = $('clearPlanStatus');
    if (!userId) {
      status.textContent = 'User ID is required.';
      return;
    }
    if (!confirm('Clear this user\'s current admin-granted plan? This cannot be undone.')) return;
    status.textContent = 'Clearing…';
    try {
      await adminApi.clearPlan(userId);
      status.textContent = 'Cleared.';
    } catch (err) {
      status.textContent = err.message;
    }
  });

  $('creditSubmitBtn').addEventListener('click', async () => {
    const userId = $('creditUserId').value.trim();
    const amount = parseInt($('creditAmount').value, 10);
    const reason = $('creditReason').value.trim();
    const status = $('creditStatus');
    if (!userId || !Number.isInteger(amount) || amount === 0) {
      status.textContent = 'User ID and a non-zero integer amount are required.';
      return;
    }
    status.textContent = 'Adjusting…';
    try {
      await adminApi.grantCredits(userId, amount, reason);
      status.textContent = 'Adjusted.';
    } catch (err) {
      status.textContent = err.message;
    }
  });

  $('unlockHistoryLoadBtn').addEventListener('click', async () => {
    const userId = $('unlockHistoryUserId').value.trim();
    const table = $('unlockHistoryTable');
    if (!userId) return;
    table.textContent = 'Loading…';
    try {
      const { unlocks } = await adminApi.getUnlockHistory(userId);
      table.innerHTML = unlocks.length
        ? `<table><thead><tr><th>When</th><th>Source</th><th>Valid until</th></tr></thead><tbody>` +
          unlocks
            .map(
              (u) =>
                `<tr><td>${new Date(u.unlocked_at).toLocaleString()}</td><td>${u.source}</td><td>${new Date(u.valid_until).toLocaleString()}</td></tr>`
            )
            .join('') +
          `</tbody></table>`
        : '<p class="text-sm text-gray-500">No document unlocks yet.</p>';
    } catch (err) {
      table.innerHTML = `<p class="text-sm text-red-600">${err.message}</p>`;
    }
  });

  $('lookupSubmitBtn').addEventListener('click', async () => {
    const userId = $('lookupUserId').value.trim();
    const result = $('lookupResult');
    if (!userId) return;
    result.textContent = 'Loading…';
    try {
      const entitlement = await adminApi.getEntitlement(userId);
      result.textContent = JSON.stringify(entitlement, null, 2);
    } catch (err) {
      result.textContent = err.message;
    }
  });

  $('searchSubmitBtn').addEventListener('click', async () => {
    const email = $('searchEmail').value.trim();
    const result = $('searchResult');
    if (!email) return;
    result.textContent = 'Searching…';
    try {
      const { users } = await adminApi.searchUserByEmail(email);
      result.innerHTML = users.length
        ? users.map((u) => `<div class="font-mono">${u.id} — ${u.email}</div>`).join('')
        : '<span class="text-gray-500">No match (or lookup unsupported on this project — see note above).</span>';
    } catch (err) {
      result.textContent = err.message;
    }
  });
}

async function boot() {
  await auth.init();

  const loginGate = $('adminLoginGate');
  const forbidden = $('adminForbidden');
  const app = $('adminApp');
  const whoAmI = $('adminWhoAmI');
  const logoutBtn = $('adminLogoutBtn');

  logoutBtn.addEventListener('click', async () => {
    await auth.logout();
  });

  // --- Auth tabs: ID/Password (default) vs. Email link ---
  const tabPassword = $('adminAuthTabPassword');
  const tabLink = $('adminAuthTabLink');
  const passwordPanel = $('adminAuthPasswordPanel');
  const linkPanel = $('adminAuthLinkPanel');
  function setAuthTab(mode) {
    tabPassword.className = `btn ${mode === 'password' ? 'btn-primary' : 'btn-secondary'} flex-1`;
    tabLink.className = `btn ${mode === 'link' ? 'btn-primary' : 'btn-secondary'} flex-1`;
    passwordPanel.classList.toggle('hidden', mode !== 'password');
    linkPanel.classList.toggle('hidden', mode !== 'link');
    $('adminLoginStatus').textContent = '';
  }
  tabPassword.addEventListener('click', () => setAuthTab('password'));
  tabLink.addEventListener('click', () => setAuthTab('link'));

  // --- ID/Password: log in only. Admin accounts are provisioned by adding
  // the email to ADMIN_EMAIL_ALLOWLIST, not by self-signup — the "Sign up"
  // option that exists on the main app's login modal is intentionally
  // omitted here.
  const pwSubmitBtn = $('adminPwSubmitBtn');

  pwSubmitBtn.addEventListener('click', async () => {
    const email = $('adminPwEmail').value.trim();
    const password = $('adminPwPassword').value;
    const statusEl = $('adminLoginStatus');
    if (!email || !password) {
      statusEl.textContent = 'Enter email and password.';
      return;
    }
    try {
      await auth.signInWithPassword(email, password);
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  $('adminLoginSendBtn').addEventListener('click', async () => {
    const email = $('adminLoginEmail').value.trim();
    const statusEl = $('adminLoginStatus');
    if (!email) return;
    try {
      // redirectTo is this same admin.html — clicking the link (same tab or
      // a different one) re-establishes a session here via detectSessionInUrl
      // or supabase-js's cross-tab session sync, then auth.onChange() below
      // re-renders once the user appears.
      await auth.sendMagicLink(email, window.location.href);
      statusEl.textContent =
        'Sign-in link sent — check your email and click it. This page usually continues automatically; if it ' +
        "doesn't (e.g. you opened the link on a different device), press \"I've signed in — Continue\" below.";
      $('adminLoginContinueBtn').classList.remove('hidden');
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  $('adminLoginContinueBtn').addEventListener('click', async () => {
    const statusEl = $('adminLoginStatus');
    const user = await auth.refreshSession();
    if (!user) statusEl.textContent = 'Not signed in yet — click the link in your email first.';
    // If signed in, the onChange listener below fires render() on its own.
  });

  // onAuthStateChange (which onChange wraps) also fires on token refresh, not
  // just sign-in — only re-render on an actual sign-in/sign-out transition,
  // so a routine refresh doesn't re-run render()/wireForms().
  let wasAuthenticated = !!auth.user;
  auth.onChange((state) => {
    if (!!state.user !== wasAuthenticated) render();
    wasAuthenticated = !!state.user;
  });

  async function render() {
    const user = await auth.requireUser();
    if (!user) {
      loginGate.classList.remove('hidden');
      forbidden.classList.add('hidden');
      app.classList.add('hidden');
      logoutBtn.classList.add('hidden');
      whoAmI.textContent = '';
      return;
    }
    whoAmI.textContent = user.email || '';
    logoutBtn.classList.remove('hidden');

    // Probe admin access with a cheap authenticated call — the server enforces
    // ADMIN_EMAIL_ALLOWLIST on every /admin/* route regardless of what this
    // page shows, so this is purely a UX gate, not the real security boundary.
    try {
      await adminApi.listManualPayments('pending');
      loginGate.classList.add('hidden');
      forbidden.classList.add('hidden');
      app.classList.remove('hidden');
      await Promise.all([loadManualPayments(), populatePlanSelect()]);
      wireForms();
    } catch (err) {
      loginGate.classList.add('hidden');
      if (err.status === 403) {
        forbidden.classList.remove('hidden');
        app.classList.add('hidden');
      } else {
        alert(err.message);
      }
    }
  }

  await render();
}

boot();
