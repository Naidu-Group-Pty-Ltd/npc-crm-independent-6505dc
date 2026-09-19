# Template Library — platform implementation

How the library is stored, versioned, injected into, rendered, permissioned and
measured inside the Command Center. Read
[`template-library-strategy.md`](./template-library-strategy.md) first — this
document assumes the flow-versus-canvas decision made there.

---

## 1. Storage

### Three artefacts, three homes

| Artefact | Home | Why |
| --- | --- | --- |
| Template definition (sections, components, bindings) | `command_center_templates` table, seeded from `template-library.json` | Queryable, versionable, per-organisation overridable |
| Generated master `.docx` | Object storage, immutable per version | Binary, cacheable, served by signed URL |
| Rendered previews and thumbnails | Object storage, derived, regenerable | Cheap to rebuild, expensive to keep in the database |

The **source of truth is `scripts/aurixa-templates/`**, in git, reviewed in pull
requests. The database holds a published snapshot. This is deliberate: a
template is design work with correctness properties, and design work with
correctness properties belongs under code review, not in a form.

### Schema

```sql
create table public.command_center_templates (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null,                    -- 'property-investment-report'
  version                integer not null default 1,
  name                   text not null,
  summary                text not null,
  category               text not null,
  design_family          text not null,
  audience_mode          text not null,                    -- client-facing|internal|regulator|partner
  length_band            text not null,
  data_intensity         text not null,
  image_intensity        text not null,
  formality              text not null,
  min_tier               text not null,                    -- launch|growth|scale|enterprise
  max_white_label_level  smallint not null default 4,
  report_types           text[] not null default '{}',
  sections               jsonb  not null,                  -- ordered, with optional/repeats flags
  bindings               jsonb  not null,
  white_label_points     jsonb  not null,
  brief                  jsonb  not null,                  -- the 24-point brief, for the detail drawer
  master_object_key      text,                             -- .docx in object storage
  thumbnail_object_key   text,
  status                 text not null default 'draft',    -- draft|published|archived
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (slug, version)
);

create unique index on public.command_center_templates (slug)
  where status = 'published';

-- Per-organisation configuration. A delta, never a fork.
create table public.org_template_settings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  template_slug     text not null,
  enabled           boolean not null default true,
  approved          boolean not null default false,        -- shows the "approved" badge
  is_default_for    text,                                  -- report type this is the default for
  white_label_level smallint,                              -- capped at the template's ceiling
  section_overrides jsonb not null default '{}'::jsonb,    -- mandatory/hidden per section
  brand_overrides   jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, template_slug)
);

create table public.template_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  user_id         uuid not null,
  template_slug   text not null,
  template_version integer not null,
  input_payload   jsonb not null,
  status          text not null default 'queued',          -- queued|running|succeeded|failed
  error_code      text,
  error_detail    jsonb,
  docx_object_key text,
  pdf_object_key  text,
  page_count      integer,
  duration_ms     integer,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
```

RLS follows the existing pattern: `command_center_templates` is readable by any
authenticated user whose plan tier reaches `min_tier` and whose organisation has
not disabled it; `org_template_settings` and `template_generation_jobs` are
scoped to `organisation_id`.

**Why a delta table rather than forked template rows.** A fork is a snapshot of a
design decision. When the library is refreshed — an annual product commitment —
every fork is stranded on the old design and someone has to reconcile hundreds
of them by hand. A delta re-applies cleanly to the new version, and the two
fields most likely to conflict (`section_overrides`, `brand_overrides`) are
small enough to validate on upgrade and report on when they no longer apply.

---

## 2. Metadata and the registry

`src/lib/command-center/templateLibrary.ts` is generated from the catalogue and
carries the **index**: everything the grid, the filters, the shelves and the
recommender need. 98 KB, code-split behind the library route.

`public/templates/command-center/template-library.json` carries the **detail**:
sections, bindings, white-label points and the long-form brief. 417 KB, fetched
once per session when a user first opens a template's detail drawer, and the
same payload that seeds the database.

