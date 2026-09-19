#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const handler = readFileSync("supabase/functions/aml-monitoring/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260725101000_revoke_direct_edd_case_writes.sql",
  "utf8",
);

const upsert = handler.slice(
  handler.indexOf('if (op === "upsert_edd")'),
  handler.indexOf('if (op === "mlro_decision_edd")'),
);

assert.ok(upsert, "upsert_edd operation must exist");
assert.doesNotMatch(upsert, /\.\.\.e[,}]/, "upsert_edd must not spread caller-controlled EDD fields");
for (const protectedField of ["mlro_decision", "mlro_decision_by", "mlro_decision_at", "completed_at"]) {
  assert.doesNotMatch(upsert, new RegExp(`\\b${protectedField}\\s*:`), `${protectedField} must not be written by upsert_edd`);
}
assert.match(upsert, /Terminal EDD status requires an MLRO decision/, "generic updates must reject terminal statuses");
assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE aml\.edd_cases FROM authenticated;/, "authenticated direct EDD access must be revoked");

console.log("AML EDD MLRO authorization boundary checks passed");
