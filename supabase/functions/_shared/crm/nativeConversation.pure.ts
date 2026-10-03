// HOW A NATIVE CONVERSATION IS ADDRESSED, decided once for both ends of it.
//
// ## The thread an operator could not start
//
// On this line a conversation existed only once a client had texted in:
// `crm-inbound-message` was the one writer of `ghl_conversations`, keyed
// `native-sms-<number as Twilio sent it>`. Nothing let a staff member open a
// thread with a client who had never written, so the Conversations page and a
// client's own tab could only ever reply. A CRM in which you cannot speak first
// is a support inbox.
//
// ## One key, whichever end opens the thread
//
// The operator's side reads a client's `primary_mobile`, typed by a person —
// `0412 345 678`, `+61 412 345 678`, `61412345678`. Twilio's side writes E.164
// (`+61412345678`). If the two sides keyed their threads from what they each
// happened to hold, a client who replied to an operator's first message would
// land in a SECOND thread, and the operator would read a conversation with no
// answer in it. So both ends key from `australianMobileToE164`, which is the
// one place that decides what a number IS.
//
// A client with no usable mobile still gets a thread — email is a channel too —
// keyed by the client's id. If a mobile is added later, an inbound SMS finds the
// thread by the client rather than by the key (`crm-inbound-message` asks both),
// so the two never fork.
//
// ## What it will not do
//
// It never guesses a country for a number that names one. `+44 7700 900123` is
// a United Kingdom number and is kept as one; only a number with no country of
// its own is read as Australian, because this product's clients are.
//
// And it never "repairs" a number into a different one. A string that is not a
// plausible phone number answers `null`, which the sender turns into a sentence
// about the RECORD — the operator can correct it — rather than an SMS to
// whoever that string happens to reach.

/** Every native thread's key starts with this, so no vendor id can collide. */
export const NATIVE_CONVERSATION_PREFIX = "native-";

/**
 * A mobile number as E.164, reading a number with no country code as
 * Australian. `null` when the input is not a plausible phone number.
 *
 * Accepted:
 *   `+<8–15 digits>`                       any country, kept as given
 *   `+61 0412…` / `+610412…`               the trunk `0` people write after +61
 *   `61412345678`                          the country code without the `+`
 *   `0412 345 678` / `(04) 1234 5678`      national form
 *   `412 345 678`                          national form missing its trunk `0`
 */
export function australianMobileToE164(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Anything other than digits, spaces and the usual punctuation is not a
  // number somebody typed; a letter means it is a name, a note or an email.
  if (/[^0-9+\s().\-]/.test(trimmed)) return null;
  const plus = trimmed.startsWith("+");
  if (trimmed.indexOf("+", 1) !== -1) return null;
  const digits = trimmed.replace(/\D/g, "");

  if (plus) {
    // `+61 0412 345 678`: the national trunk prefix written after the country
    // code. Dropping it is not a repair — the number dials the same line.
    if (digits.startsWith("610") && digits.length === 12) {
      return `+61${digits.slice(3)}`;
    }
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith("61") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `+61${digits.slice(1)}`;
  }
  if (digits.length === 9 && /^[2-478]/.test(digits)) return `+61${digits}`;
  return null;
}

/**
 * The key a native conversation is filed under.
 *
 * SMS-addressable clients are keyed by their number, which is the key
 * `crm-inbound-message` derives from Twilio's `From` — so a reply to an
 * operator's first message lands in the thread that message opened.
 */
export function nativeConversationKey(input: {
  readonly mobileE164: string | null;
  readonly clientId: string;
}): string {
  return input.mobileE164
    ? smsConversationKey(input.mobileE164)
    : `${NATIVE_CONVERSATION_PREFIX}client-${input.clientId}`;
}

/** The key for a thread addressed by an E.164 number alone, as inbound has it. */
export function smsConversationKey(mobileE164: string): string {
  return `${NATIVE_CONVERSATION_PREFIX}sms-${mobileE164}`;
}

/**
 * The channels a client's record can be reached on, in the vocabulary
 * `ghl_conversations.available_channels` already uses.
 *
 * WhatsApp is never offered: this build has no native WhatsApp sender, and a
 * channel listed here is one the composer will let an operator pick.
 */
export function reachableChannels(input: {
  readonly mobileE164: string | null;
  readonly email: string | null | undefined;
}): ("sms" | "email")[] {
  const channels: ("sms" | "email")[] = [];
  if (input.mobileE164) channels.push("sms");
  if (typeof input.email === "string" && input.email.includes("@")) {
    channels.push("email");
  }
  return channels;
}

/**
 * The forms a person may have typed for one Australian number, so an inbound
 * `From` can find the client whose record stores it.
 *
 * Asked as an `IN` list of literal values, never as a composed filter string:
 * an interpolated PostgREST filter is the defect `screeningConsumer` paid for.
 * The caller confirms every candidate with `confirmedMobileMatches`, so a row
 * is linked only where its own number normalises to the same line — never on
 * a shared suffix, which can belong to a number in another country.
 */
export function mobileLookupVariants(e164: string): string[] {
  const variants = new Set<string>([e164]);
  const digits = e164.replace(/\D/g, "");
  variants.add(digits);
  if (e164.startsWith("+61") && digits.length === 11) {
    const local = digits.slice(2); // 412345678
    const national = `0${local}`; // 0412345678
    variants.add(national);
    variants.add(`${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`);
    variants.add(`+61 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`);
    variants.add(`61 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`);
    variants.add(`(${national.slice(0, 2)}) ${national.slice(2, 6)} ${national.slice(6)}`);
    variants.add(`${national.slice(0, 4)}-${national.slice(4, 7)}-${national.slice(7)}`);
    variants.add(`+61${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`);
  }
  return [...variants];
}

/**
 * The candidate client ids whose recorded mobile IS this number.
 *
 * One id answers; none or several answer `null`. Two records holding one
 * number (a couple filed twice, a duplicate import) is a question for a
 * person, and this webhook does not decide who somebody is.
 */
export function confirmedMobileMatches(
  mobileE164: string,
  candidates: ReadonlyArray<{ readonly id: string; readonly primary_mobile: string | null }>,
): string | null {
  const ids = new Set(
    candidates
      .filter((c) => australianMobileToE164(c.primary_mobile) === mobileE164)
      .map((c) => c.id),
  );
  return ids.size === 1 ? [...ids][0] : null;
}
