import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AU_LOCALE, displayDate, displayDateTime } from "./displayDate";

/**
 * Compliance dates are Day/Month/Year, and never the reader's machine.
 *
 * ── What was on screen ────────────────────────────────────────────────
 * "Next periodic review **8/29/2029**" beside "Screening refresh Due
 * **8/21/2027**" — month first, for an Australian reporting entity. Both
 * came from `toLocaleDateString()` with no locale, which takes whatever the
 * browser happens to be set to.
 *
 * Two of those numbers are ambiguous to a reader and a third of the calendar
 * is silently wrong by months: 8/9/2027 is the ninth of August or the eighth
 * of September depending on who is looking. A compliance date is read by an
 * auditor, quoted in a report and typed into a regulator's form; it must not
 * depend on the machine it is read on.
 *
 * The rest of the product already said `en-AU` explicitly at 100+ call
 * sites, so this adopts a convention rather than inventing one.
 */

describe("the AML date helpers are pinned", () => {
  const jan = "2027-01-08T00:00:00.000Z";

  it("day comes before month", () => {
    expect(AU_LOCALE).toBe("en-AU");
    expect(displayDate(jan)).toBe("08/01/2027");
  });

  it("and in the date-and-time form too", () => {
    expect(displayDateTime(jan)).toMatch(/^08\/01\/2027/);
  });

  it("an absent value is still an em dash, never 'Invalid Date'", () => {
    expect(displayDate(null)).toBe("—");
    expect(displayDate("")).toBe("—");
    expect(displayDate("not a date")).toBe("—");
  });
});

/** Every `.ts`/`.tsx` under a root, excluding tests. */
function sources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      out.push(path);
    }
  };
  walk(root);
  return out;
}

describe("no surface formats a date on the reader's locale", () => {
  /* The rule, not the symptom: an un-localed `toLocale*` call is the defect
     wherever it is, and it reappears every time somebody writes one. */
  const roots = [
    "src/components/aml",
    "src/components/partner-compliance",
    "src/pages/aml",
    "src/lib/aml",
    "supabase/functions/_shared/aml",
  ];

  it("across every AML and partner-compliance module", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sources(root)) {
        const body = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (/toLocale(Date|Time)?String\(\s*\)/.test(body)) offenders.push(file);
      }
    }
    expect(offenders, `un-localed date formatting in:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("and the helper itself is the one place the locale is named", () => {
    const helper = readFileSync("src/lib/aml/displayDate.ts", "utf8");
    expect(helper).toContain('export const AU_LOCALE = "en-AU"');
    expect(helper).toContain("toLocaleDateString(AU_LOCALE)");
    expect(helper).toContain("toLocaleString(AU_LOCALE)");
  });
});
