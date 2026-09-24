# The Commercial & Industrial module: structure, deletion, clients and reports

Read this before touching `/commercial`, `/calculators`, anything under
`src/components/commercial/` or `src/lib/ciAssessment/`, or
`manage-ci-assessments`. It records the September 2026 audit: what the module
was, what it is now, the rules that keep it safe, and how its reports are
recorded, found and downloaded (§6). It supersedes
[`ANALYSIS_WORKSPACE.md`](./ANALYSIS_WORKSPACE.md), which describes the
standalone workspace this retired.

The one rule the rest of this depends on: **an assessment is one record with one
editor.** There is one way to start it, one ten-step workflow to complete it,
one place it records which building it concerns and one place it records which
client it is for.

## 1. What was wrong, measured at `2ebc652`

**Two editors over one record.** "Standalone calculators" on the landing opened
`/calculators`, a second workspace over the same `commercial_industrial_assessments`
rows. It listed the same assessments (`Untitled assessment · Draft`), created
more of them under another name (`Untitled analysis`), and edited them through
nine stages in a different order from the assessment's own steps. Nothing told
a user which editor they were supposed to be in. The only things it could do
that the assessment could not were the valuation (`capRateEngine`), the forecast
(`dcfEngine`), and starting from a register property.

**Four ways to start, every one of them creating a record on the click.** These
were the header's "New assessment" (`Untitled assessment`), ten "Start from a
transaction type" buttons under the list, the workspace's "New analysis", and a
property page's "Send to Calculators". The last two created `Untitled analysis`,
and "Send to Calculators" did so on arrival. Nothing could delete any of them, so
every click that went no further left a permanent draft behind.

**No record of the building.** "Send to Calculators" held the register property
in memory (`CalculatorPrefillContext`). "Fill from property" filled blanks from
it on request, but the assessment stored no reference to the register row. So no
property page could say what had been assessed on it, and a refresh lost the
connection.

**Client handling, seven faults.**

- The intake step's "Create a new client" opened the client list in a **new
  browser tab**. The client was created with no assessment context, and the
  adviser had to find the same person again at the final step.
- Search matched the whole term against each column, so "Marcus Chen" matched
  nobody, and a mobile number could not be searched at all.
- `create_client` accepted a single name and wrote `null` into the other. Both
  columns are `NOT NULL`, so the create failed as an opaque 500 after the form
  had accepted it.
- The duplicate-email check used `ilike`, where `_` is a wildcard, so a near-miss
  could block a genuine new client. It also told the operator to "search for
  them instead" even when the existing client was outside their search scope,
  which is a dead end.
- Relinking through the API left the previous link row open, so the history
  showed one assessment linked to two clients at once.
- Unlinking an archived assessment wrote `completed` while `archived_at` was
  still set.
- Restoring from the archive set `draft` for every unlinked assessment. A
  completed assessment archived and restored the same afternoon came back as a
  draft, its report would no longer generate, and nothing said why.

**The reconciliation step promised a write that never happened.** It offered
"Update the client record" and said items "will be recorded against the client
record". What it actually does is record the choice on the link. Nothing writes
to the client record (§5).

**The Type step did not file the record.** `assessment_type` and `segment` were
written once, at creation. Changing "Commercial investment" to "Industrial
investment" left the assessment filtered and counted as commercial.

**A version conflict could never be recognised.** `unwrap` in
`useCiAssessments` returned only the message on a non-2xx and dropped the code.
`VERSION_CONFLICT` therefore never matched, and an edit made in another tab
surfaced as "Save failed" with no Reload offered.

**Add tenancy and saved DCF runs could not save.** `commercial_leases` and
`commercial_dcf_runs` carry both a `NOT NULL user_id` and a `NOT NULL
property_id`. `manage-commercial-data` filed them as user-owned, set only
`user_id`, and dropped `property_id` (which the allow-list deliberately refuses
from the body). The insert failed on the missing column.
`_shared/commercialOwnership.pure.ts` records this.

## 2. The structure now

### The landing (`/commercial`, also served at `/industrial`)

| Tab | Holds |
| --- | --- |
| **Assessments** | The working list. **New assessment**, in the header or on an empty list, creates the draft and opens it on its Type step. |
| **Property register** | Commercial and industrial buildings as one list. Each row can start **New assessment of …** that building, the same way. Was "Properties". |
| Portfolio impact | Unchanged. |
| Reports | Generate from a completed assessment, and the template choice. Unchanged (§6). |
| **Policy defaults** | The assessment policy settings. Was "Calculator settings", a name left over from the retired suite. |

