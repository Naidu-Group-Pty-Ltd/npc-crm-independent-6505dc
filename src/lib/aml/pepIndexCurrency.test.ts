import { describe, expect, it } from "vitest";
import {
  PEP_INDEX_AGEING_AFTER_DAYS,
  PEP_INDEX_STALE_AFTER_DAYS,
  assessIndexRecency,
  describeCoverage,
  describeTenure,
  indexIsUsable,
} from "@/lib/aml/pepOfficeholderIndex";

/**
 * How current the index is — a different question from whether it loaded.
 *
 * ── What makes this index different from a sanctions list ─────────────
 * It makes a claim no sanctions list makes: `currently_held`.
 *
 * Every row from the Parliament register carries `currently_held: true` by
 * construction — the files are a snapshot of who sits on the day they are
 * downloaded, with no dates in them at all. That is accurate at the load and
 * decays from then on. A member who loses their seat at an election reads as
 * **Current** for as long as nothing reloads, and that word travels into the
 * evidence a determination rests on.
 *
 * Nothing measured it. `indexIsUsable` asks whether a load succeeded and holds
 * rows, so a load from eight months ago passes exactly as this morning's does
 * — which is the shape of the failure the sanctions register already had, with
 * freshness of the LOAD being read as currency of the DATA.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-20T00:00:00.000Z");
const loaded = (daysAgo: number, status = "succeeded") => describeCoverage(
  "aph_commonwealth_parliament",
  {
    entry_count: 225, source_as_at: "2026-08-20", status,
    completed_at: new Date(NOW - daysAgo * DAY).toISOString(),
    detail: { distinct_offices: 275 },
  },
);

describe("usability and currency are different questions", () => {
  it("a stale index is still usable, and is still searched", () => {
    /*
     * Refusing to search an old register would remove the only assistance the
     * operator has, and its rows are still leads. What it cannot do is
     * support a claim about today — so the CLAIM is what gets qualified.
     * Collapsing the two is the one-badge-two-questions mistake this codebase
     * keeps finding in a new place each time.
     */
    const old = loaded(200);
    expect(assessIndexRecency(old, NOW).reading).toBe("stale");
    expect(indexIsUsable([old])).toBe(true);
  });

  it("a load that never succeeded is neither fresh nor stale", () => {
    // "Out of date" presumes it was ever read. This one was not, and saying
    // it is stale would point at the wrong remedy.
    const never = assessIndexRecency(loaded(3, "failed"), NOW);
    expect(never.reading).toBe("never");
    expect(never.ageDays).toBe(null);
    expect(never.reason).toMatch(/has not been read/i);
  });

  it("the thresholds are counted in missed weekly runs", () => {
    expect(assessIndexRecency(loaded(1), NOW).reading).toBe("fresh");
    expect(assessIndexRecency(loaded(PEP_INDEX_AGEING_AFTER_DAYS), NOW).reading).toBe("fresh");
    expect(assessIndexRecency(loaded(PEP_INDEX_AGEING_AFTER_DAYS + 1), NOW).reading).toBe("ageing");
    expect(assessIndexRecency(loaded(PEP_INDEX_STALE_AFTER_DAYS), NOW).reading).toBe("ageing");
    expect(assessIndexRecency(loaded(PEP_INDEX_STALE_AFTER_DAYS + 1), NOW).reading).toBe("stale");
  });
});

describe("nothing says the bare word 'Current'", () => {
  it("a held seat is always held AS AT a date", () => {
    // The date is what makes the claim checkable. Without it the row asserts
    // something about today that no stored value can know.
    expect(describeTenure(true, assessIndexRecency(loaded(1), NOW)))
      .toBe("Held as at 2026-08-19");
    expect(describeTenure(true, assessIndexRecency(loaded(200), NOW)))
      .toMatch(/^Held as at 2026-02-01 — 200 days ago$/);
  });

  it("no branch produces an unqualified present-tense claim", () => {
    for (const days of [0, 10, 30, 200]) {
      for (const held of [true, false, null]) {
        const line = describeTenure(held, assessIndexRecency(loaded(days), NOW));
        expect(line).not.toBe("Current");
        expect(line).not.toMatch(/^currently\b/i);
      }
    }
  });

  it("a former holder is still named a former holder", () => {
    // Never written off by the passage of time — leaving office does not end
    // the risk, and the determination decides.
    expect(describeTenure(false, assessIndexRecency(loaded(1), NOW))).toBe("Formerly held");
    expect(describeTenure(null, assessIndexRecency(loaded(1), NOW))).toBe("Dates not recorded");
  });

  it("an unknown load date does not become a confident one", () => {
    const unknown = assessIndexRecency(loaded(3, "running"), NOW);
    expect(describeTenure(true, unknown)).toMatch(/date of record unknown/i);
    expect(describeTenure(true, unknown)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("what the reason may say", () => {
  it("is about the register and never about a person", () => {
    for (const days of [1, 30, 200]) {
      const r = assessIndexRecency(loaded(days), NOW);
      expect(r.reason).not.toMatch(/\bclear|\bno match\b|\bnot a pep\b|\bpep\b/i);
    }
  });

  it("a stale reading says what it does and does not undermine", () => {
    const r = assessIndexRecency(loaded(200), NOW);
    expect(r.reason).toMatch(/missed several/i);
    expect(r.reason).toMatch(/currently held were current on that date/i);
  });
});
