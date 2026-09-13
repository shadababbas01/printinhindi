// Random installation UUID, generated once and persisted locally. This is
// deliberately NOT a browser fingerprint — it carries no identifying
// information about the hardware/browser itself, just a random id the user's
// own account associates with "this browser install".
const STORAGE_KEY = 'hindi_registry_installation_id';

export function getInstallationId() {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
