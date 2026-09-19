import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `aml.cases` has no `tenant_id` column.
 *
 * Eighteen call sites across five Edge Functions selected it anyway. The
 * table has thirty-seven columns and has never had that one, so PostgREST
 * answered
 *
 *     42703  column "tenant_id" does not exist
 *
 * the destructure discarded `error`, `data` was null, and twelve of those
 * handlers reported **"Case not found"** about a case the operator had open.
 *
 * What that cost, measured against production:
 *
 *   - `record_pep_determination` answered 404 to every attempt, which is why
 *     `aml.pep_determinations` was EMPTY from the day it was created and why
 *     Stage 5's "Record PEP determination" appeared to do nothing at all;
 *   - every ongoing-CDD operation in `aml-monitoring` was unreachable, which
 *     the workspace rendered as "monitoring summary could not be read";
 *   - `hasCaseAccess` in `aml-verification` returned false for every caller
 *     on every case, making the documentary evidence route permanently 403
 *     behind an enabled button. (That one had already been found and fixed
 *     in place — the other seventeen were left.)
 *
 * The defect is invisible by construction: the select is valid TypeScript,
 * the failure is a string a server returns, and a discarded `error` turns it
 * into a plausible business outcome. Only a source rule can hold it.
 */

const root = join(__dirname, "../../..");
const functionsDir = join(root, "supabase/functions");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk(functionsDir);

/** `.from('cases').select('…')`, across line breaks, both quote styles. */
const CASES_SELECT = /from\(\s*['"]cases['"]\s*\)\s*\n?\s*\.select\(\s*\n?\s*(['"`])([\s\S]*?)\1/g;

describe("aml.cases has no tenant_id column, and nothing may select one", () => {
  it("no Edge Function selects tenant_id from aml.cases", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(CASES_SELECT)) {
        if (/\btenant_id\b/.test(m[2])) {
          const line = src.slice(0, m.index ?? 0).split("\n").length;
          offenders.push(`${file.replace(root + "/", "")}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the tenant is resolved in one module, and that module refuses the column", () => {
    const mod = readFileSync(
      join(functionsDir, "_shared/aml/caseTenant.ts"), "utf8");
    expect(mod).toContain("DEFAULT_AML_TENANT");
    expect(mod).toContain("tenantForCase");
    // `readCase` throws on the column rather than letting a 42703 reach the
    // operator dressed as "Case not found".
    expect(mod).toMatch(/tenant_id\\b\/\.test\(columns\)/);
    expect(mod).toContain("aml.cases has no tenant_id column");
  });

  it("a failed READ is answered differently from an absent ROW", () => {
    // A missing case is 404 and final. A failed read is 503 and worth
    // retrying. Collapsing them is how an operator gets told a case does not
    // exist while looking straight at it.
    const mod = readFileSync(
      join(functionsDir, "_shared/aml/caseTenant.ts"), "utf8");
    expect(mod).toContain("failed: boolean");
    expect(mod).toMatch(/failed: true/);

    const cases = readFileSync(join(functionsDir, "aml-cases/index.ts"), "utf8");
    const pepOp = cases.slice(cases.indexOf("case 'record_pep_determination'"));
    expect(pepOp).toContain("caseRead.failed");
    expect(pepOp).toContain("case_read_failed");
    expect(pepOp).toMatch(/}, 503\)/);
  });

  it("the PEP determination stamps the resolved tenant, not a column read", () => {
    const cases = readFileSync(join(functionsDir, "aml-cases/index.ts"), "utf8");
    expect(cases).toContain("tenant_id: caseRead.tenantId");
    expect(cases).not.toContain("caseRow.tenant_id");
  });
});

describe("an identifier that does not exist is never type debt", () => {
  /*
   * `defer_pep_determination` called `appendCaseEvent`; the function in that
   * file is `appendEvent`. The module loads, so it is not a boot failure —
   * it served every other operation perfectly and threw a ReferenceError on
   * that one branch, which reached the operator as "the server refused it".
   */
  it("no aml-cases handler calls appendCaseEvent — the helper is appendEvent", () => {
    const cases = readFileSync(join(functionsDir, "aml-cases/index.ts"), "utf8");
    expect(cases).not.toContain("appendCaseEvent");
    expect(cases).toContain("async function appendEvent(");
  });

  it("the edge type-check gate treats a missing name as fatal, never baselineable", () => {
    const gate = readFileSync(
      join(root, "scripts/security/check-edge-functions.mjs"), "utf8");
    // A COUNT baseline can absorb a swapped-in defect — one goes, one
    // arrives, the number holds — and for this class that ships a 500.
    expect(gate).toContain("'TS2304'");
    expect(gate).toContain("'TS2552'");
    expect(gate).toContain("KNOWN_MISSING_NAMES");
    expect(gate).toContain("edge-missing-names.txt");
  });

  it("the frozen list is keyed by file and identifier, never by line", () => {
    const frozen = readFileSync(
      join(root, "supabase/functions-registry/edge-missing-names.txt"), "utf8");
    const entries = frozen.split("\n")
      .map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e).toMatch(/^supabase\/functions\/[^:]+\.ts::[A-Za-z_$][\w$]*$/);
      // A line number would churn on every edit above it, or silently start
      // covering a different defect.
      expect(e).not.toMatch(/:\d+/);
    }
  });
});
