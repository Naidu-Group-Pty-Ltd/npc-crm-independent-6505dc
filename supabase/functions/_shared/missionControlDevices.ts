// Mission Control device-cap client. Mirrors the seat client pattern and uses
// the same MISSION_CONTROL_URL + MISSION_CONTROL_CLONE_API_KEY secrets.
import { MissionControlError } from "./missionControl.ts";

const BASE_URL = (Deno.env.get("MISSION_CONTROL_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";

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

export interface DeviceRegisterSuccess {
  ok: true;
  device_id: string;
  devices_active: number;
  device_limit: number;
}
export interface DeviceLimitReachedResult {
  ok: false;
  error: "device_limit_reached";
  devices_active: number;
  device_limit: number;
  devices?: DeviceRow[];
}
export interface DeviceGenericError {
  ok: false;
  error: string;
  message?: string;
}
export type DeviceRegisterResult =
  | DeviceRegisterSuccess
  | DeviceLimitReachedResult
  | DeviceGenericError;

function assertConfigured() {
  if (!BASE_URL || !API_KEY) {
    throw new MissionControlError(
      "unconfigured",
      "MISSION_CONTROL_URL or MISSION_CONTROL_CLONE_API_KEY missing",
      500,
    );
  }
}

async function call(path: string, init: RequestInit): Promise<Response> {
  assertConfigured();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-clone-api-key": API_KEY,
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 429 && attempt === 0) {
      const ra = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, Math.min(Math.max(ra, 1), 10) * 1000));
      continue;
    }
    if (res.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    return res;
  }
  return await fetch(`${BASE_URL}${path}`, init);
}

async function parseJson(res: Response): Promise<any> {
  const txt = await res.text();
  try { return txt ? JSON.parse(txt) : {}; } catch { return { _raw: txt }; }
}

export interface DeviceRegisterInput {
  externalUserId: string;
  deviceFingerprint: string;
  deviceLabel?: string;
  userAgent?: string;
  platform?: string;
}

/** Register a device. Returns a discriminated result; never throws for `device_limit_reached`. */
export async function registerDevice(input: DeviceRegisterInput): Promise<DeviceRegisterResult> {
  const res = await call("/api/public/seats/devices/register", {
    method: "POST",
    body: JSON.stringify({
      external_user_id: input.externalUserId,
      device_fingerprint: input.deviceFingerprint,
      device_label: input.deviceLabel ?? null,
      user_agent: input.userAgent ?? null,
      platform: input.platform ?? null,
    }),
  });
  const body = await parseJson(res);

  if (res.status === 402 || body?.error === "device_limit_reached") {
    // Fetch the active list so the caller can render a "Manage devices" UI.
    let devices: DeviceRow[] | undefined;
    try {
      const list = await listDevices(input.externalUserId);
      devices = list.devices;
    } catch { /* best effort */ }
    return {
      ok: false,
      error: "device_limit_reached",
      devices_active: Number(body?.devices_active ?? 0),
      device_limit: Number(body?.device_limit ?? 0),
      devices,
    };
  }
  if (!res.ok || body?.ok === false) {
    console.warn("[missionControlDevices] register upstream failure", {
      status: res.status,
    });
    return {
      ok: false,
      error: String(body?.error ?? `mc_${res.status}`),
      message: body?.message,
    };
  }
  return {
    ok: true,
    device_id: String(body?.device_id ?? body?.id ?? ""),
    devices_active: Number(body?.devices_active ?? 0),
    device_limit: Number(body?.device_limit ?? 0),
  };
}

export async function heartbeatDevice(deviceId: string): Promise<{ ok: boolean; error?: string }> {
  if (!deviceId) return { ok: false, error: "missing_device_id" };
  const res = await call("/api/public/seats/devices/heartbeat", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) {
    const body = await parseJson(res);
    return { ok: false, error: String(body?.error ?? `mc_${res.status}`) };
  }
  return { ok: true };
}

export interface DeviceReleaseInput {
  deviceId?: string;
  externalUserId?: string;
  deviceFingerprint?: string;
  reason?: string;
}

export async function releaseDevice(input: DeviceReleaseInput): Promise<{ ok: boolean; error?: string }> {
  if (!input.deviceId && !input.externalUserId && !input.deviceFingerprint) {
    return { ok: false, error: "missing_identifier" };
  }
  const res = await call("/api/public/seats/devices/release", {
    method: "POST",
    body: JSON.stringify({
      device_id: input.deviceId ?? null,
      external_user_id: input.externalUserId ?? null,
      device_fingerprint: input.deviceFingerprint ?? null,
      reason: input.reason ?? "user_signed_out",
    }),
  });
  if (!res.ok) {
    const body = await parseJson(res);
    if (body?.error === "not_found" || res.status === 404) return { ok: true };
    return { ok: false, error: String(body?.error ?? `mc_${res.status}`) };
  }
  return { ok: true };
}

export async function listDevices(
  externalUserId: string,
): Promise<{ devices: DeviceRow[]; device_limit: number; devices_active: number }> {
  const qs = new URLSearchParams({ external_user_id: externalUserId });
  const res = await call(`/api/public/seats/devices/list?${qs.toString()}`, { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok || body?.ok === false) {
    throw new MissionControlError(
      String(body?.error ?? "mc_error"),
      String(body?.message ?? `Mission Control ${res.status}`),
      res.status || 500,
      body,
    );
  }
  const arr = Array.isArray(body?.devices) ? body.devices : [];
  return {
    devices: arr.map((d: any) => ({
      id: String(d.id),
      external_user_id: String(d.external_user_id ?? ""),
      device_fingerprint: String(d.device_fingerprint ?? ""),
      device_label: d.device_label ?? null,
      user_agent: d.user_agent ?? null,
      platform: d.platform ?? null,
      last_seen_at: d.last_seen_at ?? null,
      created_at: String(d.created_at ?? new Date().toISOString()),
      status: String(d.status ?? "active"),
    })),
    device_limit: Number(body?.device_limit ?? 0),
    devices_active: Number(body?.devices_active ?? arr.length),
  };
}
