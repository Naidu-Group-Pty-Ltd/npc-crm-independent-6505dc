import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DISCLOSABLE_CAPTURE_KEY, WITHHELD_CAPTURE_KEYS, describeIdentityPortrait,
  identityPortraitObject, portraitCaption,
} from "../../../../supabase/functions/_shared/aml/passport/identityPortrait.pure";

/**
 * The photograph on the Compliance Passport.
 *
 * A Passport that proves an identity was verified and shows no face is a
 * certificate. So the booklet carries one image — and WHICH one is the whole
 * question, because three exist in a standalone verification and two of them
 * must never leave the verification record:
 *
 *   · `id_portrait`    the face the provider extracted from the DOCUMENT.
 *   · `document_front` the bio page as photographed: number, MRZ, date of
 *                      birth, signature. Staff evidence, never published.
 *   · `selfie`         the live capture. Biometric media of the person.
 *
 * The rule is an ALLOW-LIST of one key, not a deny-list over the other two:
 * a deny-list over a payload that gains a field later is how the wrong image
 * ships.
 */

const objects = {
  selfie: { bucket: "aml-biometrics", path: "case/verification/check/selfie.jpg" },
  document_front: { bucket: "aml-documents", path: "case/verification/check/document-front.jpg" },
  document_back: null,
  id_portrait: { bucket: "aml-biometrics", path: "case/verification/check/id-portrait.jpg" },
};

