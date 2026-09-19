import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One live decision per scope, made structural rather than incidental.
 *
 * ── What is actually true ─────────────────────────────────────────────
 * No case in production holds duplicate live `case_screening_scopes` rows,
 * and this path cannot create them on its own — it always supersedes the
 * existing row before inserting a new one.
 *
 * What it does not survive is a RACE. The recorder built
 * `new Map(current.map((r) => [r.scope, r]))`, which keeps only the LAST row
 * for a scope, and then superseded just that one. `sync_screening_stage`
 * runs on every page load, so two tabs opening the same case can both read
 * the single live row, both supersede it, and both insert — leaving two live
 * rows that disagree about whether screening is required, with nothing that
 * would ever clear them.
 *
 * That is worth closing rather than watching for, because of what reads
 * these rows: `deriveAmlScreeningScope` resolved them last-wins over a
 * `SELECT` with no `ORDER BY`. The scope most likely to flip is `sanctions`
 * — the one obligation in this product that binds every dealing and cannot
 * be stood down by risk.
 */

const source = readFileSync(
  join(__dirname, "../../../supabase/functions/aml-cases/index.ts"), "utf8");
const code = source.split("\n")
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

describe("the recorder keeps one live decision per scope", () => {
  it("no longer collapses the live rows into a last-wins map", () => {
    expect(code).not.toContain(
      "new Map<string, any>(\n    (current ?? []).map((r: any) => [String(r.scope), r]));");
    expect(code).toContain("liveByScope");
  });

  it("takes the NEWEST live row as the decision", () => {
    // Not "the last one the read returned". A decision has a time.
    expect(code).toContain("decided_at");
    expect(code).toContain("newestFirst");
  });

  it("supersedes every older live row, not just the one it kept", () => {
    expect(code).toMatch(/const stale = list\.slice\(1\)/);
    expect(code).toMatch(/\.update\(\{ superseded_at: nowIso \}\)\s*\.in\('id', stale\)/);
  });

  it("repairs a case even when the decision has not changed", () => {
    /*
     * The dedupe runs before the per-scope loop, which `continue`s on an
     * unchanged decision before reaching any write. A case that acquired
     * duplicates and then went stable would otherwise carry the
     * contradiction for ever — the losing race is a moment, and the damage
     * it leaves is permanent.
     */
    const dedupe = code.indexOf("const stale = list.slice(1)");
    const loop = code.indexOf("for (const key of ALL_SCREENING_SCOPES)");
    expect(dedupe).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(dedupe);
  });

  it("a failed dedupe does not record a decision on top of the damage", () => {
    // Writing a new row while the old contradictions survive would make the
    // reading worse, not better.
    const scan = code.slice(code.indexOf("const stale = list.slice(1)"));
    expect(scan.slice(0, 600)).toMatch(/if \(dedupeError\)/);
    expect(scan.slice(0, 600)).toMatch(/return \{ changed: \[\], subjectsChanged: 0, recorded: false \}/);
  });
});
