import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every AML record that names a responsible person must actually name one.
 *
 * Eleven tables in the `aml` schema carry a NOT NULL actor column with no
 * default — `reliance_agreements.created_by`, `decisions.decided_by`,
 * `compliance_attestations.issued_by` and so on. They are not bookkeeping:
 * an arrangement under section 37A is entered into BY somebody on our side,
 * and a record of one with no responsible officer is not a record of
 * anything. That is why the columns are NOT NULL.
 *
 * A NOT NULL column is a promise Postgres keeps by REFUSING, which is the
 * right answer for the database and the wrong one for a person. The direct
 * acknowledgement's acceptance omitted `created_by` — the one path with no
 * staff member in the request, because the actor is the partner over a public
 * link — and every acceptance answered 23502. The partner saw "Internal
 * error", nobody on this side was told, and the agreement they had read and
 * ticked stayed outstanding.
 *
 * Nothing could have caught it earlier: the surrounding tests assert the
 * insert EXISTS, TypeScript does not know the table's shape, and the path
 * cannot run without a partner clicking a link in an email. So the columns
 * are asserted here instead, against the insert sites themselves.
 *
 * The map below was measured against the live schema
 * (`is_nullable = 'NO' and column_default is null`). It is deliberately not
 * derived from the migrations at test time: a table's shape is the sum of
 * every migration that ever touched it, and re-deriving that is exactly the
 * reconstruction this test exists to avoid. If a constraint is ever dropped,
 * this test simply asks for more than the database does, which costs nothing.
 */
const REQUIRED_ACTOR_COLUMN: Record<string, string> = {
  analyst_recommendations: "created_by",
  approvals: "requested_by",
  compliance_attestations: "issued_by",
  decisions: "decided_by",
  direct_partner_acknowledgements: "sent_by",
  disclosure_manifests: "created_by",
  partner_organisations: "created_by",
  partner_portal_memberships: "created_by",
  reliance_agreements: "created_by",
  retention_scans: "requested_by",
  risk_overrides: "requested_by",
};

function edgeFunctionSources(dir = "supabase/functions"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...edgeFunctionSources(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** The balanced `(...)` argument of the call starting at `open`. */
function callArgument(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

interface InsertSite {
  file: string; table: string; column: string; line: number; argument: string;
}

function insertSites(): InsertSite[] {
  const sites: InsertSite[] = [];
  for (const file of edgeFunctionSources()) {
    const source = readFileSync(file, "utf8");
    const pattern = /\.from\("([a-z_]+)"\)\s*\n?\s*\.insert\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const column = REQUIRED_ACTOR_COLUMN[match[1]];
      if (!column) continue;
      const open = match.index + match[0].length - 1;
      sites.push({
        file, table: match[1], column,
        line: source.slice(0, match.index).split("\n").length,
        argument: callArgument(source, open),
      });
    }
  }
  return sites;
}

describe("an AML record that must name a responsible person, does", () => {
  const sites = insertSites();

  it("finds the insert sites it is meant to be judging", () => {
    // A regex that silently stops matching would make this file pass
    // vacuously, which is the failure mode of every source-reading test.
    expect(sites.length).toBeGreaterThanOrEqual(8);
    expect(sites.some((s) => s.table === "reliance_agreements")).toBe(true);
  });

  it.each(insertSites().map((s) => [`${s.file}:${s.line} → aml.${s.table}`, s] as const))(
    "%s names its actor column",
    (_label, site) => {
      const literal = site.argument.trimStart().startsWith("{")
        || site.argument.trimStart().startsWith("[{");
      // A payload built elsewhere cannot be judged from here; a literal can,
      // and every site in this repository is a literal today.
      if (!literal) return;
      expect(
        new RegExp(`(^|[\\s,{])${site.column}\\s*:`).test(site.argument),
        `aml.${site.table} requires ${site.column} (NOT NULL, no default). `
        + `${site.file}:${site.line} does not set it, so every insert on this path `
        + "is refused with 23502 — which reaches the caller as an internal error.",
      ).toBe(true);
    },
  );
});

describe("the direct acceptance attributes the arrangement to its issuer", () => {
  const relianceFn = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");
  const accept = relianceFn.slice(relianceFn.indexOf("/* ── acceptance ─"));

  it("uses the officer who ISSUED the request, not a placeholder", () => {
    // There is no session on this path — the actor is the partner. The
    // officer who sent the link is the one who committed this business to
    // the arrangement, so they are who the record names.
    expect(accept).toContain("created_by: ack.sent_by");
  });

  it("refuses in words rather than throwing if the issuer is somehow unknown", () => {
    expect(accept).toContain('code: "issuer_unknown"');
    expect(accept).toContain("Nothing has been recorded.");
  });

  it("the column that attribution comes from is itself required", () => {
    const migration = readFileSync(
      "supabase/migrations/20261005000000_direct_acknowledgement_issuer_required.sql", "utf8");
    expect(migration).toContain("alter column sent_by set not null");
  });
});

describe("a public link never fails silently", () => {
  const relianceFn = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");

  it("an unexpected fault on the link path is raised in the Command Centre", () => {
    // The partner has no account and no support channel: the only party who
    // witnesses the failure is the one party who cannot report it.
    expect(relianceFn).toContain("async function publicLinkFailure(");
    const helper = relianceFn.slice(relianceFn.indexOf("async function publicLinkFailure("));
    expect(helper.slice(0, 1600)).toContain("notifyCommandCentre(");
    expect(helper.slice(0, 1600)).toContain("nothing has been recorded");
  });

  it("both write paths of the link are covered by it", () => {
    const guard = relianceFn.slice(relianceFn.indexOf('if (op === "ack_view"'));
    expect(guard).toContain("return await publicLinkFailure(");
    expect(guard).toContain('op === "ack_decline" ? "A partner\'s decline" : "A partner\'s acceptance"');
  });
});
