/**
 * Archiving an AUSTRAC report — putting it away, never throwing it away.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARCHIVABLE_STATUSES, archiveBlockReason, archiveWarning, isArchived,
} from "./austracArchive";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Exactly what `reports_status_check` accepts. */
const ALL_STATUSES = [
  "draft", "in_review", "awaiting_mlro", "approved",
  "submitted", "acknowledged", "rejected", "withdrawn",
] as const;

describe("nothing owed to AUSTRAC may be hidden", () => {
  it("refuses an approved report that has not been lodged", () => {
    /* This is the rule the whole feature turns on. An archive that can hide
       an approved-but-unlodged suspicious matter report is not a tidy-up
       feature, it is a way to lose a statutory deadline: the report leaves
       the list, the clock keeps running, and nobody is looking. */
    const reason = archiveBlockReason("approved");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/still owed to AUSTRAC/i);
  });

  it("refuses a report that is still being written, and points at delete", () => {
    for (const s of ["draft", "in_review", "awaiting_mlro"]) {
      expect(archiveBlockReason(s)).toMatch(/deleted, not archived/i);
    }
  });

  it("allows only the statuses whose lodgement decision is behind them", () => {
    const allowed = ALL_STATUSES.filter((s) => archiveBlockReason(s) === null);
    expect(allowed).toEqual(["submitted", "acknowledged", "rejected", "withdrawn"]);
    expect([...ARCHIVABLE_STATUSES].sort()).toEqual(allowed.slice().sort());
  });

  it("has an answer for every status the column accepts", () => {
    /* A status with no ruling would fall through to whatever the caller
       assumed. */
    for (const s of ALL_STATUSES) {
      expect(typeof archiveBlockReason(s) === "string" || archiveBlockReason(s) === null).toBe(true);
    }
    expect(archiveBlockReason("something_new")).toBeTruthy();
    expect(archiveBlockReason(null)).toBeTruthy();
  });
});

describe("what the operator is told", () => {
  it("warns when a lodged report is archived with no receipt", () => {
    /* Archivable — AUSTRAC's acknowledgement may never arrive, and waiting
       for one for ever is not a filing system — but the operator should
       know it is going away without one. */
    expect(archiveWarning({ status: "submitted", hasReceipt: false })).toMatch(/No AUSTRAC receipt/i);
    expect(archiveWarning({ status: "submitted", hasReceipt: true })).toBeNull();
    expect(archiveWarning({ status: "acknowledged", hasReceipt: false })).toBeNull();
  });

  it("reads an archived row from the stamp and nothing else", () => {
    expect(isArchived({ archived_at: "2026-08-30T00:00:00Z" })).toBe(true);
    expect(isArchived({ archived_at: null })).toBe(false);
    expect(isArchived(null)).toBe(false);
  });
});

describe("archiving is not deleting", () => {
  it("the server stamps the row and removes nothing", () => {
    /* A lodged report is a retained record, kept for seven years with the
       evidence behind it. `archive_report` must never reach `.delete()`. */
    const fn = read("supabase/functions/aml-reporting/index.ts");
    const i = fn.indexOf('op === "archive_report"');
    expect(i).toBeGreaterThan(0);
    const block = fn.slice(i, fn.indexOf('op === "restore_report"'));
    expect(block).toContain("archived_at: new Date().toISOString()");
    expect(block).not.toContain(".delete()");
  });

  it("the server enforces the same rule the register renders", () => {
    /* Two copies of "may this be archived" is how a button comes to exist
       in order to be refused. */
    const fn = read("supabase/functions/aml-reporting/index.ts");
    expect(fn).toContain("archiveBlockReason(existing.status)");
    expect(fn).toContain('from "../_shared/aml/austracArchive.pure.ts"');
    const page = read("src/pages/aml/AmlAustracReporting.tsx");
    expect(page).toContain("archiveBlockReason(r.status)");
  });

  it("delete still refuses everything past a draft", () => {
    /* Archiving exists BECAUSE delete refuses these. If that guard ever
       loosened, archiving would be the lesser of two ways to lose a
       record. */
    const fn = read("supabase/functions/aml-reporting/index.ts");
    expect(fn).toContain("Cannot delete an approved, submitted, acknowledged, rejected, or withdrawn report");
  });

  it("cannot be archived by saving the report", () => {
    /* `upsert_report` spreads the caller's object. Without stripping the
       stamp, a client could archive a report by SAVING it — straight past
       `archiveBlockReason`, which is the one guard that stops an
       approved-but-unlodged report being hidden while its deadline runs. */
    const fn = read("supabase/functions/aml-reporting/index.ts");
    const i = fn.indexOf('op === "upsert_report"');
    const block = fn.slice(i, fn.indexOf('op === "delete_report"'));
    expect(block).toContain("delete row.archived_at");
    expect(block).toContain("delete row.archived_by");
  });

  it("the working register hides archived rows and the archive shows them", () => {
    const fn = read("supabase/functions/aml-reporting/index.ts");
    expect(fn).toContain('if (archived === "live") q = q.is("archived_at", null);');
    expect(fn).toContain('else if (archived === "archived") q = q.not("archived_at", "is", null);');
  });

  it("the migration is additive and idempotent", () => {
    /* Two nullable columns, no default, no backfill: an existing row reads
       NULL, which is "not archived", which is what every row was before. */
    const sql = read("supabase/migrations/20261027000000_aml_reports_archive.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS archived_at timestamptz");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS archived_by uuid");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});
