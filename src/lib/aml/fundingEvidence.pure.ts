/**
 * Stage 6's working surface: what the customer declared, what has been
 * recorded, what is verified — and what the Aurixa Passport makes of it.
 *
 * ── The gap this closes ───────────────────────────────────────────────
 * The customer declares their funding in the portal questionnaire — deposit,
 * sources, institutions, a narrative — and that answer sits in the submission
 * snapshot. `aml.source_of_funds` is the canonical evidence table, with a
 * complete server op (`upsert_sof`: allowlisted columns, server-stamped
 * verifier, write-role gated) and a client API — **and no UI called it.**
 *
 * So Stage 6 said "No source of funds recorded" while the customer's own
 * declaration listed two sources one table away, and the stage's own button
 * opened a section with nothing actionable on it. The analyst's actual job —
 * turn the declaration into recorded, verified evidence — had no surface.
 *
 * ── The line every function here holds ────────────────────────────────
 * **A declaration is evidence towards verification; it is never the
 * verification.** Drafts seeded from the customer's answer always arrive
 * `verified: false`. Verifying is a person's act, recorded with the
 * verifier's name — the server stamps `verified_by` from the session and
 * discards any caller-supplied value.
 */

export interface DeclaredFunding {
  deposit?: string | number | null;
  sources?: unknown;
  overseas?: string | null;
  narrative?: string | null;
  institutions?: string | null;
}

export interface SofItemFacts {
  id?: string;
  source_type: string;
  description: string | null;
  amount: number | null;
  currency: string;
  verified: boolean;
  verified_at?: string | null;
  verified_by?: string | null;
  notes?: string | null;
}

/** A row ready to be recorded. Deliberately not a `SofItemFacts`: no id, and
 *  no way to spell `verified: true`. */
export interface SofDraft {
  source_type: string;
  description: string;
  amount: null;
  currency: "AUD";
  notes: string;
}

/**
 * The portal's source labels → `source_type` codes.
 *
 * Declared, not fuzzy-matched. An unrecognised label becomes `other` with the
 * label kept verbatim in the description — the failure mode of a new portal
 * option is an ugly code, never a silently wrong classification.
 */
export const DECLARED_SOURCE_TYPE: Record<string, string> = {
  "salary savings": "savings",
  "savings": "savings",
  "salary": "employment_income",
  "loan / mortgage": "loan",
  "loan": "loan",
  "gift": "gift",
  "gift from family": "gift",
  "sale of property": "property_sale",
  "sale of asset": "asset_sale",
  "inheritance": "inheritance",
  "business income": "business_income",
  "investment income": "investment_income",
  "superannuation": "superannuation",
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  savings: "Savings",
  employment_income: "Employment income",
  loan: "Loan / mortgage",
  gift: "Gift",
  property_sale: "Sale of property",
  asset_sale: "Sale of asset",
  inheritance: "Inheritance",
  business_income: "Business income",
  investment_income: "Investment income",
  superannuation: "Superannuation",
  other: "Other",
};

const clean = (v: unknown): string => String(v ?? "").trim();

/**
 * Drafts from the customer's declared funding — minus anything already
 * recorded, so pressing the button twice cannot double a source.
 *
 * ── What a draft deliberately does NOT carry ──────────────────────────
 * An amount. The declared deposit is a TOTAL across every source; the
 * customer never said how it splits. Writing `deposit / sources.length`
 * against each row would put a number the customer never stated into an
 * evidence table, and a fabricated figure in CDD evidence is worse than a
 * blank one — the analyst records the real amount when they verify it.
 * The declared total is carried in the notes instead, as context.
 */
export function draftsFromDeclaredFunding(
  declared: DeclaredFunding | null | undefined,
  existing: SofItemFacts[],
): SofDraft[] {
  if (!declared) return [];
  const labels = Array.isArray(declared.sources)
    ? declared.sources.map(clean).filter(Boolean)
    : [];
  if (labels.length === 0) return [];

  const context: string[] = [];
  const deposit = clean(declared.deposit);
  if (deposit) context.push(`declared deposit $${deposit} (total across all sources)`);
  const institutions = clean(declared.institutions);
  if (institutions) context.push(`institutions: ${institutions}`);
  const narrative = clean(declared.narrative);
  if (narrative) context.push(`narrative: “${narrative}”`);
  const note = "Declared by the customer in their portal submission"
    + (context.length ? ` — ${context.join("; ")}.` : ".");

  const held = new Set(existing.map((e) =>
    `${e.source_type}::${clean(e.description).toLowerCase()}`));

  return labels.flatMap((label) => {
    const type = DECLARED_SOURCE_TYPE[label.toLowerCase()] ?? "other";
    const description = label;
    if (held.has(`${type}::${description.toLowerCase()}`)) return [];
    return [{
      source_type: type,
      description,
      amount: null,
      currency: "AUD" as const,
      notes: note,
    }];
  });
}

