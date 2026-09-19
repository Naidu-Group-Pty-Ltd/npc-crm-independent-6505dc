# ADR 021: Portal terms acceptances use a discriminated owner, not a generic user id

## Status

Accepted and implemented in Builder Portal Phase 1
(`supabase/migrations/20260801000300_portal_terms_multi_portal.sql`).
Baseline `43b67c8ed4879435d2f8b0dd4e6635fc2be98058`. Discharges the open
decision ADR 020 required before GEN-02 could be written.

## Context

`portal_terms_acceptances` was created by Solicitor Phase 3 as a single-portal
table:

```sql
portal            text NOT NULL CHECK (portal = 'solicitor')
solicitor_user_id uuid NOT NULL REFERENCES solicitor_portal_users(id) ON DELETE CASCADE
UNIQUE (terms_version_id, solicitor_user_id)
```

The Builder Portal needs the same terms-acceptance governance: a current
version per portal, one acceptance per user per version, and an auditable record
of who accepted what and when. Phase 0 recorded this as GEN-02 and as migration
risk MIG-01 — the highest-risk widening in the programme, because serving a
second portal requires dropping `solicitor_user_id NOT NULL`, and that is
effectively one-way: restoring the constraint later would require every row to
have a non-null value, which stops being true the moment a Builder row exists.

ADR 020 explicitly declined to pre-decide this and required a dedicated ADR
first. Production inspection through the Supabase MCP connection
(project `dduzbchuswwbefdunfct`) established the actual scale: **1 terms version
and 1 acceptance row**. The risk is therefore structural rather than volumetric —
this is about which shape the platform commits to, not about migrating data.

Three shapes were available.

**(a) Discriminated owner.** Keep one table. Add a nullable `builder_user_id`
with a real foreign key, keep `solicitor_user_id` as a real foreign key but
nullable, and constrain the pair.

**(b) Separate `builder_terms_acceptances` table.** Avoids the `NOT NULL` drop
entirely.

**(c) Generic `user_id uuid` plus the existing `portal` discriminator.** One
column serving both portals, with no foreign key because it must point at two
different tables.

## Decision

**Option (a): a discriminated owner in one table.**

```sql
solicitor_user_id uuid REFERENCES solicitor_portal_users(id) ON DELETE CASCADE  -- now nullable
builder_user_id   uuid REFERENCES builder_portal_users(id)   ON DELETE CASCADE  -- new, nullable

CONSTRAINT portal_terms_acceptances_single_owner
  CHECK (num_nonnulls(solicitor_user_id, builder_user_id) = 1)

CONSTRAINT portal_terms_acceptances_portal_owner_agree CHECK (
  (portal = 'solicitor' AND solicitor_user_id IS NOT NULL AND builder_user_id IS NULL)
  OR
  (portal = 'builder'   AND builder_user_id  IS NOT NULL AND solicitor_user_id IS NULL))

CREATE UNIQUE INDEX portal_terms_acceptances_solicitor_key
  ON portal_terms_acceptances(terms_version_id, solicitor_user_id)
  WHERE solicitor_user_id IS NOT NULL;
CREATE UNIQUE INDEX portal_terms_acceptances_builder_key
  ON portal_terms_acceptances(terms_version_id, builder_user_id)
  WHERE builder_user_id IS NOT NULL;
```

plus a trigger, because a `CHECK` cannot reach another table:

```sql
-- The acceptance's portal must equal the referenced version's portal.
guard_portal_terms_acceptance() -> raises PORTAL_TERMS_PORTAL_MISMATCH
```

### Why each constraint exists

| Requirement | Mechanism |
| --- | --- |
| Ownership is database-enforced | Two real foreign keys, not a generic column |
| Exactly one owner | `num_nonnulls(...) = 1`, added `NOT VALID` then `VALIDATE`d |
| One user cannot accept for another portal's user | `portal_owner_agree` ties the discriminator to the populated column |
| One user cannot accept another portal's terms | `guard_portal_terms_acceptance` trigger compares against `portal_terms_versions.portal` |
| Uniqueness per portal user and version | Two partial unique indexes |
| Existing Solicitor rows preserved | Nothing is deleted, rewritten or re-keyed; only the constraint shape changes |
| One current version per portal | The existing `portal_terms_one_current_idx` on `(portal) WHERE retired_at IS NULL` already generalises and is deliberately untouched |

### Migration ordering, which is part of the decision

The sequence is not incidental and must not be rearranged:

1. Pre-migration assertions — every acceptance already has a solicitor owner and
   matches its version's portal; a count snapshot is captured.
2. Widen the `portal` CHECK on both tables.
3. Add `builder_user_id`.
4. Add `single_owner` as `NOT VALID`, then `VALIDATE`.
5. Add `portal_owner_agree` the same way.
6. Create both partial unique indexes.
7. **Only then** drop the old composite unique and the `NOT NULL`.
8. Post-migration assertions — row counts unchanged, no solicitor acceptance lost
   its owner, both replacement indexes exist.

Dropping the `NOT NULL` before step 6 would open a window in which a duplicate or
ownerless acceptance is storable. Steps 1 and 8 make the migration fail loudly
rather than corrupt quietly.

## Alternatives rejected

**(b) A separate `builder_terms_acceptances` table.** Rejected. It avoids the
one-way change, which is a real benefit, but it splits one compliance concern
across two tables: two audit surfaces, two queries for "has this person accepted
the current terms", and two places to change when terms governance evolves.
ADR 020 permits a Builder-specific table only where the shared architecture
genuinely cannot support the Builder domain. It can support it here — the cost is
a careful migration, not a missing capability. Accepting a Builder-specific table
for a concern the shared table models correctly would be the first crack in the
generalise-don't-duplicate principle, and terms acceptance is the least
justifiable place to open it.

**(c) A generic `user_id uuid` column.** Rejected, and it is the option the Phase 1
brief explicitly warned against. A single column cannot carry a foreign key to two
different tables, so nothing would stop an acceptance naming a user that does not
exist, or a solicitor's id being stored under `portal = 'builder'`. Integrity
would depend entirely on application code being correct every time — precisely
the class of assumption the Solicitor Portal's own defects came from. The
discriminated shape costs one extra nullable column and buys real referential
integrity in both directions.

## Consequences

- `solicitor_user_id NOT NULL` is gone and will not come back. This is accepted
  deliberately, with the mitigations above, and is recorded here so a future
  reader does not mistake it for an oversight.
- Every future portal that needs terms acceptance adds a nullable owner column
  and extends both CHECKs. At four or five portals this shape becomes awkward,
  and a `portal_identities` supertype would be the natural successor. That is a
  future decision; at two portals the discriminated shape is the simpler correct
  answer.
- Application code must set `portal` and exactly one owner column. Getting it
  wrong is a constraint violation, not silent corruption.
- `ON DELETE CASCADE` on both owners means deleting a portal user removes their
  acceptance history. That matches the existing Solicitor behaviour and is
  preserved rather than changed here; if acceptance history must outlive the
  user, that is a separate decision affecting both portals equally.

## Verification

`scripts/builder-portal/local-db/verify-phase-1.mjs` executes the following
against a live PostgreSQL database after applying the migration:

- the existing solicitor version and acceptance are preserved with their owner
- a builder user can accept builder terms
- an acceptance cannot have two owners
- an acceptance cannot be ownerless
- a builder user cannot accept solicitor terms
- a solicitor owner cannot be recorded under the builder portal
- duplicate acceptance is rejected for both portals independently
- `solicitor_user_id` is nullable while the pair remains constrained
- both constraints are present and `convalidated`
