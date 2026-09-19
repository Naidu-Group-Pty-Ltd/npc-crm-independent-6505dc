# Choosing the template a report comes out in

Read this before touching `reportTemplateSelection.pure.ts`, the picker, or
anything in the generation path that decides which `report_templates` row a
document is drawn from.

---

## What did not exist

A template reached a document by **ranking alone**. `resolve_report_template()`
sorts the active rows for a report type by scope, then variant, then priority,
then recency, and takes the first. That is a good tiebreak and a bad interface:

- **Nobody chose.** There was no surface anywhere in the product that bound a
  template to a report format for generation.
- **Nobody could see.** The person pressing "Premium PDF" could not tell which
  template their document would come out in, or that it had changed.
- **The only door was an editor.** Every path that touched a template ended in
  `/admin/template-builder/:id` — `UseTemplateDialog` navigated there
  unconditionally on success. Choosing is not editing, so people were being sent
  into a page-design editor to express a preference, and what they got at the
  end of it was a *working copy*, which is inactive and therefore cannot be what
  a report is generated from at all.

This is the chooser that was missing. It navigates nowhere.

---

## The shape

| piece | what it is |
| --- | --- |
| `report_template_selections` | one row per (user, format): the template that user's reports of that format use |
| `_shared/reports/reportTemplateSelection.pure.ts` | the rules — what may be chosen, and what a stored choice resolves to |
| `manage-templates` | the only reader and writer, scoping every operation to the session user |
| `useReportTemplateSelection` | the two queries and two mutations every surface shares |
| `ReportTemplatePicker` | the dialog |
| `ReportTemplateSelector` | the line above a generate button |
| `ReportTemplateBindings` | every format at once, on the Templates page |
| `routeReportThroughTemplate({ templateId })` | the generation path honouring the choice |

**A selection is read before the ranking, never instead of it.** No row means
today's behaviour, byte for byte. That is what makes this safe to ship against
1,317 existing generation runs.

---

## Four rules that keep biting

### A format has several spellings and they are one format

`compass`, `investment_compass`, `investment_report` and `property_investment`
are all the Investment report, and `manage-templates` will activate a template
stored under any of them (`PRODUCTION_REPORT_TEMPLATE_TYPES`). A picker matching
the raw `report_type` column would show a different set depending on which
spelling a template happened to be saved under, and a selection keyed on the raw
column would be a *different selection* for each spelling.

Everything goes through `normaliseReportType`, and a selection is stored under
the normalised key. That map now lives in the pure module and
`src/lib/reportTemplate/adapters/index.ts` re-exports it, because two copies is
exactly how `commercial_industrial` came to be a spelling the broker would
**activate** and the registry would then resolve to **no adapter at all** — a
template that could be published, could not be picked, and rendered nothing.
`reportTemplateSelection.spec.ts` reads `PRODUCTION_REPORT_TEMPLATE_TYPES` out
of the broker's source and fails when any spelling in it does not land on an
adapter.

### Selecting is not approving

Every entry in the picker is already `is_active`, and a row only becomes active
by passing `validateReportTemplateUpdate` — superadmin, approved, a production
adapter for the type, and a schema that renders. So choosing is choosing among
things somebody else already approved, and it needs no module permission of its
own. Gating it on `templates:edit` would mean the people who generate reports
could not choose which template they use.

The house default stays where it already lives: `is_default` and `priority` on
`report_templates`, applied by the ranking when nobody has chosen.

### A chosen template that will not be drawn has to say so

`routeReportThroughTemplate` skips anything whose `engine` is not `weasyprint`
and the caller falls through to the legacy generator. That is one of the four
silent fall-throughs [`COVERAGE.md`](./COVERAGE.md) measured, and the reason
**80 of 81** template rows draw nothing. Such a template is still selectable —
it is what the ranking would have picked anyway — but both the picker and the
control beside the generate button label it, because "chosen" and "used" are
otherwise indistinguishable from outside.

### A selection can go stale without being deleted

The template can be deactivated, or retyped onto another format, and the row
still points at it. `resolveTemplateSelection` answers **`unavailable`** for
that — a third status, not a collapse to `none`. Generation falls back to the
ranking either way; the difference is that the fallback is *said out loud*,
because a document quietly changing template under somebody is the failure this
whole feature exists to prevent. `routeReportThroughTemplate` re-reads the row
server-side and applies the same rule, so a stale id in the browser cannot
resurrect a retired template.

---

## Ownership, and why it is in the broker

