# PDF Import Client-Safe Report Policy

## Policy Summary

Client-safe reports must only include approved, sanitized information. Every
report passes through the redaction sanitizer before it can be saved, approved,
or exported.

## Allowed Content

| Content | external_client | internal_business | internal_operator |
|---|---|---|---|
| Import status label | yes | yes | yes |
| Template readiness label | yes | yes | yes |
| Visual QA summary label | yes | yes | yes |
| Export validation status | yes | yes | yes |
| Manual review required | yes | yes | yes |
| Operator decision | yes | yes | yes |
| Approved operator note | yes | yes | yes |
| Internal IDs (UUIDs) | no | limited | yes |
| Error codes | no | limited | yes |
| Cost/performance risk | no | yes | yes |
| Monitoring alert titles | no | limited | yes |
| Storage paths | no | no | no |
| Signed URLs | no | no | no |
| Screenshots/diff images | no | no | no |
| Raw metadata | no | no | no |
| Logs/stack traces | no | no | no |

## Disallowed Content

Raw PDF text, OCR text, raw extracted tables, screenshots/diff images, storage
object paths, signed URLs, Cloud Run/Supabase logs, function stack traces, SQL
output, full JSON metadata, monitoring evidence internals, retention storage
object paths, private artifact paths, service-role/system details, and secrets.

## Redaction Rules

- Remove URLs and signed/tokenized URLs.
- Remove storage/bucket/object paths (`template-import-artifacts`, `pdf-import-diagnostics`, `storage.objects`).
- Remove `service_role` / `SUPABASE_SERVICE_ROLE_KEY` references.
- Remove stack traces and SQL snippets.
- Remove raw JSON-like payload dumps and environment variable assignments.
- Remove UUIDs for `external_client` (internal IDs).
- Replace technical failure details with plain-language summaries.

If any unsafe content survives sanitization, the report is forced to `blocked`
and cannot be approved or exported.

## Report Approval

- `external_client` reports require approval.
- `safe_with_warnings` reports require an approval note.
- `internal_only` reports cannot be approved for external export.
- `blocked` reports cannot be approved.
- Only `approved` reports can be marked exported (json/markdown/html; **not** pdf).

## Example Safe Wording

- Accepted: "The template import passed quality review and is ready for use."
- Accepted with warnings: "The template import has been accepted with minor layout warnings that do not block use."
- Manual review required: "The template requires manual review before it can be approved."
- Rejected: "The import did not meet quality requirements and requires rework."
- Export validation pending: "Export validation is pending before final approval."

## Example Unsafe Wording (never include)

Generic examples of what must NOT appear (do not include real data):

- "Storage path: template-import-artifacts/..."
- "Signed URL: https://...token=..."
- "Stack trace: Error at function..."
- "Raw OCR text: ..."
