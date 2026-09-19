import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StampFace, PendingStampFace } from "./StampFace";
import { StampRecordDialog } from "./PassportPortals";
import { Wax } from "./primitives";
import { stampFaceTone, stampInk } from "@/lib/aml/passport";
import type { PassportStamp, PendingStamp } from "@/lib/aml/passport";

/**
 * The watermark, and the one property that matters about it.
 *
 * It was reported as missing, and it was: an `<img>` of the emblem laid over
 * the die under `mix-blend-mode: screen`. `screen` LIGHTENS — on the booklet's
 * cream leaf it pushed a near-white surface to white and erased the mark, and
 * on the dark register it screened dark artwork over a dark field and lifted
 * almost nothing. The layer the whole design is built around was never really
 * on screen, on any passport.
 *
 * The fix is not a better opacity. A stamp is ONE ink, so the emblem became
 * the mask and `--stamp-ink` the fill — and the reason that is worth a test
 * is that it removes the failure mode rather than tuning it. There is no
 * surface on which "the impression's own ink" disappears, so no future change
 * of background can erase the mark again.
 */

const CSS = readFileSync(
  join(__dirname, "../../../../styles/passport-tokens.css"), "utf8",
);

/** The stylesheet block for one selector, for asserting what it declares. */
function ruleFor(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("}", at));
}

const stamp = (over: Partial<PassportStamp> = {}): PassportStamp => ({
  code: "screening_completed",
  title: "SCREENING COMPLETED",
  org: "Naidu Property Consulting Services",
  portal: "System",
  actor: "System",
  at: "2026-08-21T01:16:00.000Z",
  tone: "gold",
  shape: "circle",
  version: null,
  source: { kind: "aml.party_screening_subjects" },
  ...over,
} as PassportStamp);

const pending = (): PendingStamp => ({
  code: "passport_issued",
  title: "PASSPORT ISSUED",
  org: null,
  shape: "circle",
  tone: "gold",
  awaiting: "An attestation has not been issued.",
  expected_at: null,
} as unknown as PendingStamp);

describe("the impression carries the mark of the system that struck it", () => {
  it("inks the emblem rather than laying a picture over the die", () => {
    const { container } = render(
      <StampFace stamp={stamp()} issuerOrg="Naidu Property Consulting Services" />,
    );
    const watermark = container.querySelector(".passport-stamp__watermark") as HTMLElement;

    expect(watermark).not.toBeNull();
    expect(watermark.tagName).toBe("SPAN");
    expect(watermark.style.getPropertyValue("--stamp-watermark-src"))
      .toBe('url("/brand/aurixa-emblem-240.png")');
  });

  it("takes the impression's own ink, so no surface can erase it", () => {
    // This is the whole point. A fill of `--stamp-ink` is the same colour as
    // the lettering beside it: gold on the dark register, the same gold
    // darkened for paper on the leaf. A blend mode has to be right for the
    // background; an ink does not.
    const rule = ruleFor(".passport-stamp__watermark");
    expect(rule).toContain("background-color: var(--stamp-ink)");
    expect(rule).toContain("mask: var(--stamp-watermark-src,");
    expect(rule).not.toContain("mix-blend-mode");
  });

  it("the leaf changes only how much ink the paper takes", () => {
    // The previous leaf override had to fight the blend mode. It now sets one
    // number, because there is nothing left to correct for.
    const rule = ruleFor(".passport-leaf .passport-stamp__watermark");
    expect(rule).toContain("--stamp-watermark-opacity");
    expect(rule).not.toContain("mix-blend-mode");
    expect(rule).not.toContain("filter");
  });

  it("fills the die rather than sitting in the middle of it", () => {
    // At 104px inside a 164px circle it read as a small logo somebody had
    // placed there. A watermark is the GROUND an impression is struck over.
    const circle = ruleFor(".passport-stamp--circle .passport-stamp__watermark,\n.passport-stamp--seal .passport-stamp__watermark");
    expect(circle).toContain("122px");
  });

  it("an unstruck die carries no watermark — nothing pressed it", () => {
    const { container } = render(<PendingStampFace stamp={pending()} />);
    expect(container.querySelector(".passport-stamp__watermark")).toBeNull();
    // But it keeps the die's own geometry, so the empty impression is the
    // same shape as the struck one beside it.
    expect(container.querySelector(".passport-stamp__inner")).not.toBeNull();
  });

  it("is burnished, so the die reads as pressed rather than printed", () => {
    const { container } = render(
      <StampFace stamp={stamp()} issuerOrg="Naidu Property Consulting Services" />,
    );
    expect(container.querySelector(".passport-stamp__burnish")).not.toBeNull();
    // Drawn in the impression's own relief and depth, so it inherits every
    // tone and every surface rather than carrying a colour of its own.
    const rule = ruleFor(".passport-stamp__burnish");
    expect(rule).toContain("var(--stamp-relief");
    expect(rule).toContain("var(--stamp-depth");
  });
});

