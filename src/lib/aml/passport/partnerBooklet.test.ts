import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BOOKLET_LEAVES, buildPartnerBooklet, type PartnerDisclosure } from "./partnerBooklet.pure";
import { BOOKLET_ZOOM_STEPS, bookletGeometry, bookletZoom, nextBookletZoom } from "./index";

/**
 * The partner receives the document, not the payload.
 *
 * A partner opening their emailed link was shown `JSON.stringify` of the
 * attestation in a `<pre>` — the literal object, braces and quoted keys and
 * all. Everyone inside the issuing business sees this record as a bound
 * booklet; the one audience the document exists FOR was handed source code.
 */

const disclosure = (over: Partial<PartnerDisclosure> = {}): PartnerDisclosure => ({
  attestation_sha256: "28099ae9048b1397aa11bb22cc33dd44ee55ff6677889900aabbccddeeff0011",
  issued_at: "2026-08-27T08:28:28.000Z",
  attestation_version: 1,
  agreement: {
    partner_org_name: "Testing Pty Ltd",
    agreement_reference: "AML/CTF Compliance Passport Agreement",
    scope: ["customer_identification"],
  },
  notice:
    "You may rely on the customer identification procedures described here under your written "
    + "CDD arrangement (AML/CTF Act Pt 2 Div 7).",
  attestation: {
    schema: "aml.compliance_attestation.v1",
    issuer: "NPC Services command centre",
    case_reference: "AML-2026-00005",
    subject: "Rugesh Naidu",
    subject_type: "individual",
    customer_identification: {
      parties: [
        {
          party: "Rugesh Naidu", verified: true, method: "electronic_idv",
          completed_at: "2026-08-20T15:16:00.000Z", document_type: null,
        },
      ],
      questionnaire_version: "2026.2",
      sections_submitted: 6,
      consents_held: [
        { code: "compliance_sharing", version: "2026.2", accepted_at: "2026-08-15T16:51:54.000Z" },
      ],
    },
    screening: {
      performed: true,
      last_performed_at: "2026-08-20T15:16:00.000Z",
      scope: ["sanctions"],
      list_freshness: { un: "2026-08-26T20:01:53.000Z", dfat: "2026-08-26T20:02:33.000Z" },
    },
    service_readiness: true,
    limitations: ["documents_not_verified_against_issuing_authority"],
    reliance_basis: "AML/CTF Act 2006 (Cth) Pt 2 Div 7",
  },
  ...over,
});

const idsOf = (d: PartnerDisclosure) => buildPartnerBooklet(d).map((p) => p.id);
const flat = (d: PartnerDisclosure) => JSON.stringify(buildPartnerBooklet(d));

describe("the partner opens a bound document", () => {
  it("opens on the cover, naming its bearer with the ISSUER's own credential", () => {
    const [cover] = buildPartnerBooklet(disclosure());
    expect(cover.variant).toBe("cover");
    expect(cover.sub).toBe("Rugesh Naidu");
    // Character-identical to the Command Centre's, because both derive it
    // from `passportCredential`. "AML-2026-00005" and "AUX-AML-2026-00005-V1"
    // look like two documents to a partner comparing their copy.
    expect(cover.foot).toContain("AUX-AML-2026-00005-V1");
    expect(cover.foot).toContain("v1");
    expect(cover.fingerprint).toBe("2809·9AE9·048B·1397");
  });

  it("carries the reliance basis on the leaf the instrument keeps it on", () => {
    const pages = buildPartnerBooklet(disclosure());
    const leaf = pages.find((p) => p.id === "disclosure")!;
    expect(leaf.title).toBe("Disclosure & Access");
    expect(JSON.stringify(leaf.blocks)).toContain("under your written");
    // Who it was issued to, under what, by whom, when.
    expect(JSON.stringify(leaf.blocks)).toContain("Testing Pty Ltd");
  });

  it("renders each party's identification in words a person reads", () => {
    // `electronic_idv` is not a phrase anybody says out loud, and a relying
    // entity is reading this to decide whether it meets their requirements.
    expect(flat(disclosure())).toContain("Electronic identity verification");
    expect(flat(disclosure())).not.toContain("electronic_idv");
  });

  it("names an unfamiliar method as it arrived rather than inventing a label", () => {
    const d = disclosure();
    (d.attestation.customer_identification as any).parties[0].method = "future_method";
    // Inventing a friendly name for a method this build has never seen would
    // be a claim about what was performed.
    expect(flat(d)).toContain("Future method");
  });

  it("prints a party the record does not show as verified, rather than omitting them", () => {
    const d = disclosure();
    (d.attestation.customer_identification as any).parties.push({
      party: "Second Party", verified: false, method: null, completed_at: null,
    });
    const text = flat(d);
    // A shortened list would read as a complete one.
    expect(text).toContain("Second Party");
    expect(text).toContain("Not verified");
  });
});

