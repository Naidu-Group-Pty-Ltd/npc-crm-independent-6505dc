# Template Library — Deployment Runbook

> ## Deployment status — production (`dduzbchuswwbefdunfct`)
>
> | Step | Status |
> | --- | --- |
> | `20260801090000_create_template_library.sql` | ✅ applied |
> | `20260801093000_seed_template_library.sql` | ✅ applied — 12 published |
> | `20260802093000_seed_template_library_v2.sql` | ✅ **applied — 40 published, 10 production-ready** |
> | `manage-template-library` edge function | ✅ deployed v1, ACTIVE, verify_jwt on |
> | `manage-templates` redeploy (insert gate) | ❌ **NOT deployed — still v9** |
>
> The v2 seed is a **new file, not an edit of the applied one**. Supabase records
> a migration by its version prefix and never re-runs it, so re-generating into
> `20260801093000` would have changed the repository and nothing else — the 28
> added templates would never have reached the database, and the only symptom
> would have been a catalogue that stayed at 12.
>
> ### Verified in production after applying v2
>
> | Check | Result |
> | --- | --- |
> | Entries / published | 40 / 40 |
> | Production-ready | 10 (only report types with a Builder adapter) |
> | Brand-safe | 40 |
> | Categories represented | 8 — smallest is 3, so no filter chip is a dead end |
> | **Schema integrity** | **all 40 byte-exact** — `md5(schema::text)` compared against the locally computed canonical form for every row |
> | `report_templates` | unchanged at 80 rows, 1 active |
> | Library rows leaked into the Builder's table | 0 |
> | RLS by role | `anon` sees 0, `authenticated` sees 40, `authenticated` INSERT refused |
>
> The transfer itself was checksum-gated: the migration was fetched from the
> published branch and executed only after its SHA-256 matched the local file
> (`c8ee6e62…d086`, 380,407 bytes) inside the same statement. Nothing ran
> unverified, and the per-row md5 comparison afterwards proves every schema
> landed intact rather than merely that the file arrived.
>
> ### Migration ledger repaired
>
> All three Template Library migrations had been applied by direct SQL and were
> **absent from `supabase_migrations.schema_migrations`**. A later
> `supabase db push` would therefore have tried to re-run
> `20260801090000`, whose four `CREATE POLICY` statements have no
> `IF NOT EXISTS` and would have failed the push. All three versions are now
> recorded, which is accurate — they are applied — and removes that trap.
>
> **Outstanding: `manage-templates` still runs v9, without the insert gate.**
> The Management API refused the update — `POST …/functions/deploy?slug=` returns
> 409 `deployment already exists` for a function that already exists, and
> `PATCH …/functions/{slug}` with a multipart body returns a 500. The Supabase
> CLI could not be used from that environment because its HTTP client does not
> honour the outbound proxy. Hand-bundling the live Builder write path through
> an unsupported route was not worth the risk, so it was left alone.
>
> This is a safe state, not a broken one: v9 is the working pre-existing
> version, the Template Library does not call `manage-templates` at all, and the
> only thing outstanding is a security hardening of a hole that predates this
> work. Deploy it with `supabase functions deploy manage-templates` from a
> machine where the CLI has network access. The previously deployed v9 bundle is
> archived as a rollback artefact.

---

Merging the code is not the same as the feature working. Three things have to be
in place, in this order, or the Library tab renders its error state:

1. the migrations applied,
2. the `manage-template-library` edge function deployed,
3. the feature flag on (it defaults on — this is a check, not a step).

Nothing here touches the existing Reporting Engine Builder. If step 1 or 2 is
skipped, the Builder is unaffected: the Library tab shows "Could not load the
template library" with a retry, and every other tab behaves exactly as before.

---

## 1. Apply the migrations

```bash
supabase db push
```

| Migration | Effect |
| --- | --- |
| `20260801090000_create_template_library.sql` | Creates `template_library_entries`, `template_library_instantiations`, `template_library_events` with RLS, indexes and grants. **No `ALTER TABLE` on any existing table.** |
| `20260801093000_seed_template_library.sql` | Inserts the first 12 seeded templates and publishes them. Upserts on `(slug, version)`. |
| `20260802093000_seed_template_library_v2.sql` | Upserts the **whole 40-template catalogue** — the original 12 plus 28 more — and publishes them. A complete replacement, not a delta, so a fresh database and a long-running one end in the same state. |

The seed migrations are **idempotent**. Re-running one updates the seeded rows,
never duplicates them, and never touches an entry an operator promoted
themselves — those match neither the seeded slugs nor `version = 1` after their
first edit.

### Verify

```sql
-- Expect 40, all 'published'.
SELECT status, count(*) FROM public.template_library_entries GROUP BY status;

-- Expect 10 true / 30 false. `production_ready` is derived, not asserted:
-- only report types with a Template Builder adapter can be activated.
SELECT production_ready, count(*) FROM public.template_library_entries
WHERE status = 'published' GROUP BY production_ready;

-- Expect every category to have at least two entries, so no filter chip is
-- a dead end. 8 rows.
SELECT category, count(*) FROM public.template_library_entries
WHERE status = 'published' GROUP BY category ORDER BY category;

-- Expect zero rows. Library entries must never be in the Builder's table.
SELECT count(*) FROM public.report_templates
WHERE name IN (SELECT name FROM public.template_library_entries);
```

