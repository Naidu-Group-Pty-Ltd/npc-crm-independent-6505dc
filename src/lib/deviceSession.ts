// Device session lifecycle for the Mission Control device cap.
// Wraps the `mission-control-devices` edge function so the clone API key
// never reaches the browser.
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  getDeviceFingerprint,
  getDeviceLabel,
  getStoredDeviceId,
  persistDeviceId,
  clearDeviceId,
} from '@/lib/deviceFingerprint';

export interface DeviceRow {
  id: string;
  external_user_id: string;
  device_fingerprint: string;
  device_label: string | null;
  user_agent: string | null;
  platform: string | null;
  last_seen_at: string | null;
  created_at: string;
  status: string;
}

export type DeviceRegisterOutcome =
  | { ok: true; code: 'ok'; device_id: string; devices_active: number; device_limit: number }
  | {
      ok: false;
      code: 'device_limit_reached';
      devices_active: number;
      device_limit: number;
      devices: DeviceRow[];
    }
  | { ok: false; code: 'error'; message: string };


/**
 * Register the current browser as a device on Mission Control.
 * Call this AFTER a successful sign-in (so the session token is available).
 */
export async function registerCurrentDevice(): Promise<DeviceRegisterOutcome> {
  const fingerprint = getDeviceFingerprint();
  const { data, error } = await invokeSecureFunction<any>('mission-control-devices', {
    action: 'register',
    device_fingerprint: fingerprint,
    device_label: getDeviceLabel(),
    user_agent: navigator.userAgent,
    platform: (navigator as any).platform ?? null,
  });

  if (data?.error === 'device_limit_reached') {
    return {
      ok: false,
      code: 'device_limit_reached',
      devices_active: Number(data.devices_active ?? 0),
      device_limit: Number(data.device_limit ?? 0),
      devices: Array.isArray(data.devices) ? data.devices as DeviceRow[] : [],
    };
  }
  if (error || !data?.ok) {
    return { ok: false, code: 'error', message: error?.message || data?.error || 'register_failed' };
  }
  const id = String(data.device_id ?? '');
  if (id) persistDeviceId(id);
  return {
    ok: true,
    code: 'ok',
    device_id: id,
    devices_active: Number(data.devices_active ?? 0),
    device_limit: Number(data.device_limit ?? 0),
  };
}

export async function heartbeatCurrentDevice(): Promise<void> {
  const id = getStoredDeviceId();
  if (!id) return;
  await invokeSecureFunction('mission-control-devices', {
    action: 'heartbeat',
    device_id: id,
  });
}

export async function releaseCurrentDevice(reason = 'user_signed_out'): Promise<void> {
  const id = getStoredDeviceId();
  const fingerprint = getDeviceFingerprint();
  if (!id && !fingerprint) return;
  try {
    await invokeSecureFunction('mission-control-devices', {
      action: 'release',
      device_id: id ?? undefined,
      device_fingerprint: fingerprint,
      reason,
    });
  } finally {
    clearDeviceId();
  }
}

export async function listMyDevices(): Promise<{ devices: DeviceRow[]; device_limit: number; devices_active: number }> {
  const { data } = await invokeSecureFunction<any>('mission-control-devices', { action: 'list' });
  return {
    devices: Array.isArray(data?.devices) ? data.devices as DeviceRow[] : [],
    device_limit: Number(data?.device_limit ?? 0),
    devices_active: Number(data?.devices_active ?? 0),
  };
}

export async function revokeDevice(deviceId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction<any>('mission-control-devices', {
    action: 'revoke',
    device_id: deviceId,
  });
  if (error || !data?.ok) return { ok: false, error: error?.message || data?.error || 'revoke_failed' };
  return { ok: true };
}