### One way in: New assessment creates the draft and opens its Type step

**New assessment** creates the draft on the click and opens it on step 1, the
Type step. That step asks the two questions every assessment starts with, its
name and its transaction type, at its top. There is nothing to confirm first.
Every button that starts an assessment is the one action, `useStartAssessment`:
the landing's header and its empty list, a register row, and a building's own
page (its header and its **Assessments** panel).

- **The name.** The server refuses an empty name, so a draft nobody has named is
  stored as `Untitled assessment` (`UNTITLED_ASSESSMENT`). The Type step shows
  that as an EMPTY field with its placeholder (`isUntitled`), because it is the
  list's word for the draft and not text anybody should have to delete. An
  empty name is never sent: a pause with the field empty commits nothing, and
  leaving it empty puts back what it showed.
- **The type** starts as a commercial investment, or as an industrial investment
  for an industrial building (`startingType`), until the Type step is answered.
- **Started from a building**, the draft carries it from the first moment. The
  building is read on its own (`readRegisterProperty`). Its figures fill the
  assessment's blanks and never overwrite (`applyRegisterProperty`, over the
  existing `applyPropertyPrefill`), the link is stored on the record, and the
  draft is named after the building (`defaultTitle`). **A building that cannot
  be read creates nothing**: the click asked for an assessment OF it, and one
  silently without it is a different thing.
- **One start at a time.** A second click while the first is creating makes
  nothing, so a double-click cannot mint two drafts. The button pressed shows
  that it is working.
- **The client** is chosen inside the assessment: created on the intake step, or
  linked on the final step, existing or new (§5).

**A link never creates a record.** A refresh, the Back button and every
bookmark follow a link again, so a link that created would create each time.
Old links therefore land where one click does: `?new=assessment&domain=…&propertyId=…`
(read by `readNewAssessmentLink`) and every `/calculators` link that named a
property (§4) go to that building's own page (`registerPropertyPath`), and a
`?new=assessment` naming no building is simply the list. The request is
replaced, so Back does not bring it round again.

**Why the click creates again.** For a while a dialog asked the name, the type,
the building and the client first, and created nothing until it was
confirmed. It existed because every click that went no further used to leave
an "Untitled assessment" behind that nobody could delete. It answered the wrong
half of that. A draft can be deleted now (§3: one plain confirmation for an
untouched draft), and the dialog asked, before the work began, the very
questions the Type step asks at its start. The one thing it offered that the
assessment does not is choosing an EXISTING client before completion (§5).

### The workflow: the ten steps, unchanged, plus one optional step

| # | Requested stage | Step key | Label |
| --- | --- | --- | --- |
| 1 | Property Type | `type` | Type |
| 2 | Intake Pack | `pack` | Intake pack |
| 3 | Property Transaction | `property` | Property & transaction |
| 4 | Ownership | `ownership` | Ownership |
| 5 | Income | `income` | Income |
| 6 | Portfolio | `portfolio` | Portfolio |
| 7 | Lease Income | `lease` | Lease income |
| 8 | Loan Structure | `loan` | Loan structure |
| — | *(new, optional)* | `analysis` | **Valuation & forecast** |
| 9 | Results | `results` | Results |
| 10 | Save Link | `link` | Save & link |

The ten established steps keep their keys, fields, engine (`runAssessment`),
validation and payload sections. What changed inside them is additive:

- the Property step can link a register property;
- the intake step creates a client in a dialog instead of a new tab;
- Save & link opens with the intended client selected.

**Valuation & forecast** is the retired workspace's only unique capability,
moved into the assessment. It reuses `ValuationStage`, `ForecastStage` and `runAnalysis`
unchanged. It is labelled optional, validation does not require it, and the
Results rail shows its figures in an Investment block when there are any. Its
data is the existing `AssessmentPayload.analysis` section, read through
`analysisOf()`. An assessment written before the section existed opens with
defaults, and autosave never writes assumptions nobody chose (see
`ANALYSIS_WORKSPACE.md` §3–4, which remains correct on the units).

`commercialModule.test.tsx` asserts the step order.

### The building: recorded on the assessment

