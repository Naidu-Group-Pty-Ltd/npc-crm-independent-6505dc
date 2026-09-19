import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The determination screen must not contradict the search it describes, and
 * must not hide the work it is about to demand.
 *
 * ── Why source assertions ─────────────────────────────────────────────
 * jsdom does no layout, so a rendered test here proves mount rather than
 * visibility, and this dialog pulls a screening run, an index-status fetch
 * and four register links behind it. What actually went wrong was *wiring* —
 * a sentence that described the run without reading it, and a footer that
 * rendered one element of an array — and wiring is what a source rule holds.
 * The behaviour underneath is covered by `pepManualChecks.test.ts` and
 * `pepDeterminationSteps.test.ts`.
 */

const dir = join(__dirname, "..");
const dialog = readFileSync(join(dir, "PepDeterminationDialog.tsx"), "utf8");

/**
 * Source with comment lines removed.
 *
 * Every rule below is documented in the file it guards, and the
 * documentation necessarily quotes the code being removed. A scan that
 * counted those would fail on the explanation of its own fix — which has now
 * happened three times in this suite, so it is a helper rather than a habit.
 */
const codeOnly = (src: string) => src
  .split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

describe("the manual-check prose is derived, never counted by hand", () => {
  it("the sentence that went stale is gone", () => {
    /*
     * "The two Commonwealth registers block automated requests, so the run
     * above cannot read them."
     *
     * One did. Parliament of Australia had become a register the server
     * searches on every run, and the panel directly above this sentence said
     * "1 source was not searched" — the same scroll, two answers, and the
     * operator sent to open by hand a register the platform had just read.
     */
    expect(codeOnly(dialog)).not.toMatch(/two Commonwealth registers/i);
    expect(codeOnly(dialog)).not.toMatch(/the run above cannot read them/i);
  });

  it("the sentence and the count come off the run", () => {
    // Correcting "two" to "one" would be true until the next source moves
    // from "somebody opens a tab" to "the server reads it", which is the
    // whole direction of this programme.
    expect(dialog).toContain("describeManualChecks(manualChecks");
    expect(dialog).toContain("classifyManualChecks(");
    expect(dialog).toContain("onSources={setRunSources}");
  });

  it("a register the run read is labelled as searched, in the list itself", () => {
    expect(dialog).toContain("searched_by_platform");
    expect(dialog).toMatch(/searched on this run/);
  });

  it("reopening the dialog does not carry the last party's coverage across", () => {
    // Telling an operator a register was searched for a party it was never
    // searched for is the same lie, arrived at by a different route.
    expect(dialog).toContain("setRunSources(null)");
  });
});

describe("the footer shows everything outstanding, not the first refusal", () => {
  it("no longer renders a single error message", () => {
    /*
     * `verdict.errors[0]?.message`. Before an outcome is chosen the only
     * error is "Choose what was determined", so every other requirement was
     * invisible — and each one was discovered only by satisfying the last.
     */
    expect(codeOnly(dialog)).not.toContain("verdict.errors[0]?.message");
    expect(dialog).toContain("describeOutstanding(requirements)");
    expect(dialog).toContain("requirements.filter((r) => !r.met)");
  });

  it("the list is built from the errors the assessment produces", () => {
    // Not a second list of rules that agrees with the server today. What the
    // operator is shown outstanding and what the server refuses cannot become
    // two standards.
    expect(dialog).toContain("errors: verdict.errors");
  });

  it("a requirement names the step it belongs to", () => {
    expect(dialog).toMatch(/step \{r\.step\}/);
  });
});

describe("what the registers do not cover is named where the work is", () => {
  it("the measured Rule-category gaps render on the determination itself", () => {
    // The loader has measured this since the index gained a second register,
    // and it rendered two clicks away inside the search panel. Its whole
    // value is the answer to "the run found nothing — what had it never
    // looked at?", which is a question asked at exactly this moment.
    expect(dialog).toContain("<PepCoverageGaps");
  });

  it("an unmeasured index is not reported as a clean bill", () => {
    const gaps = readFileSync(join(dir, "PepCoverageGaps.tsx"), "utf8");
    expect(gaps).toContain("ruleCoverageMeasured");
    expect(gaps).toMatch(/have not been measured against the Rule/i);
    // And a failed read is unknown, never "covers everything".
    expect(gaps).toMatch(/could not be read/i);
  });

  it("a gap is reported across registers, not against each one", () => {
    // Per-register would list "judiciary" as a gap against a register of
    // parliamentary seats — true, useless, and it buries the real gap.
    const gaps = readFileSync(join(dir, "PepCoverageGaps.tsx"), "utf8");
    expect(gaps).toContain("gapsAcrossRegisters");
  });
});

