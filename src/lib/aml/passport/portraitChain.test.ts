import { describe, it, expect } from "vitest";
import {
  captureObjectsFor, backfillStampFor, describeIdentityPortraitSlot,
  describeIdentityPortrait, identityPortraitObject, slotCaption,
} from "@/lib/aml/passport";
import { buildBooklet } from "@/lib/aml/passport";

/* outcome_detail as production actually holds it for AML-2026-00005. */
const OUTCOME = {
  standalone: {
    capture_objects: {
      selfie: { bucket: "aml-biometrics", path: "8b66/verification/00b7/selfie.jpg" },
      document_back: null,
      document_front: { bucket: "aml-documents", path: "8b66/verification/00b7/document-front.jpg" },
    },
    document_choice: "passport",
    face_match_reference: "id_portrait",
    id_verification: { id_verification: { issuing_state: "AUS", document_number: "REDACTED" } },
  },
  standalone_capture: {
    document_choice: "passport",
    objects: {
      selfie: { bucket: "aml-biometrics", path: "8b66/verification/00b7/selfie.jpg" },
      id_portrait: { bucket: "aml-biometrics", path: "8b66/verification/00b7/id-portrait.jpg" },
      document_back: null,
      document_front: { bucket: "aml-documents", path: "8b66/verification/00b7/document-front.jpg" },
    },
  },
};

describe("the whole chain, on the real payload", () => {
  const objects = captureObjectsFor(OUTCOME);

  it("1. the reader finds the stored object", () => {
    expect(identityPortraitObject(objects)).toEqual({
      bucket: "aml-biometrics", path: "8b66/verification/00b7/id-portrait.jpg",
    });
  });

  it("2. the descriptor is built, and carries no bucket, path or number", () => {
    const d = describeIdentityPortrait({
      captureObjects: objects, documentChoice: "passport",
      issuingState: "AUS", completedAt: "2026-08-15T16:59:20.691Z",
    })!;
    expect(d.available).toBe(true);
    expect(d.url).toBeNull();
    const json = JSON.stringify(d);
    for (const leak of ["aml-biometrics", "id-portrait.jpg", "REDACTED", "document-front"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("3. the Client Identity slot reads available, not pending", () => {
    const slot = describeIdentityPortraitSlot({
      captureObjects: objects, documentChoice: "passport", issuingState: "AUS",
      completedAt: "2026-08-15T16:59:20.691Z", verified: true,
      backfillStamp: backfillStampFor(OUTCOME),
    });
    expect(slot.available).toBe(true);
    expect(slot.reason).toBeNull();
    expect(slotCaption(slot)).toBe("Australian passport");
  });

  it("4. the booklet draws the bio block with the signed src", () => {
    const slot = describeIdentityPortraitSlot({
      captureObjects: objects, documentChoice: "passport", issuingState: "AUS",
      completedAt: "2026-08-15T16:59:20.691Z", verified: true,
      backfillStamp: backfillStampFor(OUTCOME),
    });
    const view: any = {
      audience: "command",
      header: {
        subject: "Rugesh Naidu", subject_type: "individual",
        credential: "AUX-AML-2026-00005-V1", case_reference: "AML-2026-00005",
        issuer_org: "AML/CTF Command Centre", officer_label: null,
        state: { label: "Issued · Current", code: "issued_current", tone: "ok", reasons: [] },
        current_version_label: "v1", evidence_fingerprint: null,
        evidence_fingerprint_short: "2809-9AC9", first_issued_at: "2026-08-27T00:00:00Z",
        last_issued_at: null, opened_at: null,
      },
      versions: [],
      identity: { fields: [], portrait: { ...slot, url: "https://signed.example/x.jpg?token=t" } },
      verification: { parties: [] }, documents: [], transactions: [],
      journey: { phases: [] }, ownership: [], stamps: [], pending_stamps: [],
      history: [], screening: null, funding: null, partners: [],
    };
    const pages = buildBooklet(view);
    const identity = pages.find((p: any) => p.id === "identity")!;
    const bio: any = identity.blocks.find((b: any) => b.kind === "bio");
    expect(bio).toBeTruthy();
    expect(bio.src).toBe("https://signed.example/x.jpg?token=t");
    expect(bio.absence).toBeNull();
    expect(bio.holder).toBe("Rugesh Naidu");
    expect(bio.caption).toBe("Australian passport");
  });

  it("5. an unsigned slot still draws the mount, and says why", () => {
    const view: any = {
      audience: "partner",
      header: {
        subject: "Rugesh Naidu", subject_type: "individual", credential: "X",
        case_reference: "AML-2026-00005", issuer_org: "Org", officer_label: null,
        state: { label: "Issued · Current", code: "issued_current", tone: "ok", reasons: [] },
        current_version_label: "v1", evidence_fingerprint: null,
        evidence_fingerprint_short: null, first_issued_at: null,
        last_issued_at: null, opened_at: null,
      },
      versions: [],
      identity: {
        fields: [],
        portrait: { available: false, reason: "pending_retrieval", document: "passport",
                    issuing_state: "AUS", captured_at: null, url: null },
      },
      verification: { parties: [] }, documents: [], transactions: [],
      journey: { phases: [] }, ownership: [], stamps: [], pending_stamps: [],
      history: [], screening: null, funding: null, partners: [],
    };
    const bio: any = buildBooklet(view).find((p: any) => p.id === "identity")!
      .blocks.find((b: any) => b.kind === "bio");
    expect(bio.src).toBeNull();
    expect(bio.absence).toMatch(/retriev/i);
    expect(bio.caption).toBe("Australian passport");
  });
});
