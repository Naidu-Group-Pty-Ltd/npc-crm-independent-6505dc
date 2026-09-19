/**
 * The Compliance Passport as a partner receives it — the SAME document,
 * leaf for leaf, built from the disclosure and nothing else.
 *
 * ── What was wrong ────────────────────────────────────────────────────
 * Two defects, one after the other.
 *
 * First the partner was shown `JSON.stringify` of the attestation in a
 * `<pre>` — the literal object, braces and quoted keys and all. Everyone
 * inside the issuing business sees this record as a bound navy-and-gold
 * booklet; the one audience the document exists FOR was handed source code.
 *
 * Fixing that produced a booklet, but a DIFFERENT booklet: seven leaves with
 * their own titles ("Reliance basis", "Customer identity") beside a Command
 * Centre document of thirteen pages with titles of its own. Placed side by
 * side they read as two documents about one customer, and the obvious
 * question — which is the real one? — has no good answer. A passport whose
 * pages depend on who is holding it is not a passport.
 *
 * ── One instrument ────────────────────────────────────────────────────
 * The document has ONE leaf sequence, and it is the Command Centre's:
 * `BOOKLET_LEAVES` below carries the same ids, titles and order that
 * `buildBooklet` emits, and a test fails if the two ever diverge. Every leaf
 * appears in the partner's copy, in that order, under that title, at that
 * numeral. Nothing is missing, because nothing can be missing: a leaf is
 * either disclosed or it states why it is not.
 *
 * ── The three readings of a leaf ──────────────────────────────────────
 *   · **disclosed** — rendered from the disclosure the server sent.
 *   · **withheld** — the leaf carries the issuing organisation's own
 *     assessment, which a relying entity never receives. The reason is the
 *     AUDIENCE, so the statement is true whatever the case happens to hold.
 *   · **not in this disclosure** — the leaf is disclosable in principle and
 *     this grant does not carry it. Different from withheld, and said
 *     differently, because "we do not share this" and "this was not shared
 *     with you" are not the same sentence.
 *
 * ── The rule that governs every line below ────────────────────────────
 * **It renders the disclosure; it never adds to it.** The server intersects
 * the payload with the grant's manifest before sending it — the risk
 * assessment, screening match content and internal notes are not merely
 * hidden here, they never arrive. This module reads only the object it is
 * given, invents no fact and infers no conclusion.
 */

import { passportCredential, passportVersionLabel, shortFingerprint } from "./index";
import type { BookletBlock, BookletPage, BookletTone } from "./index";

/** The attestation payload, as `buildAttestationPayload` composes it. */
export interface PartnerDisclosure {
  attestation: Record<string, unknown>;
  attestation_sha256: string;
  issued_at: string;
  /** The version of the attestation this grant is bound to. */
  attestation_version?: number | null;
  agreement: { partner_org_name: string; agreement_reference: string; scope?: string[] };
  /** The statutory position, restated by the server at the point of use. */
  notice: string;
}

/**
 * The document's leaf sequence — the Command Centre's own, in its own order.
 *
 * This is not a partner-side invention: every entry mirrors a `push({...})`
 * in `buildBooklet`. `partnerBooklet.test.ts` reads that composer's source
 * and fails when an id here is missing there or the other way round, so a
 * leaf added to the Command Centre document cannot silently go missing from
 * the copy a partner receives.
 *
 * `share` records WHY a leaf reaches a relying entity or does not, and it is
 * a property of the audience rather than of any one case:
 *
 *   record   — the procedures performed. This is what reliance rests on.
 *   internal — the issuing organisation's own assessment, holdings and
 *              dealings. Never disclosed, on any case, to any partner.
 */
export const BOOKLET_LEAVES = [
  { id: "identity", title: "Client Identity", share: "record" },
  { id: "summary", title: "Compliance Summary", share: "record" },
  { id: "identity-detail", title: "Identity Information", share: "record" },
  { id: "verification", title: "Identity Verification", share: "record" },
  { id: "ownership", title: "Ownership & Control", share: "record" },
  { id: "screening", title: "Screening", share: "record" },
  { id: "funding", title: "Funding & Due Diligence", share: "internal" },
  { id: "evidence", title: "Evidence Wallet", share: "internal" },
  { id: "disclosure", title: "Disclosure & Access", share: "record" },
  { id: "partners", title: "Partner Access", share: "internal" },
  { id: "transaction", title: "Transaction & Matter", share: "internal" },
  { id: "seals", title: "Certification Seals", share: "internal" },
  { id: "versions", title: "Version Register", share: "internal" },
  { id: "journey", title: "Journey Record", share: "internal" },
  { id: "completion", title: "Transaction Completion", share: "internal" },
  { id: "renewal", title: "Review & Renewal", share: "record" },
] as const;

