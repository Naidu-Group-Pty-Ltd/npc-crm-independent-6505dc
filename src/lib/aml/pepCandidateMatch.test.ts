import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PEP_CANDIDATE_MIN_NAME_SCORE,
  admitCandidate,
  comparePepDob,
  rankCandidate,
  resolveSubjectDob,
} from "@/lib/aml/pepOfficeholderIndex";
import { scoreNames } from "../../../supabase/functions/_shared/aml/matching.ts";

/**
 * A date of birth ORDERS candidates and annotates them. It never removes one.
 *
 * ── Why that is the rule ──────────────────────────────────────────────
 * The sanctions path does the opposite, and correctly: there the adjustment
 * decides whether something is REFERRED at all, and the cost of over-
 * referring is a reviewer's minute.
 *
 * Here the candidate is already in front of a reviewer whose job is to reach
 * the determination. Dropping an office holder out of that list because a
 * birth date disagrees is the automation reaching it instead — and the
 * operator would never learn that a same-named office holder existed.
 *
 * The registers also disagree with each other and with official records often
 * enough that a date is a reason to look harder, never a conclusion.
 */

describe("the admitted set does not depend on the date of birth", () => {
  it("admitCandidate cannot consult one — it is not in the signature", () => {
    // Expressed in the type so it cannot be quietly relaxed later.
    expect(admitCandidate.length).toBe(1);
    expect(admitCandidate(PEP_CANDIDATE_MIN_NAME_SCORE)).toBe(true);
    expect(admitCandidate(PEP_CANDIDATE_MIN_NAME_SCORE - 0.001)).toBe(false);
  });

  it("a strong name match with a contradicting date is still shown", () => {
    /*
     * The concrete failure this prevents. A 0.9 name score multiplied by the
     * sanctions path's mismatch factor of 0.75 is 0.675 — below the 0.7 floor.
     * Applying the adjustment before the threshold would have silently
     * removed a real office holder from the list.
     */
    const nameScore = 0.9;
    const contradicts = comparePepDob("1978-04-02", "1961-08-04");
    expect(contradicts.agreement).toBe("mismatch");
    expect(rankCandidate(nameScore, contradicts.agreement)).toBeLessThan(
      PEP_CANDIDATE_MIN_NAME_SCORE);
    // …and it is admitted anyway, because admission reads the name alone.
    expect(admitCandidate(nameScore)).toBe(true);
  });

  it("ranking is where the date is allowed to act", () => {
    // Reordering a list a person reads changes what they look at first and
    // changes nothing about what they can see.
    const agree = comparePepDob("1961-08-04", "1961-08-04").agreement;
    const differ = comparePepDob("1961-08-04", "1978-04-02").agreement;
    expect(rankCandidate(0.8, agree)).toBeGreaterThan(rankCandidate(0.8, differ));
  });
});

describe("an absent date is never a disagreement", () => {
  it("a register that publishes none says exactly that", () => {
    const c = comparePepDob("1961-08-04", null);
    expect(c.reading).toBe("source_not_recorded");
    expect(c.agreement).toBe("unknown");
    expect(c.sentence).toMatch(/not a difference/i);
    expect(c.sentence).not.toMatch(/different date/i);
  });

  it("a party with none on file is a DIFFERENT fact from a source with none", () => {
    // They point at different remedies: one the operator can fix.
    const noParty = comparePepDob(null, "1961");
    expect(noParty.reading).toBe("party_not_recorded");
    expect(noParty.sentence).toMatch(/no date of birth is recorded for this party/i);
    expect(comparePepDob("1961-08-04", null).reading).toBe("source_not_recorded");
  });

  it("neither absence corroborates anything", () => {
    expect(comparePepDob(null, null).corroborates).toBe(false);
    expect(comparePepDob("1961-08-04", null).corroborates).toBe(false);
    expect(comparePepDob(null, "1961-08-04").corroborates).toBe(false);
  });
});

describe("the two things a shared year can mean", () => {
  it("same year because the register only publishes a year", () => {
    /*
     * `DobAgreement` returns `year_match` for this AND for two full dates
     * that fall on different days. Those read very differently to a person:
     * the first is weak corroboration, the second is close to a disagreement.
     */
    const c = comparePepDob("1961-08-04", "1961");
    expect(c.agreement).toBe("year_match");
    expect(c.reading).toBe("same_year_only_year_known");
    expect(c.corroborates).toBe(true);
    expect(c.sentence).toMatch(/publishes only the year/i);
  });

  it("same year, different day — and it says so", () => {
    const c = comparePepDob("1961-08-04", "1961-03-02");
    expect(c.agreement).toBe("year_match");
    expect(c.reading).toBe("same_year_different_day");
    expect(c.corroborates).toBe(false);
    expect(c.sentence).toMatch(/on a different day/i);
  });

  it("an exact agreement is stated plainly", () => {
    const c = comparePepDob("1961-08-04", "1961-08-04");
    expect(c.reading).toBe("same_date");
    expect(c.corroborates).toBe(true);
  });
});

