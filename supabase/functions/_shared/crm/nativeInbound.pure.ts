/**
 * What a native deployment does with ONE inbound message, decided before a row
 * is written and before a signature is trusted.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `crm-send-message` closed half of the conversation surface. A client's REPLY
 * had nowhere to arrive: under `ghl` it reaches `ghl-webhook-receiver`, and
 * under `native` nothing was listening at all, so every native thread was a
 * transcript of one side talking. The doc said so plainly — "Nothing fills
 * `ghl_conversations`. A client's reply arrives nowhere." — which is worth
 * fixing rather than restating.
 *
 * ── The one that is NOT like outbound ───────────────────────────────────────
 *
 * Outbound is called by a signed-in operator behind `verify_jwt`. Inbound is a
 * webhook: `verify_jwt = false`, publicly reachable, and the caller claims to
 * be Twilio. So the ONLY thing standing between the open internet and a row in
 * a customer's conversation is `X-Twilio-Signature`, and that is checked here
 * before any lookup, any write, and any answer that would tell a prober
 * anything.
 *
 * **No auth token means every request is refused.** Not "accepted because we
 * cannot check" — the verification key IS `TWILIO_AUTH_TOKEN`, and a
 * deployment without it cannot distinguish Twilio from anyone who found the
 * URL. This repository has already written down what the alternative costs:
 * `STEP_UP_ENFORCED` is fail-closed when unset for exactly this reason, and
 * `osmAllowance` refuses on a counter nobody can read. An unverifiable webhook
 * is an open write endpoint into customer records.
 *
 * ── Why the verdict is a value rather than a thrown error ───────────────────
 *
 * `planInboundMessage` returns what to do; the function does it. That keeps
 * the interesting decisions — is this signed, do we know this number, is this
 * the same message twice — testable without a database, a network or a clock,
 * which is the only way the orderings above can be asserted at all.
 */

/** Channels a native deployment can receive on today. */
export type InboundChannel = 'sms';

/** The credential that verifies an inbound Twilio request. */
export const TWILIO_INBOUND_CREDENTIAL = 'TWILIO_AUTH_TOKEN';

export type InboundRefusalKind =
  /** No `TWILIO_AUTH_TOKEN`, so nothing can be verified. Fail closed. */
  | 'unverifiable'
  /** A signature was supplied and it did not match. */
  | 'bad_signature'
  /** No signature header at all. */
  | 'unsigned'
  /** The payload is not a message we can place. */
  | 'unusable_payload';

export type InboundPlan =
  | {
      readonly act: 'record';
      readonly channel: InboundChannel;
      /** E.164, as the provider gave it. Never reformatted — it is a key. */
      readonly from: string;
      readonly to: string;
      readonly body: string;
      /** The provider's own id. The idempotency key, and never ours. */
      readonly providerMessageId: string;
    }
  | {
      readonly act: 'refuse';
      readonly kind: InboundRefusalKind;
      /** For the function log. NEVER returned to the caller — see below. */
      readonly reason: string;
    };

type Env = Readonly<Record<string, string | undefined>>;

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Whether this deployment can verify an inbound webhook at all.
 *
 * Separate from `hasTwilioCredentials` in `nativeOutbound.pure.ts` on purpose:
 * SENDING needs an account SID and a from-number as well, RECEIVING needs only
 * the token that signs. A deployment that can receive but not send is a real
 * state and must not be refused for the wrong reason.
 */
export function canVerifyInbound(env: Env): boolean {
  return text(env[TWILIO_INBOUND_CREDENTIAL]).length > 0;
}

/**
 * Decide what to do with one inbound request.
 *
 * `signatureValid` is passed in rather than computed, because the HMAC needs
 * `crypto.subtle` and this module stays synchronous and dependency-free. The
 * ORDER is what matters and is asserted: verification outranks everything, and
 * a payload is not even looked at until the caller is known.
 */
export function planInboundMessage(input: {
  readonly env: Env;
  readonly signatureHeader: string | null | undefined;
  /** The caller's computed verdict. Ignored unless a signature was supplied. */
  readonly signatureValid: boolean;
  readonly params: Readonly<Record<string, string>>;
}): InboundPlan {
  if (!canVerifyInbound(input.env)) {
    return {
      act: 'refuse',
      kind: 'unverifiable',
      reason:
        `${TWILIO_INBOUND_CREDENTIAL} is not set, so an inbound request cannot be ` +
        'distinguished from any other caller. Refusing rather than writing.',
    };
  }

  const signature = text(input.signatureHeader);
  if (!signature) {
    return { act: 'refuse', kind: 'unsigned', reason: 'No X-Twilio-Signature header.' };
  }
  if (!input.signatureValid) {
    return { act: 'refuse', kind: 'bad_signature', reason: 'X-Twilio-Signature did not match.' };
  }

  const from = text(input.params.From);
  const to = text(input.params.To);
  const body = text(input.params.Body);
  const providerMessageId = text(input.params.MessageSid) || text(input.params.SmsSid);

  // A body may legitimately be empty (an MMS with only an attachment), but a
  // message we cannot ADDRESS or cannot DE-DUPLICATE is one we must not write:
  // without `From` there is no conversation to attach it to, and without the
  // provider's id a retry becomes a second copy of the same reply.
  if (!from || !providerMessageId) {
    return {
      act: 'refuse',
      kind: 'unusable_payload',
      reason: `Inbound payload lacks ${!from ? 'From' : 'MessageSid'}.`,
    };
  }

  return { act: 'record', channel: 'sms', from, to, body, providerMessageId };
}

/**
 * What an unverified caller is told.
 *
 * One sentence and one status for every refusal kind, deliberately. A webhook
 * that answers "no auth token configured" to one prober and "bad signature" to
 * another has told both of them how this deployment is set up, and the second
 * answer confirms the endpoint is real and worth grinding at. The operator
 * gets the distinction in the function log, where the reader is trusted.
 *
 * 403 rather than 401: there is no credential the caller could add to the next
 * request that would change the answer.
 */
export const INBOUND_REFUSAL_STATUS = 403;
export const INBOUND_REFUSAL_BODY = 'Forbidden';

/**
 * The string Twilio signs: the full request URL with every POST parameter
 * appended in key order, name then value, with no separators.
 *
 * Exported and pure so it can be checked against Twilio's published example
 * rather than believed.
 */
export function twilioSignatureBase(
  url: string,
  params: Readonly<Record<string, string>>,
): string {
  return Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
}