`report_template_selections` has RLS enabled and **no policy**, and no grants to
`authenticated`. Every read and write goes through `manage-templates`, which
holds a service-role client — and a service-role client bypasses RLS, so
ownership has to be enforced in the broker or not at all. It is the same
treatment `comparison_analysis_templates` already gets there, for the same
stated reason.

Three things the broker does, all asserted in
`reportTemplateSelection.spec.ts`:

- `list` is `.eq('owner_user_id', userId)` **before** the caller's filters are
  applied, so no filter combination enumerates anyone else's choices;
- `get` / `update` / `delete` re-check ownership by id and answer 404 otherwise;
- `insert` / `upsert` stamp `owner_user_id` from the verified session and
  **drop a caller-supplied `id`** — the upsert names `(owner_user_id,
  report_type)` as its conflict target, and a primary key in the body would be a
  second, unscoped way to address a row that is not yours.

`UNIQUE (owner_user_id, report_type)` is what "locked in" means: choosing again
replaces the answer rather than adding a second one, in the database rather than
by convention.

---

## What is wired, and what is not

`PremiumPdfButton` — the Investment report's design-system path — reads the
selection and passes it to `tryRouteThroughTemplateBuilder`. The control sits in
`InvestmentReportExportPanel` above the generate buttons, because which template
a document comes out in is a decision *about the document*.

`ReportTemplateBindings` on the Templates page covers **every** format the
adapter registry knows, including the preview-only ones — which say why a choice
would not change anything rather than being silently absent. Formats other than
Investment can therefore be bound today, and the binding is honoured the moment
their generation surface passes `templateId` through the same routing helper.
That wiring is per-surface and deliberately not done in bulk: each format's
generate button reaches its renderer by its own path, and
[`COVERAGE.md`](./COVERAGE.md) is the list of which paths those are.

`UseTemplateDialog` no longer navigates into the Builder on success. Creating a
working copy and editing one are now two buttons instead of one action with a
side effect — the copy is inactive either way, so there was never anything about
it that had to be finished in an editor.

## The choice has to reach the document, on every format

The picker lists every format the adapter registry knows and tells the reader
"a choice is kept for every report of that format until it is changed here".
That was true of one format. `PremiumPdfButton` passed the chosen id into the
Compass route; the shared path every other format's delivery goes through —
`tryTemplateDocument` — did not accept one, so on the other eight a selection
was **stored, displayed as `selected`, and ignored by the generator it was a
choice about**. The UI promised something the system did not do, which is worse
than not offering the choice: the person has no way to tell, because a document
still arrives and it looks fine.

`tryTemplateDocument` now resolves the selection itself and forwards it.
Deliberately looked up there rather than threaded through eight `deliver*`
signatures: that would have fixed the surfaces that remembered to pass it and
left the same hole open for the email, attachment and broker-portal paths,
which never touch the picker's hook. The lookup is **not cached** — somebody
who changes their template and generates again expects the new one — and a
failed read resolves by ranking, exactly as it did before selections existed.

Nothing else changes about resolution: the id is still re-read and revalidated
server-side by `loadSelectedTemplate`, and a choice that no longer applies
still falls back to the ranking rather than failing the generation.

### The one format whose choice cannot always be honoured

The 10 Year Cash Flow renders from a projection the modal recomputes in the
browser, and a template renders the stored one. When they differ — which is
the normal case for a report with adviser overrides — the export cannot use a
template without printing different figures from the ones on screen, so it does
not. That is correct, and it used to be silent: the person had chosen a
template and received the standard layout with no explanation, which is
indistinguishable from the choice being broken. The export now says so, and
only to somebody it is news for — a person with a selection for that format who
did not get it.

`templateRouteEnforcement.spec.ts` holds the whole contract for every format at
once: each production format has an adapter that can list, route and bind; each
one's delivery path asks for a templated document; that request carries the
chosen template; and a format whose choice cannot change anything says so.

## The choice belongs where the document is produced

Choosing a template was possible in two places: the Template Library list, and
one export panel. Every other format's download control offered no way to see
or change it — so the answer to "which template is this going to come out in?"
lived a page away from the button that used it, and a person had to know that
page existed at all to find it. Nobody should have to learn a settings screen to
answer a question about the button in front of them.

All nine production formats now carry the control at the point of download.
Two presentations over one hook, one picker and one stored selection:

- **`useReportTemplateMenu`** — a labelled section at the foot of a download
  menu, for the seven surfaces that are split buttons with a dropdown of
  destinations. It states the current template and opens the picker.
