import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVIEW_INTERVALS, MAX_REVIEW_INTERVAL_MONTHS, addMonthsUtc,
  resolveReviewInterval, reviewCycleLabel,
} from "../../../supabase/functions/_shared/aml/reviewSchedule.pure";

/**
 * The review cycle, and the reminders it raises.
 *
 * ── What was reported ─────────────────────────────────────────────────
 * "The review cycle and the CDD is not making sense to me as I believe a
 * review needs to be completed on an annual basis."
 *
 * The card read **"Every 36 months (low risk)"** with a next review in
 * 2029 — while the same card showed a screening refresh due in 2027. Two
 * obligations on one customer running on different clocks, and the slower
 * one attached to the more searching question.
 *
 * AUSTRAC fixes no interval (ongoing CDD is risk-based), so the interval is
 * a programme parameter. `reviewSchedule.pure.ts` is where the programme
 * states it, and these tests pin the two rules that make the statement
 * safe rather than merely different.
 */

describe("a review is completed at least annually", () => {
  it("every default is at or inside the ceiling", () => {
    for (const [rating, months] of Object.entries(DEFAULT_REVIEW_INTERVALS)) {
      expect(months, rating).toBeLessThanOrEqual(MAX_REVIEW_INTERVAL_MONTHS);
      expect(months, rating).toBeGreaterThan(0);
    }
    expect(MAX_REVIEW_INTERVAL_MONTHS).toBe(12);
  });

  it("a rating may make the cycle TIGHTER, never longer", () => {
    /* The old table went the other way — low risk reviewed least often, at
       three years. A rating exists here to bring a review forward. */
    expect(DEFAULT_REVIEW_INTERVALS.prohibited).toBeLessThan(MAX_REVIEW_INTERVAL_MONTHS);
    for (const rating of ["low", "medium", "high", "unrated"]) {
      expect(resolveReviewInterval(rating).months, rating).toBe(12);
    }
    expect(resolveReviewInterval("prohibited").months).toBe(3);
  });

  it("an unknown or absent rating still gets a cycle", () => {
    /* Ongoing CDD lapsing quietly is the failure this area exists to
       prevent — "no rating" must never mean "no review". */
    expect(resolveReviewInterval(null).months).toBe(12);
    expect(resolveReviewInterval("").months).toBe(12);
    expect(resolveReviewInterval("something_new").months).toBe(12);
  });
});

describe("a tenant may configure it tighter, and only tighter", () => {
  it("a shorter configured cycle is honoured exactly", () => {
    const r = resolveReviewInterval("low", { low: 6 });
    expect(r.months).toBe(6);
    expect(r.clamped).toBe(false);
  });

  it("a longer one is clamped, and says so", () => {
    /* Reported rather than silent: a tenant who configured 24 should be
       able to see that the programme's ceiling applied. */
    const r = resolveReviewInterval("low", { low: 24 });
    expect(r.months).toBe(12);
    expect(r.clamped).toBe(true);
    expect(r.configuredMonths).toBe(24);
  });

  it("nonsense configuration falls back rather than disabling the cycle", () => {
    for (const bad of [{ low: 0 }, { low: -5 }, { low: "annually" }, { low: null }]) {
      const r = resolveReviewInterval("low", bad as Record<string, unknown>);
      expect(r.months, JSON.stringify(bad)).toBe(12);
    }
  });
});

describe("the cycle reads the same wherever it is written", () => {
  it("twelve months is said as annual", () => {
    expect(reviewCycleLabel(resolveReviewInterval("low"))).toBe("Annually (low risk)");
  });

  it("a tighter cycle names its months", () => {
    expect(reviewCycleLabel(resolveReviewInterval("prohibited")))
      .toBe("Every 3 months (prohibited risk)");
  });

  it("an unrated case is not described as '(unrated risk) risk'", () => {
    expect(reviewCycleLabel(resolveReviewInterval(null))).toBe("Annually (unrated)");
  });

  it("the card renders from this module, not from its own arithmetic", () => {
    const workspace = readFileSync("src/pages/aml/AmlCaseWorkspace.tsx", "utf8");
    expect(workspace).toContain("reviewCycleLabel({");
    expect(workspace).not.toContain("`Every ${monitoring.review_interval_months} months");
  });

  it("adding months is UTC, so a cycle does not drift by a timezone", () => {
    expect(addMonthsUtc(new Date("2026-08-29T00:00:00.000Z"), 12).toISOString())
      .toBe("2027-08-29T00:00:00.000Z");
  });
});