The split exists because putting the full brief in the bundle costs every user
417 KB to render a grid of cards. `verify_library.py` fails the build if the
index exceeds 160 KB, so the split cannot silently erode.

The bundled index is also the **offline fallback**: if the database is
unreachable, the library still renders from the bundle and generation is the
only thing that degrades.

---

## 3. Dynamic-field mapping

### One binding language

`{{path.to.field | filter}}`, resolved by
`src/lib/reportTemplate/bindingResolver.ts`. The library reuses it rather than
inventing a second syntax, so filters (`currency`, `date`, `percent`) and
computed fields work identically in canvas templates and library templates.

### Three binding shapes

| Shape | Example | Resolves to |
| --- | --- | --- |
| Scalar | `{{property.address}}` | A string |
| Block | `{{report.executiveSummary}}` | An **array of paragraphs**, rendered as a `prose` run of any length |
| Collection | `{{comparables[]}}` | An array of records, rendered once per record by a `repeats` section |

Block and collection bindings are what make the library survive real content. A
template with `{{summaryPara1}}`, `{{summaryPara2}}`, `{{summaryPara3}}` has
silently decided the summary is three paragraphs; a template with one block
binding has not.

### The mapping layer

Each template declares its bindings. A resolver assembles the context from
existing platform records:

```
client record        → client.*, applicants[]
whitelabel_settings  → org.*, brand.*
user profile         → author.*
property record      → property.*, comparables[]
borrowing capacity   → assessment.*, lenders[], commitments[]
cash-flow model      → cashflow.*, assumptions{}
AML case             → customer.*, identity.*, screening[], riskFactors[]
generated content    → report.executiveSummary, report.recommendation, …
```

Unmapped bindings are the interesting case. A binding with no source is either
(a) user-supplied at generation time — surfaced as a form field in the generate
step — or (b) genuinely absent, which is a validation failure. The distinction
is declared per binding, not guessed.

---

## 4. Content injection and generation

### Pipeline

```
1  Resolve      template + version + org settings + brand config
2  Bind         assemble the context; resolve every binding
3  Validate     required bindings present, alt text present, images meet minimums
4  Compose      run the builder: sections in order, optional ones filtered, repeats expanded
5  Emit DOCX    the editable artefact
6  Render PDF   through the existing print pipeline
7  Store        object storage; record the job
8  Notify       the user, with both download URLs
```

### Where generation runs

The builders are Python. Three options were considered:

| Option | Advantage | Disadvantage |
| --- | --- | --- |
| Port the component library to TypeScript and generate in an edge function | One language; runs where the rest of the platform runs | Re-implements 2,000 lines of hard-won OOXML handling; two implementations drift; the schema-ordering bug class returns |
| Run the Python builders in a container service, called over HTTP | Reuses the toolchain exactly; the artefact that was reviewed is the artefact that ships | A new service to operate |
| Pre-generate every combination | No runtime generation | Combinatorially impossible once content is injected |

**Recommended: the container service**, alongside the existing
`weasyprint-service` and `pdf-parse-service`. The OOXML handling in
`scripts/docgen/oxml.py` — particularly schema-ordered element insertion, which
Word silently rejects when wrong — is the kind of code that should exist once.
A second implementation in another language would be a second place for that bug
class to live.

The service takes `{templateSlug, version, brand, context, options}` and returns
a DOCX. It holds no state and no credentials beyond its own.

### PDF

DOCX → PDF through the existing print pipeline. Requirements the library places
on it: PDF/A-2b, tagged, bookmarks derived from section openers, embedded fonts,
and preserved table header repetition. A PDF that loses the repeating header row
on a 60-row register has lost the thing the register is for.

### Preview

Preview renders the **sample build**, not a live generation. It is deterministic,
cacheable, and produced by the same builder as the master — so what a user
previews is structurally what they will get. Live-generated previews are slower,
non-cacheable, and tempt the codebase toward a second rendering path.

Thumbnails are page 1 of the sample build at 3:4, regenerated when the template
version changes.

---

## 5. Version control

- **Template versions are immutable.** Publishing creates a new row; it never
  mutates a published one.