- **`ReportTemplateSelector`** — the row form, for surfaces that are not menus:
  the Market Intelligence options popover, the Commercial & Industrial card
  header (once for the card, since every row's Generate report uses the same
  per-format choice) and the Investment export panel it was written for.

Three rules the hook keeps:

- **A format a choice cannot change offers none.** Preview-only formats render
  nothing rather than a control that does nothing — the Library page is where
  they explain why.
- **The picker is rendered outside the menu that opens it.** Radix unmounts
  `DropdownMenuContent` on close, so a dialog inside it opens and vanishes in
  the same frame. The hook returns the section and the dialog separately for
  exactly this reason, and `templateRouteEnforcement.spec.ts` asserts no
  surface puts the dialog inside its own menu.
- **A failed read is not "nothing chosen"** — it says the check failed *and*
  that generation is unaffected, because a person who reads only the first half
  has no way to know whether their download still works.

`templateRouteEnforcement.spec.ts` also holds the format→surface map complete
against the adapter registry, so a tenth format cannot ship with a download
control that offers no way to choose its template.

## The choice was empty on eight of nine formats, and why

The picker draws from `report_templates` where `is_active`, and for eight of
the nine production formats that set was empty — not by fault but by
architecture. The library's only exit (`instantiate`) deliberately creates
inactive user drafts ("nothing about a fresh copy is live"), and the only
surface that sets `is_active` is the Builder's superadmin Activate button, one
approved template at a time. No migration, script or seed had ever produced an
active row for borrowing_capacity, cashflow, client_details,
commercial_capacity, comparison, market_intelligence, portfolio or qa. So the
menus shipped above stated, correctly, that there was nothing to choose — and
every document fell back to the legacy generator, which is the coverage number
`COVERAGE.md` measures.

`supabase/migrations/20260814190000_activate_production_masters_eight_formats.sql`
seeded one master per format: Private Banking, variant A — "Chancery", the
drawn reference of the catalogue's leading family, copied from
`template_library_entries` in exactly the state the activation gate produces
(approved, active, global, weasyprint, a production adapter for the type — the
contract in `reportTemplateInsertGuard.pure.ts`). It records lineage the way
`instantiate` does, skips any format that already has an active template — so
a re-run is a no-op and a hand activation is never displaced — and can only
insert. `productionMasterSeed.spec.ts` pins those properties, and pins that the
seeded spellings are the adapters' own routing strings verbatim, because the
ranking fallback matches `report_type` with a raw `eq` and a template stored
under a spelling no adapter emits can be picked but never resolves.

The behavioural consequence is deliberate and worth stating plainly: a format
whose ranking used to resolve nothing now resolves a WeasyPrint master, so
documents with **no stored selection** route through the design system instead
of the legacy generator. A stored selection still beats the ranking, every
failure path still falls back to legacy, and deactivating the master returns
the format to exactly its previous behaviour.

## The library is the choice, not a place the choice points at

The picker used to list only rows already in `report_templates` — after the
seed, one master per format — while the fifty designs the library holds per
format were reachable only through the Library page, and only as *editing*
copies (`instantiate` deliberately creates inactive drafts). Choosing a design
for generation is a different act, so the picker now offers the library
directly: the format's published, production-ready, WeasyPrint designs, grouped
by design family with the family's curated colourways beside them, on every
download surface at once.

The path from the catalogue to a choice is `use_for_reports` in
`manage-template-library`: given an entry (and optionally a colourway), it
returns a **selectable** `report_templates` row — active, approved,
**user-scoped**, every safety-critical field fixed server-side. It carries the
same authority bar as `instantiate` (module `can_edit`), because the copy it
creates is visible only to its owner and can only ever affect that owner's own
documents — the superadmin activation gate protects the *global* candidate
set, which this operation cannot touch. `validateEntryForReportUse` refuses
anything the render path would silently drop (unpublished, preview-only,
non-WeasyPrint, no production pipeline), because a selection that changes
nothing is worse than a refusal with a reason.

Four rules carry the tie-up, pinned by `reportUseCopy.spec.ts` and
`reportTemplatePickerLibrary.test.tsx`:

- **Adoption is idempotent on (entry, entry version, colourway).** Reuse is
  matched on the `libraryLineage` block, global rows first — so adopting the
  house default finds the seeded master rather than minting a private
  duplicate of it, and asking twice returns the same row.