describe("what the document may not say", () => {
  it("carries no risk vocabulary of its own", () => {
    const text = flat(disclosure()).toLowerCase();
    // The server never sends these; the document must not invent them either.
    for (const forbidden of ["risk rating", "risk score", "escalat", "suspicio"]) {
      expect(text).not.toContain(forbidden);
    }
    // "Risk assessment" may appear ONLY where the document denies holding one.
    for (const at of [...text.matchAll(/risk assessment/g)].map((m) => m.index ?? 0)) {
      const context = text.slice(Math.max(0, at - 120), at + 40);
      expect(context).toMatch(/does not contain|never|not transfer/);
    }
  });

  it("states that match content is absent, so silence is not read as 'nothing found'", () => {
    expect(flat(disclosure())).toContain("carries no match content");
  });

  it("keeps every leaf even when the disclosure carries none of them", () => {
    // Dropping a leaf is what produced two documents of different lengths.
    // A leaf that is present and says why it is empty cannot be mistaken for
    // a document that is missing pages.
    const d = disclosure();
    delete (d.attestation as any).screening;
    delete (d.attestation as any).limitations;
    (d.attestation.customer_identification as any).parties = [];
    (d.attestation.customer_identification as any).consents_held = [];

    const ids = idsOf(d);
    expect(ids).toEqual(["cover", ...BOOKLET_LEAVES.map((l) => l.id)]);
    const screening = buildPartnerBooklet(d).find((p) => p.id === "screening")!;
    expect(JSON.stringify(screening.blocks)).toContain("Not part of this disclosure");
    // And it never reads as a screening that found nothing.
    expect(JSON.stringify(screening.blocks)).not.toContain("Not performed");
  });

  it("says WITHHELD and NOT-DISCLOSED differently, because they are different", () => {
    const pages = buildPartnerBooklet(disclosure());
    const funding = pages.find((p) => p.id === "funding")!;
    const ownership = pages.find((p) => p.id === "ownership")!;

    // "We do not share this" …
    expect(JSON.stringify(funding.blocks)).toContain("Not disclosed to a relying entity");
    expect(JSON.stringify(funding.blocks)).toContain("own due diligence");
    // … is not the same sentence as "this was not shared with you".
    expect(JSON.stringify(ownership.blocks)).toContain("Not part of this disclosure");
  });

  it("survives a payload that is missing everything", () => {
    const bare = disclosure({ attestation: {} });
    const pages = buildPartnerBooklet(bare);
    expect(pages[0].variant).toBe("cover");
    expect(pages).toHaveLength(BOOKLET_LEAVES.length + 1);
    expect(JSON.stringify(pages)).not.toContain("undefined");
  });

  it("never prints a seal, because there is no certification record behind it", () => {
    const kinds = buildPartnerBooklet(disclosure())
      .flatMap((p) => p.blocks.map((b) => b.kind));
    expect(kinds).not.toContain("seals");
    expect(kinds).not.toContain("hero");
    expect(kinds).not.toContain("signature");
  });
});

describe("the fingerprint a verifier checks", () => {
  it("prints in full on the renewal leaf, short on the cover", () => {
    const d = disclosure();
    const pages = buildPartnerBooklet(d);
    expect(pages[0].fingerprint).toBe("2809·9AE9·048B·1397");
    expect(JSON.stringify(pages.find((p) => p.id === "renewal")))
      .toContain(d.attestation_sha256);
  });
});

/**
 * One instrument.
 *
 * The partner's copy and the Command Centre's are the same document. That is
 * asserted against the composer's SOURCE rather than against a list somebody
 * remembered to update: a leaf added to `buildBooklet` and not to
 * `BOOKLET_LEAVES` would silently go missing from every partner's copy, which
 * is exactly the defect this replaces.
 */
describe("the partner's copy is the Command Centre's document", () => {
  const composer = readFileSync(
    "supabase/functions/_shared/aml/passport/passportBooklet.pure.ts", "utf8",
  );
  const commandIds = [...composer.slice(composer.indexOf("export function buildBooklet"))
    .matchAll(/\n\s+id: "([a-z-]+)",\n\s+kicker:/g)].map((m) => m[1]);

  it("finds the composer's leaves at all", () => {
    // A regex that stops matching would make this pass vacuously.
    expect(commandIds.length).toBeGreaterThanOrEqual(10);
    expect(commandIds).toContain("identity");
  });

  it("carries every leaf the Command Centre can print, in the same order", () => {
    expect(BOOKLET_LEAVES.map((l) => l.id)).toEqual(commandIds);
  });

  it("gives each leaf the Command Centre's own title and numeral", () => {
    const pages = buildPartnerBooklet(disclosure());
    const identity = pages.find((p) => p.id === "identity")!;
    expect(identity.title).toBe("Client Identity");
    expect(identity.numeral).toBe("I");
    expect(composer).toContain('title: "Client Identity"');

    const leaves = pages.filter((p) => p.variant === "leaf");
    expect(leaves.map((p) => p.numeral).slice(0, 4)).toEqual(["I", "II", "III", "IV"]);
  });

  it("prints the same eight identity fields the Command Centre prints", () => {
    const identity = buildPartnerBooklet(disclosure()).find((p) => p.id === "identity")!;
    const fields = identity.blocks.find((b) => b.kind === "fields") as
      Extract<typeof identity.blocks[number], { kind: "fields" }>;
    expect(fields.items.map((f) => f.k)).toEqual([
      "Client name", "Credential ID", "Customer type", "AML case",
      "Issue date", "Version", "Disclosed to", "Fingerprint",
    ]);
  });
});