- **Generated documents record the version they used**, so a document produced
  in March is reproducible in December.
- **Roll back = republish an earlier version**, not edit-in-place. The forward
  history stays intact.
- **Organisation deltas re-apply on upgrade**, and any delta that no longer
  applies (a section that no longer exists) is reported to the administrator
  rather than silently dropped.
- The library's own source is versioned in git; `export_registry.py` regenerates
  the published snapshot, and `verify_library.py` gates it.

---

## 6. White-label branding variables

Branding resolves from `whitelabel_settings` (see
[`WHITE_LABEL_TOKEN_CONTRACT.md`](../WHITE_LABEL_TOKEN_CONTRACT.md)) into a
`BrandConfig`:

```
whitelabel_settings.theme_config.primary   → brand.primary
whitelabel_settings.theme_config.accent    → brand.accent
whitelabel_settings.logo_config.*          → logo slots
org profile                                → org.name, org.abn, contact fields
org_template_settings.white_label_level    → brand.level (clamped to the template ceiling)
```

Three rules the generator enforces:

1. **A brand config cannot reach layout.** It carries colour, logo and copy.
   Nothing in it touches spacing, type scale, margins or component structure.
2. **Semantic colours are not overridable.** Success, warning, alert and info are
   fixed. A partner palette must not be able to change what a warning means.
3. **Level 4 removes Aurixa from metadata as well as the body.** A white-label
   document whose properties say Aurixa is not white-labelled. Assert this in
   the export pipeline, not just in the builder.

Contrast is validated at generation, not at configuration time: a partner primary
colour that fails WCAG AA against white is rejected with the measured ratio and
the nearest passing shade offered. Doing this at generation catches colours
imported from an integration, not only ones typed into the settings form.

---

## 7. Permissions

Two independent gates, both must pass — the pattern already established in
`src/lib/pricing/planEntitlements.ts`:

- **Plan entitlement** — does the workspace's tier include this template?
  `templatesForPlan(plan)` in the generated module.
- **User permission** — may this user generate, approve, or administer
  templates? `usePermissions`.

Plus two library-specific gates:

- **Audience mode** — templates with `audience_mode` of `internal` or
  `regulator` are excluded from client-facing preview and from portal sharing.
  An AML assessment must never be one misconfigured share away from the customer
  it assesses.
- **Organisation enablement** — an administrator may disable a template for the
  organisation entirely, and it disappears from the grid rather than appearing
  locked. A locked card the user can never unlock is browsing noise.

---

## 8. Approvals

`status` moves `draft → published → archived`, and publication requires:

1. `verify_library.py` passing in CI;
2. a sample build generated and reviewed;
3. a hostile-fixture generation succeeding (see QA below);
4. an administrator approval recorded with user and timestamp.

Organisation-level approval is separate and lighter: an organisation marks a
published template as approved for its own users, which the recommender weights
heavily (+40) and the card badges.

---

## 9. Error handling

Generation fails loudly rather than producing a defective document:

| Code | Condition | User-facing behaviour |
| --- | --- | --- |
| `BINDING_MISSING` | A required binding has no value | Names the field and the section; offers to supply it inline |
| `ALT_TEXT_MISSING` | An image or chart has no alt text | Blocks; alt text is an accessibility requirement, not a nicety |
| `IMAGE_BELOW_MINIMUM` | An image is under the template's stated resolution | Blocks with the required size; upscaling would degrade the artefact |
| `SECTION_EMPTY` | A required section resolved to nothing | Offers to remove the section if it is optional, or names what is missing |
| `BRAND_CONTRAST` | Partner colour fails WCAG AA | Reports the measured ratio and the nearest passing shade |
| `TEMPLATE_UNAVAILABLE` | Version withdrawn mid-job | Retries against the current published version |
| `RENDER_TIMEOUT` | Generation exceeded its budget | Retries once, then reports with the job id |

Partial success is not offered. A report with a blank chart frame reaching a
client is worse than a report that did not generate.

---

## 10. Quality assurance

### In CI