/** Why a leaf a partner cannot read is not disclosed to them. */
const WITHHELD_REASON: Record<string, string> = {
  funding:
    "Source-of-funds and source-of-wealth enquiries are the issuing organisation's own due "
    + "diligence. What is disclosed to a relying entity is that identification procedures were "
    + "performed, never the enquiries behind them.",
  evidence:
    "The customer's documents themselves are held by the issuing organisation and are not "
    + "distributed. This record states which procedures were performed against them.",
  partners:
    "Which other organisations hold access to this record, and what each of them determined, is "
    + "not part of your reliance and is not shared.",
  transaction:
    "The matter, its parties and its financial particulars belong to the issuing organisation's "
    + "engagement with the customer.",
  seals:
    "Certification impressions are struck against the issuing organisation's own register. A seal "
    + "printed without that record behind it would be an impression of nothing.",
  versions:
    "The version history of this record is the issuing organisation's. Your copy names the version "
    + "you hold and the fingerprint that identifies it.",
  journey:
    "The case's own event register contains reviewer and MLRO reasoning, which is never disclosed "
    + "to a relying entity.",
  completion:
    "Settlement and completion of the underlying matter are the issuing organisation's record.",
};

const ROMAN = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII",
  "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI",
];

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const dash = (v: string | null | undefined) => (v && v.length > 0 ? v : "—");