The register link lives at `payload.property.registerProperty`
(`registerLink.pure.ts`): `{ domain, propertyId, label, linkedAt }`. It sits
inside the `property` section because `hydrateAssessmentPayload` spreads each
section but drops unknown top-level keys, so a top-level key would be erased by
the first autosave. The link is written by:

- New assessment, started from a building (`useStartAssessment`);
- the Property step's **Is this a property in your register?** panel
  (`RegisterPropertyPanel`), which links, re-links or unlinks, and fills blanks
  only.

It is read by `list` with a `propertyId` filter (a JSON-path equality on the
link, UUID-checked). That filter feeds the **Assessments** tab on both property
detail pages (`PropertyAssessmentsPanel`). The relationship is read from the
other end; no property row stores anything.

## 3. Deleting an assessment

`deletion.pure.ts` is the rule and `manage-ci-assessments` enforces it. The
dialog (`DeleteAssessmentDialog`) renders what the server decided and never
decides for itself. Delete is offered in two places:

- each list row's **More actions** menu, beside Archive;
- the assessment's own **More actions** menu, in its header.

From 768px up, the list's actions column is pinned to the right edge
(`.ci-sticky-actions`). The table is wider than its pane at common laptop
widths: measured at 1,339px of table in a 1,116px pane at 1440px with the
sidebar open. Without the pin, every row action, Delete included, started
off-screen.

**What deleting removes.** The assessment, with its calculation runs,
scenarios, client-link history and audit trail. The database cascades all four
(`ON DELETE CASCADE`). Nothing outside the assessment is touched: no client
record, no register property (which stores nothing about it) and no document.

**When it is refused.** The reason is stated and **Archive instead** is offered,
checked in this order:

| Block | Why the assessment is kept |
| --- | --- |
| `linked_to_client` | It is part of that client's Commercial / Industrial file. |
| `client_history` | It was linked before. The link history records what it wrote to the client's record, and deleting would erase that. |
| `report_issued` | A report succeeded in either ledger. The document is evidence of what a client or lender was told. |
| `report_in_progress` | A render is `running` and younger than 15 minutes. The answer is *wait*, so archiving is not offered. |
| `report_requested` | Any row in the capacity-report ledger, including failures. Its foreign key is `ON DELETE RESTRICT`, and a render row's `storage_path` is written *before* the upload, so a failed row cannot prove no file was stored. |

Two ledgers are read, and that is load-bearing:

- `commercial_industrial_report_renders` (the direct route), whose foreign key
  would refuse the delete anyway;
- `template_render_jobs` (`mode = 'final'`, `metadata->>report_id` = the
  assessment), which has **no foreign key at all**. A document drawn through a
  report template is recorded only there, so nothing else would notice it.

A ledger table that does not exist on a deployment is read as empty. Any other
read error is a 500, which is a refusal.

**Confirmation is sized to what is at stake.** A draft is usually a stray click,
so one explicit, destructive **Delete permanently** button is enough. A
`completed` or `linked` assessment needs its reference typed back
(`deletionNeedsTypedConfirmation`). The server checks the typed reference too.

**Who may delete.** Assessments are owner-scoped, and every operation reads
through `loadOwned`, so nobody can delete somebody else's. On top of ownership:

- where an administrator manages permissions for the `commercial` module,
  delete needs `can_delete` (superadmins pass);
- where the deployment manages none (`module_not_registered`), the owner may
  delete their own, exactly as they may already archive them;
- a permission lookup that throws is a refusal.

`useMayOfferAssessmentDelete` hides the action only where it is known to be
refused.

**Races.** The delete is scoped by `version` as well as by owner, so an
assessment that changed between the check and the statement is not deleted
(`VERSION_CONFLICT`). A render that starts after the check trips the ledger's
`RESTRICT` (`23001`/`23503`), and that is reported as the refusal it is. The
workspace saves any pending autosave before it asks.

**What is recorded.** Nothing survives in the database by design: the
assessment's own audit trail is deleted with it, and `activity_logs` has no
action type for it (§8). The act is logged by the function (reference, status,
counts, who, when). Everything deletable is, by construction, a draft that never
reached a client or a document.

**Archive and restore.** Archive records the status held before archiving on the
`assessment_archived` event, and restore returns to it (`statusAfterRestore`).
A recorded `linked` whose client has gone comes back as `completed` or
`data_entry`. A `completed` with no calculation comes back as `data_entry`.

## 4. The retired `/calculators` routes

`/calculators`, `/commercial/calculators` and `/industrial/calculators` are
redirects (`legacyCalculatorRedirect`). They stay behind the same
`ModuleGuard`, and none of them creates anything:

| Arrival | Lands on |
| --- | --- |
| `?workspace=<id>[&stage=<s>]` | That assessment, at the step that now holds the stage's fields (`valuation`/`forecast` → Valuation & forecast, `income` → Lease income, `lending` → Loan structure, `report` → Results, …). |
| `?propertyId=<id>[&domain=<d>]` | That building's own page (`registerPropertyPath`), whose **New assessment** starts one of it. The link itself creates nothing. |
| anything else | The assessment list. |

`/calculators/classic`, the pre-workspace suite, is a separate route. It is
untouched and unlinked.

## 5. Clients

**Intent and link are different facts.** The client an assessment is *for* can
be known long before it is linked: created from the intake step, or, for an
assessment started while the New assessment dialog existed, chosen there. That
intent is an audit event (`client_created` or `client_intended`) and never a
link. `intended_client` returns the latest one. Nothing writes
`client_intended` any more. The server still accepts `intendedClientId` on
`create`, and the dialog was its only caller. An existing client is linked on
the final step.
The workspace header says "For Marcus Chen (not linked yet)", the intake pack
shows who it is being prepared for, and the Save & link step opens with that
client already selected. **Only `link_client` writes a link**, on the final
step, after reconciliation. A client can therefore never be attached to an
unfinished assessment by accident, and the adviser never has to find the same
person twice.

**Creating a client happens inside the workflow**, on the intake step (in a
dialog) or on the final step, through the same `ClientCreateForm`:

- **Both names are required**, because `clients` stores both as `NOT NULL`.
- **Possible matches are offered while typing** (by email once it looks like one,
  otherwise by name), and **Use this client** is offered wherever an existing
  record can be used from that step.
- **An email already in the book is a duplicate whoever it belongs to.** The
  database narrows the candidates and `sameEmail` decides, so a near-miss never
  blocks. The existing record is named only to a caller who can reach it. Anyone
  else is told to ask an administrator to assign them, never to search for
  somebody their search cannot show.

**Search is by word** (`clientRecords.pure.ts`). Every word must match a name
or the email, and different words may match different fields, so "Marcus Chen"
finds Marcus Chen. A single word of four or more digits is also tried against
the mobile. A term that is a phone number is one search instead: six or more
digits, matched in order against the mobile whatever spacing it was stored
with, so "0412 345 678" finds `0412345678`. Every word passes through
`filterSafeWord`, so a term cannot add a PostgREST condition of its own.

**Linking.** Relinking closes whatever link row is open before opening the new
one. Unlinking an archived assessment is refused ("Restore it first"). The link
row survives an unlink as history; it is closed, not erased.

**Reconciliation records a decision. It does not write the client record.** The
final step compares the assessment's borrower details with the client record and
asks what should happen to each difference. The choices are stored on the link
and the copy now says exactly that. **No code writes the reconciled values to
the client record** (§8).

### The relationships

```
                  intent (audit event)                link (only on Save & link)
   client  <- - - - - - - - - - - - -  assessment  ------------------------->  client
                                         |    ^
         payload.property.registerProperty    | report ledgers (renders, template jobs)
                                         v    |
                          register property   report (PDF)
```

- **Client ↔ assessment.** One current link, a closed link history, and an
  intent that is only a statement of purpose.
- **Property ↔ assessment.** The link is on the assessment. The property page
  lists its assessments by querying for that link.
- **Assessment ↔ report.** A report is rendered from the assessment's saved
  calculation run and recorded in one of two ledgers. It is not linked to the
  client directly (§6, G7).

## 6. Reports: one record per document, one reader, and where each is found

The first pass of this work changed nothing in report generation and recorded
nine gaps (G1–G9) for the reporting workstream. They are closed here. The two
that were decisions (G6, G7) are taken and stated below. The render paths
themselves — the document, the engine, the template picker — are unchanged.

### Two routes, two ledgers, one reader

A Capacity Report is drawn one of two ways, and each route records what it
drew in its own ledger:

| Route | Ledger | Bucket |
| --- | --- | --- |
| `render-commercial-capacity-pdf` | `commercial_industrial_report_renders` | `client-files` |
| a report template, through `render-template-pdf` | `template_render_jobs` (`mode = 'final'`, the assessment in `metadata.report_id`) | `investment-reports` |

