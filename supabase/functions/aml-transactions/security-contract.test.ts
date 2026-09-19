import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const functionSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../../migrations/20260725110000_preserve_aml_transaction_audit_history.sql", import.meta.url),
  "utf8",
);

describe("AML transaction audit-history protections", () => {
  it("restricts the legacy delete operation and archives with an event", () => {
    const deleteBranch = functionSource.match(
      /if \(op === "delete_transaction"\) \{([\s\S]*?)\n    \}/,
    )?.[1];

    expect(deleteBranch).toContain("requireMlro();");
    expect(deleteBranch).toContain('"archived"');
    expect(deleteBranch).toContain("archived_at:");
    expect(deleteBranch).not.toContain('.from("transactions").delete()');
  });

  it("does not let ordinary writes alter archival markers", () => {
    expect(functionSource).toContain("delete transactionInput.archived_at;");
    expect(functionSource).toContain("delete transactionInput.archived_by;");
    expect(functionSource).toContain('if (ex.archived_at) return jr({ error: "archived transactions cannot be changed" }, 409);');
  });

  it("denies direct deletes and prevents event cascades", () => {
    expect(migrationSource).toContain("REVOKE DELETE, UPDATE ON aml.transactions FROM authenticated");
    expect(migrationSource).toContain("REFERENCES aml.transactions(id) ON DELETE RESTRICT");
    expect(migrationSource).not.toContain('CREATE POLICY "aml_tx_write"');
  });

  it("does not grant authenticated clients direct access to archive markers", () => {
    const authenticatedUpdateGrant = migrationSource.match(
      /GRANT UPDATE \(([\s\S]*?)\) ON aml\.transactions TO authenticated;/,
    )?.[1];

    expect(authenticatedUpdateGrant).toBeDefined();
    expect(authenticatedUpdateGrant).not.toContain("archived_at");
    expect(authenticatedUpdateGrant).not.toContain("archived_by");
  });
});