describe("the dialog behind a stamp shows THAT stamp", () => {
  it("draws the real die, not a second seal with a different issuer", () => {
    // It used to open on `Wax`: a plain ring, no grain, no ticks, no
    // watermark, and "AURIXA SYSTEMS" hard-coded as the issuer whoever had
    // actually struck the record. The one surface whose job is "here is that
    // impression" showed something that was not it.
    const { container } = render(
      <StampRecordDialog
        stamp={stamp()}
        issuerOrg="Naidu Property Consulting Services"
        onClose={() => {}}
      />,
    );
    const dialog = document.querySelector("[role='dialog']") as HTMLElement;

    expect(dialog.querySelector(".passport-wax")).toBeNull();
    const die = dialog.querySelector(".passport-stamp") as HTMLElement;
    expect(die).not.toBeNull();
    expect(die.querySelector(".passport-stamp__watermark")).not.toBeNull();
    expect(within(die).getByText("SCREENING COMPLETED")).toBeInTheDocument();
    // The issuer is the one who struck it.
    expect(die.querySelector(".passport-stamp__orgname")?.textContent)
      .toBe("Naidu Property Consulting Services");
    expect(container).toBeTruthy();
  });

  it("presents the specimen upright", () => {
    // The register is tilted because a page of hand-pressed impressions is
    // not a grid. One specimen is not a register, and a tilted die in a
    // dialog reads as a misaligned dialog.
    render(
      <StampRecordDialog
        stamp={stamp()}
        issuerOrg="Naidu Property Consulting Services"
        onClose={() => {}}
      />,
    );
    const die = document.querySelector("[role='dialog'] .passport-stamp") as HTMLElement;
    expect(die.style.getPropertyValue("--stamp-rot")).toBe("0deg");
  });

  it("still names the record the impression was earned from", () => {
    render(
      <StampRecordDialog
        stamp={stamp()}
        issuerOrg="Naidu Property Consulting Services"
        onClose={() => {}}
      />,
    );
    const dialog = document.querySelector("[role='dialog']") as HTMLElement;
    // A seal that cannot be opened is decoration; this is what makes the
    // register auditable.
    expect(within(dialog).getByText("Underlying record")).toBeInTheDocument();
    expect(within(dialog).getByText("aml.party_screening_subjects")).toBeInTheDocument();
  });
});

describe("every seal on the document carries the mark", () => {
  it("the wax seal is marked too, and inked the same way", () => {
    // The identity leaf's official seal and the journey's milestones are
    // `Wax`, not the struck die. An unmarked seal beside a marked one reads
    // as belonging to something else.
    const { container } = render(<Wax title="OFFICIAL SEAL" caption="AURIXA SYSTEMS" />);
    const watermark = container.querySelector(".passport-wax__watermark") as HTMLElement;

    expect(watermark).not.toBeNull();
    expect(watermark.style.getPropertyValue("--stamp-watermark-src"))
      .toContain("/brand/aurixa-emblem-240.png");
    const rule = ruleFor(".passport-wax__watermark");
    expect(rule).toContain("background-color: var(--seal-ink)");
    expect(rule).not.toContain("mix-blend-mode");
  });

  it("an unearned wax seal carries none — nothing pressed it", () => {
    const { container } = render(<Wax title="NOT YET" earned={false} />);
    expect(container.querySelector(".passport-wax__watermark")).toBeNull();
  });
});

