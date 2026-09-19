# ADR 017: Template Library entries are separate from report templates

## Status
Proposed. Blocks PR 2 of the Template Library roadmap
(`docs/template-library/03-roadmap.md`). Requires the D1–D5 decisions in
`docs/template-library/README.md` to be answered before implementation begins.

## Context
The platform needs a browsable library of 30–40 professionally designed report
templates that a user can preview and turn into their own editable template. The
existing Reporting Engine Builder — `report_templates`, the WeasyPrint render
pipeline, `resolve_report_template()`, versioning, approvals and branching — is
operational and must not change.

The obvious implementation is to add the library templates to `report_templates`
with an `is_library` flag. Two properties of the current code make that unsafe:

1. `useReportTemplates()` lists `report_templates` with no filter, so library
   rows would appear as cards in the existing Builder tab the moment they were
   seeded.
2. `resolve_report_template()` selects `FROM report_templates WHERE report_type = $1
   AND is_active = true`, so every library row would be one mis-set boolean away
   from becoming the template used for live customer PDFs.

The first breaks the requirement immediately. The second is a latent
production-data risk with a blast radius of every report of that type.

## Decision
Library templates live in their own table, `template_library_entries`. They are
never rows in `report_templates`.

"Use template" performs a **snapshot copy**: it writes an ordinary
`report_templates` row through the existing `manage-templates` broker, using the
field-reset recipe already proven by `TemplateBranchingDialog`, and records
lineage in a separate `template_library_instantiations` table. Master entries are
not referenced, inherited from, or live-linked; a later change to an entry never
alters a copy already made.

Lineage is stored on the library side so that `report_templates` requires no
`ALTER TABLE`. No existing table, policy, index, function or component is
modified by the data foundation.

## Consequences
Library entries are structurally incapable of being resolved into a live report
or of appearing in the Builder list — those two risks are eliminated rather than
guarded. Master templates cannot be edited from the Builder because the Builder
has no query that reaches them. Rollback is a table drop plus a revert, with
nothing to restore, because nothing was replaced.

The costs are accepted deliberately: the template schema is stored in two places
(catalogue and copy), so a compatibility check is required at copy time;
"which library template did this come from" requires a join rather than a column;
and a working copy does not track improvements to its source. The last is a
feature, not a defect — a customer's approved, branded, active report design must
not change because a catalogue entry was edited.

Tenant-scoped library visibility is **not** delivered. This codebase has no
organisation, tenant or agency table; `report_templates.agency_id` is an orphan
column and migration `20260726143000` documents that no authoritative membership
relation exists. The `visibility` column is shaped to accept `'agency'` later, but
only `'global'` is reachable, and the library must not be described as
tenant-isolated until a tenancy model exists.