/** Where the stage stands, in one honest sentence. */
export interface FundingProgress {
  recorded: number;
  verified: number;
  settled: boolean;
  sentence: string;
}

export function fundingProgress(items: SofItemFacts[]): FundingProgress {
  const recorded = items.length;
  const verified = items.filter((i) => i.verified).length;
  const settled = recorded > 0 && verified === recorded;
  return {
    recorded, verified, settled,
    sentence: recorded === 0
      ? "Nothing recorded yet. Record each source of funds, then verify it "
        + "against evidence."
      : settled
        ? `${verified} source${verified === 1 ? "" : "s"} recorded and verified.`
        : `${verified} of ${recorded} source${recorded === 1 ? "" : "s"} verified — `
          + "an unverified source is a claim, not evidence.",
  };
}

/**
 * What the Aurixa Passport will say about this stage.
 *
 * MIRRORS `passportStamps.pure.ts`: the SOURCE OF FUNDS REVIEWED stamp is
 * earned when at least one row is verified, dated by the latest
 * `verified_at`. A source test asserts the two rules cannot drift apart —
 * this module must never promise a stamp the passport will not mint.
 *
 * The stamp is `client_safe`: it appears on the passport the customer and
 * relying partners see. That is the whole reason to surface it here — the
 * verifying analyst is producing something outward-facing, and should know.
 */
export interface PassportStampReadiness {
  earned: boolean;
  earnedAt: string | null;
  sentence: string;
}

export function passportSofStampReadiness(items: SofItemFacts[]): PassportStampReadiness {
  const dates = items
    .filter((i) => i.verified)
    .map((i) => clean(i.verified_at))
    .filter(Boolean)
    .sort();
  const earnedAt = dates.length ? dates[dates.length - 1] : null;
  return {
    earned: earnedAt !== null,
    earnedAt,
    sentence: earnedAt
      ? `The Aurixa Passport carries SOURCE OF FUNDS REVIEWED, dated `
        + `${earnedAt.slice(0, 10)}. It is client-safe: the customer and relying `
        + "partners see it."
      : "Verifying a source earns SOURCE OF FUNDS REVIEWED on the Aurixa "
        + "Passport — a client-safe stamp the customer and relying partners see. "
        + "Recording alone does not earn it.",
  };
}

/* ══════════════════════════════════════════════════════════════════════
   THE DOCUMENTS — reviewed where the verification happens
   ══════════════════════════════════════════════════════════════════════
 *
 * Verifying a source of funds means looking at a document, and the
 * documents lived two stages back: the analyst read "Verify against
 * evidence", went to Stage 4, found the bank statement, reviewed it, came
 * back, and verified — with nothing on the record connecting the two acts.
 *
 * The binding already exists in the data. Every client upload carries a
 * `requirement` code, and `source_of_funds` is one of the seeded
 * requirements — so which documents ARE the funding evidence is a fact on
 * file, not a guess. And `aml.source_of_funds` has carried `evidence_path`
 * since the table was created, writable and never written: a verification
 * has never once named the document it rested on.
 */

export interface CaseDocumentFacts {
  id: string;
  filename: string;
  display_name?: string | null;
  status?: string | null;
  uploaded_at?: string | null;
  uploaded_by_type?: string | null;
  requirement?: { code?: string | null; label?: string | null } | null;
}

/** Requirement codes whose documents ARE funding evidence. */
export const FUNDING_REQUIREMENT_CODES = new Set(["source_of_funds", "source_of_wealth"]);

const DOC_ORDER: Record<string, number> = { accepted: 0, uploaded: 1, rejected: 2 };

/**
 * The case documents that belong to this stage, most reviewable first.
 *
 * Membership is the requirement CODE and nothing else. Matching on filenames
 * ("bank", "statement", "savings") would classify documents by what they
 * happen to be called, and a mis-filed passport named `savings.pdf` would
 * become funding evidence. A document uploaded against no requirement is
 * reachable through Stage 4, which this block links rather than duplicates.
 */