`useCapacityReport` tries the template route first, so wherever a template is
active most documents were in the second ledger, and every reader of the first
missed them (G4). The fix is not to copy one ledger into the other.
`report_render_coverage` counts both tables, so a copy would count every
templated document twice. Each document is recorded once, where it was drawn,
and `_shared/ciAssessments/documents.pure.ts` is the one place that reads the
two as a single list. Every surface below goes through it.

Two rules there matter:

- **A template job counts only if the assessment's owner requested it.**
  `render-template-pdf` accepts HTML and a report id from any signed-in user,
  so a job naming an assessment proves only that somebody sent its id. The
  adapter that draws this format reads the assessment through its owner-scoped
  `get`, so a genuine job is the owner's (`isGenuineTemplateJob`).
- **A render still `running` after 15 minutes "did not finish".** The window is
  the delete rule's own, imported rather than restated, so the Documents panel
  and the delete dialog cannot disagree.

### Every attempt leaves a row (G9)

`render-commercial-capacity-pdf` now writes its row straight after the
refusals, before the model call, the brand, the document build and the engine.
A failure in any of them is recorded with its reason. If the row cannot be
written, the render stops: a document that exists in no ledger can never be
listed, downloaded again or accounted for. The WeasyPrint configuration check
moved to just after the record, so "the report never arrived" has an answer on
a misconfigured deployment too. The analysis and brand facts are written on the
final update, whether it succeeded or failed.

A refusal (not found, not completed, no calculation run) still writes nothing,
deliberately. It is an answer to the caller rather than an attempt, and an
assessment that is not the caller's must not gain a row about it.

One consequence is deliberate. The ledger holds its rows with
`ON DELETE RESTRICT`, so an assessment with any recorded attempt is archived
rather than deleted (§3's `report_requested`). That rule already applied to a
render that failed at the engine. It now also applies to one that failed
earlier, including on a deployment with no WeasyPrint configured. A request is
a record whether or not a document came of it, and archiving can be undone.

The template route now gets its `report_generated` audit event too.
`useCapacityReport` reports the stored path, and `record_template_document`
checks it against the template ledger before writing anything: it must be a
finished final render of this assessment, requested by its owner. The event is
written once per job. A document the browser drew as a stand-in while the print
engine was down was never stored, so there is nothing to record or download
again; the notice at the time says so.

### Downloading again (G2)

`document_url` on `manage-ci-assessments` signs a five-minute link to the file
stored when the document was produced. Nothing is re-rendered: a second render
reads today's brand and today's analysis, so it would not be the document the
client was sent.

It does not go through `secure-storage`, and no storage binding is written.
None of this product's rendered reports writes one. A binding would also open
a second read path beside this module's, with a different rule (the client's
creator, or a finance assignment). One document, one rule.

### Where a document is found

- **The assessment (G3, G8).** The Results step has a Documents panel listing
  every document from both routes. Each shows its state, route and page count,
  the reason if it failed, and Download once it is finished. Beneath it,
  Activity shows the assessment's audit trail in words, which no screen showed
  before. An event type it does not know reads "Change recorded", never its
  database name.
- **The client's Commercial / Industrial tab (G7).** This lists the documents
  drawn FOR this client. Renders carry no client, and reading them through the
  current link moved a client's history to whichever client an assessment was
  relinked to, while each PDF still names the first. The link history already
  says who a document belonged to: the client whose link was open when it was
  drawn (`clientLinkedAt`), or nobody when none was. An assessment linked here
  once still contributes what was drawn while it was.
- **The client's Reports tab (G5).** Commercial & Industrial is a new kind,
  added as a sixth source after the five so no existing row moves.
  - It downloads through `document_url`.
  - It is not offered for the portal, which has no route to the file. Its
    publish verdict says so, where a missing file reference would otherwise
    have produced "nothing has been generated".
  - Generated PDFs are deliberately not added to the Files tab. That tab lists
    uploads with a Delete beside each one, and these files are evidence.
