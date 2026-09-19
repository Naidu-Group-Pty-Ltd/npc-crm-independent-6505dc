// Mission Control seat-entitlement client.
// Single source of truth for the seat:* endpoints. Uses the same
// MISSION_CONTROL_URL + MISSION_CONTROL_CLONE_API_KEY secrets as the
// token client, plus the shared error envelope.
import { MissionControlError } from "./missionControl.ts";

const BASE_URL = (Deno.env.get("MISSION_CONTROL_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";

export interface SeatReserveInput {
  externalUserId: string;
  email?: string;
  displayName?: string;
  idempotencyKey: string;
  /** Optional pricing-catalog role slug; forwarded as `metadata.role_slug`. */
  roleSlug?: string;
  /** Arbitrary additional metadata merged into the reservation payload. */
  metadata?: Record<string, unknown>;
}

export interface SeatReserveSuccess {
  ok: true;
  seat_id: string;
  seats_remaining: number;
  status: string;
}
export interface SeatLimitReached {
  ok: false;
  error: "seat_limit_reached";
  seat_limit: number;
  seats_used: number;
  plan: string;
}
export interface SeatGenericError {
  ok: false;
  error: string;
  message?: string;
}
export type SeatReserveResult = SeatReserveSuccess | SeatLimitReached | SeatGenericError;

export interface SeatEntitlement {
  plan: {
    slug: string;
    name: string;
    seat_limit: number;
    device_limit_per_seat: number | null;
  };
  seats_used: number;
  seats_remaining: number;
}

export interface SeatRow {
  id: string;
  external_user_id: string;
  email: string | null;
  display_name?: string | null;
  status: string;
  created_at: string;
}

export interface SeatList {
  seats: SeatRow[];
  total: number;
}

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

/** Reserve a seat. Returns a discriminated result; never throws for `seat_limit_reached`. */
export async function reserveSeat(input: SeatReserveInput): Promise<SeatReserveResult> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (input.roleSlug) metadata.role_slug = input.roleSlug;
  const res = await call("/api/public/seats/reserve", {
    method: "POST",
    body: JSON.stringify({
      external_user_id: input.externalUserId,
      email: input.email ?? null,
      display_name: input.displayName ?? null,
      idempotency_key: input.idempotencyKey,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    }),
  });
  const body = await parseJson(res);

  if (res.status === 402 || body?.error === "seat_limit_reached") {
    return {
      ok: false,
      error: "seat_limit_reached",
      seat_limit: Number(body?.seat_limit ?? 0),
      seats_used: Number(body?.seats_used ?? 0),
      plan: String(body?.plan ?? "unknown"),
    };
  }
  if (!res.ok || body?.ok === false) {
    return {
      ok: false,
      error: String(body?.error ?? `mc_${res.status}`),
      message: body?.message,
    };
  }
  return {
    ok: true,
    seat_id: String(body?.seat_id ?? body?.id ?? ""),
    seats_remaining: Number(body?.seats_remaining ?? 0),
    status: String(body?.status ?? "reserved"),
  };
}

export async function commitSeat(seatId: string): Promise<{ ok: boolean; error?: string }> {
  if (!seatId) return { ok: false, error: "missing_seat_id" };
  const res = await call("/api/public/seats/commit", {
    method: "POST",
    body: JSON.stringify({ seat_id: seatId }),
  });
  const body = await parseJson(res);
  if (!res.ok || body?.ok === false) {
    return { ok: false, error: String(body?.error ?? `mc_${res.status}`) };
  }
  return { ok: true };
}

export async function releaseSeat(
  externalUserId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!externalUserId) return { ok: false, error: "missing_external_user_id" };
  const res = await call("/api/public/seats/release", {
    method: "POST",
    body: JSON.stringify({
      external_user_id: externalUserId,
      reason: reason ?? "user_deleted",
    }),
  });
  const body = await parseJson(res);
  if (!res.ok || body?.ok === false) {
    // Idempotent: treat "not_found" as success so re-deletes don't fail.
    if (body?.error === "not_found" || res.status === 404) return { ok: true };
    return { ok: false, error: String(body?.error ?? `mc_${res.status}`) };
  }
  return { ok: true };
}

export async function getSeatEntitlement(): Promise<SeatEntitlement> {
  const res = await call("/api/public/seats/entitlement", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok || body?.ok === false) {
    throw new MissionControlError(
      String(body?.error ?? "mc_error"),
      String(body?.message ?? `Mission Control ${res.status}`),
      res.status || 500,
      body,
    );
  }
  return {
    plan: {
      slug: String(body?.plan?.slug ?? "unknown"),
      name: String(body?.plan?.name ?? "Unknown"),
      seat_limit: Number(body?.plan?.seat_limit ?? 0),
      device_limit_per_seat: body?.plan?.device_limit_per_seat ?? null,
    },
    seats_used: Number(body?.seats_used ?? 0),
    seats_remaining: Number(body?.seats_remaining ?? 0),
  };
}

export async function listSeats(
  opts: { status?: "reserved" | "active" | "removed"; limit?: number; offset?: number } = {},
): Promise<SeatList> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set("status", opts.status);
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  if (opts.offset != null) qs.set("offset", String(opts.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await call(`/api/public/seats/list${suffix}`, { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok || body?.ok === false) {
    throw new MissionControlError(
      String(body?.error ?? "mc_error"),
      String(body?.message ?? `Mission Control ${res.status}`),
      res.status || 500,
      body,
    );
  }
  const seats = Array.isArray(body?.seats) ? body.seats : [];
  return {
    seats: seats.map((s: any) => ({
      id: String(s.id),
      external_user_id: String(s.external_user_id ?? ""),
      email: s.email ?? null,
      display_name: s.display_name ?? null,
      status: String(s.status ?? "active"),
      created_at: String(s.created_at ?? new Date().toISOString()),
    })),
    total: Number(body?.total ?? seats.length),
  };
}