```bash
python3 scripts/aurixa-templates/export_registry.py   # must produce no diff
python3 scripts/aurixa-templates/build_library.py --sample
python3 scripts/aurixa-templates/verify_library.py
```

`verify_library.py` asserts: the registry validates; every `built=True` template
has a generator and vice versa; every component named in a brief exists; every
design family carries at least two templates; the exported index and detail agree
with the catalogue; the index stays under 160 KB; and, per built document — every
headed section from the brief appears under exactly that title, the cover
suppresses the running header, no row uses an exact height, no row may split
across a page, and every captioned data table repeats its header row.

The section-title assertion is the one that matters most over time. It is what
stops 40 published briefs from drifting away from 40 shipped artefacts.

### Hostile fixtures

Every template is generated against a fixture set designed to break it, and the
output is checked for overflow, orphaned headings and page-count blow-outs:

- a 4,000-word executive summary in a slot designed for 150;
- a 200-row register;
- a client name of 90 characters and an organisation name of 120;
- zero images where images are optional;
- every optional section removed, and every optional section present;
- one property and five properties through the same comparison template;
- a partner brand colour at the edge of the contrast threshold;
- every white-label level, 1 through 4.

### Visual regression

Sample builds are rendered to PNG per page and compared against approved
baselines. A diff above threshold fails the build. This is what catches the
class of defect that structural assertions cannot — a table that technically fits
but now collides with its caption.

---

## 11. Analytics

| Metric | Why |
| --- | --- |
| Selections and generations per template | Which templates earn their maintenance |
| Generation success rate per template | Which template has a content-injection defect |
| Time to first export | Whether the select-configure-generate flow is working |
| Abandonment at each step of the configure flow | Which step is too complex |
| Exports by format | Whether DOCX or PDF dominates, per category |
| Templates never selected in 90 days | Archive candidates |
| Recommender acceptance rate | Whether the scoring weights are right |
| Error codes by template and organisation | Whether a failure is a template defect or a data-quality problem |
| Page-count distribution per template | Whether the stated length band is honest |

The last one is worth calling out. If a template briefed at 8–14 pages is
producing 30-page documents in production, either the brief is wrong or the
content being injected is not what the template was designed for. Both are worth
knowing and neither shows up in a success-rate metric.

---

## 12. Scalability

- **Generation is stateless** and horizontally scalable; the service holds no
  session state.
- **Previews and thumbnails are derived and cached**, keyed by template version,
  so they are computed once per version rather than per view.
- **The detail payload is a static asset**, served from the CDN and invalidated
  on version change.
- **Adding a template** is a new entry in `catalogue.py` plus a builder function.
  Nothing else changes: the docs, the index, the detail payload, the filters and
  the recommender all follow from the registry.
- **Adding a design family** is one dataclass. Every template assigned to it
  re-skins on the next build — which is what makes the annual refresh a
  commercially viable product rather than 40 redesigns.
- **The library scales to ~100 templates** on the current architecture. Beyond
  that the bundled index needs to become a paged API rather than a static module,
  and the verifier's per-document checks need to run in parallel.

---

## 13. Build order

| Phase | Work | Outcome |
| --- | --- | --- |
| 1 | Generation service; `command_center_templates` and `org_template_settings`; seed from the detail payload | All 40 templates generate end to end |
| 2 | Library grid, filters, shelves, detail drawer, preview | Users can browse and preview |
| 3 | Configure and generate flow; section picker; brand application; DOCX and PDF export | The feature is usable |
| 4 | Admin surface: publish, approve, assign, test injection, analytics | Operable without engineering |
| 5 | Visual regression baselines from the sample builds; thumbnail pipeline | Layout drift is caught before release, not by a customer |
| 6 | Enterprise bespoke family capability; partner-authored templates | The commercial upside above Scale |

Phases 1–3 are the minimum that delivers value; the library is worth nothing
until a user can select a template and get a document out of it. Every template
in the catalogue is built, so phases 1–3 are gated only on the platform work —
there is no template still to be authored before a user can be given the full
library.