describe("exactly one image may leave the verification record", () => {
  it("the portrait extracted from the document", () => {
    expect(DISCLOSABLE_CAPTURE_KEY).toBe("id_portrait");
    expect(identityPortraitObject(objects)).toEqual({
      bucket: "aml-biometrics", path: "case/verification/check/id-portrait.jpg",
    });
  });

  it("the document page and the selfie are NAMED as withheld", () => {
    /* Named rather than merely absent, so a reader of the module sees the
       decision instead of inferring it from a gap. */
    expect([...WITHHELD_CAPTURE_KEYS].sort())
      .toEqual(["document_back", "document_front", "selfie"]);
  });

  it("and no argument returns them", () => {
    /* The function takes the whole object and answers with one key. There is
       no parameter that widens it. */
    expect(identityPortraitObject({ selfie: objects.selfie })).toBeNull();
    expect(identityPortraitObject({ document_front: objects.document_front })).toBeNull();
    expect(identityPortraitObject({ document_back: objects.document_front })).toBeNull();
  });

  it("a malformed or traversing path is not a portrait", () => {
    for (const bad of [
      { id_portrait: { bucket: "aml-biometrics", path: "/etc/passwd" } },
      { id_portrait: { bucket: "aml-biometrics", path: "case/../../secret.jpg" } },
      { id_portrait: { bucket: "", path: "x.jpg" } },
      { id_portrait: { bucket: "aml-biometrics", path: "" } },
      { id_portrait: "aml-biometrics/x.jpg" },
      { id_portrait: null },
    ]) {
      expect(identityPortraitObject(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(identityPortraitObject(null)).toBeNull();
    expect(identityPortraitObject(undefined)).toBeNull();
  });
});

describe("the descriptor carries no credential and no document data", () => {
  const facts = {
    captureObjects: objects,
    documentChoice: "passport",
    issuingState: "AUS",
    completedAt: "2026-08-15T16:59:20.691Z",
  };

  it("it says what the face was printed on, never what the document says", () => {
    /* "Verified against an Australian passport" is the fact a relying party
       needs. The passport NUMBER is the credential they do not. */
    const d = describeIdentityPortrait(facts)!;
    expect(d).toEqual({
      available: true, document: "passport", issuing_state: "AUS",
      captured_at: "2026-08-15T16:59:20.691Z", url: null,
    });
    const serialised = JSON.stringify(d).toLowerCase();
    for (const leak of ["bucket", "path", "mrz", "number", "birth", "signature"]) {
      expect(serialised, leak).not.toContain(leak);
    }
  });

  it("the URL is null in the projection — it is minted at the moment of service", () => {
    /* A signed storage URL is a bearer credential with a lifetime. One
       inside a projection can be persisted, cached, embedded in an
       attestation payload, or handed on after it stops being the reader's
       to hold. */
    expect(describeIdentityPortrait(facts)!.url).toBeNull();
  });

  it("no portrait stored is null, and that is the ordinary case", () => {
    /* Every verification recorded before portraits were stored, every
       hosted-provider verification, and every attempt whose portrait could
       not be written. Each surface must render unchanged. */
    expect(describeIdentityPortrait({ ...facts, captureObjects: { selfie: objects.selfie } }))
      .toBeNull();
    expect(describeIdentityPortrait({ ...facts, captureObjects: null })).toBeNull();
  });

  it("an unrecognised document kind is null rather than echoed back", () => {
    const d = describeIdentityPortrait({ ...facts, documentChoice: "<script>" })!;
    expect(d.document).toBeNull();
  });
});

describe("the caption names the document, in words", () => {
  const base = {
    captureObjects: objects, documentChoice: "passport",
    issuingState: "AUS", completedAt: null,
  };

  it("an Australian passport reads as one", () => {
    expect(portraitCaption(describeIdentityPortrait(base)!)).toBe("Australian passport");
  });

  it("a licence reads as words, never as a column name", () => {
    expect(portraitCaption(describeIdentityPortrait({ ...base, documentChoice: "driver_licence" })!))
      .toBe("Australian driver licence");
    expect(portraitCaption(describeIdentityPortrait({ ...base, documentChoice: "driver_licence" })!))
      .not.toMatch(/_/);
  });

  it("with no document kind it still says something true", () => {
    expect(portraitCaption(describeIdentityPortrait({ ...base, documentChoice: null, issuingState: null })!))
      .toBe("identity document");
  });
});

describe("wired end to end, and additive throughout", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the portrait is stored beside the captures, in a private bucket", () => {
    const verification = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    expect(verification).toContain("async function storeIdentityPortrait(");
    // The selfie's own bucket and prefix — derived from the plan rather than
    // rebuilt, so it can never drift from the attempt's.
    expect(verification).toContain("const bucket = plan.objects.selfie.bucket;");
    expect(verification).toContain("id-portrait.jpg");
  });

  it("and is DELETED on the same clock as everything else", () => {
    /* An image this product stores and never deletes would be a worse
       defect than not storing it at all. The retention job enumerates fixed
       keys, so a new object has to be added there or it is never seen. */
    const retention = read("supabase/functions/aml-idv-retention/index.ts");
    expect(retention).toContain("plan.objects.id_portrait");
    const plan = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    // The job reads the PLAN, not the evidence block, so the plan is
    // re-persisted with the derived object on it.
    expect(plan).toContain("standalone_capture: {");
    expect(plan).toContain("objects: plan.objects,");
  });

  it("storing it can never fail a verification", () => {
    const verification = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    const fn = verification.slice(
      verification.indexOf("async function storeIdentityPortrait("),
      verification.indexOf("async function download("));
    expect(fn).toContain("return null;");
    expect(fn).toContain("} catch {");
    expect(fn).not.toMatch(/\bthrow\b/);
  });

  it("the URL is signed at the moment of service, never in the projection", () => {
    /* The rule, not the location: a signed storage URL is a bearer
       credential with a lifetime, so no pure projection may mint one. The
       signing itself has moved into ONE shared module — it was twenty
       duplicated lines in each of two edge functions, which is how the
       client's Passport and the issuer's came to be corrected separately. */
    for (const pure of [
      "supabase/functions/_shared/aml/passport/passportView.pure.ts",
      "supabase/functions/_shared/aml/passport/passportBooklet.pure.ts",
      "supabase/functions/_shared/aml/passport/identityPortrait.pure.ts",
    ]) {
      expect(read(pure), pure).not.toContain("createSignedUrl");
    }
    const signer = read("supabase/functions/_shared/aml/passport/attachPortraitUrls.ts");
    expect(signer).toContain("createSignedUrl(ref.path");
    for (const fn of [
      "supabase/functions/aml-reliance/index.ts",
      "supabase/functions/aml-client-portal/index.ts",
    ]) {
      expect(read(fn), fn).toContain("attachPortraitUrls(admin, view, checks ?? []);");
    }
  });

  it("ONE assembler serves the Command Centre, the client and the partner", () => {
    /* The partner's copy and the Command Centre's cannot drift, because
       they are the same function with an audience parameter. */
    const reliance = read("supabase/functions/aml-reliance/index.ts");
    expect(reliance).toContain('buildCasePassportView(admin, caseId, "command")');
    expect(reliance).toContain('buildCasePassportView(admin, link.case_id, "partner")');
    expect(reliance).toContain("await attachPortraitUrls(admin, view, checks ?? []);");
  });

  it("the booklet draws it on the CLIENT IDENTITY leaf, unconditionally", () => {
    /* The rule, not the wording: the holder's photograph belongs on the page
       that bears their identity, and the mount is drawn whether or not there
       is an image. A block that disappeared on a missing photograph is what
       left the bio page with no holder on it and no way to tell why. */
    const booklet = read(
      "supabase/functions/_shared/aml/passport/passportBooklet.pure.ts");
    const identityLeaf = booklet.slice(
      booklet.indexOf('id: "identity",'),
      booklet.indexOf('id: "summary",'),
    );
    expect(identityLeaf).toContain('kind: "bio"');
    // Not behind a filter, a length check or a ternary that can omit it.
    expect(identityLeaf).not.toMatch(/\.filter\([^)]*portrait/);
    // And it carries the reason when it carries no image.
    expect(identityLeaf).toContain("absence:");

    const blocks = read("src/components/aml/passport/design/BookletBlocks.tsx");
    expect(blocks).toContain('case "bio":');
    expect(blocks).toContain("passport-portrait__empty");
    /* The empty frame is a branch of the SAME block, never a second block:
       one implementation cannot render the two states differently. */
    expect(blocks).not.toContain('case "portrait":');
  });

  it("the verification leaf's standing disclaimer stays TRUE", () => {
    /* It said captured biometric media stays inside the verification record.
       One image now leaves it — the face PRINTED ON THE DOCUMENT — so the
       sentence has to name that image and where it went, rather than being
       read as a claim that the booklet carries no photograph at all. */
    const booklet = read(
      "supabase/functions/_shared/aml/passport/passportBooklet.pure.ts");
    expect(booklet).toMatch(/Client Identity page is the portrait printed on the identity document/);
    expect(booklet).toMatch(/document image itself, the live capture taken during\s*\n?\s*verification/);
  });

  it("the document page is never published, on any surface", () => {
    /* The one image that would carry the number, the MRZ and the date of
       birth to a partner. */
    for (const file of [
      "supabase/functions/_shared/aml/passport/passportView.pure.ts",
      "supabase/functions/_shared/aml/passport/passportBooklet.pure.ts",
      "src/components/aml/passport/design/BookletBlocks.tsx",
    ]) {
      const body = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(body, file).not.toContain("document_front");
      expect(body, file).not.toContain("aml-documents");
    }
  });
});
