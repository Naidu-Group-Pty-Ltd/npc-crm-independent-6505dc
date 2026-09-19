/**
 * Mission Control's activation-gate API — this clone's client for it.
 *
 * A sibling of `missionControl.ts` rather than part of it: that module's
 * contract is the TOKEN api (reserve / commit / cancel / balance) and its
 * header says so. The gate is a different family with a different failure
 * policy — the token client fails CLOSED, refusing to spend what it cannot
 * confirm, and this one fails OPEN, because the thing it would otherwise
 * withhold is the customer's own dashboard.
 *
 * Parses under Deno: no `@/` aliases, explicit `.ts` extensions.
 */
import {
  parseGateResponse,
  unknownVerdict,
  type GateVerdict,
} from "./paymentGate.pure.ts";

const BASE_URL = (Deno.env.get("MISSION_CONTROL_URL") ?? "").replace(
  /\/+$/,
  "",
);
const API_KEY = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";

/**
 * Short on purpose. This call sits in front of the dashboard's first paint, so
 * a slow Mission Control must cost a moment and then be ignored — not hold the
 * page. Six seconds is far above the endpoint's healthy latency and far below
 * anything a person would sit through.
 */
const TIMEOUT_MS = (() => {
  const raw = Number(Deno.env.get("MC_GATE_TIMEOUT_MS") ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 6_000;
})();

export function gateConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY);
}

async function gateFetch(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-clone-api-key": API_KEY,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Mission Control whether this workspace is open.
 *
 * Returns an OPEN verdict on every failure — unconfigured, unreachable,
 * timed out, 4xx, 5xx, unparseable. The one status treated specially is 503,
 * which Mission Control answers when its own read of the gate row FAILED: that
 * is a fault, not "no gate", and reporting it as open-and-known would let a
 * database blip look like a definite answer. It comes back `known: false` like
 * every other failure, so a caller holding a previous verdict keeps it.
 */
export async function fetchGateVerdict(): Promise<GateVerdict> {
  if (!gateConfigured()) {
    // A clone with no Mission Control credentials cannot be gated by one. This
    // is also the local-development shape, and it must never lock a developer
    // out of the app they are building.
    return unknownVerdict();
  }
  try {
    const res = await gateFetch("/api/public/clones/gate", { method: "GET" });
    if (!res.ok) {
      console.warn("[paymentGate] gate read not ok", res.status);
      return unknownVerdict();
    }
    const body = await res.json().catch(() => null);
    return parseGateResponse(body);
  } catch (err) {
    console.warn("[paymentGate] gate read failed", err);
    return unknownVerdict();
  }
}

export type StartCheckoutResult =
  | { ok: true; url: string; sessionId: string | null }
  | { ok: false; error: string; pricingUrl: string | null };

/**
 * Mint the activation checkout — the CTA's one click.
 *
 * On any failure it hands back the pricing URL rather than nothing: a customer
 * looking at a locked screen must always have somewhere to pay, and a dead
 * button is worse than a link.
 */
export async function startActivationCheckout(input: {
  returnUrl?: string | null;
  contact?: Record<string, string | null | undefined> | null;
}): Promise<StartCheckoutResult> {
  if (!gateConfigured()) {
    return { ok: false, error: "unconfigured", pricingUrl: null };
  }
  try {
    const res = await gateFetch("/api/public/clones/gate/checkout", {
      method: "POST",
      body: JSON.stringify({
        return_url: input.returnUrl ?? null,
        contact: input.contact ?? null,
      }),
    });
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (res.ok && body && body.ok === true && typeof body.url === "string") {
      return {
        ok: true,
        url: body.url,
        sessionId: typeof body.session_id === "string" ? body.session_id : null,
      };
    }
    return {
      ok: false,
      error: typeof body?.error === "string" ? body.error : `mc_${res.status}`,
      pricingUrl:
        typeof body?.pricing_url === "string" ? body.pricing_url : null,
    };
  } catch (err) {
    console.error("[paymentGate] checkout mint failed", err);
    return { ok: false, error: "checkout_unreachable", pricingUrl: null };
  }
}
