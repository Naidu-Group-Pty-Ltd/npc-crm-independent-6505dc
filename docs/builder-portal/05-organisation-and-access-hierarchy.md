# Proposed organisation and access hierarchy

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Status:** proposed. Nothing here is implemented in Phase 0.

## Target hierarchy

```text
Builder or Developer Organisation
        ↓
Development
        ↓
Project
        ↓
Stage or Building
        ↓
Lot or Unit
        ↓
Builder Transaction
        ↓
Transaction Case
```

Each level is a distinct aggregate with its own row and its own parent
foreign key. Every child mutation is scoped to a server-verified parent; the
chain is walked on the server, never asserted by the client.

## Separate Builder and Developer companies

The Solicitor Portal models a single `firm_id` on the user, because a solicitor
belongs to exactly one practice and a matter belongs to exactly one practice.
**That shape is wrong for Builder** and must not be copied.

In Australian residential development, the developer that owns and releases the
land is frequently a different legal entity from the builder that constructs the
dwelling, and both legitimately need portal access to the same project — with
different visibility. A single `organisation_id` column on a project cannot
express this.

### Proposal: one organisation table, an explicit party join

```text
builder_organisations
  id, legal_name, trading_name, abn, acn,
  org_type CHECK ('builder','developer','builder_developer'),
  contact fields, is_active, row_version, timestamps

builder_project_parties
  id,
  project_id       -> builder_projects
  organisation_id  -> builder_organisations
  party_role       CHECK ('developer','builder','sales_agent','project_manager')
  is_primary       boolean
  valid_from, valid_until, revoked_at
  UNIQUE (project_id, organisation_id, party_role)
  partial unique: one active is_primary row per (project_id, party_role)
```

`org_type = 'builder_developer'` covers the common case where one entity is both;
it is a property of the organisation, while `party_role` is a property of the
organisation's involvement in a specific project. An entity can be the developer
on one project and the builder on another.

### Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Separate `builder_organisations` and `developer_organisations` tables | Duplicates identity, invitations, users, sessions and audit for a single real-world concept; an entity that is both needs two rows and two logins |
| A single `organisation_id` on `builder_projects` | Cannot express a project with a distinct developer and builder — the primary requirement |
| Reusing `solicitor_firms` with a type column | Couples the legal domain to the builder domain; `practising_states` and the legal role enum are meaningless for builders; blast radius on every existing solicitor FK |

## Access grant model

Access is **explicit and level-scoped**, following the Solicitor Portal's
`solicitor_matter_access` correction of its own earlier client-scoped model —
Builder starts where Solicitor ended up, and never ships the intermediate model.

```text
builder_user_access
  id,
  builder_user_id   -> builder_portal_users
  organisation_id   -> builder_organisations     always set, always verified
  scope_type        CHECK ('organisation','development','project','stage','unit','transaction')
  scope_id          uuid                          the row at that level
  access_role       text                          see 06-roles-and-permissions.md
  permissions       jsonb                         tri-state: inherit | allow | deny
  valid_from        timestamptz NOT NULL
  valid_until       timestamptz
  revoked_at        timestamptz
  granted_by        uuid
  UNIQUE (builder_user_id, scope_type, scope_id) WHERE revoked_at IS NULL
```

### Resolution rules

1. **Deny by default.** No grant means no access. There is no default-allow key
   set — this is the direct correction of Solicitor finding NOCOPY-01.
2. **Organisation containment is mandatory.** The grant's `organisation_id` must
   match the user's organisation, and the scope row must resolve up the hierarchy
   to that same organisation. A grant that fails containment is inert.
3. **Grants are inherited downward.** A `project` grant reaches that project's
   stages, units and transactions. It never reaches a sibling project.
4. **The most specific grant wins per permission key.** A unit-level `deny`
   overrides a project-level `allow` for the same key.
5. **Tri-state at every level.** `allow` beats `deny` only when it is more
   specific; at equal specificity `deny` wins. `inherit` falls through.
6. **Grants expire and are revocable.** `valid_from` / `valid_until` /
   `revoked_at` are checked on every resolution, as `resolveSolicitorMatterAccess()`
   does today.
7. **`read_only` clamps.** An `access_role` of `read_only` forces `edit` and
   `delete` false after resolution, matching the Solicitor implementation.

### What is never an access boundary

- `client_id` — an attribute, never an authorization boundary (existing platform
  principle, stated in the Solicitor target-state document)
- Property address or address similarity — never a matching or access predicate
- Any ID supplied in the request body
- Sales responsibility or "assigned consultant" — responsibility is not a grant,
  the same distinction the Solicitor Portal draws between
  `assigned_solicitor_user_id` and an access row

## Cross-organisation visibility on a shared project

When a developer and a builder are both parties to a project, each sees only
what its `party_role` and its own grants permit:

| Data | Developer party | Builder party |
| --- | --- | --- |
| Unit inventory and availability | full | full |
| Release status and released pricing | full | read |
| Unreleased pricing and feasibility | full | none |
| Construction milestones and site progress | read | full |
| Construction cost and supplier pricing | none | full |
| Defects and rectification | read | full |
| Reservations and allocations | full | read |
| Contract issue and execution status | full | read |
| Progress claims | read | full |

This table is the starting contract for the party-role permission defaults. It is
proposed, not final, and is settled in the phase that implements
`builder_project_parties`.

## Relationship to the transaction case

`builder_transactions` is the Builder domain aggregate. It links to
`transaction_cases` through `transaction_case_links.builder_transaction_id`
(GEN-09), under the same invariants as every other domain link: same
`client_id`, at most one case per domain record, atomic and audited link
changes, and never an address-similarity match. See
`08-transaction-case-relationships.md`.
