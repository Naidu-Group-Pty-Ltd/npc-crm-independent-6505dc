/**
 * Give the holder's portrait a short-lived URL, for one reader — once, for
 * every surface.
 *
 * ── Why the URL is attached here and not built into the view ──────────
 * `passportView.pure.ts` is pure and does no I/O, which is what makes it
 * testable and what lets one assembler serve four audiences. More
 * importantly, **a signed storage URL is a bearer credential with a
 * lifetime**: one inside a projection can be persisted, cached, embedded in
 * an attestation payload, or handed on after it stops being the reader's to
 * hold. So the projection carries a descriptor and the URL is minted at the
 * moment of service, for the request that asked.
 *
 * ── Why it is a module and not a helper in each function ──────────────
 * Because it was a helper in each function, and they drifted. `aml-reliance`
 * and `aml-client-portal` each carried their own copy of the same twenty
 * lines — the same object lookup, the same five-minute lifetime, the same
 * fail-soft branch — and each had to be corrected separately. The Command
 * Centre's document and the client's are the SAME document, and "identical"
 * has to be a property of one implementation rather than of two that agree
 * today.
 *
 * ── Fail-soft, always ─────────────────────────────────────────────────
 * A portrait that cannot be signed leaves `url` null, and the leaf draws its
 * empty frame and says so. A missing photograph must never fail a Passport.
 */

import { captureObjectsFor, identityPortraitObject } from "./identityPortrait.pure.ts";

/**
 * The lifetime of a portrait URL.
 *
 * The shortest that survives a slow first paint on a partner's connection
 * while being far too short to be worth passing on.
 */
export const PORTRAIT_URL_TTL_SECONDS = 300;

interface CheckRow {
  party_label?: string | null;
  status?: string | null;
  outcome_detail?: unknown;
}

/**
 * Whose photograph the Client Identity page shows.
 *
 * The assembler's own rule, restated here because this module has to find
 * the same party: the subject's own row where there is one, the first
 * otherwise.
 */
function subjectPartyLabel(view: any): string | null {
  const parties = view?.verification?.parties ?? [];
  const subject = view?.header?.subject ?? "Subject";
  if (parties.some((p: any) => p?.party === subject)) return subject;
  return parties[0]?.party ?? null;
}

/**
 * Attach signed URLs to every portrait on the view, in place.
 *
 * `checks` are the same rows the view was built from. The stored object is
 * found from them by the same allow-list of one key — the view never carries
 * a bucket or a path, and `PARTNER_RESTRICTED_KEYS` would refuse it if it
 * tried, so this is the only place the object can be resolved.
 */
export async function attachPortraitUrls(
  admin: any, view: any, checks: CheckRow[],
): Promise<void> {
  if (!view) return;

  /* One signing per stored object, shared by every slot that points at it.
     The Client Identity page and the party row are the SAME photograph, and
     minting two credentials for one image is two things to expire. */
  const signed = new Map<string, string | null>();
  const sign = async (ref: { bucket: string; path: string }): Promise<string | null> => {
    const key = `${ref.bucket}/${ref.path}`;
    if (signed.has(key)) return signed.get(key) ?? null;
    let url: string | null = null;
    try {
      const { data } = await admin.storage.from(ref.bucket)
        .createSignedUrl(ref.path, PORTRAIT_URL_TTL_SECONDS);
      url = data?.signedUrl ?? null;
    } catch {
      url = null;
    }
    signed.set(key, url);
    return url;
  };

  const subject = subjectPartyLabel(view);
  const objectsFor = (party: string) => {
    const match = (checks ?? []).find((c) =>
      (c.party_label ?? view?.header?.subject ?? "Subject") === party
      && c.status === "passed");
    return identityPortraitObject(captureObjectsFor(match?.outcome_detail));
  };

  for (const party of view?.verification?.parties ?? []) {
    if (!party?.portrait) continue;
    const ref = objectsFor(party.party);
    if (!ref) continue;
    const url = await sign(ref);
    if (!url) continue;
    party.portrait = { ...party.portrait, url };
  }

  /* The Client Identity page carries the same image, and is resolved
     independently of the party loop: a projection whose party row somehow
     lacks a descriptor must still be able to show the holder, because that
     leaf is the one the reader opens to find out whose document this is. */
  const slot = view?.identity?.portrait;
  if (slot?.available && !slot.url && subject) {
    const ref = objectsFor(subject);
    if (ref) {
      const url = await sign(ref);
      if (url) view.identity.portrait = { ...slot, url };
    }
  }
}
