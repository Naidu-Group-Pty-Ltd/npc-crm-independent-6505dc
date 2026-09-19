/**
 * The DIRECT partner acknowledgement — public client.
 *
 * Deliberately NOT `invokeAmlFunction`: that wrapper is for staff calls and
 * attaches step-up credentials. This surface has no session at all. The
 * token in the link is the whole credential, matched by hash server-side,
 * and every rule — expiry, terminal state, the mandatory acknowledgements —
 * is enforced by `aml-reliance`, never here.
 */
import { invokeSecureFunction } from "@/lib/secureInvoke";

export interface PublicAcknowledgementView {
  status: "sent" | "viewed" | "accepted" | "declined" | "expired" | "superseded";
  organisation_name: string | null;
  recipient_name: string;
  recipient_email: string;
  expires_at: string;
  accepted_at: string | null;
  /** Who accepted, as they typed it. Present once the status is accepted. */
  accepted_by_name?: string | null;
  declined_at: string | null;
  issuer_name: string;
  /** The instrument itself, exactly as published. */
  terms: { version: string; title: string; content_markdown: string } | null;
  /** The mandatory acknowledgements, in the agreement's own order. */
  acknowledgements: ReadonlyArray<{ key: string; heading: string; statement: string }>;
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>("aml-reliance", payload);
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}

export const partnerAcknowledgementPublicApi = {
  view: (ack_token: string) =>
    call<{ acknowledgement: PublicAcknowledgementView }>({ op: "ack_view", ack_token }),
  accept: (ack_token: string, params: { accepted_by_name: string; acknowledgements: string[] }) =>
    call<{ acknowledgement: PublicAcknowledgementView }>({ op: "ack_accept", ack_token, ...params }),
  decline: (ack_token: string, reason?: string) =>
    call<{ acknowledgement: PublicAcknowledgementView }>({ op: "ack_decline", ack_token, reason }),
};

/* ── The Compliance Passport itself ────────────────────────────────────
 * The grant's bearer token, presented from a link. `redeem_attestation`
 * and `record_independent_assessment` are the SAME partner operations the
 * system-to-system integrations use — this surface only gives them a page.
 */

export interface PassportRedemption {
  attestation: Record<string, unknown>;
  /**
   * The DOCUMENT — the same `PassportView` the Command Centre renders, built
   * for the partner audience. Optional only because a deployment may be
   * serving a build that predates it; the page falls back to composing from
   * the payload when it is absent.
   */
  passport?: unknown;
  attestation_sha256: string;
  issued_at: string;
  schema_version?: number;
  /** The attestation version this grant is bound to — part of the credential. */
  attestation_version?: number | null;
  agreement: { partner_org_name: string; agreement_reference: string; scope: string[] };
  /** The statutory position, restated by the server at the point of use. */
  notice: string;
  /**
   * Where else this record lives, when the holder also has a portal account.
   *
   * SERVER-DECIDED. `available` is false unless the compliance page exists
   * on this deployment and the organisation has an active membership
   * somebody could sign in with — a door that refuses is worse than no door.
   * Absent on a deployment serving a build that predates it.
   */
  portal_handoff?: {
    available: boolean;
    portalType: string | null;
    label: string | null;
    path: string | null;
    url: string | null;
    reason: string | null;
  };
}

export const passportPublicApi = {
  redeem: (access_token: string) =>
    call<PassportRedemption>({ op: "redeem_attestation", access_token }),
  /**
   * The partner's OWN determination, made against the records disclosed
   * here. It never moves the issuing organisation's case — their
   * compliance is theirs, ours is ours.
   */
  recordIndependentAssessment: (access_token: string, params: {
    assessor_name: string; assessor_role?: string;
    status: "satisfied" | "not_satisfied" | "records_requested";
    decision_notes: string;
  }) => call<{ assessment: { id: string; status: string; decided_at: string }; message: string }>(
    { op: "record_independent_assessment", access_token, ...params }),
  /** Available from an EXPIRED link only; it mints nothing. */
  requestNewLink: (access_token: string) =>
    call<{ requested: boolean; message: string }>({ op: "request_passport_link", access_token }),
};
