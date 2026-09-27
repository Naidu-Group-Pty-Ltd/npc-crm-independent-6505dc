# What `manage-templates` may do with tables no module covers

`manage-templates` is the Template Builder's broker. It runs on the
service-role client and serves about thirty tables to the Builder and a
handful of other pages: charts, checklists, game plans, comparisons, cover
overlays, the team list and the integration credentials among them.

Its permission check maps some of those tables to a module permission:

- checklists to Checklists;
- workflows to Integrations;
- report templates and their versions to Templates.

Every other table returned early from that check. For those tables, the only
thing asked of a caller was that they had signed in.

## What that allowed

Read from the handler during the release audit on 26 Sep 2026. No call was
made to confirm it.

- **Staff accounts.** `list` on `custom_users` returned whatever columns the
  caller named. Any staff login could therefore read every user's
  `password_hash`, `mfa_secret_encrypted` and `mfa_recovery_codes_hash`.
- **Staff roles.** `update` on `custom_users` wrote any column, so any staff
  login could set its own `role` to `superadmin`. That column is one of the
  two things the broker's own permission check reads to decide who is a
  superadmin.
- **Integration credentials.** `integration_configs` holds each credential's
  `key_value` in plain text. Any staff login could read it and overwrite it,
  although both screens that use it (Integrations and Workflow Playground)
  require the Integrations module.
- **Report settings and finance contacts.** `global_report_settings` and
  `finance_agent_contacts` (bank details included) could be rewritten by any
  staff login. Nothing in the product writes either table through the broker.

## The rule now

Each of these tables is narrowed to exactly what the product sends through the
broker. Everything else is refused. The rules are in
`supabase/functions/_shared/templateBrokerTablePolicy.pure.ts` and tested by
`src/lib/security/__tests__/templateBrokerTablePolicy.spec.ts`, which CI runs.

- **Staff accounts are read-only here, through the directory's own columns:**
  `id, username, email, first_name, last_name, is_active`.
  - The team list the product reads is `id, username, email, is_active`, and
    it passes unchanged.
  - A field list, a filter or an ordering that names any other column is
    refused outright, not trimmed. A request that asks for a password hash
    should get no answer at all.
- **The integration credentials belong to the Integrations module**, the same
  module both of their screens already require. Reading them takes `view`,
  saving them takes `edit`.
- **Report settings and finance contacts are written here only by a
  superadmin.** Reading them is unchanged. The product writes both tables
  through the ordinary client under their own policies, so this refusal takes
  nothing away from any screen.
- **The list of ungated tables is frozen in the spec.** A table added to the
  broker with no permission mapping fails CI until somebody decides, in
  review, that it should be ungated.

## What is deliberately not changed

The other ungated tables (charts, game plans, comparisons, cover overlays and
the rest) hold ordinary business records that any staff user reads and writes
through these screens today. They stay as they are. Whether any of them
should be scoped to an owner or a module is a product decision, and it is
recorded for the owner rather than made here.
