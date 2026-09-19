import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * No migration in this corpus may use syntax PostgreSQL rejects.
 *
 * Two migrations were written with `CREATE POLICY IF NOT EXISTS`, which
 * PostgreSQL has never supported in any version — `CREATE POLICY` has no
 * `IF NOT EXISTS` clause. Every one of the 23 statements across those files
 * was a parse error (42601), verified against PostgreSQL 17, so neither
 * migration could ever have run.
 *
 * That was survivable only by accident. Clone backends are built by catalog
 * introspection (`replicateSchemaByIntrospection`) and have the prime's
 * migration ids stamped into their ledger, so historical files are skipped
 * rather than replayed. But `applyPrimeMigrations` — which Mission Control
 * uses to push INCREMENTAL migrations onto every existing clone — halts on
 * the first failure. A new migration copying this pattern therefore stops
 * schema sync for the entire fleet, and the pattern is exactly the kind that
 * gets copied from a neighbouring file.
 *
 * Kept narrow deliberately: these are forms the grammar rejects outright, not
 * a style opinion. A check that argues about taste is one people learn to
 * silence.
 */
const MIGRATIONS = "supabase/migrations";

/** Statement forms PostgreSQL has no `IF NOT EXISTS` clause for. */
const INVALID = [
  { re: /\bcreate\s+policy\s+if\s+not\s+exists\b/gi, stmt: "CREATE POLICY" },
  { re: /\bcreate\s+trigger\s+if\s+not\s+exists\b/gi, stmt: "CREATE TRIGGER" },
  { re: /\bcreate\s+rule\s+if\s+not\s+exists\b/gi, stmt: "CREATE RULE" },
  { re: /\bcreate\s+constraint\s+trigger\s+if\s+not\s+exists\b/gi, stmt: "CREATE CONSTRAINT TRIGGER" },
  { re: /\balter\s+table\s+[^\n;]*\badd\s+constraint\s+if\s+not\s+exists\b/gi, stmt: "ADD CONSTRAINT" },
];

/** Drop `--` comments so the note explaining this rule does not trip it. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

describe("migration corpus parses", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

  it("has migrations to check", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  // The corpus is 984 files and 327 MB (measured 16 Sep 2026): reading it
  // alone is ~2.4 s, the comment strip ~1.2 s and the five scans ~1.4 s, so
  // the default 5 s budget was already the measured cost of the test and one
  // more migration tipped it over under a parallel run. A file that never
  // says `if not exists` is skipped before the strip, and the budget states
  // what the corpus costs rather than what a small one would.
  it("uses no IF NOT EXISTS clause PostgreSQL does not have", { timeout: 60_000 }, () => {
    const offences: string[] = [];
    for (const file of files) {
      const raw = readFileSync(join(MIGRATIONS, file), "utf8");
      if (!/\bif\s+not\s+exists\b/i.test(raw)) continue;
      const sql = stripComments(raw);
      for (const { re, stmt } of INVALID) {
        const hits = sql.match(re);
        if (hits) {
          offences.push(
            `${file}: ${hits.length}× "${stmt} IF NOT EXISTS" — ` +
              `PostgreSQL has no such clause; use DROP ... IF EXISTS then CREATE`,
          );
        }
      }
    }
    expect(offences).toEqual([]);
  });
});
