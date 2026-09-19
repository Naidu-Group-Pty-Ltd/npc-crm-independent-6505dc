/**
 * One list of stored objects, one reader — the defect that kept the
 * photograph off the Passport after everything else about it was correct.
 *
 * ## What happened
 *
 * A standalone verification wrote its object list in TWO places:
 *
 *   · `outcome_detail.standalone_capture.objects` — the capture PLAN. Read by
 *     `readCapturePlan`, re-written by `persistProgress` during processing,
 *     and the list `aml-idv-retention` enumerates when it deletes.
 *   · `outcome_detail.standalone.capture_objects` — a copy folded into the
 *     evidence block once, at the end of the run, and never updated again.
 *
 * Every reader preferred the COPY. So the extracted portrait was uploaded to
 * storage, named by the plan, and correctly on the retention job's list —
 * and every Passport still drew an empty frame, because it was reading the
 * older of two lists. Measured on production: both passed verifications held
 * `id_portrait` in the plan, and the old expression found it on neither.
 *
 * Two copies of one fact is the class. These guards pin the rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { captureObjectsFor, identityPortraitObject, backfillStampFor } from "@/lib/aml/passport";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const FRONT = { bucket: "aml-documents", path: "c/v/k/document-front.jpg" };
const SELFIE = { bucket: "aml-biometrics", path: "c/v/k/selfie.jpg" };
const PORTRAIT = { bucket: "aml-biometrics", path: "c/v/k/id-portrait.jpg" };

/** The production shape, verbatim: the plan has the portrait, the copy does not. */
const REAL_ROW = {
  standalone: {
    capture_objects: { selfie: SELFIE, document_back: null, document_front: FRONT },
    face_match_reference: "id_portrait",
  },
  standalone_capture: {
    document_choice: "passport",
    objects: { selfie: SELFIE, id_portrait: PORTRAIT, document_back: null, document_front: FRONT },
  },
};

describe("the reader finds the portrait on the real record", () => {
  it("finds it where the old expression did not", () => {
    // The old expression, for the record: `sa.capture_objects ?? plan.objects`.
    const old = REAL_ROW.standalone.capture_objects ?? REAL_ROW.standalone_capture.objects;
    expect(identityPortraitObject(old)).toBeNull();

    expect(identityPortraitObject(captureObjectsFor(REAL_ROW))).toEqual(PORTRAIT);
  });

  it("MERGES rather than choosing a list", () => {
    /* Picking one means a shape nobody anticipated loses an object that
       exists. A union cannot. */
    expect(captureObjectsFor({
      standalone: { capture_objects: { selfie: SELFIE } },
      standalone_capture: { objects: { id_portrait: PORTRAIT } },
    })).toEqual({ selfie: SELFIE, id_portrait: PORTRAIT });
  });

  it("lets the PLAN win, including when the plan says null", () => {
    // A null in the plan is a real answer — a document with no back — and
    // must overwrite rather than be treated as "no opinion".
    expect(captureObjectsFor({
      standalone: { capture_objects: { document_back: FRONT } },
      standalone_capture: { objects: { document_back: null } },
    })).toEqual({ document_back: null });
  });

  it("still reads a record written before the plan was persisted", () => {
    expect(identityPortraitObject(captureObjectsFor({
      standalone: { capture_objects: { id_portrait: PORTRAIT } },
    }))).toEqual(PORTRAIT);
  });

  it("answers null rather than throwing on anything else", () => {
    for (const junk of [null, undefined, "x", 7, [], {}, { standalone: "x" }]) {
      expect(captureObjectsFor(junk)).toBeNull();
      expect(backfillStampFor(junk)).toBeNull();
    }
  });
});

describe("there is exactly one reader, and one writer", () => {
  const FILES = [
    "supabase/functions/aml-reliance/index.ts",
    "supabase/functions/aml-client-portal/index.ts",
    "supabase/functions/_shared/aml/standaloneVerification.ts",
  ];

  it("no surface reaches into the evidence block's copy by hand", () => {
    /* The rule, not the four call sites: `standalone.capture_objects` may be
       named in `captureObjectsFor` and in prose, and nowhere else. Four
       hand-written copies of one expression is why "fix the order" meant
       getting four edits right and staying right. */
    for (const file of FILES) {
      // Prose may name it; code may not.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(code).not.toMatch(/standalone\??\.\s*capture_objects/);
      expect(code).not.toMatch(/\[["']standalone["']\]/);
    }
  });

  it("the run no longer writes a second copy of the list", () => {
    const shared = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    const evidence = shared.slice(shared.indexOf("face_match_reference: portraitBytes"));
    expect(evidence).not.toMatch(/^\s*capture_objects:/m);
  });

  it("the plan is still re-persisted during processing", () => {
    /* This is what puts the portrait on the retention job's list. Losing it
       would make the one image this product derives the one it never
       deletes. */
    const shared = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    expect(shared).toContain("objects: plan.objects");
    expect(read("supabase/functions/aml-idv-retention/index.ts")).toContain("id_portrait");
  });
});

describe("one signer, so the client's Passport cannot drift from the issuer's", () => {
  it("both portals call the shared implementation", () => {
    for (const file of [
      "supabase/functions/aml-reliance/index.ts",
      "supabase/functions/aml-client-portal/index.ts",
    ]) {
      const src = read(file);
      expect(src).toContain('from "../_shared/aml/passport/attachPortraitUrls.ts"');
      expect(src).toContain("await attachPortraitUrls(admin, view, checks ?? []);");
      // And neither carries its own copy of the signing any more.
      expect(src).not.toContain("createSignedUrl(ref.path");
    }
  });

  it("signs the Client Identity slot as well as the party row", () => {
    /* The leaf a reader opens to find out whose document this is must be
       able to show the holder even if a party row somehow lacks a
       descriptor. */
    const signer = read("supabase/functions/_shared/aml/passport/attachPortraitUrls.ts");
    expect(signer).toContain("view?.identity?.portrait");
    expect(signer).toContain("verification?.parties");
  });

  it("mints one credential per image, with a short life", () => {
    const signer = read("supabase/functions/_shared/aml/passport/attachPortraitUrls.ts");
    expect(signer).toMatch(/PORTRAIT_URL_TTL_SECONDS = 300/);
    expect(signer).toContain("signed.has(key)");
  });

  it("never fails a Passport over a photograph", () => {
    const signer = read("supabase/functions/_shared/aml/passport/attachPortraitUrls.ts");
    expect(signer).toContain("catch");
    expect(signer).not.toContain("throw");
  });

  it("reaches every audience because it is inside the one assembler", () => {
    const reliance = read("supabase/functions/aml-reliance/index.ts");
    // The emailed one-time link, the partner portal and the Command Centre.
    expect(reliance).toContain('buildCasePassportView(admin, link.case_id, "partner")');
    expect(reliance).toContain('buildCasePassportView(admin, caseId, "command")');
    const from = reliance.indexOf("async function buildCasePassportView");
    const builder = reliance.slice(from, reliance.indexOf("\n}", reliance.indexOf("return view;", from)));
    expect(builder).toContain("await attachPortraitUrls(");
  });
});
