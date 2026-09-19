# GHL Migration Cascade Investigation Report
**Date:** 2026-04-25  
**Scope:** Legacy GHL → New GHL migration for **contacts** and **opportunities**  
**Investigated by:** Codex agent

---

## Executive summary
The cascade is failing primarily because the opportunities worker is resolving target contacts by **name matching** instead of by the source `contactId` mapping, while the contacts worker can store placeholder names like `Unknown Unknown` in `ghl_id_mapping.notes`. That combination causes valid opportunities to be skipped with "No target contact named ..." even when a source contact ID exists.

A secondary reliability issue is that duplicate names are intentionally collapsed to the latest match, which can misroute opportunities to the wrong person whenever multiple contacts share the same name.

---

## What I reviewed
- `supabase/functions/ghl-migrate-contacts-worker/index.ts`
- `supabase/functions/ghl-migrate-opportunities-worker/index.ts`
- `supabase/functions/_shared/migration-jobs.ts`
- `supabase/migrations/20260425093228_7090f8e5-aa96-40f1-8bfa-3009e676aa41.sql`

---

## Findings

### 1) Opportunities are cascaded by contact **name**, not source contact ID
In the opportunities worker, contact resolution is done through `resolveTargetContactByName(...)`, which queries `ghl_id_mapping` by normalized `notes` (name), not by `old_ghl_id = opp.contactId`.

**Impact:** If name normalization drifts between workers, opportunity migration skips valid records.

### 2) Contacts worker can persist placeholder names into mapping notes
The contacts worker builds `contactName` from sanitized first/last names first, including synthetic placeholders (`Unknown`) when name parts are missing. This can produce `Unknown Unknown` and store that in `ghl_id_mapping.notes`.

**Impact:** Opportunities that carry a real `contactName` (or only `contactId`) may not match `Unknown Unknown`, causing skipped opportunities.

### 3) Ambiguous duplicate-name policy can misroute opportunities
`resolveTargetContactByName` intentionally picks the latest mapped contact when duplicate normalized names exist.

**Impact:** Cascading is non-deterministic for common names (e.g., multiple "John Smith" contacts), potentially attaching opportunities to the wrong target contact.

### 4) Mapping table uniqueness is not direction-aware
`ghl_id_mapping` has a unique constraint on `(resource_type, old_ghl_id)` only.

**Impact:** Re-running migrations in different directions/accounts can overwrite prior mappings for the same old ID/resource type, degrading auditability and reuse.

---

## Probable root-cause chain for your issue
1. Contacts job upserts contacts and records mapping `notes` using a synthesized/sanitized name (sometimes `Unknown Unknown`).
2. Opportunities job later attempts to resolve each opportunity's contact via name lookup in `notes`.
3. Name mismatch (or duplicate-name ambiguity) causes `resolveTargetContactByName` to return no/incorrect target contact.
4. Opportunities are marked `skipped` with errors like `No target contact named ... — run contacts worker first`, even though contacts may already be migrated.

---

## Evidence checkpoints to validate in your environment
Run these checks against `migration_job_items` and `ghl_id_mapping`:

1. **Skipped opportunities due to missing name match**
```sql
select source_id, entity_label, error_message, processed_at
from migration_job_items
where status = 'skipped'
  and error_message ilike 'No target contact named%'
order by processed_at desc
limit 200;
```

2. **Mappings where contact note is placeholder-like**
```sql
select old_ghl_id, new_ghl_id, notes, created_at
from ghl_id_mapping
where resource_type = 'contact'
  and (notes ilike 'Unknown%' or notes is null or length(trim(notes)) = 0)
order by created_at desc
limit 200;
```

3. **Duplicate normalized names in contact mappings**
```sql
with m as (
  select
    lower(regexp_replace(coalesce(notes, ''), '[^a-z0-9]+', ' ', 'g')) as norm_name,
    count(*) as c
  from ghl_id_mapping
  where resource_type = 'contact'
  group by 1
)
select *
from m
where norm_name <> '' and c > 1
order by c desc, norm_name
limit 200;
```

4. **Opportunities that had `contactId` but still skipped by name**
(Use worker logs around skipped items to compare `opp.contactId` presence vs skip reason.)

---

## Recommended remediation plan

### Priority 0 (hotfix)
1. **Use ID-based mapping first in opportunities worker**:
   - Look up `ghl_id_mapping` where:
     - `resource_type = 'contact'`
     - `old_ghl_id = opp.contactId`
     - `source_account_label = sourceAccount`
     - `target_account_label = targetAccount`
   - If found, use this target `new_ghl_id` directly.
   - Fall back to name only when `opp.contactId` is absent or unmapped.

2. **Improve skip diagnostics**:
   - Include whether `opp.contactId` existed.
   - Include whether ID mapping existed.
   - This makes dashboard triage much faster.

### Priority 1 (correctness hardening)
1. **Contacts worker naming precedence**:
   - Prefer explicit `contact.contactName` when first/last are missing.
   - Avoid writing placeholder-only values as canonical mapping note keys.

2. **Store a stable normalized key column** (e.g., `normalized_contact_name`) instead of deriving from free-text `notes`.

3. **Direction-aware mapping key**:
   - Update uniqueness strategy to include account direction context (or add a dedicated unique index covering source/target labels).

### Priority 2 (operational safety)
1. Add a post-contacts validation step before opportunities start:
   - `% of opportunities with contactId that have valid contact mapping`.
2. Block opportunities migration when this ratio falls below threshold (e.g., 98%).

---

## Risk assessment
- **Current risk:** High for partial migration and cross-contact mis-assignment where names are duplicated/unclean.
- **Data integrity risk:** Medium–High (wrong contact attachment is harder to detect than simple skips).
- **Recovery complexity:** Moderate (can be repaired if migration_job_items + mappings are intact).

---

## Conclusion
The cascade issue is not a single API outage; it is primarily a **mapping strategy mismatch** between workers:
- contacts mapping key often reflects sanitized display names,
- opportunities resolver depends on that name key instead of deterministic source contact IDs.

Switching opportunities to **ID-first mapping** will remove most cascade failures immediately, while name-logic hardening will reduce residual edge cases.
