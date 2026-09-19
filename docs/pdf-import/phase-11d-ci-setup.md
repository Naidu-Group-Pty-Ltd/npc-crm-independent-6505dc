# PDF Import Release Gate CI Setup

## Local Command

```
npm run pdf-import:release-gate
```

or:

```
node scripts/regression/pdf-import-release-gate.mjs
```

Variants:

```
npm run pdf-import:release-gate:static     # explicit static mode
npm run pdf-import:release-gate:no-build    # skip the build step
```

CLI flags: `--mode=static|live|full`, `--no-build`, `--no-tests`, `--json`,
`--strict-warnings`, `--output-dir=<path>`.

## Static Gate

Runs without secrets. This is the default. It checks required files, staged
private artifacts, unsafe source patterns, and (unless skipped) the Phase 11D
tests and the build.

## Live Gate

Requires environment variables and is opt-in:

```
SUPABASE_URL
SUPABASE_ANON_KEY            # for monitoring function reachability
SUPABASE_SERVICE_ROLE_KEY    # only if a CI read-only key is unavailable — prefer a read-only key
PDF_IMPORT_ENABLE_LIVE_CHECKS=true
PDF_PARSE_SERVICE_URL
```

Run:

```
PDF_IMPORT_ENABLE_LIVE_CHECKS=true node scripts/regression/pdf-import-release-gate-live-check.mjs
```

**Important: do not commit secrets.** The live script never prints secrets, uses
short timeouts, and degrades to warnings when endpoints/credentials are absent.
Missing env must never fail the static gate.

## GitHub Actions

The workflow `.github/workflows/pdf-import-release-gate.yml`:

- **Trigger:** pull requests touching PDF import paths, pushes to `main`, and
  manual dispatch.
- **Jobs:** a single `pdf-import-release-gate` job on `ubuntu-latest`.
- **Steps:** checkout (full history) → setup Node 20 → `npm install` →
  `npm run pdf-import:release-gate:static` → upload the report artifact.
- **Required secrets:** none (static mode).
- **Live checks:** disabled.
- **Artifact/report output:** `reports/pdf-import-release-gate/` (JSON + Markdown).

## Recommended Initial CI Mode

`static`. Live checks should be enabled later once secrets and read-only
permissions are confirmed.

## Failure Handling

When the gate fails:

- do not deploy
- inspect the release gate report (`reports/pdf-import-release-gate/`)
- fix the critical blockers
- rerun the gate
