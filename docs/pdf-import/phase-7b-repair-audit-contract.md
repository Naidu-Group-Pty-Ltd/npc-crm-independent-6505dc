# Phase 7B.1 — Repair Audit Edge Function Contract Patch

## Problem summary

The Template Builder Run Repair flow failed to persist. Running Visual QA or
Run Repair produced an `unknown operation` error and **nothing was ever saved**:
`template_imports.meta.visual_quality_artifact_path`,
`visual_repair_artifact_path`, and `visual_quality_summary` were `null` on every
import.

Root cause was **not** a missing edge-function handler. The
`save_visual_repair_audit` / `get_visual_repair_audit` handlers already existed.
The real defect was a **request-envelope mismatch**:

- The frontend persistence helpers call
  `invokeSecureFunction('template-import-pdf', { body: { operation, ... } })`.
- `invokeSecureFunction(fn, payload)` forwards its 2nd argument **verbatim** as
  the JSON request body.
- So the function received `{ body: { operation, ... }, session_token }` and read
  `body.operation` → `undefined` → `unknown operation`.

Callers that pass the payload directly (e.g. `get_artifacts` in
`importArtifacts.ts`, which unwraps to `invokeSecureFunction(fn, args.body)`)
were unaffected — which is why imports worked but Visual QA/Repair persistence
never did.

This affected **all** wrapped operations: `save_visual_quality`,
`get_visual_quality`, `list_visual_quality`, `save_visual_repair_audit`,
`get_visual_repair_audit`.

## Fix

An **edge-function contract patch**: `template-import-pdf` now normalises the
request envelope. If the parsed body has no top-level `operation` but has a
nested `body` object, the inner payload is unwrapped while the top-level auth
fields (`session_token`, `user_id`) are preserved:

```ts
if (body && typeof body === 'object' && !body.operation && body.body && typeof body.body === 'object') {
  const { body: wrapped, ...envelope } = body;
  body = { ...wrapped, ...envelope };
}
```

Direct callers (top-level `operation`) are unchanged. No frontend change is
required, so this fixes the live app on deploy without a frontend release. The
`get_visual_repair_audit` handler also gained a deterministic fallback path
(`{importId}/repair/repair-loop.json`) when the meta pointer is absent.

## Frontend operations

`src/lib/reportTemplate/ingestion/visualQuality/repair/repairAuditPersistence.ts`

- `saveVisualRepairAudit(importId, payload)` → op `save_visual_repair_audit`;
  expects `{ audit_path }`, returns `{ kind: 'ok', auditPath }`.
- `loadVisualRepairAudit(importId)` → op `get_visual_repair_audit`; expects
  `PersistedVisualRepairAudit | null`, returns `kind: 'ok' | 'missing' | 'error'`.

## Supabase operations (`supabase/functions/template-import-pdf/index.ts`)

- `save_visual_repair_audit` — validates `import_id` + `payload`; ownership check
  (403 unless owner or `service_role`); uploads audit JSON; updates meta; returns
  `{ ok, audit_path, artifactPaths }`.
- `get_visual_repair_audit` — validates `import_id`; ownership check; reads the
  audit JSON; returns `{ importId, payload, artifactPaths }` or `null`.

## Storage path

Bucket `template-import-artifacts`, object `${importId}/repair/repair-loop.json`
(`contentType: application/json`, `upsert: true`).

## Metadata fields (`template_imports.meta`)

- `visual_repair_artifact_path` — the audit object path.
- `visual_repair_summary` — `{ version, importId, templateId, visualQaScore,
  finalScore, scoreDelta, visualQaPersisted, repairStatus, canRunRepairLoop,
  eligiblePageCount, totalApplied, passesAttempted, patchesAccepted,
  patchesRejected, requiresFallback, requiresManualReview, problemCount,
  generatedAt, persistedAt }`.

## Manual test flow

1. Template Builder → Import PDF → Hybrid → upload a 1-page PDF.
2. Wait for import complete → **Review quality**.
3. **Run Visual QA** → confirm "Visual QA saved".
4. **Run repair** → confirm **no** "unknown operation" error, toast "Repair audit
   saved", and the Repair audit card appears.
5. **Apply repair** becomes available → click it → Template Builder editor opens.

## SQL validation

Run `scripts/regression/pdf-import-phase-7b-repair-audit-contract-check.sql`.
Expected after a real run: the latest import has `visual_repair_artifact_path`
and `visual_repair_summary`; `audit_object_count = 1`; `repair_status ∈
{completed, skipped, failed}`; `repair_final_score` populated.

## Deployment

The repo carries duplicate Supabase config, so deploy with a temporary minimal
config and restore the original:

```bash
cd ~/npc-property-dashbord
cp supabase/config.toml supabase/config.toml.before-phase7b-repair-audit.bak
cat > supabase/config.toml <<'EOF'
project_id = "dduzbchuswwbefdunfct"

[functions.template-import-pdf]
verify_jwt = false
EOF
npx supabase@latest functions deploy template-import-pdf --project-ref dduzbchuswwbefdunfct
mv supabase/config.toml.before-phase7b-repair-audit.bak supabase/config.toml
git diff -- supabase/config.toml   # expect: no diff
```

(In this environment the function was deployed via the Supabase MCP
`deploy_edge_function` tool, which does not require the config swap. `verify_jwt`
stays `false` — the function verifies the custom session internally.)

## Pass/fail criteria

- **Pass:** Run Repair completes with no "unknown operation"; the audit object
  exists in storage; `visual_repair_artifact_path` + `visual_repair_summary` are
  populated; Apply repair opens the editor.
- **Fail:** any "unknown operation" error, or missing artifact / meta after a run.