function fmtDate(iso: unknown): string {
  const s = str(iso);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

/**
 * `electronic_idv` is not a phrase anybody says out loud.
 *
 * A relying entity is reading this to decide whether the identification meets
 * their own requirements, so the method has to be readable. An unrecognised
 * code is printed as it arrived rather than guessed at — inventing a friendly
 * label for a method this build has never seen would be a claim about what
 * was performed.
 */
const METHOD_LABELS: Record<string, string> = {
  electronic_idv: "Electronic identity verification",
  document_sighting: "Certified document sighting",
  dvs: "Document Verification Service (DVS)",
};

const CONSENT_LABELS: Record<string, string> = {
  identity_verification: "Identity verification",
  biometric_collection: "Biometric collection",
  compliance_sharing: "Sharing of the completed verification",
  record_keeping: "Record keeping",
  regulatory_reporting: "Regulatory reporting",
  aml_ctf_program: "AML/CTF programme",
  privacy_notice: "Privacy notice",
};

const LIMITATION_LABELS: Record<string, string> = {
  documents_not_verified_against_issuing_authority:
    "Documents were not verified against the issuing authority",
  liveness_signal_is_heuristic_only: "The liveness signal is heuristic only",
};

const LIST_LABELS: Record<string, string> = {
  un: "United Nations Consolidated List",
  dfat: "DFAT Consolidated List (Australia)",
  ofac: "OFAC (United States)",
};

const humanise = (code: string) =>
  code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const methodLabel = (code: string | null) =>
  code ? (METHOD_LABELS[code] ?? humanise(code)) : "—";

export function buildPartnerBooklet(d: PartnerDisclosure): BookletPage[] {
  const a = d.attestation ?? {};
  const subject = str(a.subject);
  const caseReference = str(a.case_reference);
  const issuer = str(a.issuer) ?? "the issuing organisation";
  const version = typeof d.attestation_version === "number" ? d.attestation_version : null;

  /* The SAME helpers the Command Centre renders its cover from, so the
     identifier on the two documents is character-identical rather than
     similar. A partner comparing their copy with the issuer's must not have
     to wonder whether "AML-2026-00005" and "AUX-AML-2026-00005-V1" name the
     same instrument. */
  const credential = passportCredential(caseReference, version);
  const versionLabel = passportVersionLabel(version);
  const fingerprintShort = shortFingerprint(d.attestation_sha256);

  const pages: BookletPage[] = [];

  /* ── cover ───────────────────────────────────────────────────────── */
  pages.push({
    id: "cover",
    variant: "cover",
    kicker: "Aurixa Systems",
    title: "AML/CTF Compliance Passport",
    sub: subject ?? undefined,
    numeral: null,
    foot: [credential, versionLabel].filter(Boolean).join("  ·  "),
    fingerprint: fingerprintShort,
    blocks: [],
  });

  const identity = obj(a.customer_identification);
  const parties = arr(identity?.parties)
    .map((p) => obj(p))
    .filter((p): p is Record<string, unknown> => p !== null);
  const screening = obj(a.screening);
  const screeningPerformed = screening?.performed === true;
  const consents = arr(identity?.consents_held)
    .map((c) => obj(c))
    .filter((c): c is Record<string, unknown> => c !== null);
  const limitations = arr(a.limitations).map((l) => String(l));

  /**
   * A leaf the partner cannot read, printed rather than dropped.
   *
   * Dropping it is what produced two documents of different lengths. Printing
   * it keeps the instrument whole and tells a relying entity exactly where
   * the boundary of their reliance sits — which is information they need, not
   * information withheld from them.
   */
  const absent = (title: string, reason: string, heading: string): BookletBlock[] => ([
    { kind: "statement", text: heading },
    { kind: "note", title, text: reason },
  ]);

  const blocksFor = (id: string, share: "record" | "internal"): BookletBlock[] | null => {
    if (share === "internal") {
      return absent(
        "Not disclosed to a relying entity",
        WITHHELD_REASON[id] ?? "This leaf is the issuing organisation's own record.",
        "This leaf is part of the issuing organisation's record and is not disclosed.",
      );
    }

    switch (id) {
      /* I — the same eight fields the Command Centre prints, from the same
         helpers, so the two covers and the two identity leaves agree. */
      case "identity":
        return [
          {
            kind: "fields",
            items: [
              { k: "Client name", v: dash(subject) },
              { k: "Credential ID", v: dash(credential), mono: true },
              { k: "Customer type", v: str(a.subject_type) ? humanise(str(a.subject_type)!) : "—" },
              { k: "AML case", v: dash(caseReference), mono: true },
              { k: "Issue date", v: fmtDate(d.issued_at) },
              { k: "Version", v: dash(versionLabel), mono: true },
              { k: "Disclosed to", v: d.agreement.partner_org_name },
              { k: "Fingerprint", v: dash(fingerprintShort), mono: true },
            ],
          },
          {
            kind: "note",
            title: "Originating organisation",
            text: `${issuer}${caseReference ? ` · matter ${caseReference}` : ""}`,
          },
          { kind: "banner", text: "Verified · Trusted · Compliant" },
        ];

      /* II — the same summary rows the Command Centre derives, limited to the
         two the disclosure carries. A row is emitted only where the record
         answers it: "PENDING" against something never disclosed would be a
         statement about the customer that nobody made. */
      case "summary": {
        const items: Extract<BookletBlock, { kind: "summary" }>["items"] = [];
        if (parties.length > 0) {
          const verified = parties.filter((p) => p.verified === true).length;
          items.push({
            k: "KYC verification",
            sub: verified > 0 ? "Identity verified and validated" : "Not yet verified",
            status: verified > 0 ? "VERIFIED" : "PENDING",
            tone: verified > 0 ? "ok" : "na",
          });
        }
        if (screening) {
          items.push({
            k: "Sanctions screening",
            sub: screeningPerformed
              ? "Screening performed for every identified party"
              : "Not performed",
            status: screeningPerformed ? "VERIFIED" : "PENDING",
            tone: screeningPerformed ? "ok" : "na",
          });
        }
        if (items.length === 0) return null;
        return [
          { kind: "summary", items },
          {
            kind: "verify",
            code: dash(credential),
            fingerprint: dash(fingerprintShort),
            text:
              "Confirm this credential with the issuer against the credential ID and evidence "
              + "fingerprint below.",
          },
        ];
      }

      /* III — the customer's own attributes. A grant discloses the procedures
         performed rather than the attribute set behind them, so this is
         ordinarily absent, and says which of the two it is. */
      case "identity-detail": {
        const items: Array<{ k: string; v: string; mono?: boolean }> = [];
        if (identity && typeof identity.sections_submitted === "number") {
          items.push({
            k: "Questionnaire sections completed", v: String(identity.sections_submitted),
          });
        }
        if (identity && str(identity.questionnaire_version)) {
          items.push({
            k: "Questionnaire version", v: str(identity.questionnaire_version)!, mono: true,
          });
        }
        if (items.length === 0) return null;
        return [
          { kind: "fields", items },
          {
            kind: "note",
            title: "What is disclosed here",
            text:
              "This grant discloses the customer identification procedures that were performed. "
              + "The underlying attributes recorded for the customer remain with the issuing "
              + "organisation.",
          },
        ];
      }

      /* IV — the leaf a relying entity actually reads. */
      case "verification": {
        if (parties.length === 0) return null;
        return [
          {
            kind: "matrix",
            title: "Parties",
            items: parties.map((p) => {
              const verified = p.verified === true;
              const cells: Array<{ t: string; tone: BookletTone }> = [
                { t: methodLabel(str(p.method)), tone: verified ? "info" : "na" },
                { t: fmtDate(p.completed_at), tone: "na" },
              ];
              const documentType = str(p.document_type);
              if (documentType) cells.push({ t: humanise(documentType), tone: "na" });
              const certifier = str(p.certifier_capacity);
              if (certifier) cells.push({ t: `Certified by ${humanise(certifier)}`, tone: "na" });
              return {
                k: str(p.party) ?? "Party",
                v: verified ? "Verified" : "Not verified",
                tone: verified ? "ok" : "warn",
                cells,
              };
            }),
          },
        ];
      }

      case "ownership":
        return null;

      /* VI — that screening ran, and how current the lists were. Never what
         it surfaced: the absence is STATED so silence cannot be read as
         "nothing was found". */
      case "screening": {
        if (!screening) return null;
        const blocks: BookletBlock[] = [
          {
            kind: "fields",
            items: [
              { k: "Screening performed", v: screeningPerformed ? "Yes" : "No" },
              { k: "Last performed", v: fmtDate(screening.last_performed_at) },
            ],
          },
        ];
        const scope = arr(screening.scope).map((s) => String(s));
        if (scope.length > 0) {
          blocks.push({
            kind: "chips",
            title: "Scope screened",
            items: scope.map((s) => ({ t: humanise(s), tone: "info" as BookletTone })),
          });
        }
        const freshness = obj(screening.list_freshness) ?? {};
        const codes = Object.keys(freshness);
        if (codes.length > 0) {
          blocks.push({
            kind: "rows",
            title: "Lists screened against, and when each was last loaded",
            items: codes.map((code) => ({
              k: LIST_LABELS[code] ?? code.toUpperCase(),
              v: fmtDate(freshness[code]),
            })),
          });
        }
        blocks.push({
          kind: "note",
          title: "What is deliberately absent",
          text:
            "This record states THAT screening was performed and how current the lists were. It "
            + "carries no match content: what a screening surfaced, and what was concluded about "
            + "it, belongs to the issuing organisation's own assessment.",
        });
        return blocks;
      }

      /* IX — for a partner, "Disclosure & Access" IS their authority: who
         holds this record, under what arrangement, and on what consent. */
      case "disclosure": {
        const blocks: BookletBlock[] = [
          { kind: "statement", text: d.notice },
          {
            kind: "fields",
            items: [
              { k: "Disclosed to", v: d.agreement.partner_org_name },
              { k: "Arrangement", v: d.agreement.agreement_reference },
              { k: "Issued by", v: issuer },
              { k: "Issue date", v: fmtDate(d.issued_at) },
            ],
          },
        ];
        if (consents.length > 0) {
          blocks.push({
            kind: "rows",
            title: "Consents held from the customer",
            items: consents.map((c) => {
              const code = str(c.code) ?? "";
              const ver = str(c.version);
              return {
                k: CONSENT_LABELS[code] ?? humanise(code),
                note: ver ? `Version ${ver}` : undefined,
                v: fmtDate(c.accepted_at),
              };
            }),
          });
        }
        blocks.push({
          kind: "note",
          title: "What this record contains",
          text:
            "It states the customer identification procedures that were performed. It does not "
            + "contain the issuing organisation's risk assessment, screening match content or "
            + "internal notes, and it never will.",
        });
        return blocks;
      }

      /* XVI — the boundaries of the record and how it is checked. */
      case "renewal": {
        const blocks: BookletBlock[] = [];
        if (limitations.length > 0) {
          blocks.push({
            kind: "rows",
            title: "Limitations stated by the issuing organisation",
            items: limitations.map((code) => ({
              k: LIMITATION_LABELS[code] ?? humanise(code),
              v: "Disclosed",
            })),
          });
        }
        blocks.push({
          kind: "verify",
          code: dash(credential),
          fingerprint: d.attestation_sha256,
          text:
            "This SHA-256 fingerprint is taken over the disclosed record. If the issuing "
            + "organisation re-issues the attestation the fingerprint changes, the version you "
            + "hold is superseded, and a replacement is issued to you.",
        });
        blocks.push({
          kind: "note",
          title: "Your own obligations are unchanged",
          text:
            "Relying on these procedures does not transfer your organisation's AML/CTF "
            + "obligations. Safe practice is to satisfy yourself independently — you may record "
            + "your own determination against these same records at any time, without approaching "
            + "the customer again.",
        });
        return blocks;
      }

      default:
        return null;
    }
  };

  for (const leaf of BOOKLET_LEAVES) {
    const blocks = blocksFor(leaf.id, leaf.share);
    const leafIndex = pages.filter((p) => p.variant === "leaf").length;
    pages.push({
      id: leaf.id,
      variant: "leaf",
      kicker: leafIndex === 0
        ? "AML/CTF Compliance Passport"
        : `Page ${ROMAN[leafIndex] ?? String(leafIndex + 1)}`,
      title: leaf.title,
      numeral: ROMAN[leafIndex] ?? String(leafIndex + 1),
      blocks: blocks ?? absent(
        "Not part of this disclosure",
        "This leaf is disclosable, and this grant does not carry it. Ask the issuing "
        + "organisation if your assessment requires it.",
        "This leaf was not included in the record disclosed to you.",
      ),
    });
  }

  return pages;
}
