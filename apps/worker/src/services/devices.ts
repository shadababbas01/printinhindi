// Pure device-limit decision logic (no invasive fingerprinting — devices are
// identified only by a random installation_id the browser generates once
// and persists locally).

export type DeviceRow = { installation_id: string; revoked_at: string | null };

export type DeviceDecision =
  | { allowed: true; alreadyRegistered: boolean }
  | { allowed: false; reason: 'DEVICE_LIMIT_REACHED'; activeDevices: DeviceRow[] };

export function decideDeviceRegistration(
  installationId: string,
  activeDevices: DeviceRow[],
  deviceLimit: number
): DeviceDecision {
  const alreadyRegistered = activeDevices.some((d) => d.installation_id === installationId && !d.revoked_at);
  if (alreadyRegistered) return { allowed: true, alreadyRegistered: true };

  const activeCount = activeDevices.filter((d) => !d.revoked_at).length;
  if (activeCount >= deviceLimit) {
    return { allowed: false, reason: 'DEVICE_LIMIT_REACHED', activeDevices: activeDevices.filter((d) => !d.revoked_at) };
  }
  return { allowed: true, alreadyRegistered: false };
}
