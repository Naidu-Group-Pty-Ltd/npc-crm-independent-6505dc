# PDF Import Phase 9E — GitHub Actions Notes

## Workflow

`.github/workflows/pdf-import-regression.yml` runs the Phase 9E **Class 1 automated**
release gates on pull requests that touch PDF-import paths (and via
`workflow_dispatch`). It executes the local release script:

```
bash scripts/regression/pdf-import-phase-9-release-check.sh
```

which checks required files, JSON validity, the focused Phase 8/9 test suite, the
build, and the private-artifact staging check.

## Design choices

- **`npm install`, not `npm ci`** — this matches the repo's existing `ci.yml`. The
  committed `package-lock.json` is out of sync with `package.json` on `main`, which
  makes `npm ci` abort. Swap to `npm ci` once the lockfile is regenerated.
- **No secrets** — the workflow needs no credentials. It never runs Supabase SQL,
  never deploys, and never drives a browser.
- **Path-scoped** — it only runs when PDF-import source, docs, regression scripts,
  the `template-import-pdf` function, migrations, or the lockfile change, so it does
  not add noise to unrelated PRs.
- **Class 2 (SQL) and Class 3 (browser) gates are NOT run in CI** — they are manual
  by design (they require the live database and a human). The script prints those
  checklists; they are tracked in `phase-9e-release-checklist.md`.

## Relationship to the existing `ci.yml`

`ci.yml` remains the repo-wide verification gate (golden-render isolation guard +
Template Builder surface tests + build). `pdf-import-regression.yml` is an
additional, PDF-import-scoped release gate. They overlap on `npm run build` but
serve different scopes; the PDF-import workflow additionally enforces the release
file/JSON/private-artifact gates.

## Future enforcement

Phase 9F monitoring can reuse the release gate definitions
(`getDefaultPdfImportReleaseGateDefinitions`) and the SQL release gate decision to
alert on regressions. Full release enforcement (blocking merges on the PDF-import
gate) can be enabled later by marking this workflow as a required status check.
