import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DECLARED_SOURCE_TYPE,
  draftsFromDeclaredFunding,
  fundingProgress,
  passportSofStampReadiness,
} from "@/lib/aml/fundingEvidence.pure";

/**
 * The customer declared; the analyst records and verifies; the Passport
 * stamps. Each hand-off has a rule, and each rule has a way to go quietly
 * wrong that these tests hold shut.
 */

const declared = (over = {}) => ({
  deposit: "200000",
  sources: ["Salary savings", "Loan / mortgage"],
  overseas: "no",
  narrative: "Family and savings ",
  institutions: "Cba",
  ...over,
});

const item = (over = {}) => ({
  id: "s1", source_type: "savings", description: "Salary savings",
  amount: null, currency: "AUD", verified: false, verified_at: null,
  ...over,
});

describe("drafts from the customer's declaration", () => {
  it("maps the portal's labels onto source types, keeping the words", () => {
    const drafts = draftsFromDeclaredFunding(declared(), []);
    expect(drafts.map((d) => d.source_type)).toEqual(["savings", "loan"]);
    // The customer's own words survive as the description — the record shows
    // what they said, not what a mapping renamed it to.
    expect(drafts.map((d) => d.description)).toEqual(["Salary savings", "Loan / mortgage"]);
  });

  it("NEVER invents a per-source amount", () => {
    /*
     * The declared deposit is a total across every source. Writing
     * deposit / sources.length against each row would put a number the
     * customer never stated into a CDD evidence table — a fabricated figure
     * is worse than a blank one. The total travels in the notes as context.
     */
    for (const d of draftsFromDeclaredFunding(declared(), [])) {
      expect(d.amount).toBeNull();
      expect(d.notes).toMatch(/declared deposit \$200000 \(total across all sources\)/);
    }
  });

  it("a draft cannot spell verified", () => {
    // A declaration is evidence towards verification, never the
    // verification. The type has no `verified` field at all, and the note
    // says where the words came from.
    for (const d of draftsFromDeclaredFunding(declared(), [])) {
      expect("verified" in d).toBe(false);
      expect(d.notes).toMatch(/declared by the customer/i);
    }
  });

  it("an already-recorded source is not offered again", () => {
    const drafts = draftsFromDeclaredFunding(declared(), [item()]);
    expect(drafts.map((d) => d.description)).toEqual(["Loan / mortgage"]);
  });

  it("an unrecognised label becomes `other` with the label kept verbatim", () => {
    // The failure mode of a new portal option is an ugly code, never a
    // silently wrong classification.
    const drafts = draftsFromDeclaredFunding(
      declared({ sources: ["Cryptocurrency windfall"] }), []);
    expect(drafts[0].source_type).toBe("other");
    expect(drafts[0].description).toBe("Cryptocurrency windfall");
  });

  it("no declaration, or no sources, seeds nothing", () => {
    expect(draftsFromDeclaredFunding(null, [])).toEqual([]);
    expect(draftsFromDeclaredFunding(declared({ sources: [] }), [])).toEqual([]);
    expect(draftsFromDeclaredFunding(declared({ sources: "not-an-array" }), [])).toEqual([]);
  });
});

describe("where the stage stands", () => {
  it("an unverified source is named a claim, not evidence", () => {
    const p = fundingProgress([item(), item({ id: "s2", verified: true, verified_at: "2026-08-25T00:00:00Z" })]);
    expect(p.settled).toBe(false);
    expect(p.sentence).toMatch(/a claim, not evidence/i);
  });

  it("settled means every recorded source verified, and at least one", () => {
    expect(fundingProgress([]).settled).toBe(false);
    expect(fundingProgress([item({ verified: true })]).settled).toBe(true);
  });
});

