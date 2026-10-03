// HOW A FINANCE PARTNER'S MESSAGE LEAVES A NATIVE DEPLOYMENT.
//
// ## The failure this exists to stop
//
// `finance-portal-client-comms` sent every SMS, WhatsApp and email through
// GoHighLevel: it looked up the client's vendor conversation, read the vendor
// key and posted to `leadconnectorhq.com`. This line holds no vendor account,
// so a broker writing to their client was told `no_ghl_conversation` or
// `ghl_not_configured`, the code itself, in a toast. Nothing was sent and
// nothing said why in words the broker could act on.
//
// ## Three rules
//
// **The reader is the broker, not the operator.** A finance partner works for
// another business and cannot set a project secret, so a refusal says what
// happened and who can change it, never which environment variable is
// missing. The operator's remedy is returned separately, for the function log.
//
// **A channel this deployment cannot carry is refused, never downgraded.** The
// same rule as `nativeOutbound.pure.ts`, whose planner decides SMS and
// WhatsApp here too. A WhatsApp message is not quietly sent as an SMS.
//
// **The email's text is the broker's, so it is set as text.** The vendor path
// put the broker's body into HTML unescaped. Here it is escaped before it
// reaches the template, and the subject loses only the two characters that
// could open a tag, because it is also the email's subject line.

import { planNativeSend } from "./nativeOutbound.pure.ts";

export type FinancePortalChannel = "sms" | "whatsapp" | "email";

export type FinancePortalRefusalReason =
  /** This deployment has no sender for the channel. The team's to fix. */
  | "not_configured"
  /** The client's record lacks what any sender would need. */
  | "no_destination"
  /** This build has no sender for the channel at all. */
  | "not_implemented";

export type FinancePortalSendPlan =
  | {
      readonly act: "send";
      readonly via: "twilio" | "resend";
      readonly channel: FinancePortalChannel;
      readonly to: string;
    }
  | {
      readonly act: "refuse";
      readonly reason: FinancePortalRefusalReason;
      /** Shown to the broker. */
      readonly message: string;
      /** For the function log. Names what the operator would change. */
      readonly operatorRemedy: string | null;
    };

type Env = Readonly<Record<string, string | undefined>>;

/** The names whose presence means this deployment can send an email. */
export const EMAIL_CREDENTIAL_NAMES = ["RESEND_API_KEY"] as const;

function present(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What to do with one message a finance partner sends to a client.
 *
 * Decided before anything is sent or written, so the caller cannot record a
 * send it was not told to make.
 */
export function planFinancePortalSend(input: {
  readonly channel: FinancePortalChannel;
  readonly client: {
    readonly email: string | null | undefined;
    readonly mobile: string | null | undefined;
  };
  readonly env: Env;
}): FinancePortalSendPlan {
  if (input.channel === "email") {
    if (!EMAIL_CREDENTIAL_NAMES.every((name) => present(input.env[name]).length > 0)) {
      return {
        act: "refuse",
        reason: "not_configured",
        message:
          "Emails cannot be sent from this portal yet, so this one was not sent. " +
          "Your client's address is not the problem. The team you work with can switch on email.",
        operatorRemedy: `Set ${EMAIL_CREDENTIAL_NAMES.join(", ")} on this project.`,
      };
    }
    const to = present(input.client.email);
    if (!to) {
      return {
        act: "refuse",
        reason: "no_destination",
        message: "This client has no email address recorded, so there was nowhere to send the message.",
        operatorRemedy: null,
      };
    }
    if (!EMAIL_SHAPE.test(to)) {
      return {
        act: "refuse",
        reason: "no_destination",
        message:
          "The email address on this client's record could not be read as an address, so the message was not sent.",
        operatorRemedy: "Correct the email address on the client's record.",
      };
    }
    return { act: "send", via: "resend", channel: "email", to };
  }

  const recorded = present(input.client.mobile);
  const plan = planNativeSend({ channel: input.channel, to: recorded, env: input.env });
  if (plan.act === "send") {
    return { act: "send", via: "twilio", channel: plan.channel, to: plan.to };
  }

  switch (plan.kind) {
    case "not_implemented":
      return {
        act: "refuse",
        reason: "not_implemented",
        message:
          "WhatsApp messages cannot be sent from this portal, so this one was not sent. " +
          "Send it as a text message or an email instead.",
        operatorRemedy: null,
      };
    case "not_configured":
      return {
        act: "refuse",
        reason: "not_configured",
        message:
          "Text messages cannot be sent from this portal yet, so this one was not sent. " +
          "Your client's number is not the problem. The team you work with can switch on text messaging.",
        operatorRemedy: plan.remedy,
      };
    case "no_destination":
      return {
        act: "refuse",
        reason: "no_destination",
        message: recorded
          ? "The mobile number on this client's record could not be read as a phone number, so the message was not sent."
          : "This client has no mobile number recorded, so there was nowhere to send the message.",
        operatorRemedy: recorded ? "Correct the mobile number on the client's record." : null,
      };
  }
}

/** Text set into the email's HTML: every character the broker typed, as text. */
export function emailBodyHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br/>");
}

/**
 * The subject, which the template uses as both a heading and the subject line.
 * Escaping it would print `&amp;` in a subject line, so only the two
 * characters that could open a tag are removed.
 */
export function emailSubjectText(subject: string | null | undefined, fallback: string): string {
  const cleaned = present(subject).replace(/[<>]/g, "").slice(0, 200).trim();
  return cleaned || fallback;
}