export function fundingDocuments(docs: CaseDocumentFacts[]): CaseDocumentFacts[] {
  return docs
    .filter((d) => FUNDING_REQUIREMENT_CODES.has(String(d.requirement?.code ?? "")))
    .sort((a, b) =>
      (DOC_ORDER[String(a.status ?? "uploaded")] ?? 1)
      - (DOC_ORDER[String(b.status ?? "uploaded")] ?? 1));
}

export function documentDisplayName(d: CaseDocumentFacts): string {
  return clean(d.display_name) || clean(d.requirement?.label) || d.filename;
}

/**
 * The write that verifies a source AND names what it rested on.
 *
 * `evidence_path` gets a stable `aml_document:<id>` reference (the column is
 * text, and a naked filename would break the link the moment the document is
 * renamed); `metadata` carries the ids and the names as read at the time, so
 * the record shows what the verifier saw even if a document is later
 * renamed or removed. Metadata is MERGED over the item's existing metadata —
 * this write must not erase what another surface stored there.
 *
 * Verifying with NO document named is legal and stays legal — evidence can
 * be something no upload holds (a payslip sighted in person, a register
 * checked). What it can never be is implicit: the caller chooses the empty
 * list; this function does not invent one.
 */
export function verifyWithEvidence(
  item: SofItemFacts & { metadata?: Record<string, unknown> | null },
  documents: CaseDocumentFacts[],
): {
  id: string | undefined;
  verified: true;
  evidence_path: string | null;
  metadata: Record<string, unknown>;
} {
  return {
    id: item.id,
    verified: true,
    evidence_path: documents.length > 0 ? `aml_document:${documents[0].id}` : null,
    metadata: {
      ...(item.metadata ?? {}),
      evidence_document_ids: documents.map((d) => d.id),
      evidence_document_names: documents.map(documentDisplayName),
    },
  };
}

/** What a verified row says it rested on. Names as recorded at verification. */
export function evidenceNames(
  item: { metadata?: Record<string, unknown> | null },
): string[] {
  const names = (item.metadata as { evidence_document_names?: unknown } | null)
    ?.evidence_document_names;
  return Array.isArray(names) ? names.map(clean).filter(Boolean) : [];
}

/* ══════════════════════════════════════════════════════════════════════
   THE NEXT STEP — one sentence, derived, never a dead end
   ══════════════════════════════════════════════════════════════════════ */

export interface FundingNextStep {
  key: "review_documents" | "record" | "verify" | "chase_documents" | "settled";
  sentence: string;
  /** True when the stage is settled and the walk continues to Stage 7. */
  continueToSubmission: boolean;
}

/**
 * What the operator does next, from where the evidence actually stands.
 *
 * Decided from the same facts the panel renders, so the guidance can never
 * point at work the panel does not show. The order is the work's own order:
 * an unreviewed document is read before a source is verified against it, and
 * nothing suggests verifying against documents that are all rejected.
 */
export function fundingNextStep(
  progress: FundingProgress,
  docs: CaseDocumentFacts[],
): FundingNextStep {
  const accepted = docs.filter((d) => String(d.status ?? "") === "accepted").length;
  const awaiting = docs.filter((d) => String(d.status ?? "uploaded") === "uploaded").length;

  if (progress.settled) {
    return {
      key: "settled", continueToSubmission: true,
      sentence: "This stage is settled — every recorded source is verified. "
        + "Continue to Stage 7 · Submission review.",
    };
  }
  if (progress.recorded === 0) {
    return {
      key: "record", continueToSubmission: false,
      sentence: "Record each source of funds first — the customer's declared "
        + "sources can be recorded in one click above.",
    };
  }
  if (awaiting > 0) {
    return {
      key: "review_documents", continueToSubmission: false,
      sentence: `Review the ${awaiting} funding document${awaiting === 1 ? "" : "s"} `
        + "awaiting review below, then verify each source against what you accepted.",
    };
  }
  if (accepted === 0) {
    return {
      key: "chase_documents", continueToSubmission: false,
      sentence: docs.length === 0
        ? "No funding document is on file. Request the evidence through the "
          + "document requirements, or verify from evidence sighted outside "
          + "the platform and record where it was seen."
        : "Every funding document on file was rejected. Request replacements "
          + "before verifying, or verify from evidence sighted outside the "
          + "platform and record where it was seen.",
    };
  }
  return {
    key: "verify", continueToSubmission: false,
    sentence: `Verify the remaining ${progress.recorded - progress.verified} `
      + `source${progress.recorded - progress.verified === 1 ? "" : "s"} against `
      + "the accepted documents below — each verification names the document "
      + "it rested on.",
  };
}