- **The entry's default colourway is recorded as null** — the authored
  palette, unbaked — which is how the seeded masters record it. This is NOT
  what `instantiate` does (it resolves and bakes the default); baking here
  would stamp the default's id into the lineage and break the reuse match.
- **An active row that descends from a listed design is folded into that
  design's row** (the picker fetches `config->libraryLineage` as its own tiny
  column, never `config`), so one choice never looks like two. Hand-built
  templates and the Compass pilot keep their own rows.
- **A library version bump is a different design.** A copy of v1 is never
  reused for a v2 pick — the user chose the design as the library shows it
  now — and the stale copy simply stops being offered.

## The surfaces the map missed, found by walking every generation path

"All nine formats carry the control at the point of download" was true of the
*download components* and not of every place a document is produced — which is
the same class of hole as the adapter that was wired nearly all the way. A
sweep of every call into the delivery modules found four:

- **Commercial & Industrial Capacity's primary surfaces had nothing.** The
  assessment workspace's results step and both Generate actions on the
  `/commercial` page called `useCapacityReport` with no control anywhere on the
  page — the only wired selector sat on a client-modal tab behind a Scale-only
  add-on. All three now carry `ReportTemplateSelector`.
- **The portfolio reports list** (`/portfolio-reports`, and the Clients page)
  typeset reviews per row with no control; the list header now carries one.
- **`ConversationExport` embedded the whole Q&A download button inside its own
  menu content** — a `DropdownMenu` nested in another menu never opens, and the
  template dialog unmounted with the content: the picker opened and vanished in
  the same frame. The menu now offers the typeset documents as plain items
  through the same delivery hook (`useReportQaDelivery`), carries the template
  section at its foot, and renders the dialog outside. The mobile overflow menu
  on the Q&A page embedded `ConversationExport` itself the same way and was
  lifted out for the same reason.
- **The per-file checks could not see any of this**, because they read each
  wired component's own file. `templateRouteEnforcement.spec.ts` now scans
  every component in `src/` and fails when a control that carries a dialog is
  rendered inside any `DropdownMenuContent`.

## The choice must reach the render — and say so when it cannot

"The final render doesn't follow the selection" was measured and had two
halves. The general half: every failure inside the template path — an adapter
refusal, a stale choice, a failed render — fell back **silently** to the
format's own composer, and on the migrated formats that fallback is itself a
well-typeset WeasyPrint document, so "your choice was honoured" and "your
choice was ignored" were indistinguishable from the outside.
`tryTemplateDocument` now says it out loud, once, at the moment it happens:
when a stored selection exists and the document was not produced with it, a
warning names what happened beside the file that still downloads
(`notifySelectionNotUsed`), and a route that fell back to the ranking says the
choice went stale. The capacity report's analysis refresh — the one action
that bypasses the template path by design — says so too, only when a choice
exists to bypass.

The specific half was the 10 Year Cash Flow, the one format whose contract
puts the arithmetic in the browser: the modal recomputes ten years live, the
adapter reads the stored series, and the template was only asked for when the
two matched exactly (`matchStoredScenario`) — the exception, not the rule. The
adapter contract now carries an optional **`payload`** channel
(`liveProjectionRow.ts`): the modal always asks, a matched series routes under
its named scenario, and an unmatched one hands the adapter the same wire the
composer receives. The reviewed series is published by the same projection
producer under the same vocabulary, headlined by the composer's own headline
figure (after-tax), labelled **"Adviser-reviewed"** — never a scenario name it
does not satisfy — and the stored three-way scenario comparison is withheld
because there is nothing to compare. `cashFlowTemplateRouteGuarded.spec.ts`
pins both halves; `liveProjectionRow.spec.ts` pins the mapping, the refusals
and the labelling.

## The read that could never succeed

The warning above ("your chosen template was not used") fired on a cash flow
download whose report was healthy, whose template was active and WeasyPrint,
and whose selection was stored. The render ledger settled it: `template_render_jobs`
had **no row** for the attempt, and `render-template-pdf` writes its row before
calling the engine — so the route refused before it ever rendered.

The refusal was the adapter's own read. **Command Centre identity is a custom
HttpOnly-cookie session, not a Supabase Auth session**: `integrations/supabase/client.ts`
creates the client with the anon key and `persistSession: false`, so `auth.uid()`
is always NULL in the browser. Three of the tables the adapters read have exactly
one non-service SELECT policy and it is gated on `auth.uid()`:

| Table | Policy | Formats affected |
| --- | --- | --- |
| `investment_reports` | `generated_by = auth.uid()` | cashflow (entry), investment |
| `property_comparisons` | `user_id = auth.uid()` | comparison (entry) |
| `clients` | `created_by = auth.uid()` | client_details (entry); borrowing_capacity and commercial_capacity (name only) |

A read of any of them returned **zero rows for every record and every user** —
not an error, an empty result. `loadReport` answered null, `resolveRoutingContext`
answered null, the router read that as "this adapter refuses this record", and
the caller fell through to the legacy generator. So three formats could never
route at all, two printed documents with no client name, and the one format that
ever rendered through the design system — `investment_compass` — is the one whose
adapter already read through a broker. That is the mechanical explanation for
`COVERAGE.md`'s 0.14%.

Every adapter now reads through an edge function holding a service-role client,
scoped to the verified session user: `get-investment-reports` for the two report
tables and `get-client-data` for the client and its children — both already
existed and are already permission-gated, so this added no new surface and no new
authorisation decision. `adapters/secureSource.ts` is the only place that decides,
and `adapterSourceReadable.spec.ts` fails any adapter that reads one of the three
tables directly. Two consequences worth stating: the investment adapter's
browser-client *fallbacks* were removed, because a fallback that returns nothing
reads as though a second route exists; and the cash flow picker's
"only reports that store a projection" filter no longer travels with the read,
since the brokered list projection omits the blob on purpose — `projectCashFlow`'s
structural check was always the guard that actually refuses such a report, at
render time.

### What the brokered read costs, and why it cannot regress anyone

The two brokers are permission-gated — `get-investment-reports` on `reports:can_view`,
`get-client-data` on `client_management:can_view` — so the templated path now
depends on a permission the direct read did not ask for. That is safe in the
only direction that matters: a caller who lacks the permission gets a refusal,
`secureSource` turns it into `null`, and the format falls through to its legacy
generator — which is **exactly** what the direct read produced for everybody,
permission or not. The worst case after this change equals the best case before
it, so no surface can generate less than it did; the surfaces whose users hold
the permission simply start getting the document they chose.

### A refusal names the gate it closed at

`routeReportThroughTemplate` answers `null` for ten distinct reasons, and every
one of them falls back to the format's own composer — which on the migrated
formats is itself a well-typeset WeasyPrint document. So "your template
rendered" and "your template was skipped" were indistinguishable from the
outside *and* in the console, and diagnosing one refusal meant querying
`template_render_jobs` in production to see whether a render had even been
attempted.

The route now records which gate closed (`TemplateRouteRefusal`) and reports it
through an `onRefusal` callback; `tryTemplateDocument` puts the wording in the
notice the person is already reading. The contract is unchanged — a refusal is
still a fallback, still `null`, still never an error — only its silence is
gone. Two things came out of writing it: `parseTemplate` used to throw straight
past every remaining gate into the outer `catch`, where an unreadable schema
looked exactly like a network failure, so it now parses inside its own guard;
and the shim reports `no_adapter` itself, because it refuses before the route
is entered at all.

## The format whose only global candidate could never be drawn

Everything above assumes the ranking's fallback resolves something a renderer
will accept. On the Investment Compass it did not, and the way it failed is the
mirror image of the seed above.

Measured in production on 2026-08-16, `resolve_report_template('investment_compass')`
returned **"Investment Compass — WeasyPrint Pilot"**, whose `engine` is
`jspdf`. `routeReportThroughTemplate` skips any non-`weasyprint` resolution, so
that row was chosen by the ranking and refused at the engine gate on every
generation. The only WeasyPrint master for the format was `scope = 'user'` and
therefore invisible to the ranking — `rank_source` is NULL for a user-scoped
row when no user id is passed — and exactly one stored selection existed,
belonging to that same user. **The design system was reachable by an explicit
per-user choice and by nothing else**, which is a fifth silent fall-through to
add to `COVERAGE.md`'s four.

The pilot also carried no `libraryLineage`, so no re-activation could refresh
it: it still held the schema it was given on 6 August, and every catalogue fix
since had reached the library and stopped there.

Two rules come out of it.

**A format's ranking is only as good as its global row's engine.** An active
row is not a route. The check is `is_active AND scope = 'global' AND engine =
'weasyprint'`, and `20260816160000` seeds exactly that for
`investment_compass`.