describe("nothing here concludes anything about a person", () => {
  it("no sentence can be read as an identification or an exclusion", () => {
    for (const [a, b] of [
      ["1961-08-04", "1961-08-04"], ["1961-08-04", "1978-04-02"],
      ["1961-08-04", "1961"], ["1961-08-04", "1961-03-02"],
      [null, "1961"], ["1961-08-04", null], [null, null],
    ] as Array<[string | null, string | null]>) {
      const s = comparePepDob(a, b).sentence ?? "";
      expect(s).not.toMatch(/\bis (not )?this person\b/i);
      expect(s).not.toMatch(/\bnot a pep\b|\bcleared\b|\bruled out\b|\bconfirmed\b/i);
    }
  });

  it("a disagreement asks for confirmation rather than declaring one", () => {
    expect(comparePepDob("1961-08-04", "1978-04-02").sentence)
      .toMatch(/worth confirming against the official register/i);
  });
});

describe("the party's date is resolved in one place", () => {
  it("the screened party's own record wins over the case submission", () => {
    // Two operations compare against this. Deriving it twice would let the
    // list an operator browses rank differently from the record kept of what
    // was searched, and both would look right on their own.
    expect(resolveSubjectDob({
      partySubject: { date_of_birth: "1961-08-04" },
      personalDetails: { dob: "1978-04-02" },
    })).toBe("1961-08-04");
  });

  it("falls back to the submission, and accepts the spellings it uses", () => {
    expect(resolveSubjectDob({ personalDetails: { dob: "1978-04-02" } })).toBe("1978-04-02");
    expect(resolveSubjectDob({ personalDetails: { date_of_birth: "1978-04-02" } }))
      .toBe("1978-04-02");
  });

  it("a malformed date is discarded, never half-parsed", () => {
    // `null` reads as "not recorded", which is true and visible. A
    // half-parsed date is a comparison nobody can audit.
    for (const bad of ["circa 1961", "04/08/1961", "1961", "", 19610804, null]) {
      expect(resolveSubjectDob({ partySubject: { date_of_birth: bad } })).toBe(null);
    }
  });
});

describe("the floor is the one the index already applied", () => {
  it("a real same-name pair still clears it on the name alone", () => {
    // Two different people called Anthony Albanese: the name score is high,
    // which is exactly why the date of birth has to be visible and exactly
    // why it must not be the thing that decides.
    const s = scoreNames("Anthony Albanese", "Anthony Albanese").score;
    expect(admitCandidate(s)).toBe(true);
  });
});

describe("the rule, enforced against the endpoints that could break it", () => {
  const cases = readFileSync(
    join(__dirname, "../../../supabase/functions/aml-cases/index.ts"), "utf8");

  it("neither read path filters on an adjusted score", () => {
    /*
     * The regression this catches is one line: moving `rankCandidate` from
     * the sort into the filter. It would look like a tidy-up, it would pass
     * every behavioural test that does not supply a date of birth, and it
     * would silently stop showing office holders whose recorded birthday
     * disagrees — the exact automation-reaches-the-conclusion failure the
     * whole design position rules out.
     */
    for (const m of cases.matchAll(/\.filter\(\s*\(?c\)?\s*=>\s*([^)]*)\)/g)) {
      if (!/admitCandidate|score/.test(m[1])) continue;
      expect(m[1]).not.toMatch(/rankCandidate|dobAgreement|applyDobAdjustment|\.dob\b/);
    }
    // And admission goes through the shared helper in both places, rather
    // than a re-typed `>= 0.7`.
    expect(cases.match(/\.filter\(\(c\) => admitCandidate\(c\.score\)\)/g)?.length).toBe(2);
  });

  it("both operations resolve the party's date through the one module", () => {
    // Two derivations would let the browsed list and the recorded run compare
    // against different dates, and both would look right on their own.
    expect(cases.match(/resolveSubjectDob\(/g)?.length).toBe(2);
  });

  it("the index is never asked for a category it does not hold", () => {
    /*
     * `r.pep_type ?? 'domestic'` asserted an AUSTRAC category that the loader
     * refuses to write, the column leaves null and the migration's comment
     * says belongs to the determination. Nothing rendered it, so it was a
     * fabricated field waiting for its first consumer.
     */
    // Comments are stripped first — the note explaining the defect names it.
    const code = cases.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/pep_type \?\? 'domestic'/);
    expect(code).toMatch(/pepType: r\.pep_type \?\? null/);
  });
});
