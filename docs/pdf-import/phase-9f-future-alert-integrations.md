# PDF Import Phase 9F — Future Alert Integrations (Deferred)

Phase 9F prepares alert **payloads** but intentionally does not deliver them. This
note records how future phases can wire delivery safely, reusing the existing
`PdfImportAlertPayload` and monitoring evaluator without changing the rules engine.

## Shared contract

All channels consume the same output:

```ts
const summary = evaluatePdfImportMonitoring({ metrics });
const payload = buildPdfImportAlertPayload(summary);
```

`payload` is channel-agnostic (title, severity, status, releaseBlocked,
primaryOwner, counts, top-10 alerts). A delivery adapter maps it to a channel;
the rules engine never changes.

## Candidate channels (all deferred)

- **Dashboard** — render `summary` in an admin panel (severity/status tones already
  exist in `pdfImportMonitoringDisplay`). No secrets. Lowest risk; likely Phase 9G.
- **Supabase scheduled check** — a `pg_cron` + Edge Function job that runs the
  Phase 9F metric queries, evaluates, and stores/forwards the payload. Requires a
  new scheduled job (explicitly out of scope for 9F).
- **Slack** — post `payload.summaryText` + top alerts to an incoming webhook.
  Requires a webhook secret (out of scope).
- **Email** — send the payload via the existing mail path. Requires config (out of
  scope).
- **GCP log-based alert** — emit a structured log line keyed by
  `payload.severity` / `payload.status`; create an alert policy on it. Requires GCP
  changes (out of scope).
- **Make.com webhook** — forward the payload JSON. Requires a webhook URL (out of
  scope).

## Guardrails for the delivery phase

- Keep the rules/evaluator pure and unit-tested; put I/O only in adapters.
- Never send private PDF contents — the payload is metadata only; keep it that way.
- Gate any secret behind environment config; never commit secrets.
- De-duplicate / throttle at the adapter, not in the evaluator.
- Map `releaseBlocked` / `critical` to the highest-priority channel; `warning` to a
  digest.
