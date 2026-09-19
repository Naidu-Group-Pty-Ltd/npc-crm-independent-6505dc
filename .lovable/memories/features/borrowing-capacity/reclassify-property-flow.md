---
name: Reclassify Property Flow
description: Superadmin-only migration of a property between client_properties / commercial_properties / industrial_properties via reclassify-property edge fn, audited in property_reclassification_log.
type: feature
---
- Edge fn `reclassify-property` (actions: `list` | `preview` | `execute`). Verifies `user_roles.role='superadmin'`, then service-role copies → deletes source.
- Audit table `property_reclassification_log` keeps `source_snapshot` jsonb for full forensic recovery; `status` ∈ pending/completed/failed/reverted.
- UI: `/admin/reclassify-property` (sidebar item "Reclassify Property", superadmin-only). Always preview before execute.
- Mapping is best-effort: residential→commercial defaults `asset_class=office`, `tenure=freehold`, `gst_treatment=going_concern`; residential→industrial defaults `asset_subtype=warehouse` and seeds `industrial_financing` from loan_remaining/interest_rate.
- Sidebar also exposes `/admin/bc-segment-engine` (Gauge icon) for the hybrid BC flag.