### Rollback

```sql
DROP TABLE IF EXISTS public.template_library_events;
DROP TABLE IF EXISTS public.template_library_instantiations;
DROP TABLE IF EXISTS public.template_library_entries;
```

Nothing in `report_templates` references them, so the drop is safe. Working
copies already created keep working — they are ordinary Builder templates and do
not read the library at all.

---

## 2. Deploy the edge function

```bash
supabase functions deploy manage-template-library
```

Already registered in both places CI checks:

- `supabase/config.toml` — `verify_jwt = true`, `request_timeout = 1500`
- `supabase/functions-registry/SECURITY_REGISTRY.json` — `human-authenticated`

`npm run security:registry` reports the same 26 pre-existing problems with and
without this feature; `manage-template-library` is not among them.

`manage-templates` is **also redeployed** in this release, because the insert
gate lives in it:

```bash
supabase functions deploy manage-templates
```

> Deploy `manage-templates` in the same window as the rest. It is the live
> Builder write path — the change is 32 added lines inside the `insert` branch
> and nothing else moved, but it should not sit half-deployed.

### Verify

```bash
# Expect 200 with 40 records for a user holding templates:view.
curl -sS -X POST "$SUPABASE_URL/functions/v1/manage-template-library" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"operation":"list"}' | head -c 400
```

---

## 3. Confirm the flag

Defaults **on**. No action needed unless it was previously switched off in a
browser.

| Lever | Effect |
| --- | --- |
| `?templateLibrary=0` | Off for one visit |
| `localStorage['template-library'] = '0'` | Off for that browser |
| `VITE_TEMPLATE_LIBRARY=0` at build | Off for the deployment |

Turning it off restores the eight-tab Template Management page exactly.

---

## 4. Post-deploy smoke test

Ten minutes, in this order. Stop and roll back if any Builder row fails.

**Builder — must be unchanged**

- [ ] Builder tab lists the same templates, same order, same count as before
- [ ] "New template" creates a template and opens it
- [ ] Edit a block, save; version snapshot still increments
- [ ] Delete an inactive template succeeds; an active one returns 409
- [ ] Branch a template from the Builder — **this exercises the new insert gate**
- [ ] Generate a live report and compare the PDF to one from before the deploy

**Library**

- [ ] Library tab appears; 40 templates render with schematic thumbnails
- [ ] Thumbnails are distinguishable — each in its own palette, none blank
- [ ] Search narrows; each filter axis works; "Clear filters" restores
- [ ] Every category chip returns at least one template
- [ ] Preview opens, pages navigate, focus returns to the trigger on close
- [ ] "Use template" is hidden for a `templates:view`-only user
- [ ] Create a working copy — it opens in the Builder with the right content
- [ ] The new copy is inactive, draft, and owned by you
- [ ] Edit the copy, then confirm the library entry is unchanged
- [ ] A second user cannot see your copy in their Builder list

**Admin (superadmin)**

- [ ] Admin panel is invisible to a non-superadmin
- [ ] Promote a Builder template → appears as a draft
- [ ] Publish it → appears in the grid for ordinary users
- [ ] Archive it → leaves the grid; restore brings it back

---

## 5. What the insert gate changes

The one behavioural change outside the new feature. `manage-templates` now
rejects a `report_templates` **insert** that:

| Attempt | Response |
| --- | --- |
| Creates a row already `is_active`/`is_default`, without superadmin | 403 |
| Same, as superadmin, but not approved / no report type / no production adapter | 422 |
| Creates an already-`approved` row, without superadmin | 403 |
| Names another user as `owner_user_id`, without superadmin | 403 |
| Creates an `agency`-scoped row, without superadmin | 403 |

**No caller in this codebase does any of those.** Both insert sites send
`is_active: false, is_default: false`, and `reportTemplateInsertGuard.spec.ts`
replays their exact payloads. An external integration creating active templates
directly would start receiving 403s — which is the point of the change, and
worth checking before deploy if any such integration exists.

---

## 6. Adding more templates

No code change and no deploy. In the Library tab as a superadmin:

1. Build the template in the existing Template Builder.
2. Admin panel → **Promote** it.
3. Fill in description, category, style, tier, tags, industry.
4. **Publish**. Validation runs first: the schema must parse at the supported
   version, use only production-renderer block types, and have a name and slug.

Editing a published entry creates the next version as a draft, so working copies
already taken keep pointing at the version they were made from. Publishing the
new version retires the old one; rolling back is republishing the previous
version, which is still on disk.

To change the **seeded** forty, edit `scripts/template-library/templates.ts`
(the core twelve) or `templatesExtended.ts` (the other twenty-eight) and run
`npm run templates:library:seed` — it re-validates everything and rewrites the
migration. Never hand-edit the generated SQL.

If the current generated migration has **already been applied to production**,
bump `MIGRATION` in `buildSeedCatalogue.ts` to a new timestamped filename first.
The script writes one file and Supabase runs each version once; regenerating
into an applied file changes nothing in the database.
