// WHAT A NATIVE DEPLOYMENT DOES WITH AN OUTBOUND MESSAGE, decided before
// anything is sent and before any row is written.
//
// ## The failure this exists to stop
//
// `send-ghl-message` is the only outbound path in this product — two callers,
// `Conversations.tsx` and `ClientConversationsTab.tsx` — and every sentence it
// can put in front of an operator is about the CONTACT:
//
//     'This contact does not have a valid mobile number.'
//     'This contact has opted out of SMS communications.'
//     'This contact cannot receive WhatsApp messages.'
//
// Those are right when GoHighLevel refused a real send. On a deployment with
// no CRM vendor at all they are libel about somebody's customer: the number is
// fine, the contact opted out of nothing, and the reason nothing was delivered
// is that this deployment has no sender. The location service already paid for
// this rule — `geocoder_unavailable` and `geocoder_not_attempted` exist so a
// missing provider is never reported as a bad address — and an outbound
// message is the same shape with a person on the other end of it.
//
// ## Three rules
//
// **A refusal is not a send, and must never be recorded as one.** The messages
// table separates `message_status: 'sent'` from `'failed'` with an
// `error_message`, so there is already an honest place for this. What there
// must never be is a row that says delivered when nothing left the building —
// an operator reading a green conversation has no way to discover it, and the
// client is waiting for a reply that was never sent.
//
// **Whose fault it is decides where the operator goes.** `not_configured`
// sends them to this deployment's settings, `rejected` to the contact record,
// `unavailable` to the vendor's status page. One badge for all three is how
// "not required" came to read as "clear" on the screening stage.
//
// **A channel this deployment cannot carry is refused, never downgraded.**
// Silently sending an SMS because WhatsApp is unconfigured picks a channel the
// operator did not choose, at a cost they did not agree to, to a number that
// may not be the one they meant.

/** The channels the outbound path accepts. Mirrors `send-ghl-message`. */
export type NativeChannel = "sms" | "whatsapp";

/** Who has to do something for this message to go. */
export type NativeRefusalKind =
  /** This deployment holds no sender for the channel. Ours to fix. */
  | "not_configured"
  /** The record lacks what any sender would need. The contact's, or the data's. */
  | "no_destination"
  /** This build has a switch for the channel but no implementation behind it. */
  | "not_implemented";

export type NativeSendPlan =
  | {
      readonly act: "send";
      readonly via: "twilio";
      readonly channel: NativeChannel;
      readonly to: string;
    }
  | {
      readonly act: "refuse";
      readonly kind: NativeRefusalKind;
      /** Shown to the operator. Never about the contact unless the contact is the reason. */
      readonly message: string;
      /** What would make it work, where we are the ones who can. */
      readonly remedy: string | null;
    };

/**
 * The names whose presence means this deployment can put an SMS on the wire.
 *
 * All three are required: an account SID and auth token authorise, and a
 * from-number addresses. Two of three is the half configuration
 * `crmProvider.pure.ts` refuses for GoHighLevel, for the same reason.
 *
 * Measured on this clone 19 Sep 2026: none of the three is set, and the fleet
 * secret policy carries no forward row for any of them — so a native clone
 * cannot send an SMS today and this module's whole job is to say so rather
 * than to fail at a vendor.
 */
export const TWILIO_CREDENTIAL_NAMES = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

function has(env: Env, name: string): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function hasTwilioCredentials(env: Env): boolean {
  return TWILIO_CREDENTIAL_NAMES.every((n) => has(env, n));
}

/**
 * Which of the three Twilio names are absent.
 *
 * Named rather than counted, because "2 of 3 configured" tells an operator
 * nothing about which field to fill.
 */
export function missingTwilioCredentials(env: Env): readonly string[] {
  return TWILIO_CREDENTIAL_NAMES.filter((n) => !has(env, n));
}

/**
 * What to do with one outbound message on a native deployment.
 *
 * Pure, and deliberately decided BEFORE the row is written: the caller cannot
 * record a send it has not been told to make.
 */
export function planNativeSend(input: {
  readonly channel: NativeChannel;
  /** The contact's destination — an E.164 number for both channels today. */
  readonly to: string | null | undefined;
  readonly env: Env;
}): NativeSendPlan {
  // WhatsApp first, because it is refused on a ground that no credential
  // changes: this build has no native WhatsApp sender at all. Checking the
  // credentials first would tell an operator to configure Twilio and then
  // refuse them anyway, which is worse than refusing once.
  if (input.channel === "whatsapp") {
    return {
      act: "refuse",
      kind: "not_implemented",
      message:
        "This deployment has no WhatsApp sender. The message was not sent and nothing was recorded against the conversation.",
      remedy: null,
    };
  }

  if (!hasTwilioCredentials(input.env)) {
    const missing = missingTwilioCredentials(input.env);
    return {
      act: "refuse",
      kind: "not_configured",
      // About the deployment. Never about the contact — the number may be
      // perfect and there is simply nothing here to send it with.
      message:
        "This deployment has no SMS sender configured, so the message was not sent. " +
        "This is not a problem with the contact.",
      remedy: `Set ${missing.join(", ")} on this project, then send again.`,
    };
  }

  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (to.length === 0) {
    return {
      act: "refuse",
      kind: "no_destination",
      // Here the contact IS the reason, so here it is fair to say so.
      message:
        "This contact has no mobile number recorded, so there was nowhere to send the message.",
      remedy: null,
    };
  }

  return { act: "send", via: "twilio", channel: "sms", to };
}

/**
 * Whether a plan may result in a row claiming the message went.
 *
 * One expression, exported, so the two call sites cannot disagree about it —
 * which is exactly how `send-ghl-message` came to have one path that writes a
 * `failed` row and one that returns a 400 writing nothing.
 */
export function planMayRecordDelivery(plan: NativeSendPlan): boolean {
  return plan.act === "send";
}
