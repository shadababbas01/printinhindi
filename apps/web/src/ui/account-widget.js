import { auth } from '../auth/session.js';

// Small header widget: shows nothing while logged out (the print-gate modal
// is still the only login entry point), and "email + Logout" once logged in
// — the "one option to logout" the account flow needs, since a password
// session otherwise just sits open indefinitely.
export function mountAccountWidget(container) {
  function render() {
    if (!auth.user) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <span class="app-header-btn" style="cursor:default;">${auth.user.email ?? auth.user.phone ?? ''}</span>
      <button id="accountLogoutBtn" class="app-header-btn">लॉगआउट / Logout</button>
    `;
    container.querySelector('#accountLogoutBtn').addEventListener('click', async () => {
      await auth.logout();
    });
  }

  auth.onChange(render);
  render();
}
