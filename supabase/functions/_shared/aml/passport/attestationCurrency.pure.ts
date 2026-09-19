/**
 * One living record, versioned history — which attestation a reader gets.
 *
 * ── The question this settles ─────────────────────────────────────────
 * An attestation is a frozen, hash-stamped statement of the customer due
 * diligence that was performed. Freezing it is not ceremony: a partner
 * relying under AML/CTF Act Pt 2 Div 7 must be able to say afterwards
 * *which* record they relied on, and a hash that changes underneath them
 * makes that unanswerable. So versions are real and they must stay.
 *
 * But the operator's question was the right one: *why is version management
 * mine?* Everyone — the Command Centre, the client, every partner — should
 * be looking at the current record, with the history filed rather than
 * administered.
 *
 * ── What was actually happening ───────────────────────────────────────
 * A grant pins `attestation_id` at the moment it is issued, and every read
 * path resolved the document through that pin. So the instant the MLRO
 * issued v2 — which is the ordinary consequence of a material change — every
 * existing partner's read answered **409 `attestation_superseded`**:
 *
 *   "This attestation has been superseded. Ask the issuing organisation for
 *    current access."
 *
 * Nothing was broken; it worked exactly as written. But issuing a new version
 * silently revoked every partner's access, and the only repair was for the
 * operator to re-issue the Passport to each of them by hand — which is the
 * work the operator was objecting to, and which nothing in the product told
 * them was now owed.
 *
 * ── The rule ──────────────────────────────────────────────────────────
 * A grant authorises a PARTNER to read a CASE's attested record. It does not
 * freeze which version of that record they may see. So a read resolves the
 * case's CURRENT attestation, and the version the reader actually saw is
 * recorded on the access log — where an auditor needs it — rather than
 * enforced by breaking the link.
 *
 * Three rules carry it.
 *
 * **The grant's pin is history, never the reading.** `attestation_id` still
 * records what the grant was issued against and is never rewritten: that is
 * the audit fact. It stops being the thing that decides what is served.
 *
 * **Current means CURRENT, not merely newer.** A version flagged for refresh
 * is withheld exactly as before. That is a different question from
 * supersession: superseded means "there is a better one, here it is", while
 * refresh-required means "we know this one is wrong and there is nothing
 * better yet", and serving the second would be letting a partner rely on a
 * record we have already contradicted.
 *
 * **A widening is never implicit.** Under schema v2 a partner reads through
 * a disclosure manifest scoped to one attestation. Following the current
 * version therefore requires a manifest for that version, and if one does not
 * exist the read fails closed — it does NOT fall back to the pinned version,
 * because a pinned manifest describes a document the reader is no longer
 * being shown.
 */

export interface AttestationRow {
  id: string;
  version: number | null;
  superseded_at?: string | null;
  refresh_required_at?: string | null;
  schema_version?: number | null;
}

export type CurrencyCode =
  /** The reader gets the case's current version. */
  | "current"
  /** They were issued against this exact version and it is still current. */
  | "current_as_issued"
  /** Current exists but is flagged: we know it is wrong and nothing is newer. */
  | "refresh_required"
  /** No attestation exists on this case at all. */
  | "none";

export interface CurrencyReading {
  /** The attestation to actually serve, or null when nothing may be. */
  serve: AttestationRow | null;
  code: CurrencyCode;
  /** True when the reader is being moved off the version they were pinned to. */
  movedForward: boolean;
  /** The version the grant was issued against — an audit fact, always kept. */
  issuedAgainstVersion: number | null;
  /** Partner-safe, and empty when there is nothing to say. */
  message: string;
}

/**
 * Which attestation this reader gets.
 *
 * `current` is the case's non-superseded attestation, whatever it is.
 * `pinned` is the one the grant was issued against, used only to report what
 * changed — never as a fallback, because falling back would serve a document
 * the issuing organisation has explicitly replaced.
 */
export function resolveAttestationForRead(input: {
  current: AttestationRow | null;
  pinned: AttestationRow | null;
}): CurrencyReading {
  const pinnedVersion = input.pinned?.version ?? null;

  if (!input.current) {
    /* No current version. Deliberately not the pinned one: an attestation
       with no live successor and a `superseded_at` of its own is a record the
       issuer withdrew, and serving it would be disclosing something they
       stopped standing behind. */
    return {
      serve: null, code: "none", movedForward: false,
      issuedAgainstVersion: pinnedVersion,
      message: "No current attestation is available for this matter. The issuing organisation is preparing it.",
    };
  }

  if (input.current.refresh_required_at) {
    /* Known-wrong beats known-old. A material change was recorded and no new
       version exists yet, so there is nothing correct to serve — this is the
       one hold that survives, and it is not supersession. */
    return {
      serve: null, code: "refresh_required", movedForward: false,
      issuedAgainstVersion: pinnedVersion,
      message: "The information behind this record has been updated and a refreshed version is being prepared. It will be available here without a new link.",
    };
  }

  const movedForward = Boolean(
    input.pinned && input.current.id !== input.pinned.id);

  return {
    serve: input.current,
    code: movedForward ? "current" : "current_as_issued",
    movedForward,
    issuedAgainstVersion: pinnedVersion,
    /* Said rather than hidden. A partner who relied on v1 and is now reading
       v2 must be able to see that, because what they may rely on is the
       record in front of them and not the one they remember. */
    message: movedForward
      ? `This record has been updated since your access was issued. You are reading version ${input.current.version ?? "—"}${pinnedVersion ? `; your access was issued against version ${pinnedVersion}` : ""}.`
      : "",
  };
}

/**
 * Does issuing a new version owe anything to the partners who already hold
 * access?
 *
 * Under schema v2 it does: each live grant reads through a disclosure
 * manifest scoped to one attestation, so a new version needs a manifest of
 * its own or every partner fails closed on `manifest_missing`. Under v1 there
 * is no manifest and nothing is owed.
 *
 * This is why re-issuing used to break partner access silently: the new
 * version was written and nothing carried the existing authorisations onto
 * it. Carrying them forward is ADDITIVE — a new manifest row per grant,
 * scoped exactly as the old one was. It widens nothing: the record classes,
 * the denied classes and the expiry all come from the manifest being
 * replaced, so a partner's authorisation after a re-issue is what it was
 * before it.
 */
export function grantsNeedingForwardManifest<T extends {
  id: string;
  revoked_at?: string | null;
  expires_at: string;
}>(
  grants: T[],
  opts: { schemaVersion: number | null; now?: Date },
): T[] {
  if ((opts.schemaVersion ?? 1) !== 2) return [];
  const now = (opts.now ?? new Date()).getTime();
  return grants.filter((g) =>
    !g.revoked_at && new Date(g.expires_at).getTime() > now);
}