describe("no PEP surface claims an office is held today", () => {
  it("nothing renders the bare word 'Current'", () => {
    /*
     * Every Parliament row carries `currently_held: true` by construction —
     * the files are a snapshot of who sits on the day they are downloaded.
     * An unqualified present tense is a claim about today made from a
     * photograph of last week, and it travels into the evidence a
     * determination rests on.
     *
     * Two components rendered that badge and they were fixed separately, so
     * this scans the whole directory rather than the two that are known.
     */
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.startsWith("Pep") || !file.endsWith(".tsx")) continue;
      /*
       * Comments are stripped first. The notes explaining why this badge
       * changed necessarily quote the word, and a scan that counted those
       * would fail on the documentation of its own fix.
       */
      const src = codeOnly(readFileSync(join(dir, file), "utf8"));
      if (/[?:]\s*"Current"/.test(src) || />\s*Current\s*</.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the run panel dates the claim from the register it searched", () => {
    const panel = readFileSync(join(dir, "PepScreeningRunPanel.tsx"), "utf8");
    // ONE renderer for this sentence, shared with the index panel. The run
    // stores less than a coverage row, so an adapter fills the gap rather
    // than a second sentence being written somewhere else.
    expect(panel).toContain("describeTenure(");
    expect(panel).toContain("recencyFromRunSource(sourceAsAt, sourceCurrency");
    // From the run's own record of the source, so the badge cannot disagree
    // with what was searched.
    expect(panel).toMatch(/run\.sources\.find\(\(s\) => s\.key === c\.sourceKey\)\?\.asAt/);
  });

  it("both PEP surfaces render that sentence from the same function", () => {
    for (const file of ["PepScreeningRunPanel.tsx", "PepOfficeholderIndexPanel.tsx"]) {
      expect(readFileSync(join(dir, file), "utf8")).toContain("describeTenure(");
    }
  });
});

describe("nothing resets the editing session except the session changing", () => {
  it("the reset is keyed on a session, never on a fetched object", () => {
    /*
     * `}, [open, declaration]);`
     *
     * The workspace refetches on `focus` and `visibilitychange`, and this
     * screen's own design sends the operator to open registers in a new tab.
     * So returning from a register produced a new `pep_declaration` object
     * with identical content, this effect fired, and the run's cascade, every
     * row it had written and anything typed into the determination went with
     * it. The poll runs on a timer too, so it could land mid-sentence.
     *
     * Object identity of refetched data is not a signal that anything
     * changed.
     */
    expect(codeOnly(dialog)).not.toMatch(/\}, \[open, declaration\]\)/);
    expect(dialog).toContain("const sessionKey = open ? subject.id : null");
    expect(dialog).toContain("initialisedFor");
    expect(dialog).toMatch(/\}, \[sessionKey\]\)/);
  });

  it("the declaration is seeded once, on primitives, and never rewritten", () => {
    // It can arrive after the dialog opens, so it cannot live in the
    // initialiser — and its dependencies are the answer's primitives, so a
    // refetch carrying the same answer does nothing.
    expect(dialog).toContain("seededDeclarationFor");
    expect(dialog).toMatch(
      /\[sessionKey, declaration\?\.answered, declaration\?\.answer, declaration\?\.summary\]/);
  });

  it("a different party still starts clean", () => {
    // Immunity to refetches must not become immunity to the thing the reset
    // is for. Telling an operator a register was searched for a party it was
    // never searched for is the same lie from the other direction.
    expect(dialog).toContain("setRunSources(null)");
    expect(dialog).toContain("setRows([])");
  });

  it("the run reports upwards from ONE derivation", () => {
    /*
     * It was reported in three places — on restore, on a new run, and on
     * failure — which is three chances for the checklist to describe a search
     * the panel did not perform.
     */
    const panel = readFileSync(join(dir, "PepScreeningRunPanel.tsx"), "utf8");
    expect(panel).toContain("onSourcesRef");
    expect(panel).toMatch(/onSourcesRef\.current\?\.\(run/);
    expect(panel).toMatch(/\}, \[run\]\)/);
    // …and nowhere else.
    expect((codeOnly(panel).match(/onSources\?\.\(/g) ?? []).length).toBe(0);
  });
});