describe("the mark cannot degrade into a blot", () => {
  it("names the emblem as the mask fallback as well", () => {
    // An unset custom property inside a shorthand invalidates the whole
    // declaration, so `mask` would resolve to none and the ink would paint as
    // a solid disc over the inscription. The worst case has to be the right
    // mark, not a blot.
    for (const selector of [".passport-stamp__watermark", ".passport-wax__watermark"]) {
      expect(ruleFor(selector)).toContain('url("/brand/aurixa-emblem-240.png")');
    }
  });
});

/**
 * The ink, and the two axes it is decided on.
 *
 * The register was reported as bland, and it was: `STAMP_VOCABULARY` has
 * carried a per-code tone since it was written, and the die collapsed
 * twenty-two certifications into three inks. Because the issuer strikes
 * nearly all of them, a real page rendered as five gold rectangles and one
 * green circle. The colour was in the data; nothing asked for it.
 */
describe("the ink says what the certification is", () => {
  const ISSUER = "Naidu Property Consulting Services";

  it.each([
    ["client_consent_recorded", "violet"],
    ["identity_verified", "gold"],
    ["documents_verified", "gold"],
    ["screening_completed", "azure"],
    ["source_of_funds_reviewed", "emerald"],
    ["edd_completed", "emerald"],
    ["passport_issued", "final"],
    ["transaction_completed", "final"],
    ["access_revoked", "alert"],
    ["passport_superseded", "alert"],
    ["reliance_accepted_finance", "partner"],
  ] as const)("inks %s as %s", (code, ink) => {
    expect(stampInk({ code, org: ISSUER }, ISSUER)).toBe(ink);
  });

  it("keeps funding APART from the terminal certification", () => {
    // The vocabulary inks `source_of_funds_reviewed` the same green as
    // `passport_issued`, and a funding review that looks identical to the
    // issuance is exactly the confusion a colour system removes. That is why
    // the die reads its own map rather than the vocabulary's coarser tone.
    expect(stampInk({ code: "source_of_funds_reviewed", org: ISSUER }, ISSUER))
      .not.toBe(stampInk({ code: "passport_issued", org: ISSUER }, ISSUER));
  });

  it("AUTHORITY still comes first, whatever the subject", () => {
    // The security property: a reader must be able to see at a glance which
    // impressions are ours. A stamp struck by somebody else is partner-inked
    // even where its subject would say otherwise.
    for (const code of ["identity_verified", "screening_completed", "passport_issued"] as const) {
      expect(stampInk({ code, org: "Someone Else Pty Ltd" }, ISSUER)).toBe("partner");
    }
    // And that decision is still made in one place.
    expect(stampFaceTone({ code: "identity_verified", org: "Someone Else Pty Ltd" }, ISSUER))
      .toBe("partner");
  });

  it("every ink it can return has a face to render it with", () => {
    // A code mapped to an ink with no `.passport-stamp--<ink>` class renders
    // as an unstyled die: no edge, no wash, no glow, and a watermark with no
    // colour to take. Both surfaces have to carry every family.
    for (const ink of ["gold", "azure", "violet", "emerald", "final", "partner", "alert"]) {
      expect(CSS).toContain(`.passport-stamp--${ink} {`);
      expect(CSS).toContain(`--stamp-${ink}-ink`);
    }
  });

  it("the leaf re-mixes every family rather than inheriting the dark one", () => {
    // A hue that reads as a bright ink on a near-black field is a wash on
    // cream. The leaf block has to redefine each family or the booklet
    // renders four of the seven in the register's lightness.
    // `.passport-leaf` appears more than once — geometry, then the paper's
    // own ink block. The one that matters is whichever declares the die.
    const at = CSS.indexOf("--stamp-gold-ink", CSS.indexOf("--stamp-alert-glow"));
    expect(at).toBeGreaterThan(-1);
    const leaf = CSS.slice(at, at + 4_000);
    for (const ink of ["gold", "partner", "final", "azure", "violet", "emerald", "alert"]) {
      expect(leaf).toContain(`--stamp-${ink}-ink`);
    }
  });
});