describe("what the Passport is promised", () => {
  it("recording alone earns nothing, and says so", () => {
    const r = passportSofStampReadiness([item()]);
    expect(r.earned).toBe(false);
    expect(r.sentence).toMatch(/recording alone does not earn it/i);
  });

  it("one verified source earns the stamp, dated by the latest verification", () => {
    const r = passportSofStampReadiness([
      item({ verified: true, verified_at: "2026-08-20T10:00:00Z" }),
      item({ id: "s2", verified: true, verified_at: "2026-08-25T10:00:00Z" }),
      item({ id: "s3", verified: false }),
    ]);
    expect(r.earned).toBe(true);
    expect(r.earnedAt).toBe("2026-08-25T10:00:00Z");
    expect(r.sentence).toContain("2026-08-25");
  });

  it("mirrors the passport's own rule, so it cannot promise a stamp the passport will not mint", () => {
    /*
     * The stamp derivation lives in `passportStamps.pure.ts`:
     *
     *   const sofAt = maxDate(input.source_of_funds.filter((r) => r.verified)
     *     .map((r) => r.verified_at));
     *   if (sofAt) make("source_of_funds_reviewed", ...)
     *
     * — at least one verified row, dated by the newest `verified_at`. If that
     * rule ever changes shape, this fails and the mirror gets updated with
     * it, instead of the panel quietly telling analysts something the
     * passport no longer does.
     */
    const src = readFileSync(join(
      __dirname,
      "../../../supabase/functions/_shared/aml/passport/passportStamps.pure.ts",
    ), "utf8");
    expect(src).toMatch(
      /const sofAt = maxDate\(input\.source_of_funds\.filter\(\(r\) => r\.verified\)\.map\(\(r\) => r\.verified_at\)\);/);
    expect(src).toMatch(/if \(sofAt\) make\("source_of_funds_reviewed", sofAt/);
    // And it is client-safe — the sentence tells the analyst the stamp is
    // outward-facing, which is only true while the vocabulary says so.
    expect(src).toMatch(
      /source_of_funds_reviewed: \{ title: "SOURCE OF FUNDS REVIEWED", shape: "rect", tone: "green", client_safe: true \}/);
  });
});

describe("the label map", () => {
  it("is declared lowercase, so lookups cannot miss on case", () => {
    for (const key of Object.keys(DECLARED_SOURCE_TYPE)) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
   THE DOCUMENTS, AND THE NEXT STEP
   ══════════════════════════════════════════════════════════════════════ */

import {
  documentDisplayName, evidenceNames, fundingDocuments, fundingNextStep,
  verifyWithEvidence,
} from "@/lib/aml/fundingEvidence.pure";

const doc = (over = {}) => ({
  id: "d1", filename: "17868163460724899975067990115218.jpg",
  display_name: null, status: "uploaded", uploaded_at: "2026-08-20T00:00:00Z",
  uploaded_by_type: "client",
  requirement: { code: "source_of_funds", label: "Source of funds evidence" },
  ...over,
});

describe("which documents are the funding evidence", () => {
  it("membership is the requirement code, never the filename", () => {
    /*
     * Matching on "bank", "statement" or "savings" would classify documents
     * by what they happen to be called — and a mis-filed passport named
     * `savings.pdf` would become funding evidence. The binding the client
     * upload already carries is the fact; a name is a guess.
     */
    const docs = fundingDocuments([
      doc(),
      doc({ id: "d2", requirement: { code: "source_of_wealth", label: "Source of wealth" } }),
      doc({ id: "d3", filename: "savings-statement.pdf", requirement: { code: "photo_id_primary", label: "Photo ID" } }),
      doc({ id: "d4", requirement: null }),
    ]);
    expect(docs.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("most reviewable first: accepted, then uploaded, then rejected", () => {
    const docs = fundingDocuments([
      doc({ id: "r", status: "rejected" }),
      doc({ id: "u", status: "uploaded" }),
      doc({ id: "a", status: "accepted" }),
    ]);
    expect(docs.map((d) => d.id)).toEqual(["a", "u", "r"]);
  });

  it("names a document the way Stage 4 does — display name, label, filename", () => {
    expect(documentDisplayName(doc())).toBe("Source of funds evidence");
    expect(documentDisplayName(doc({ display_name: "CBA statement Jan–Mar" })))
      .toBe("CBA statement Jan–Mar");
    expect(documentDisplayName(doc({ requirement: null }))).toBe(
      "17868163460724899975067990115218.jpg");
  });
});

describe("a verification names what it rested on", () => {
  it("writes a stable reference and the names as read at the time", () => {
    const body = verifyWithEvidence(
      { ...item({ id: "s1" }), metadata: { kept: "yes" } },
      [doc({ display_name: "CBA statement" }), doc({ id: "d2" })],
    );
    expect(body.verified).toBe(true);
    // An id reference, not a filename — a rename must not break the link.
    expect(body.evidence_path).toBe("aml_document:d1");
    expect(body.metadata.evidence_document_ids).toEqual(["d1", "d2"]);
    expect(body.metadata.evidence_document_names).toEqual([
      "CBA statement", "Source of funds evidence"]);
    // Merged, never replaced: what another surface stored survives.
    expect(body.metadata.kept).toBe("yes");
  });

  it("verifying with nothing named is legal, and explicit", () => {
    // Evidence can be something no upload holds — sighted in person, a
    // register checked. The empty list is the caller's choice; nothing here
    // invents a document.
    const body = verifyWithEvidence(item({ id: "s1" }), []);
    expect(body.evidence_path).toBeNull();
    expect(body.metadata.evidence_document_ids).toEqual([]);
  });

  it("reads back the names recorded at verification", () => {
    expect(evidenceNames({ metadata: { evidence_document_names: ["A", "", "B"] } }))
      .toEqual(["A", "B"]);
    expect(evidenceNames({ metadata: null })).toEqual([]);
    expect(evidenceNames({ metadata: { evidence_document_names: "not-a-list" } }))
      .toEqual([]);
  });
});

describe("the next step is derived from where the evidence stands", () => {
  const p = (recorded: number, verified: number) =>
    fundingProgress(Array.from({ length: recorded }, (_, i) =>
      item({ id: `s${i}`, verified: i < verified,
        verified_at: i < verified ? "2026-08-25T00:00:00Z" : null })));

  it("nothing recorded → record first", () => {
    expect(fundingNextStep(p(0, 0), [doc()]).key).toBe("record");
  });

  it("documents awaiting review outrank verification", () => {
    // An unreviewed document is read before a source is verified against it.
    const step = fundingNextStep(p(2, 0), [doc({ status: "uploaded" })]);
    expect(step.key).toBe("review_documents");
    expect(step.sentence).toMatch(/review the 1 funding document/i);
  });

  it("no document on file does not dead-end", () => {
    const step = fundingNextStep(p(1, 0), []);
    expect(step.key).toBe("chase_documents");
    expect(step.sentence).toMatch(/request the evidence/i);
    expect(step.sentence).toMatch(/sighted outside\s+the platform/i);
  });

  it("everything rejected does not dead-end either", () => {
    const step = fundingNextStep(p(1, 0), [doc({ status: "rejected" })]);
    expect(step.key).toBe("chase_documents");
    expect(step.sentence).toMatch(/rejected/i);
  });

  it("accepted documents and unverified sources → verify", () => {
    const step = fundingNextStep(p(2, 1), [doc({ status: "accepted" })]);
    expect(step.key).toBe("verify");
    expect(step.sentence).toMatch(/remaining 1\s+source/);
  });

  it("settled → continue to Stage 7, and only then", () => {
    const settled = fundingNextStep(p(2, 2), [doc({ status: "accepted" })]);
    expect(settled.key).toBe("settled");
    expect(settled.continueToSubmission).toBe(true);
    for (const other of [p(0, 0), p(2, 1)]) {
      expect(fundingNextStep(other, [doc()]).continueToSubmission).toBe(false);
    }
  });
});