- **Generated Reports (G1).** A Commercial & Industrial tab, gated on the
  module the way the Comparisons tab is gated on its capability. The tab, its
  read and the `?tab=commercial` deep link go together.
  - A capability still loading resolves to `enabled: false`, and the
    resolver's own contract is that this is "a skeleton, not a denial". The
    deep link and the open tab are taken away only once the capability is
    decided; otherwise a bookmark opened while permissions load lands on
    Investment every time. The `?tab=comparisons` redirect beside it had the
    same fault and has the same guard.
  - A third tab card does not fit three to a row at every width the page
    gets: the sidebar takes 16rem from 768px up. So three cards wrap as many
    to a row as fit and their text wraps inside them. Measured, all three sit
    on one row from a 1280px screen up, and none clips its text at any width.
    One or two tabs render exactly as before. On a phone the tabs are a strip
    that scrolls sideways, so the strip brings the open tab into view.
  - It lists the documents from the caller's own assessments.
  - It names the client each was drawn for, where the caller may still reach
    that client, and opens the assessment.
  - It is its own tab over its own reader. Pushed through the investment
    pipeline, these rows would be read and grouped as Compass reports
    (`normalizeReportVariant`).

### Who may do what (G6)

- **Generating a report stays with the assessment's owner**, and so does
  opening the assessment. On the client tab both are offered only on the
  caller's own assessments. On a colleague's, the cell says "Another adviser's
  assessment" instead of offering buttons the server would answer "not found".
- **Downloading follows the client.** Anyone who may see a client may download
  what was issued to that client, the rule `client_workspace` already applied
  to listing it. Only a document drawn while the assessment was linked to that
  client qualifies (`mayReadDocument`). Anything else gets exactly the answer a
  document that does not exist would.

### What `client_workspace` still sends

The response still carries `renders`, the direct route's rows for the
assessments linked now. This frontend no longer reads it; it is kept because a
frontend published before this server still does. `documents` is the field to
read. Remove `renders` once no deployment serves the older frontend.

### Not done here

- A C&I report cannot be published to the client portal. Whether it should,
  and through which path, is a product decision.
- Generated Reports lists only the caller's own documents, the rule every list
  in this module follows. A team-wide view would need a new access rule.

## 7. How this reaches the clones

This is the prime. Aurixa Mission Control cascades changed files from here to
each clone as a pull request: to `npc-client-dashboard` directly and on to its
own children through it. On the same cascade it deploys the Edge Functions
into each clone's Supabase project. The lineage is in
[`CLONE_PROVISIONING_GAPS.md`](../operations/CLONE_PROVISIONING_GAPS.md),
"Which deployment a clone receives from". Four things follow for this work:

- **It is new modules wherever it could be.** They include
  `_shared/ciAssessments/*.pure.ts`, `_shared/commercialOwnership.pure.ts`,
  `lib/ciAssessment/{assessmentManagement,registerProperty,newAssessment,legacyCalculatorLinks,clientRecords,assessmentDeletion}.ts`
  and the new components. New files travel on a cascade like changed ones.
- **No file was deleted or renamed.** A clone can carry code of its own, so a
  change that reaches every clone deletes nothing a clone's own code might
  still import. The retired workspace's modules stay in place, unreferenced
  (§8), for a separate clean-up.
- **No migration is added.** Nothing here changes a table, so a cascade has
  nothing to apply to a clone's database. `manage-ci-assessments` and
  `manage-commercial-data` changed, and a frontend that calls the new
  operations before its server is redeployed is answered "Unknown operation",
  which every caller reports as an ordinary error.
