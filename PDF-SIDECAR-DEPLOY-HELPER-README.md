# PDF Parse Sidecar — One-command Cloud Run deployment helper

This helper replaces most manual Google Cloud Console work for the
`pdf-parse-service` sidecar.

## What it automates

- Discovers and records the current Cloud Run service and serving revision.
- Saves a redacted configuration baseline without printing secret values.
- Records the exact production traffic split for rollback.
- Verifies the repository is clean and compiles `app.py`.
- Builds and pushes an immutable container image with Cloud Build.
- Deploys a tagged Cloud Run revision at **0% production traffic**.
- Checks that service account, runtime resources, environment variable names,
  secret bindings and key annotations did not drift.
- Tests `/healthz`, `/capabilities`, and optionally the Plan V2 `/plan` contract.
- Promotes to 5% or 100% with one command.
- Restores the original traffic split with one rollback command.

## Cloud Shell setup

1. Open Google Cloud Shell.
2. Clone or open the repository checkout.
3. Upload the two helper files, or copy them into the repository root.
4. Configure the deployment:

```bash
cp pdf_sidecar_deploy.env.example .pdf-sidecar.env
nano .pdf-sidecar.env
chmod 700 deploy_pdf_sidecar.sh
```

The minimum fields are `PROJECT_ID`, `REGION`, and `REPO_ROOT`.
Set `SMOKE_PDF_URL` to a small approved test PDF so the script can validate the
sidecar's `/plan` response.

## Recommended release flow

```bash
# Build, deploy a 0%-traffic tagged canary, and run smoke tests.
./deploy_pdf_sidecar.sh release

# Review the printed evidence directory and Cloud Run logs, then:
./deploy_pdf_sidecar.sh promote 5
./deploy_pdf_sidecar.sh status
./deploy_pdf_sidecar.sh promote 100
```

Rollback is always:

```bash
./deploy_pdf_sidecar.sh rollback
```

For an interactive menu:

```bash
./deploy_pdf_sidecar.sh
```

For a guided run with typed promotion confirmations:

```bash
./deploy_pdf_sidecar.sh guided
```

## Important behavior

`release` does **not** send traffic to the new revision. This is deliberate. It
creates and tests the canary, then leaves promotion as an explicit action.

The script updates only the service image when creating the revision. It does
not use destructive environment-variable replacement flags. It also compares a
redacted before/after configuration snapshot and stops if critical settings
unexpectedly change.

## Longer-term automation

Once this flow has been used successfully a few times, the same build and
release steps can be moved into Cloud Build and Cloud Deploy:

- A Cloud Build trigger builds an immutable image from an approved Git tag.
- Cloud Deploy manages staged Cloud Run traffic percentages and approvals.
- Verification tasks run the same health, capabilities and plan-contract tests.

The shell helper is the lower-risk starting point because it requires no new
pipeline IAM setup and produces a clear rollback state immediately.
