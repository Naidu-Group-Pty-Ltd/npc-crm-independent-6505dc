# Builders Network — Phase 4 data-move runbook

Companion to [`45-network-extraction-plan.md`](./45-network-extraction-plan.md) §7 Phase 4.
The plan names the move; this file carries the measured state, the re-key scheme the owner
chose (plan §10, decided 2026-09-14), and the order with its verification gates. Re-measure
the table below **again on the day of the move** — the corpus is live.

## Measured 2026-09-14 (prime `dduzbchuswwbefdunfct`, via SQL, not estimates)

| What | Count | Notes |
|---|---|---|
| Organisations | 2 | both travel |
| Portal users | 3 | re-invited, never password-hash-copied (plan §7) |
| Live memberships | 3 | |
| Stock items | 1,014 | unchanged since the plan was written |
| Stock image ROWS | 3,069 | rows ≠ objects: post-dedupe rows share objects |
| `builder-stock-images` objects | 1,098 · 725 MB | 0 rows point at a missing object (measured) |
| `builder-stock-lists` objects | 5 · 24 MB | vs 2 LIVE upload rows — 3 objects are debris of the 104 soft-deleted uploads |
| `builder-documents` objects | 0 | nothing to move |
| Upload rows | 106 (104 soft-deleted) | reconcile BEFORE copying — don't import the mess |
| Transactions / documents / selections | 0 / 0 / 1 | the E2/E4 edges are cold, as the plan expected |

## The re-key scheme (owner's decision: rewrite, never preserve)

New object keys are network-native and org-scoped:

```
stock-images:  org/<organisation_id>/item/<stock_item_id>/<object_uuid><ext>
stock-lists:   org/<organisation_id>/upload/<upload_id>/<original_filename>
```

Rules that carry from the rest of the programme:
- **The map is derived from the rows, then asserted by effect.** Build a
  `(old_path → new_path)` manifest FROM `builder_stock_item_images` + live uploads, copy
  object-by-object, and refuse to rewrite any row whose new object's byte size does not
  equal its source. A row the manifest cannot place is a STOP, not a skip.
- **Rows rewrite in the same pass as their objects**, network-side, inside one
  transaction per table — `storage_path` never points across the boundary, in either
  direction, at any commit point an operator could observe.
- **Debris never travels**: soft-deleted uploads and their 3 orphan objects stay behind
  (and are the prime's own cleanup, separately); `selected_by_user_id` and
  `internal_notes` are stripped at export exactly as E3 settled.
- **Counts are gated at three points**: source manifest count = copied count =
  rewritten-row count, and the network's post-move
  `builder_stock_item_images` row count must equal the prime's LIVE row count for the
  moved organisations. Any inequality stops the phase.

## Order (inside the plan's MC → network → prime rule)

1. Freeze intake on the prime's two orgs (stock upload paused — operator announcement,
   not a code change; the corpus is small enough for a same-day window).
2. Re-run the measurement block above; diff against this table.
3. Export rows (orgs, users-as-invites, memberships, items, image rows, live uploads)
   through the E-settlement projections; privacy contract runs at export.
4. Copy objects per the manifest (service-role, network-side pull or MC-relayed push),
   size-asserted per object.
5. Insert rows network-side with re-keyed paths, count-gated.
6. Re-issue the three users' invitations (network `builder-portal-invite`).
7. Create the NPC clone's `workspace_connections` row + transports (MC console), grant
   the E3 scopes, flip `builder_network_enabled` on the prime.
8. Verify by effect: a builder signs in on the network, the stock list renders its
   pictures (signed URLs against the NETWORK bucket), and the prime's marketplace still
   renders through its own untouched tables.

Rollback before step 7 is: nothing — the prime was never written to. After step 7 it is
flipping the flag back off; the network rows stay, harmlessly, because nothing on the
prime reads them.

## Executed — steps 1–5 (2026-09-14)

The data move (the additive, prime-read-only half) ran and reconciled clean. The
prime (`dduzbchuswwbefdunfct`) was **read only**; every write landed on the network
(`htfluofznhxeumblwbww`).

**Mechanism (keys stayed server-side; bytes never crossed a tool payload).** A
throwaway token-gated `mig-import` edge function on the network (its service-role key
auto-injected, never seen) did the byte-faithful uploads and the row upserts. The prime
minted short-lived storage **signed URLs** (via `pg_net` + a transient `http` extension,
the vault service key read only *inside* the SQL) and `pg_net`-posted the projected row
batches straight to `mig-import`. Only signed URLs — read-only, expiring capabilities —
ever crossed the boundary. All scaffolding is gone: `mig-import` is neutralised (410,
holds no credential; the MCP has no function-delete), and the prime's `mig` schema and
the `http` extension were dropped, restoring its original extension set.

**What moved, measured not assumed:**

| Set | Moved | Left behind | Note |
|---|---|---|---|
| Organisations | 2 | — | ids preserved (same entity) |
| Stock items | 1,014 | — | `created_by`, non-live upload refs nulled; `primary_image_id` restored after images (785) |
| Stock image rows | 3,069 | — | 1,157 re-keyed to network paths, 456 external-URL kept, 1,456 empty slots kept for fidelity |
| Image **objects** | **927 · 619,217,584 B** | 171 unreferenced + debris | manifest is row-derived, so unreferenced objects don't travel |
| Stock-list uploads | 2 live · 17,059,917 B | 104 soft-deleted + 3 debris objects | "don't import the mess" |
| Memberships / users | — (step 6) | — | re-invited, never hash-copied |

**Gates that held.** Object copy: network bucket count **927 / 619,217,584 B** +
**2 / 17,059,917 B**, byte-exact against the manifest, and `mig-import` refused to
upload any object whose fetched length ≠ expected — so no wrong-sized object could
exist. Rows: per-org counts equal the prime (Bob 200 items / 661 images; Kopi 814 /
2,408), **0 dangling** storage paths, **0 dangling** `primary_image_id`, **0** rows
still pointing at a prime path.

**Re-key note.** The scheme is `org/<org>/item/<owning-item>/<uuid>.<ext>` for images and
`org/<org>/upload/<upload_id>/<file>` for lists. 43 objects are shared across items; each
is stored **once** under a deterministic owning item (min stock_item_id) and every
referencing row points at that one object, so dedup is preserved and no object is
duplicated per item.

## Remaining — steps 6–8 (the cutover, config-gated)

Not yet run; each depends on tenant configuration and step 7 is the first prime-side
write, held for an explicit go:

- **Step 6 — re-invite users.** Needs `RESEND_API_KEY` on the network project (invite
  emails). Bootstrap: the first **owner** of each moved org cannot be peer-invited (no
  existing owner to invite them), so it is seeded through `builder-network-admin`, then
  the other members follow by the normal invite. Nothing is password-hash-copied.
- **Step 7 — wire + flip (cutover).** Needs the MC console operational
  (`BUILDERS_NETWORK_ADMIN_URL` on Mission Control + a minted NULL-clone
  `builders:operate` key). Create the NPC clone's `workspace_connections` row +
  transports, grant the E3 scopes, then flip `builder_network_enabled` on the prime.
  This is the one prime write; rollback is flipping it back off.
- **Step 8 — verify by effect.** Needs the network reachable at
  `builders.aurixasystems.com.au` (DNS) with its Turnstile widget, and a signed-in
  builder. Confirm the stock list renders pictures from **network** signed URLs and the
  prime marketplace still renders through its own untouched tables.