- **A spec that reads `src/App.tsx` does not travel.** Every clone carries its
  own `App.tsx`, so the cascade holds it back, and it holds back any spec that
  reads it too: a spec and its subject travel together or not at all. A held
  spec keeps the clone's old copy. The first cascade of this work
  (`npc-client-dashboard` #236, 23 Sep 2026) carried the new redirect page and
  held its spec, because one test in it read `App.tsx`. The client was left
  running the retired workspace's spec against the redirect, and all 11 of its
  tests failed. Nothing reported it, because that repository's CI runs no
  `src/pages/calculators` tests. The redirect spec now reads only the page it
  tests. The route guard it was checking was already pinned by
  `lib/navigation/__tests__/registry.spec.ts`.

## 8. Found along the way and not fixed here

- **Reconciliation write-back.** The final step records what should change on
  the client record and changes nothing. Whether it *should* write, and with
  what audit, is a decision about the client record. The copy is truthful in the
  meantime.
- **`activity_logs` action types that do not exist.** `action_type` is the
  Postgres enum `activity_action_type`, but the CI gate checks
  `entity_type` only (`check-activity-entity-types.mjs`).
  `update-integration-secret` writes `action_type: 'update'` and `aml-cases`
  writes `'aml_client_journey_purged'`. **No migration in this repository
  declares either value**, so both writes are refused at runtime (`22P02`).
  `recordActivity` logs the failure, and the row is not written. The same enum
  has no value for "assessment deleted", which is why §3 logs to the function
  log.
- **Modules retained with no importer.** These are
  `components/commercial/workspace/{ContextStage,ReportDeliveryStage,WorkspaceResultsRail,workspaceStages}`,
  `lib/ciAssessment/workspaceBootstrap.ts` (still imported by two specs) and
  `pages/industrial/IndustrialProperties.tsx` (not routed; its "Calculators"
  button points at `/calculators`, which now redirects). `ValuationStage` and
  `ForecastStage` are live, used by the Valuation & forecast step. Delete the
  rest in a change of their own (§7).
- **`/calculators/classic`** still serves the pre-workspace suite, unlinked.
  Retire it with its engines' last callers.

## 9. What pins this

| Spec | Pins |
| --- | --- |
| `lib/ciAssessment/__tests__/assessmentDeletion.test.ts` | Every block, its order, the in-flight window, typed confirmation, restore. |
| `lib/ciAssessment/__tests__/clientRecords.test.ts` | Word search, filter safety, email sameness, the new-client rules. |
| `lib/ciAssessment/__tests__/registerProperty.test.ts` | Where the link lives, that hydration keeps it, prefill fills blanks only. |
| `lib/ciAssessment/__tests__/legacyCalculatorLinks.test.ts` | Every old link shape: a property link lands on the building's page and never creates; reading the links already out there. |
| `lib/ciAssessment/__tests__/newAssessment.test.ts` | Default names, the placeholder name told from a real one, the starting type, segment filing, the create plan. |
| `components/commercial/assessment/__tests__/useStartAssessment.test.tsx` | New assessment creates one draft on the click and opens the Type step; from a building, read from its own register and carried; an unreadable building creates nothing; a double-click makes one draft; a failed create opens nothing. |
| `components/commercial/assessment/__tests__/assessmentRename.test.tsx` | The name field, including an unnamed draft shown as an empty field and an empty name never sent. |
| `lib/__tests__/commercialOwnership.test.ts` | Leases and DCF runs get both ownership columns. |
| `components/commercial/assessment/__tests__/assessmentManagement.test.tsx` | The delete dialog's every answer. |
| `components/commercial/assessment/__tests__/clientCreateAndLink.test.tsx` | Creating, matching and linking a client. |
| `pages/calculators/__tests__/commercialIndustrialWorkspace.test.tsx` | The redirects, as the router renders them. It reads no other file, so it can travel to the clones (§7). |
| `lib/navigation/__tests__/registry.spec.ts` | The module guard on every C&I route, the retired `/calculators` routes included. Pre-existing. |
| `pages/commercial/__tests__/commercialModule.test.tsx` | The landing: New assessment from the header, the empty list and a register row opens the Type step with no dialog, and an old link creates nothing. The step order, the optional step, in-app client creation, archive/delete with the record, the Results step's Documents panel. |
| `lib/ciAssessment/__tests__/issuedDocuments.test.ts` | Both ledgers as one list; the client a document belongs to, through a relink; the did-not-finish window is the delete rule's; the buckets the two render functions actually write to. |
| `lib/ciAssessment/__tests__/documentDownload.test.ts` | A re-download is the stored file, never a re-render, sent through the client it was reached from. |
| `lib/ciAssessment/__tests__/assessmentActivity.test.ts` | A phrase for every audit event the functions write, read from their source; no database name ever reaches the page. |
| `hooks/__tests__/useCapacityReportDocuments.test.tsx` | The template route's audit event (and none for a browser stand-in); the end of every render announced, failures included. |
| `components/clients/__tests__/clientCommercialIndustrialTab.test.tsx` | The documents drawn for this client, downloaded through it; generating and opening only on the caller's own assessments. |
| `lib/reports/__tests__/clientReportInventoryCommercial.spec.ts` | The Reports tab's sixth source, appended after the five; not offered for the portal, and why. |
| `components/reports/library/__tests__/commercialDocumentsPanel.test.tsx` | Generated Reports' C&I tab in every state; the tab only with the module; on a phone, the open tab is brought into view by scrolling the tab strip, never the page. |
| `lib/entitlements/__tests__/gatingContracts.spec.ts` | The C&I tab, its read and its deep link gated on the module; the Reports tab's read too; a capability still loading takes nothing away, on this tab or on Comparisons. |
