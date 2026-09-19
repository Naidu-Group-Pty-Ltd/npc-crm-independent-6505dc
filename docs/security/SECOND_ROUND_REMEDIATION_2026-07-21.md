# Second-round backend security remediation (21 July 2026)

Addresses the deeper-scan audit (score 44/100, "Blocked") that identified attack
surfaces beyond the original F-01…F-08 findings. Work is grouped by the audit's
own required remediation order. All edge-function changes fail closed and reuse
the shared trust libraries (`_shared/auth.ts`, `auth_v2.ts`, `authz.ts`,
`permissions.ts`, `notify.ts`).

## Emergency containment (Criticals)

| # | Finding | Fix |
|---|---------|-----|
| C1 | `auto-report-webhook` unauthenticated → paid report generation | Require verifyInternal (service key/HMAC) **or** a dedicated `x-webhook-secret` (constant-time); refuses to run when the secret is unconfigured. |
| C2 | `email-sync-cron` unauthenticated → Graph + service role | Require `verifyInternal` (service-role key / HMAC); anon + `body.source` bypass removed. |
| C3 | `airtable-proxy` unauthenticated credential proxy | Require verified staff (`verifyAuth`) before using the Airtable credential / `list_tables`. |
| C4 | `voice-to-text` unauthenticated paid Whisper proxy | Require verified staff; add a 34 MB base64 ceiling before decode/forward. |
| C5 | `ai-dashboard-agent` `execute-tool` trusts `body.source` → run as any user | Service identity derived only from the verified auth method; `body.source` trust deleted. |
| C6 | `agent-task-runner` trusts `body.source` / falls through on anon key | Gate on `verifyInternal`; body-field trust removed. |
| C7 | `outlook-calendar` `targetEmail` bypasses mailbox ownership | Enforce `assertMailboxOwnership` at the single mailbox-resolution point (covers list/create/update/delete/freeBusy). |
| C8 | `manage-generated-documents` any-auth full CRUD + DocuSign send | Deny-by-default module gate (`agreements`); send/void/delete need edit/delete. |

Also fixed the same `body.source` bypass in `enrich-lead-attributions` (paid Meta Ads).

## Deny-by-default authorization layer

New `_shared/authz.ts` (`requireModulePermission`, `requireSuperadmin`,
`permForAction`, `actorIsSuperadmin`) over the existing
`dashboard_modules`/`user_permissions` model — but denying on unknown module /
missing permission. Applied to: generated-documents (`agreements`),
compliance-records / commission-ledger / commission-payout / analytics-query
(`finance_portal_admin`), outlook-manage-subscription (superadmin-only).

## Storage read authorization (EC-5)

- `secure-storage`: reads (download/list/signedUrl/publicUrl) now require
  `can_view` on the bucket's governing module (`checkModuleView`); previously
  gated only for writes.
- Email attachments: the three Outlook sync paths now store the object **path**
  + a short-lived **signed URL** instead of a permanent public URL;
  `EmailAttachmentsList` resolves signed URLs on demand (legacy `storageUrl`
  fallback). *Flipping the live public buckets private remains a coordinated
  migration — portal report viewing still depends on `investment-reports`
  public URLs.*

## Webhooks fail closed (EC-6)

- `verifyWebhookSecret()` (strong-secret-required, constant-time).
- `ghl-webhook-receiver` + `vapi-call-webhook`: were "verify only if configured"
  → now reject when the secret is absent.
- `outlook-email-webhook`: validate the Graph `clientState` on every
  notification (prefer `OUTLOOK_WEBHOOK_CLIENT_STATE`, legacy fallback);
  `outlook-manage-subscription` sets it from the same secret.

## High-priority hardening

- **AI conversation IDOR**: `userCanAccessConversation` (owner or active share)
  gates `get-messages`, `chat`, `chat-stream`, and `confirm-action`.
- **Notification targeting**: `_shared/notify.ts insertTargetedNotification`
  targets a specific user or a module's viewers (+ superadmins) — never a
  null-target broadcast. Applied to email-sync-cron / outlook-email-sync /
  send-email-reply.
- **Reset pepper**: `RESET_TOKEN_PEPPER` now required (≥16 chars) to hash;
  fail-closed on issue, tolerant on verify.
- **Email send caps**: outbound attachments limited to ≤20 files / ≤25 MB.

## CI / registry

- Duplicate `[functions.<name>]` detection (removed 8 redundant declarations).
- New static rules: R4 (body-field service trust), R5 (`getPublicUrl` on
  email-attachments).
- Deno type-check of the shared trust modules.
- 20 hardened functions reclassified from `needs-review` to reviewed.

## Required owner actions (secrets)

Set these project secrets so the fail-closed paths accept legitimate traffic:

- `RESET_TOKEN_PEPPER` — ≥32 random chars (password reset hashing).
- `AUTO_REPORT_WEBHOOK_SECRET` — ≥16 chars, configured on the external caller.
- `GHL_WEBHOOK_SECRET`, `VAPI_WEBHOOK_SECRET` — required for those webhooks.
- `OUTLOOK_WEBHOOK_CLIENT_STATE` — high-entropy; recreate the Graph subscription
  afterward so notifications carry it.
- Confirm `INTERNAL_EDGE_SECRET` is set (HMAC internal calls) and that pg_cron
  invokes `email-sync-cron` / `agent-task-runner` with the service-role key.

## Not done here (coordinated / product decisions)

- Flipping the 4 public buckets private (portal report-viewing migration).
- Recipient-domain/DLP rules and send-rate quotas on email.
- Full `auth_v2` HMAC rollout replacing service-role Bearer on all internal calls.
- Cookie-only sessions (tokens still returned to JS).
