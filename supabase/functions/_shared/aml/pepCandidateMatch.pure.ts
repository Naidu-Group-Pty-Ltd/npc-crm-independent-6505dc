/**
 * Telling a candidate apart from somebody who merely shares a name.
 *
 * ── The problem this solves ───────────────────────────────────────────
 * The office-holder index is searched on name tokens alone, and that is
 * deliberate: a common surname must still surface the office holder, so the
 * search is built for recall. The consequence is that an operator is handed
 * candidates who are frequently a different person entirely, with nothing on
 * the card to connect them to the customer except an office title.
 *
 * A date of birth is the strongest discriminator any of these sources
 * publishes — Wikidata carries one for 99% of the people it holds.
 *
 * ── THE RULE, AND IT IS THE WHOLE POINT ───────────────────────────────
 * **A date of birth orders candidates and annotates them. It never removes
 * one.**
 *
 * The threshold deciding whether a candidate reaches a person is applied to
 * the NAME score alone. `admitCandidate` does not take a date of birth as an
 * argument, which is not an oversight — it is the guarantee, expressed in the
 * signature so it cannot be quietly relaxed, and a test asserts the admitted
 * set is byte-identical with and without the customer's date of birth.
 *
 * The sanctions path does the opposite, and correctly: there the adjustment
 * decides whether something is REFERRED at all, and a reviewer's time is the
 * cost. Here the candidate is already in front of a reviewer, and dropping an
 * office holder because a birth date disagrees would be the automation
 * reaching the determination. This platform's position is that the reviewer
 * or MLRO reaches it, on evidence they can see.
 *
 * So a disagreement is rendered, in words, beside the candidate — and it is a
 * reason a reviewer may cite when they reject it, which is the one place a
 * rejection reason is recorded and required.
 *
 * ── Why the agreement is imported rather than written here ────────────
 * `compareDob` is the comparator the sanctions screening already uses, and it
 * already understands partial dates. A second implementation that rounded
 * differently by one day would rank this index differently from the register
 * beside it, for reasons nobody could see.
 */
import { applyDobAdjustment, compareDob, type DobAgreement } from "./matching.ts";

/**
 * The floor a NAME score must clear to reach a person.
 *
 * Unchanged from what the index already applied, and stated here so the one
 * number and the rule that it is name-only live in the same file.
 */
export const PEP_CANDIDATE_MIN_NAME_SCORE = 0.7;

/**
 * What the comparison actually established, in a vocabulary a person can act
 * on.
 *
 * `DobAgreement` has four values and collapses two facts that read very
 * differently on a screen. `year_match` is returned both when the index holds
 * *only* a year — so the year is all there was to compare — and when two full
 * dates share a year but fall on different days. The first is weak
 * corroboration; the second is close to a disagreement. Rendering them with
 * one sentence would tell an operator the same thing about two different
 * findings.
 *
 * The agreement is left exactly as it is, because it feeds the ranking and
 * has to rank the same way the sanctions screening does. This is the reading
 * that goes on the page.
 */
export type DobReading =
  | "same_date"
  | "same_year_only_year_known"
  | "same_year_different_day"
  | "different"
  | "party_not_recorded"
  | "source_not_recorded";

export interface PepDobComparison {
  /** For ranking. Identical to what the sanctions path would compute. */
  agreement: DobAgreement;
  reading: DobReading;
  /** One sentence for the operator, or null when there is nothing to say. */
  sentence: string | null;
  /** Whether this is a reason to look harder rather than to relax. */
  corroborates: boolean;
}

/** `1961` → year, `1961-03` → month, `1961-03-02` → day. */
function precisionOf(value: string | null | undefined): "day" | "month" | "year" | null {
  const v = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "day";
  if (/^\d{4}-\d{2}$/.test(v)) return "month";
  if (/^\d{4}$/.test(v)) return "year";
  return null;
}

const yearOf = (v: string | null | undefined) => {
  const m = /^(\d{4})/.exec(String(v ?? "").trim());
  return m ? m[1] : null;
};

/**
 * Compare the party's recorded date of birth with the index row's.
 *
 * Both absences are named separately, because they are different facts about
 * different records and they point at different remedies: a party with no
 * date of birth on file is something the operator can fix, and a source that
 * publishes none is not.
 */
