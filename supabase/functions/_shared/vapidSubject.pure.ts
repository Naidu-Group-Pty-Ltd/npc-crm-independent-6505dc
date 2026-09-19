/**
 * The VAPID `sub` claim — who a push service contacts about this sender.
 *
 * RFC 8292 §2.1: the subject "SHOULD include a contact URI for the application
 * server as either a `mailto:` (email) or an `https:` URI". Both are valid, and
 * which one you have depends on the deployment.
 *
 * ## Why this is not a one-line `mailto:` prefix any more
 *
 * It was:
 *
 * ```ts
 * VAPID_SUBJECT.startsWith('mailto:') ? VAPID_SUBJECT : `mailto:${VAPID_SUBJECT}`
 * ```
 *
 * which turns a perfectly legal `https://tenant.example` subject into
 * `mailto:https://tenant.example` — a claim no push service accepts. That
 * mattered the moment the subject stopped being the prime's own address: every
 * workspace this platform provisions is its OWN sender, signing with its own
 * VAPID key pair (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are minted per
 * deployment and deliberately never inherited), so the contact has to be that
 * tenant's, and the value a control plane can derive for a tenant with no
 * further questions is its own site.
 *
 * The other half of the same defect: nothing forwarded the name this function
 * READS. Mission Control marked `VAPID_SUBJECT` inheritable — a variable no
 * function anywhere consults — while `VAPID_SUBJECT_EMAIL`, which this
 * function does consult, was forwarded by nothing. So every deployment fell
 * through to the code default and told push services to contact
 * `admin@example.com` about it.
 *
 * ## The rules
 *
 * **A subject is a contact URI, not an email address with a prefix.** An
 * `https:` or `mailto:` value is passed through as-is; a bare address becomes
 * `mailto:`; anything else is refused rather than sent malformed.
 *
 * **There is no fabricated fallback.** `admin@example.com` is not a contact —
 * it is a placeholder that reaches a push service looking exactly like a real
 * one, and it names a domain reserved by RFC 2606 that nobody can receive at.
 * An unset subject returns null, and the caller declines to send rather than
 * signing with a lie. That is the same rule as the platform's "never a
 * fabricated zero": an unusable value is worse than a visible absence.
 */

/** An address with an `@`, no spaces, and something either side of it. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value);
}

export type VapidSubject =
  | { ok: true; subject: string }
  | { ok: false; reason: "unset" | "unusable"; detail: string };

export function resolveVapidSubject(raw: string | null | undefined): VapidSubject {
  const value = (raw ?? "").trim();
  if (!value) {
    return {
      ok: false,
      reason: "unset",
      detail:
        "VAPID_SUBJECT_EMAIL is not set. It is the contact a push service uses about this " +
        "sender, and it must be this deployment's own — an https: URL of this site, or a " +
        "mailto: address somebody here receives.",
    };
  }

  const lower = value.toLowerCase();

  if (lower.startsWith("mailto:")) {
    const address = value.slice("mailto:".length).trim();
    if (!looksLikeEmail(address)) {
      return { ok: false, reason: "unusable", detail: `"${value}" is not a mailto: address.` };
    }
    return { ok: true, subject: `mailto:${address}` };
  }

  if (lower.startsWith("https://")) {
    try {
      const url = new URL(value);
      if (!url.hostname) throw new Error("no host");
      return { ok: true, subject: url.origin };
    } catch {
      return { ok: false, reason: "unusable", detail: `"${value}" is not an https: URL.` };
    }
  }

  // A bare address is the historical shape of this variable, and the one the
  // old prefix handled correctly.
  if (looksLikeEmail(value)) return { ok: true, subject: `mailto:${value}` };

  if (lower.startsWith("http://")) {
    return {
      ok: false,
      reason: "unusable",
      detail: "A VAPID subject must be https:, not http: — RFC 8292 admits mailto: and https:.",
    };
  }

  return {
    ok: false,
    reason: "unusable",
    detail: `"${value}" is neither an https: URL nor an email address, so it is not a contact URI.`,
  };
}