**`investment` and `investment_compass` are one format to the alias map and two
to the resolver.** `normaliseReportType` folds them, which is what makes the
picker and the stored selection coherent — but `resolve_report_template`
matches the raw `report_type` column with an equality. `getReportType` answers
`investment` for the snapshot, briefing, strategic and financial tiers (63
reports) and `investment_compass` for the compass tier (1,124), so a row has to
exist under **both** spellings or one of the two groups resolves nothing.
Correcting the tier fix's spelling was necessary and, on its own, changed no
document.

## A chosen template that cannot carry the report is composed, never shipped empty

Measured on 15 Sep 2026. A person chose the library's **First-Home Buyer
Report** for an Investment report and received five pages: a cover reading
"Prepared for" with no name after it, three pages carrying only their
headings, and a disclaimer — 225 KB, PDF/UA-tagged, under the tenant's own
letterhead, recorded in `template_render_jobs` as `succeeded`. The template is
seeded against a sample preset (`client.deposit`, `finance.capacity`,
`grants.fhog`, `steps.0`, `prep.0.owner`): 48 bound paths, of which 7 resolve
on a real Investment row and none of those is content — the address in the
running foot and the letterhead on the disclaimer page. Two guards existed and
neither could see it: `refuseUnboundReconstruction` catches a static copy of
one client's report, and the route's empty-context guard catches an adapter
that published nothing. A template that binds the **wrong** vocabulary passed
both.

`templateBindingCoverage.pure.ts` measures it, against the data the adapter
actually built and never against a sample: every bound path — `{{…}}`
bindings, bare `dataPath` props, dotted paths in conditionals — is resolved
exactly as the renderer resolves it, and each page is classified by what it is
for (cover, closing, content, furniture). The decision the route acts on is
narrow on purpose: **`needsComposition` is true only when the template binds
content and none of it resolves.** A template that binds nothing is a brochure
and is drawn as designed; one that resolves even one content field is the
author's document and is drawn as designed, blank pages included — that is
their call, and the toast is the place to say so.

`templateComposition.pure.ts` is what happens instead of the empty document.
The chosen template is honoured as a **design**: its closing pages are kept,
its pages of static prose are kept, its pages that bind content and resolve
none of it are left out, and the report body is drawn from a **donor** — a
published template for the format that carries it — under the chosen
template's own tokens. Both kinds of template share one `TokensSchema`, which
is what makes the palette portable; a token the chosen template does not
declare falls back to the donor's, so a block naming `token:info` never prints
the literal. A kept label whose every binding is absent is blanked rather than
half-printed ("Prepared for" with nothing after it). The donor's pages are
never rewritten: their conditionals still decide what prints.

**The cover must speak for THIS report** (measured 16 Sep 2026). The first
composition kept the chosen cover unconditionally, and an Investment report
for 85 Bronze Street, Maryborough shipped with page 1 reading "FIRST HOME /
Your First Property" — static words the coverage measure cannot judge,
because text between bindings is invisible to it. That cover's only bindings
are `org.markMono` (the tenant's mark, which resolves on every report of
every format) and `client.name` (the addressee, which resolves on every
format prepared for that person), so nothing on it could ever say which
document it fronts. The rule (`coverNamesThisReport`): a chosen cover is kept
only where it resolves at least one binding outside the tenant (`org`,
`brand`) and addressee (`client`) namespaces — `report.title`,
`property.address`, a content field. A cover that cannot goes with the blank
pages, and the donor's cover **leads** the composed document under the merged
tokens — the choice still decides how page 1 looks; the record decides what
it says. `CompositionResult.coverFrom` records whose cover leads, and the
toast says so ("the cover and report body were drawn from … in your
template's palette").

The donor is found by `findBodyDonor` in the route: the ranking's own answer
first — except that `resolve_report_template` ranks a person's own templates
above the global masters, so the template that cannot carry the report is
often the ranking's pick too — then the published set, defaults and global
scope first, one schema at a time up to eight, preferring a template that
carries the format's narrative over one that merely resolves content. Where
none does, the route refuses `template_carries_no_content` and the standard
document is produced, said out loud like every other refusal.

Proved on the real engine: the First-Home Buyer Report composed over "Luxury
Editorial — Frontispiece · Midnight Editorial" for 291 Stone Mason Drive
renders 30 pages on WeasyPrint 69.0 — the chosen cover, the master's contents,
dashboard, financial pages and 22 narrative pages in the chosen gold-on-cream
palette, the method page, and the chosen disclaimer — where the same choice
had produced five. `templateComposition.spec.ts` pins the rules.