export function comparePepDob(
  partyDob: string | null | undefined,
  sourceDob: string | null | undefined,
): PepDobComparison {
  const agreement = compareDob(partyDob, sourceDob);

  if (!String(partyDob ?? "").trim()) {
    return {
      agreement, reading: "party_not_recorded", corroborates: false,
      sentence: "No date of birth is recorded for this party, so there is "
        + "nothing to compare the register entry against.",
    };
  }
  if (!String(sourceDob ?? "").trim()) {
    return {
      agreement, reading: "source_not_recorded", corroborates: false,
      /*
       * An absent date is NEVER a disagreement. Reading "the register does
       * not say" as "the dates do not match" is the same defect as reading
       * an empty register as a clearance, pointed the other way.
       */
      sentence: "The register does not publish a date of birth for this "
        + "entry. That is not a difference — there is nothing to compare.",
    };
  }

  const partyPrecision = precisionOf(partyDob);
  const sourcePrecision = precisionOf(sourceDob);
  const sameYear = yearOf(partyDob) !== null && yearOf(partyDob) === yearOf(sourceDob);

  if (agreement === "match") {
    return {
      agreement, reading: "same_date", corroborates: true,
      sentence: `Same date of birth as this party's record (${sourceDob}).`,
    };
  }

  if (sameYear) {
    // Which kind of `year_match` is this?
    const bothFull = partyPrecision === "day" && sourcePrecision === "day";
    if (bothFull) {
      return {
        agreement, reading: "same_year_different_day", corroborates: false,
        sentence: `Born in the same year but on a different day — the register `
          + `says ${sourceDob}, this party's record says ${partyDob}.`,
      };
    }
    return {
      agreement, reading: "same_year_only_year_known", corroborates: true,
      sentence: `Born in the same year (${yearOf(sourceDob)}). The register `
        + `publishes only ${sourcePrecision === "year" ? "the year" : "the year and month"}, `
        + "so the day could not be compared.",
    };
  }

  return {
    agreement, reading: "different", corroborates: false,
    /*
     * Deliberately "a different date of birth", not "not this person". The
     * registers disagree with each other and with official records often
     * enough that a date is a reason to look harder, never a conclusion — and
     * the conclusion is the reviewer's to write down.
     */
    sentence: `A different date of birth — the register says ${sourceDob}, `
      + `this party's record says ${partyDob}. Worth confirming against the `
      + "official register before relying on either.",
  };
}

/**
 * Whether a candidate is shown to a person.
 *
 * Takes the name score and nothing else, on purpose. See the header.
 */
export function admitCandidate(nameScore: number): boolean {
  return nameScore >= PEP_CANDIDATE_MIN_NAME_SCORE;
}

/**
 * The number candidates are SORTED by.
 *
 * Ranking is where the date of birth is allowed to act, because reordering a
 * list a person is reading changes what they look at first and changes
 * nothing about what they can see.
 */
export function rankCandidate(nameScore: number, agreement: DobAgreement): number {
  return Math.round(applyDobAdjustment(nameScore, agreement) * 1000) / 1000;
}

/**
 * The party's date of birth, from the record that is actually being screened.
 *
 * ── Why this is a function and not two inline reads ───────────────────
 * Because two operations compare against it — the assisted search and the
 * recorded screening run — and if they derived it differently the same person
 * would rank differently in the list an operator browses than in the record
 * that is kept of what was searched. That divergence would be invisible: both
 * would look right on their own.
 *
 * The order is the same one the identity itself follows. A named party
 * subject is the thing under screening, so its own recorded date wins; the
 * case-level submission is the fallback, and it is the same
 * `personal_details` section the screening policy already reads.
 *
 * A malformed date is discarded rather than passed through. `null` reads as
 * "not recorded", which is a true and visible statement; a half-parsed date
 * is a comparison nobody can audit.
 */
export function resolveSubjectDob(input: {
  partySubject?: { date_of_birth?: unknown } | null;
  personalDetails?: Record<string, unknown> | null;
}): string | null {
  const iso = (v: unknown): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  };
  const fromSubject = iso(input.partySubject?.date_of_birth);
  if (fromSubject) return fromSubject;
  const pd = input.personalDetails ?? null;
  if (!pd) return null;
  return iso(pd.dob) ?? iso(pd.date_of_birth) ?? iso(pd.dateOfBirth);
}