/**
 * Magnification.
 *
 * The fit is correct and the page is still too small to read: the design
 * authors 9.5–11px body copy at 470×648, so a two-up spread in a dialog draws
 * that copy at 6–7px. The reader gets a magnification of their own on top of
 * the fit, and it never reflows anything.
 */
describe("the reader can enlarge the document", () => {
  const geometry = bookletGeometry({ availableWidth: 900, availableHeight: 620 });

  it("is the fit, unchanged, until somebody asks for more", () => {
    const view = bookletZoom(geometry, 1);
    expect(view.scale).toBe(geometry.scale);
    expect(view.width).toBe(geometry.width);
    expect(view.canZoomOut).toBe(false);
  });

  it("multiplies the same uniform transform rather than reflowing", () => {
    const view = bookletZoom(geometry, 2);
    expect(view.scale).toBeCloseTo(geometry.scale * 2, 10);
    expect(view.width).toBeCloseTo(geometry.width * 2, 10);
    expect(view.height).toBeCloseTo(geometry.height * 2, 10);
    expect(view.percent).toBe(200);
  });

  it("says how large the drawing is and never whether it fits", () => {
    /* `overflows` used to live here as `zoom > 1`, and the viewer read it to
       decide whether the board could be panned at all. It was wrong in both
       directions — the fit has a minimum-scale floor, so a short window
       overflows at 100%, while one leaf at 125% in a wide dialog does not —
       and carrying the measured box here instead flaps where the container is
       content-sized, because then the box is the one the board itself makes.
       Whether there is anywhere to pan is a question about the DOM and the
       viewer asks the DOM. */
    expect(Object.keys(bookletZoom(geometry, 2))).not.toContain("overflows");
    const book = readFileSync(
      "src/components/aml/passport/design/PassportBook.tsx", "utf8",
    );
    expect(book).toContain("scrollWidth");
    expect(book).toContain("clientWidth");
  });

  it("clamps whatever a control hands it", () => {
    // A scale of 0 draws nothing; a scale of 40 draws a leaf no scrollbar can
    // rescue. Both arrive from a control, so neither is trusted.
    expect(bookletZoom(geometry, 0).zoom).toBe(BOOKLET_ZOOM_STEPS[0]);
    expect(bookletZoom(geometry, -5).zoom).toBe(BOOKLET_ZOOM_STEPS[0]);
    expect(bookletZoom(geometry, 40).zoom)
      .toBe(BOOKLET_ZOOM_STEPS[BOOKLET_ZOOM_STEPS.length - 1]);
    expect(bookletZoom(geometry, Number.NaN).zoom).toBe(BOOKLET_ZOOM_STEPS[0]);
  });

  it("steps through the declared magnifications and stops at each end", () => {
    let z: number = BOOKLET_ZOOM_STEPS[0];
    const seen = [z];
    for (let i = 0; i < 10; i += 1) {
      z = nextBookletZoom(z, 1);
      if (seen[seen.length - 1] !== z) seen.push(z);
    }
    expect(seen).toEqual([...BOOKLET_ZOOM_STEPS]);
    expect(nextBookletZoom(BOOKLET_ZOOM_STEPS[BOOKLET_ZOOM_STEPS.length - 1], 1))
      .toBe(BOOKLET_ZOOM_STEPS[BOOKLET_ZOOM_STEPS.length - 1]);
    expect(nextBookletZoom(BOOKLET_ZOOM_STEPS[0], -1)).toBe(BOOKLET_ZOOM_STEPS[0]);
    expect(nextBookletZoom(1.5, -1)).toBe(1.25);
  });

  it("one leaf is worth more than any magnification, so it is offered first", () => {
    // Reading a single page roughly doubles the scale before any zoom at all.
    const single = bookletGeometry({ availableWidth: 900, availableHeight: 620, singleOnly: true });
    expect(single.scale).toBeGreaterThan(geometry.scale);
  });
});

describe("the partner page draws the document, not the payload", () => {
  const page = readFileSync("src/pages/PublicPassport.tsx", "utf8");

  it("mounts the SAME viewer the Command Centre and the Client Portal use", () => {
    // Three renderers of one instrument eventually disagree about what it
    // looks like.
    expect(page).toContain("PassportBook");
  });

  it("prefers the Command Centre's own composer over any local composition", () => {
    // The server sends the partner-audience view; `buildBooklet` is the only
    // thing that turns a view into pages. This composer is the fallback for a
    // deployment still serving a build that predates it.
    expect(page).toContain("buildBooklet(data.passport as PassportView)");
    expect(page).toContain("return buildPartnerBooklet(data)");
  });

  it("offers no raw payload at all", () => {
    // A fold-out of the object the document was drawn from invited a relying
    // entity to read the source instead of the instrument.
    expect(page).not.toContain("JSON.stringify(data.attestation");
    expect(page).not.toContain("View the underlying record");
  });
});
