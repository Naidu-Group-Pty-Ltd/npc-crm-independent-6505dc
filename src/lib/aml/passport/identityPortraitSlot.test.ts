/**
 * The photograph on the Client Identity page — the slot, the absence, and the
 * one repair.
 *
 * The defect these pin: the Passport carried the holder's portrait on the
 * Identity Verification leaf, behind a filter that omitted the block whenever
 * no image was stored. So on the page a reader opens to see WHO this document
 * belongs to there was no face at all — and on every Passport issued before
 * portraits were stored (all of them) there was nothing anywhere, with nothing
 * on any screen saying why or what could be done about it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DISCLOSABLE_CAPTURE_KEY,
  WITHHELD_CAPTURE_KEYS,
  backfillPending,
  describeIdentityPortraitSlot,
  portraitAbsenceNote,
  portraitBackfillCandidate,
  portraitRecoverable,
  slotCaption,
} from "@/lib/aml/passport";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const FRONT = { bucket: "aml-documents", path: "case/verification/check/document-front.jpg" };
const SELFIE = { bucket: "aml-biometrics", path: "case/verification/check/selfie.jpg" };
const PORTRAIT = { bucket: "aml-biometrics", path: "case/verification/check/id-portrait.jpg" };

const facts = (over: Record<string, unknown> = {}) => ({
  captureObjects: { document_front: FRONT, selfie: SELFIE },
  documentChoice: "passport",
  issuingState: "AUS",
  completedAt: "2026-08-15T16:59:20.691Z",
  verified: true,
  ...over,
});

const STAMP = { attempted_at: "2026-08-29T07:47:15.000Z", outcome: "no_portrait_in_document" };
const ALL_REASONS = [
  "not_verified", "pending_retrieval", "provider_retains_media", "unavailable",
] as const;

describe("the slot always answers", () => {
  it("is a photograph when one is stored", () => {
    const slot = describeIdentityPortraitSlot(facts({
      captureObjects: { document_front: FRONT, selfie: SELFIE, id_portrait: PORTRAIT },
    }));
    expect(slot.available).toBe(true);
    expect(slot.reason).toBeNull();
    // The URL is minted for one reader at the moment of service, never here.
    expect(slot.url).toBeNull();
  });

  it("names the absence rather than leaving a gap", () => {
    /* Four situations produced one `null` before this, and the booklet's only
       way to render null was to omit the block. An absence with a reason is a
       document; an absence with no reason is a page that looks broken. */
    expect(describeIdentityPortraitSlot(facts({ verified: false })).reason)
      .toBe("not_verified");
    expect(describeIdentityPortraitSlot(facts()).reason)
      .toBe("pending_retrieval");
    expect(describeIdentityPortraitSlot(facts({ captureObjects: null })).reason)
      .toBe("provider_retains_media");

    for (const reason of ALL_REASONS) {
      expect(portraitAbsenceNote(reason).length).toBeGreaterThan(10);
    }
  });

  it("separates a photograph on its way from one that will never come", () => {
    /* Both are "no image" and they are not the same thing to a reader. A page
       that goes on promising an image the document does not carry is worse
       than one that says so — and one that says "unavailable" while the sweep
       is about to fetch it is wrong the other way. */
    expect(describeIdentityPortraitSlot(facts()).reason).toBe("pending_retrieval");
    expect(describeIdentityPortraitSlot(facts({ backfillStamp: STAMP })).reason)
      .toBe("unavailable");
    expect(portraitAbsenceNote("pending_retrieval")).toMatch(/retriev/i);
    expect(portraitAbsenceNote("unavailable")).not.toMatch(/retriev|await|pending/i);
  });

  it("says nothing about the customer, only about the record", () => {
    /* Nobody's identity is in question because a photograph was not
       retained, and the page must not read as though it were. */
    for (const reason of ALL_REASONS) {
      expect(portraitAbsenceNote(reason)).not.toMatch(/fail|refus|reject|unverif|invalid|suspic/i);
    }
  });

  it("still names the document under an empty frame", () => {
    // "Australian passport" under a blank mount is more use to a reader than
    // nothing, and it is a fact about the verification rather than the image.
    expect(slotCaption(describeIdentityPortraitSlot(facts()))).toBe("Australian passport");
  });
});

