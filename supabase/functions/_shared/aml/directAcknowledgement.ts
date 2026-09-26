/**
 * The DIRECT partner acknowledgement — shared primitives.
 *
 * A partner outside the three portals has no sign-up to carry the prebuilt
 * Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport
 * Agreement, whose mandatory `binding_amlctf_arrangement` acknowledgement is
 * the s 37A / rule 6-29 arrangement statement. They acknowledge the SAME
 * instrument through a one-time emailed link instead.
 *
 * Two rules this module exists to keep:
 *
 *   1. The acceptance is the ARRANGEMENT. `grant_access` already refuses
 *      without an active `reliance_agreements` row whose review is current,
 *      so writing that row only on acceptance makes "no acknowledgement, no
 *      passport" an existing rule rather than a new one. Nothing else may
 *      create the row for a direct partner.
 *
 *   2. The link credential never rests in plaintext. The token lives in the
 *      email; the database holds only its SHA-256, exactly as every other
 *      token in this system does.
 */

import { deploymentLinkOrigin, PRIME_APP_ORIGIN } from "../emailIdentity.pure.ts";

/**
 * How long a partner has to review and sign before the link lapses.
 *
 * Longer than a portal invite (72h) because this is an agreement to read,
 * not a password to set — and shorter than the passport grant, because an
 * unsigned link is an open invitation to bind an organisation. A lapsed
 * request is re-issued rather than extended, so the record always shows how
 * many times it was sent.
 */
export const ACK_LINK_TTL_DAYS = 14;

/** Statuses from which nothing further can happen without a new request. */
export const ACK_TERMINAL_STATUSES = ["accepted", "declined", "expired", "superseded"] as const;

export type DirectAckStatus =
  | "sent" | "viewed" | "accepted" | "declined" | "expired" | "superseded";

/** The token is the credential; only its hash is ever stored. */
export async function hashAckToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.trim()));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A token with enough entropy that guessing is not an attack path. */
export function mintAckToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function env(name: string): string | null {
  return (globalThis as any).Deno?.env?.get?.(name) ?? null;
}

/**
 * The origin this deployment's public AML links open.
 *
 * On the prime: `PUBLIC_APP_URL`, else its own production domain, as always.
 * A preview URL in a partner's signing link is a link that stops working, on
 * the one document that must not.
 *
 * On a clone: the origin Mission Control provisioned, and never the prime's.
 * The production-domain fallback used to apply everywhere, so a clone with no
 * `PUBLIC_APP_URL` would have sent its partner to ANOTHER tenant's page. With
 * no origin provisioned the link is left relative and the gap is logged: a
 * link that opens nothing is recoverable, one that opens somebody else's page
 * is not. The rule is `deploymentLinkOrigin`, the same one every email uses.
 */
function publicLinkOrigin(): string {
  const origin = deploymentLinkOrigin(
    {
      supabaseUrl: env("SUPABASE_URL"),
      provisionedOrigins: [env("PUBLIC_APP_URL"), env("APP_URL"), env("APP_BASE_URL")],
    },
    env("PUBLIC_APP_URL") || PRIME_APP_ORIGIN,
  );
  if (!origin) {
    console.error("[aml-links] No application URL is provisioned for this deployment; the link is relative");
  }
  return origin ?? "";
}

/** The public page a partner signs the agreement on. */
export function acknowledgementLinkFor(token: string): string {
  return `${publicLinkOrigin()}/partner-acknowledgement/${token}`;
}

/** Is this request still able to be viewed or accepted? */
export function isAckLive(status: string, expiresAt: string | null | undefined): boolean {
  if (status !== "sent" && status !== "viewed") return false;
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now();
}

/**
 * The arrangement the acceptance creates.
 *
 * `executed_on` is the day the partner accepted — not the day an operator
 * set the request up — because that is when the instrument was entered into.
 * The reference names the channel so the register never implies a signed
 * paper agreement that does not exist.
 */
export function arrangementDraftFromAcceptance(acceptedAt: Date): {
  agreement_reference: string;
  executed_on: string;
  next_review_due: string;
} {
  const iso = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const review = new Date(acceptedAt.getTime());
  review.setUTCFullYear(review.getUTCFullYear() + 1);
  return {
    agreement_reference: "AML/CTF Compliance Passport Agreement — acknowledged directly by the partner",
    executed_on: iso(acceptedAt),
    next_review_due: iso(review),
  };
}

/**
 * What the operator may do about a request, derived from its own state.
 * Rendered by the workspace and used by the server, so the two cannot
 * describe the same row differently.
 */
export function ackActionFor(status: string, expiresAt: string | null | undefined): {
  state: DirectAckStatus;
  /** True when the passport may now be granted to this partner. */
  gateOpen: boolean;
  /** True when re-sending the request is the sensible next act. */
  canResend: boolean;
  detail: string;
} {
  if (status === "accepted") {
    return {
      state: "accepted", gateOpen: true, canResend: false,
      detail: "Acknowledged — the arrangement is recorded and the passport can be issued.",
    };
  }
  if (status === "declined") {
    return {
      state: "declined", gateOpen: false, canResend: true,
      detail: "The partner declined. Nothing is recorded against them; a new request can be sent if the position changes.",
    };
  }
  if (status === "superseded") {
    return {
      state: "superseded", gateOpen: false, canResend: false,
      detail: "Replaced by a newer request.",
    };
  }
  const expired = status === "expired" || !isAckLive(status, expiresAt);
  if (expired) {
    return {
      state: "expired", gateOpen: false, canResend: true,
      detail: "The link lapsed before it was accepted. Re-send it to the same address or a different one.",
    };
  }
  return {
    state: status === "viewed" ? "viewed" : "sent",
    gateOpen: false,
    canResend: true,
    detail: status === "viewed"
      ? "The partner has opened the agreement but not yet accepted it."
      : "Sent — waiting for the partner to review and accept.",
  };
}

/* ── The passport link ──────────────────────────────────────────────────
 * The grant's bearer token, delivered as a URL. The credential and its
 * lifetime are unchanged — this is only where it is redeemed from.
 */

/**
 * The public passport page, on the same origin as the acknowledgement link
 * and for the same reasons (see `publicLinkOrigin`).
 */
export function passportLinkFor(token: string): string {
  return `${publicLinkOrigin()}/passport/${token}`;
}

/**
 * May this denial offer the partner a replacement link?
 *
 * ONLY an expiry. A revoked grant, or one whose arrangement has been
 * suspended or terminated, must never offer self-service renewal —
 * revocation is a safety action, and inviting the subject of it to
 * re-request would undo the act it was taken for. An expiry is just time
 * passing, which is exactly the case the operator asked to be able to
 * repair without friction.
 */
export function mayRequestReplacementLink(denied: string | null | undefined): boolean {
  return denied === "expired";
}
