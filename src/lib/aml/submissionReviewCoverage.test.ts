import { describe, expect, it } from "vitest";
import {
  acceptDisclosure, differencesBadge, reviewCoverage, reviewSections,
} from "@/lib/aml/submissionReviewCoverage.pure";

/**
 * A decision made above the evidence, and a badge that contradicted its own
 * body. Both defects were arrangements of true facts; these tests hold the
 * arrangements.
 */

const facts = (over = {}) => ({
  previous_version: null,
  differences: [],
  parties: 0,
  documents: 3,
  openRequests: 0,
  verificationRows: 1,
  screeningRows: 1,
  ...over,
});

describe("which sections need opening", () => {
  it("an empty section's trigger row already says everything", () => {
    /*
     * A count of zero is on screen without a click. Requiring a click to
     * open an empty list trains reviewers that opening sections is a
     * ritual — the fastest way to make coverage meaningless.
     */
    const byKey = Object.fromEntries(
      reviewSections(facts()).map((s) => [s.key, s.hasContent]));
    expect(byKey.parties).toBe(false);
    expect(byKey.requests).toBe(false);
    expect(byKey.documents).toBe(true);
    expect(byKey.answers).toBe(true);
    expect(byKey.consent).toBe(true);
  });

  it("a first submission has no differences section to open", () => {
    expect(reviewSections(facts()).find((s) => s.key === "differences")!.hasContent)
      .toBe(false);
    expect(reviewSections(facts({
      previous_version: { version_number: 1 }, differences: [{}],
    })).find((s) => s.key === "differences")!.hasContent).toBe(true);
  });
});

describe("coverage is this session's looking, counted honestly", () => {
  const sections = reviewSections(facts());

  it("names what has not been opened, in page order", () => {
    const c = reviewCoverage(sections, ["verification"]);
    expect(c.complete).toBe(false);
    expect(c.unopened.map((s) => s.key)).toEqual(
      ["consent", "answers", "documents", "screening"]);
    expect(c.nextKey).toBe("consent");
    expect(c.sentence).toMatch(/still to look at: consent evidence/i);
  });

  it("complete when every section with content has been seen", () => {
    const c = reviewCoverage(sections,
      ["consent", "answers", "documents", "verification", "screening"]);
    expect(c.complete).toBe(true);
    expect(c.nextKey).toBeNull();
  });

  it("opening an empty section is never required for completeness", () => {
    const c = reviewCoverage(sections,
      ["consent", "answers", "documents", "verification", "screening"]);
    // parties and requests were never opened; both are empty.
    expect(c.complete).toBe(true);
  });
});

describe("what the accept confirmation says", () => {
  const sections = reviewSections(facts());

  it("names the unopened sections, and does not block", () => {
    const line = acceptDisclosure(reviewCoverage(sections, ["verification"]));
    expect(line).toMatch(/you have not opened: consent evidence/i);
    expect(line).toMatch(/accept knowing they were not looked at/i);
  });

  it("says nothing when everything was opened", () => {
    expect(acceptDisclosure(reviewCoverage(sections,
      ["consent", "answers", "documents", "verification", "screening"]))).toBeNull();
  });
});

describe("the differences badge an old server cannot spoil", () => {
  it("a first submission reads FIRST SUBMISSION whatever the payload says", () => {
    /*
     * The deployed function diffed a first submission against an empty
     * snapshot: twenty "changes", flagged material, above the sentence
     * "This is the first submission". The panel and the function deploy
     * separately, so the row must read correctly against whichever is live.
     */
    const b = differencesBadge({
      previous_version: null,
      differences: new Array(20).fill({}),
      differences_material: true,
    });
    expect(b.label).toBe("First submission");
    expect(b.material).toBe(false);
  });

  it("a real diff keeps its count and its materiality", () => {
    const b = differencesBadge({
      previous_version: { version_number: 1 },
      differences: [{}, {}],
      differences_material: true,
    });
    expect(b.label).toBe("2");
    expect(b.material).toBe(true);
  });

  it("material is never claimed over zero differences", () => {
    expect(differencesBadge({
      previous_version: { version_number: 1 },
      differences: [],
      differences_material: true,
    }).material).toBe(false);
  });
});
