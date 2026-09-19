# PDF Import Release Gate — GitHub Actions Setup (template)

A template for enabling the Phase 11D release gate in CI. The workflow at
`.github/workflows/pdf-import-release-gate.yml` runs the **static** gate only —
no secrets, no Supabase, no Cloud Run, no deployment.

## What the workflow does

1. Checks out the repo with full history (so the gate can diff changed files).
2. Sets up Node 20.
3. `npm install --no-audit --no-fund` (the repo does not use `npm ci`; see
   `ci.yml`).
4. `npm run pdf-import:release-gate:static`.
5. Uploads `reports/pdf-import-release-gate/` as an artifact.

## Enabling

The workflow is committed and enabled by default on pull requests touching PDF
import paths and on pushes to `main`. No secrets are required.

## Enabling optional live checks (later)

Live checks are **off** by default. To enable them in a dedicated, opt-in job:

1. Add repository secrets (never commit them):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `PDF_PARSE_SERVICE_URL`
2. Add a separate job/step that sets `PDF_IMPORT_ENABLE_LIVE_CHECKS=true` and
   runs `node scripts/regression/pdf-import-release-gate-live-check.mjs`.
3. Keep live checks non-blocking initially (they degrade to warnings when
   endpoints are unavailable).

## Guardrails

- Do not add secrets to the static workflow.
- Do not upload private artifacts — the reports directory contains only the
  gate's own JSON/Markdown output.
- Do not run imports, deployments, or mutations in CI.
