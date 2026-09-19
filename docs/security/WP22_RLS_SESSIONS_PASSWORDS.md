# WP-22 — The residue, re-checked against the live database

Phase 6 of the 20-item app-security programme. Checklist items **3** (RLS),
**4** (server-side permissions), **10** (auth in local storage) and **19**
(password strength).

## Most of what was carried as open is closed

The July documents list four items as outstanding. Read live on 11 August 2026,
three of them are done — the docs outlived the fixes:

| Carried as open | Live state |
|---|---|
| RLS-W2 staged, awaiting a frontend republish | **Applied.** `generated_reports`, `global_report_settings`, `depreciation_comps`, `gamma_agreement_templates` are all `{authenticated}`-scoped with no anon. |
| `notifications` INSERT `WITH CHECK(true)` | **Narrowed.** Now `notifications_insert_attributed`, `{authenticated}`, `WITH CHECK (created_by = auth.uid())`. |
| `investment-reports` bucket public | **Private** (STOR-005) — see WP-21. |
| WP-11B cookie-only sessions "Phase 3 in progress" | **Phase 4 done in source.** `extractSessionToken` reads `__Host-session_token` and nothing else; every header, body and `authorization` carrier is gone. |

This is worth saying plainly because it is the second time in this programme
that a stale note has cost real time. A doc that says a thing is open, when it
is not, spends somebody's afternoon; and it makes the notes that *are* still
true harder to believe.

### On `notifications`

The remaining question is not attribution — that is now enforced — but
authorisation to notify. A staff user can still insert a notification *targeted*
at another user, which is what the deal-assignment and reminder features
legitimately do. Closing that means routing inserts through an edge function
that checks the actor may notify the target, exactly as
`RLS_WARNING_TIER_REMEDIATION.md` specified. Left alone here: a blanket RLS
tightening would break the assignment-notify feature, which is the reason it was
deferred in the first place, and it has not become a better idea since.

## What actually needed fixing

### 1. `email_copilot_emails` accepted an unauthenticated insert

July narrowed SELECT/UPDATE/DELETE to `authenticated` but left the original
INSERT policy from `20251209112552` granted to `public` — which includes `anon`,
the publishable key in the browser bundle.

Its `WITH CHECK` looks protective, and for a signed-in user it is:

```sql
(client_id IS NULL OR EXISTS (SELECT 1 FROM clients c
   WHERE c.id = client_id AND c.created_by::text = auth.uid()::text))
AND (created_by = auth.uid() OR created_by IS NULL)
```

For `anon`, `auth.uid()` is NULL. The first arm passes on `client_id IS NULL`;
the second passes on `created_by IS NULL`. So anyone on the internet could
insert unattached rows into the email table with nothing but the publishable
key. It reads nothing and links to no client — junk-row injection rather than a
data leak — but it is unauthenticated write access in the client-communications
path.

Re-scoped to `authenticated` with the predicate unchanged, so nothing a real
user could do before changes: for them `auth.uid()` was never NULL.

This is the same shape as the two CRITICALs found in July, and worth noticing
why it survived a pass that was specifically looking for it: the policy *had* a
real-looking `WITH CHECK`, so it did not read as an always-true grant. A
predicate that is sound for one role and vacuous for another is harder to see
than `USING (true)`.

### 2. Five tables the browser reads, and cannot

WP-17 found 37 tables with RLS enabled and **no policy at all** — deny-all for
every role but `service_role`, and for most of them that is the intended
posture. Five are not, because the browser reads them directly:

| Table | Read by |
|---|---|
| `agency_agreements` | `SendAgreementDialog` (PDF-ready poll), `useAgreementNotifications` |
| `client_additional_contacts` | `EventDetailsModal`, `QuickAddAppointmentModal`, `PersonalDetailsManualEntry`, +2 |
| `client_portal_report_requests` | `ReportRequests`, `ClientReportRequestsTab`, +2 |
| `client_portal_reports` | `ClientReportsTab`, `SendToClientModal`, +2 |
| `lead_source_attributions` | `LeadAttributionPanel`, `useAllDeals`, +2 |

Every one of those reads returns nothing today. `SendAgreementDialog` polls for
a `pdf_storage_path` it can never observe, so it always times out. That is a
**functional** defect, not an exposure — deny-all is the safe direction — which
is exactly why it survived: nothing fails loudly, the panel is just empty.

Policies follow the convention `generated_reports` established: `{authenticated}`
gated on `current_user_can_view/edit(<module_key>)`, so access is the same
permission the sidebar already gates the screen on, and superadmins pass through
the predicate's own second arm.

**The module keys need confirming.** Each is a real key from
`dashboard_modules`, chosen to match the screen the read serves —
`agreements`, `client_management`, `report_requests`, `marketing_analytics`. If
one is wrong the read stays denied, which is the behaviour today, so a bad guess
fails to "still broken" and never to "too open". Confirm each against how its
screen is gated before treating this as done.

WP-17 deliberately left these five tables' grants alone so the policies and the
grants would land together rather than a phase apart; this migration does both.

### 3. Password policy: 8 → 12

`_shared/passwordValidation.ts` required 8 characters and 2 of 4 character
classes. That is a 2010 policy, and this console holds client financial
positions, identity documents and AML files. Staff authenticate with a password
against a custom store rather than an IdP, so the password *is* the boundary,
not one factor behind one.

The class requirement stays at 2-of-4 deliberately. Character-class rules mostly
produce `Password1!`; length is the part that reliably helps, and the HIBP
breach check does the work those rules were pretending to do. That check stays
fail-open on an outage, which is correct — HIBP being unreachable must not block
account recovery.

The minimum is now exported as `MIN_PASSWORD_LENGTH` so the two admin dialogs
that pre-check in the browser cannot silently drift from the server rule. Those
copies exist so the user is told before the round-trip; the server one decides.

## Item 10 — sessions

Nothing to change. The posture was already good and is now complete in source:
`persistSession: false` on the Supabase client, the access token in tab-scoped
`sessionStorage` only, an `AUTH_VERSION` migration that actively scrubs legacy
`localStorage` mirrors from older builds, and two CI gates
(`check-portal-session-client-storage.mjs`,
`check-totp-enrollment-client-storage.mjs`).

`WP11BC_COOKIE_ONLY_ROLLOUT.md` describes Phase 3 with a legacy dual-read still
open. The code has moved past it: `extractSessionToken` reads
`__Host-session_token` and returns null otherwise, with the body parameter kept
only for signature compatibility. The tracker's `deployed: false` is about
deployment rather than source, and that is what the WP-15 harness exists to
settle.

## Owner actions — not code

Both still open on the live project today, and neither can be done from this
repository:

1. **Enable Auth leaked-password protection** (Supabase → Authentication →
   Policies). This is HaveIBeenPwned at the GoTrue layer. The app already does
   its own k-anonymity HIBP check on every password-setting handler, so this is
   defence in depth rather than the primary control — but the advisor will keep
   reporting it until it is on.
2. **Take the Postgres security upgrade.** The project is on 17.4.1.074 and the
   advisor has flagged available security patches since at least July.

## Verification

```
node scripts/security/check-migration-security.mjs     # 2 migrations, passes
node scripts/security/check-password-leak-coverage.mjs # 13 handlers, 3 exemptions
npm run security:test && npm run build                 # green
```

The migration was parsed against the real PostgreSQL grammar (`pglast`, 13
statements). It is **authored, not applied** — after you apply it, check that
`SendAgreementDialog`'s poll resolves instead of timing out, that a staff user
without the module permission still reads nothing, and that
`pg_policies` shows no `{public}` row for `email_copilot_emails`.