describe("the interval is stated ONCE", () => {
  const monitoring = readFileSync("supabase/functions/aml-monitoring/index.ts", "utf8");

  it("the table is gone from the edge function — both copies of it", () => {
    /* It was written twice inside one file, thirty lines apart: once for
       `schedule_periodic_review` and once inline in `complete_review`. Only
       the first was ever edited, so completing a review booked the next one
       on a cycle the rest of the product had stopped believing in. */
    expect(monitoring).not.toContain("prohibited: 3, high: 12, medium: 24, low: 36");
    expect(monitoring).not.toContain("DEFAULT_REVIEW_INTERVALS");
    expect((monitoring.match(/resolveReviewInterval\(/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("scheduling and completing resolve it the same way", () => {
    expect((monitoring.match(/await reviewInterval\(caseRow\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
  });
});

describe("a scheduled review reaches the Reminders hub", () => {
  const shared = readFileSync(
    "supabase/functions/_shared/aml/complianceReminders.ts", "utf8");
  const monitoring = readFileSync("supabase/functions/aml-monitoring/index.ts", "utf8");
  const reliance = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");

  it("it writes to `client_reminders`, which is what the hub already reads", () => {
    /* A second reminder system is how two reminder systems disagree. This
       one writes where reminders already are, so an AML review is reminded
       about everywhere reminders are. */
    expect(shared).toContain('from("client_reminders")');
    const hook = readFileSync("src/hooks/useAllReminders.ts", "utf8");
    expect(hook).toContain("table: 'client_reminders'");
  });

  it("writing the same reminder twice updates one row", () => {
    expect(shared).toContain('.eq("source_ref", input.sourceRef)');
    const migration = readFileSync(
      "supabase/migrations/20261016000000_aml_reminders_and_annual_review_cycle.sql", "utf8");
    expect(migration).toContain("create unique index if not exists client_reminders_source_ref_key");
    expect(migration).toContain("where source_ref is not null");
  });

  it("the type is one the COLUMN accepts", () => {
    /* `reminder_type` is CHECK-constrained to a closed list, and the AML
       kinds were not in it — so every write would have been rejected at the
       column while looking, from the edge function, exactly like a write
       that had not been attempted. */
    const migration = readFileSync(
      "supabase/migrations/20261016000000_aml_reminders_and_annual_review_cycle.sql", "utf8");
    for (const type of ["aml_periodic_review", "aml_trigger_review", "aml_passport_issued"]) {
      expect(shared, type).toContain(type);
      expect(migration, type).toContain(`'${type}'`);
    }
    expect(migration).toContain("client_reminders_reminder_type_check");
  });

  it("scheduling, triggering and the daily sweep all raise one", () => {
    expect((monitoring.match(/upsertComplianceReminder\(admin, \{/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
  });

  it("completing a review discharges its reminder rather than deleting it", () => {
    expect(monitoring).toContain("completeComplianceReminder(admin, {");
    expect(shared).toContain('status: "completed"');
    expect(shared).not.toContain(".delete()");
  });

  it("a reminder NEVER fails the compliance act it accompanies", () => {
    /* The review is the record; the reminder is a prompt. A prompt that
       cannot be written must not roll back an obligation that was. */
    expect(shared).toContain("catch (e)");
    expect(shared).not.toMatch(/\bthrow\b/);
  });

  it("a case with no CRM client is skipped, not failed", () => {
    // An AML case can be opened against a subject before a client record
    // exists. There is nobody's file to remind on; that is a real state.
    expect(shared).toContain('return { written: false, skipped: "no_client" }');
  });

  it("the hub names them as compliance work", () => {
    const hub = readFileSync("src/pages/RemindersHub.tsx", "utf8");
    expect(hub).toContain("AML_REMINDER_LABELS");
    expect(hub).toContain("aml_periodic_review: 'AML/CTF review'");
  });
});

describe("issuing the Passport arms ongoing CDD", () => {
  const reliance = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");
  const armed = reliance.slice(
    reliance.indexOf("async function armOngoingCdd("),
    reliance.indexOf("async function sha256Hex("));

  it("issuance schedules the first periodic review", () => {
    /* Issuance is the moment the record becomes something a partner may
       rely on, and therefore the moment the obligation to keep it current
       begins. It had to be scheduled by hand from a card at the foot of the
       last stage, so a case could carry a live Passport with no ongoing CDD
       booked at all. */
    expect(reliance).toContain("await armOngoingCdd(admin, {");
    expect(armed).toContain('classification: "periodic"');
    expect(armed).toContain("next_periodic_review_at");
  });

  it("but never moves an obligation that already exists", () => {
    // Re-issuing a document is not a reason to re-schedule a scheduled
    // review.
    expect(armed).toContain('.in("status", ["queued", "in_progress", "remediation_required"])');
    expect(armed).toContain("if (!open) {");
  });

  it("never on a case whose relationship has ended", () => {
    expect(armed).toContain('caseRow.monitoring_status === "ended"');
    expect(armed).toContain('skipped: "relationship_ended"');
  });

  it("and never fails the issuance", () => {
    /* The attestation is the compliance act. A reminder is not. */
    expect(armed).toContain("catch (e)");
    expect(armed).toContain("/* Never fails the issuance. */");
  });

  it("the reminder says what is now owed and where", () => {
    const shared = readFileSync(
      "supabase/functions/_shared/aml/complianceReminders.ts", "utf8");
    expect(shared).toContain("export function passportIssuedReminder");
    expect(shared).toMatch(/first periodic review falls due/);
    expect(shared).toMatch(/Passport & Partners stage/);
  });

  it("and discloses nothing a reminder row should not carry", () => {
    /* A reminder is not a disclosure boundary and must not become one. */
    const shared = readFileSync(
      "supabase/functions/_shared/aml/complianceReminders.ts", "utf8");
    /* The comments deliberately NAME what must not appear — that is how the
       next person keeps the rule — so the assertion is over the code. */
    const wording = shared.slice(shared.indexOf("/* ── Wording"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const leak of ["risk_rating", "screening", "sanction", "rationale", "decision"]) {
      expect(wording.toLowerCase(), leak).not.toContain(leak);
    }
  });
});