describe("what the sweep picks up, and how often", () => {
  it("is decided by whether NPC still holds the document page", () => {
    /* Deliberately not a rule about which vendor was used: holding the source
       image is what makes the re-read possible, and a provider rule goes
       stale the moment another one is added. */
    expect(portraitRecoverable({ document_front: FRONT, selfie: SELFIE })).toBe(true);
    expect(portraitRecoverable({ document_front: FRONT, id_portrait: PORTRAIT })).toBe(false);
    expect(portraitRecoverable({ selfie: SELFIE })).toBe(false);
    expect(portraitRecoverable(null)).toBe(false);
  });

  it("attempts each check exactly ONCE, whatever the outcome was", () => {
    /* The stamp's PRESENCE is the guard, never its outcome. Retrying a paid
       call against the same unreadable document would spend every minute for
       ever — the unattended spending the processor refuses by design. */
    const objects = { document_front: FRONT, selfie: SELFIE };
    expect(portraitBackfillCandidate({ objects }, objects)).toBe(true);
    expect(backfillPending(undefined, objects)).toBe(true);
    for (const outcome of ["stored", "no_portrait_in_document", "provider_unavailable", "storage_failed"]) {
      expect(backfillPending({ ...STAMP, outcome }, objects)).toBe(false);
      expect(portraitBackfillCandidate(
        { objects, portrait_backfill: { ...STAMP, outcome } }, objects,
      )).toBe(false);
    }
  });

  it("never picks up a check that already has its photograph", () => {
    const objects = { document_front: FRONT, id_portrait: PORTRAIT };
    expect(portraitBackfillCandidate({ objects }, objects)).toBe(false);
  });
});

describe("the allow-list of exactly one image survives", () => {
  it("still admits one key and names the other two", () => {
    expect(DISCLOSABLE_CAPTURE_KEY).toBe("id_portrait");
    expect([...WITHHELD_CAPTURE_KEYS].sort())
      .toEqual(["document_back", "document_front", "selfie"]);
  });

  it("the backfill writes the portrait and nothing else", () => {
    /* It re-derives an IMAGE and never re-decides an identity. A status, a
       verdict or a score written here would make a repair into a second,
       unasked-for verification of somebody who is already verified. */
    const src = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    const fn = src.slice(src.indexOf("export async function backfillIdentityPortrait"));
    expect(fn).toContain("id_portrait: stored");
    for (const forbidden of [
      "status: 'passed'", "status: 'failed'", "processing_status:",
      "completed_at:", "failure_reason:", "provider_error_category:",
    ]) {
      expect(fn.split("\n").filter((l) => l.includes(forbidden) && !l.trim().startsWith("*")).join())
        .not.toContain(forbidden);
    }
    // Only a verification that PASSED, re-checked in the UPDATE.
    expect(fn).toContain("check.status !== 'passed'");
    expect(fn).toContain(".eq('status', 'passed')");
  });

  it("puts the fetched image on the same deletion clock as the captures", () => {
    /* `aml-idv-retention` enumerates FIXED keys out of `standalone_capture`,
       so an object written anywhere else is one this product stores and never
       deletes — a worse defect than not storing it at all. */
    const src = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    const fn = src.slice(src.indexOf("export async function backfillIdentityPortrait"));
    expect(fn).toContain("standalone_capture: {");
    expect(read("supabase/functions/aml-idv-retention/index.ts")).toContain("id_portrait");
  });
});

describe("the repair runs by itself", () => {
  const processor = read("supabase/functions/aml-verification-processor/index.ts");
  const shared = read("supabase/functions/_shared/aml/standaloneVerification.ts");

  it("is driven by the sweep that already exists, not by an operator", () => {
    /* Asking somebody to click a button per case is asking them to fix this
       product's own record-keeping bug by hand, for ever — and it makes a
       Passport's completeness depend on whether anybody opened it. */
    expect(processor).toContain("runPortraitBackfill");
    expect(processor).toContain("findPortraitBackfillCandidates");
    // And there is no manual route left anywhere.
    expect(read("supabase/functions/aml-reliance/index.ts"))
      .not.toContain("recover_document_portrait");
    expect(read("src/lib/aml/amlRelianceApi.ts")).not.toContain("recoverDocumentPortrait");
  });

  it("never delays a customer who is waiting on their own verification", () => {
    // The live queue outranks a photograph missing from an old Passport.
    expect(processor).toContain("results.length === 0");
    expect(processor).toContain("BUDGET_MS");
  });

  it("is bounded per tick, so a backlog never becomes a burst of spending", () => {
    expect(processor).toMatch(/PORTRAIT_BACKFILL_LIMIT\s*=\s*[1-5]\b/);
  });

  it("cannot take the verification sweep down with it", () => {
    const fn = processor.slice(processor.indexOf("async function runPortraitBackfill"));
    expect(fn).toContain("catch");
  });

  it("stamps once the call has been made, on every path", () => {
    /* A request whose response never arrived has an unknown billing state,
       and re-sending it is exactly what this codebase refuses. */
    const fn = shared.slice(shared.indexOf("export async function backfillIdentityPortrait"));
    expect(fn).toContain("portrait_backfill: { attempted_at:");
    // One statement, so the stamp and the object can never disagree.
    expect(fn.match(/from\('verification_checks'\)\s*\n\s*\.update\(/g)?.length ?? 0)
      .toBe(1);
  });

  it("leaves no stamp where nothing was spent", () => {
    /* A database fault, an unconfigured provider or a deleted document page
       must not permanently disqualify a check from ever being repaired. */
    const fn = shared.slice(shared.indexOf("export async function backfillIdentityPortrait"));
    const beforeCall = fn.slice(0, fn.indexOf("runWithMetrics"));
    expect(beforeCall).toContain("'not_applicable'");
    expect(beforeCall).not.toContain("portrait_backfill: {");
  });
});
