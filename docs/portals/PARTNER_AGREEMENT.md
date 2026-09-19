# The Partner Portal Agreement

One agreement, three portals: Solicitor, Builder/Developer and Finance.

The **Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport
Agreement** binds "the Partner Organisation" — a solicitor's practice, a builder,
a finance partner alike. Read this before touching anything that presents terms,
records an acceptance, or adds a portal.

## The rule

**The document is data, not code.** It lives in `portal_terms_versions`, one row
per portal, and is rendered from `content_markdown`. No page restates it. A page
carrying its own copy of the words would eventually disagree with the version the
acceptance is recorded against, and the acceptance record would then name a
document nobody read. That is exactly what the Finance Portal did until
2026-08-07 — `buildTermsBody(brand)`, compiled into the bundle, with no version
and no hash.

**One row per portal, not one row shared.** Acceptance is an act by a named
person in a named portal; the audit trail has to say which. Each portal
therefore carries its own version, its own `document_hash` and its own
acceptance history — but the text is generated from the solicitor version rather
than retyped, and `20260901000700` asserts all three are byte-identical after it
runs.

## Where each piece lives

| Concern | File |
| --- | --- |
| The four mandatory acknowledgments (client) | `src/lib/portalAgreement.ts` |
| The four mandatory acknowledgments (server) | `supabase/functions/_shared/portalAgreement.ts` |
| The consent wall every portal renders | `src/components/portal/PortalAgreementConsent.tsx` |
| Solicitor page / Builder page / Finance gate | `src/pages/solicitor/SolicitorTerms.tsx`, `src/pages/builder/BuilderTerms.tsx`, `src/components/finance-portal/FinancePortalOnboardingGate.tsx` |
| Acceptance endpoints | `solicitor-portal-verify`, `builder-portal-verify` (via `builder_accept_current_terms`), `finance-portal-verify` |
| The published document | `supabase/migrations/20260901000600` (solicitor) and `20260901000700` (cascade) |

The two acknowledgment lists must agree. Changing a key in one without the other
locks every partner out of every portal — both files carry that note, and
`tests/cross-portal-contracts/partner-agreement-cascade.test.mjs` fails if they
diverge.

## Changing the agreement

Section 16 of the agreement sets the procedure, and the schema enforces it:

1. **A new version, never an edit.** Acceptances are keyed to a version id;
   rewriting a row restates what its signatories agreed to. Retire the old row.
2. **A new document hash.** `document_hash` is derived by trigger from
   `content_markdown` on every write — never supplied by the writer — so a
   published version cannot carry the hash of a different document.
3. **A fresh acceptance.** `has_accepted_current_terms` is derived per request by
   looking for an acceptance against the *current* version, in all three portals.
   Publishing re-gates everyone; that is the intent, not a side effect.
4. **Generate the new text, don't retype it.** Both existing amendments were
   produced by transforming the previous migration's `$md$` body with a script.

Removing a required acknowledgment is safe to ship in any order — an older bundle
sends more keys than are required and only the required ones are looked for.
Adding one is not: the pages must ship first.

## Acceptance is refused without the acknowledgments

Every `*-portal-verify` refuses an acceptance missing any required key
(`ACKNOWLEDGEMENTS_INCOMPLETE`, 400) and stores the asserted keys in
`portal_terms_acceptances.acknowledgements`. The tick boxes are not an interface
gate: each is a contractual statement — authority to bind, the section 37A
arrangement — and an acceptance recorded without them would claim assent nobody
gave.

A fifth acknowledgment, "Independent AML/CTF responsibility", was withdrawn by
the operator in version 2026-08-07. Only the tick box went: section 9 still puts
assessing, approving, recording and re-checking reliance on the Partner
Organisation, and section 7 still makes statutory reliance conditional.

## Deploying a change here

Three parts ship separately, and **merging is not deploying**:

- **Migrations** — nothing in this repo applies them. `supabase db push`, or ask.
- **Edge functions** — `deploy-supabase-functions.yml`, which is opt-in by the
  `SUPABASE_ACCESS_TOKEN` secret. Without it the workflow reports what it *would*
  deploy and goes green, which is how the acknowledgment gate sat unshipped for a
  day while the page in front of it was live.
- **The frontend** — the site build.

The safe order is migration → functions → frontend. A published version with no
way to store an acceptance gates a portal on an agreement nobody can accept.

## The executed copy

An acceptance row is a fact about a document; it is not the document. Every
acceptance can produce a **PDF of the agreement as executed** — the full text,
both parties named, the version and document hash, the acceptance timestamp, and
the acknowledgments that were asserted.

| Concern | File |
| --- | --- |
| The document itself (pure, no I/O) | `supabase/functions/_shared/partnerAgreementDocument.pure.ts` |
| List / download / save for the Command Centre | `supabase/functions/partner-agreement-records/index.ts` |
| The Command Centre section (all three tabs) | `src/components/admin/PartnerAgreementsPanel.tsx` |
| The row action on a portal user | `src/components/admin/useAgreementDownload.ts` |
| Columns, bucket and view | `supabase/migrations/20260901000900_partner_agreement_records.sql` |
| Render spec / artefact | `src/lib/reports/partnerAgreement/__tests__/render.spec.ts` |

**Generated on first download, then kept.** Not at acceptance: an acceptance
must never fail because a renderer is down, and every acceptance already taken —
including those from before this existed — must still be able to produce a copy.
The first request renders and stores; every later one serves the same bytes. The
object is written with `upsert: false`, so the copy a partner holds and the copy
the operator holds are the same document.

**Saved without waiting for a click.** "Retained" cannot mean "retained once a
staff user happened to open it". The Agreements section offers **Save N copies**
whenever a listed acceptance has no current artefact; `save_missing_copies`
renders them in one pass. It is bounded (`MAX_BATCH = 25`) and sequential on
purpose — a burst of renders from one click would take down the PDF service the
reports also use — and one unrenderable record is reported by id rather than
stopping the rest.

**The service reports which document it renders.** Merging is not deploying, and
in this repo that gap is not hypothetical — `deploy-supabase-functions.yml` is
opt-in by a `SUPABASE_ACCESS_TOKEN` secret that has never been set, so it reports
what it *would* deploy and exits green (PR #1981 makes that red). On 2026-08-08
the document was rebuilt on the design system, merged, shown green, and every
agreement downloaded from all three portals kept coming out in the previous
format, because the function rendering them was still the previous function.
Nothing anywhere said so.

The frontend ships on the site build, which *does* deploy. So
`AGREEMENT_DOCUMENT_REVISION` lives in its own dependency-free module
(`_shared/partnerAgreementRevision.pure.ts`, bridged into `src/`), the app
carries the revision it expects, and `list_records` and `download_record` both
report the revision the function is actually running. A function that reports
**no** revision is read as revision 1 rather than as "unknown, assume fine" —
that is exactly a pre-revision deployment. The Agreements section then shows a
banner, and the row action warns after the download, because that path never
calls `list_records` and is where a copy is most often supplied from.

**A revision is part of the path.** Write-once is what lets the Command Centre
say the bytes a partner holds are the bytes it holds — and it is also why
improving the document would otherwise reach only agreements executed after the
improvement, leaving two partners who ask on the same day with two
different-looking documents. So `AGREEMENT_DOCUMENT_REVISION` is encoded in the
object path (`builder/2026/<id>-r2.pdf`; revision 1 has no suffix, so copies
stored before this existed still resolve). A re-issue writes a **new** object and
repoints the acceptance; no stored object is ever replaced, and the row is
stamped with a compare-and-swap on the path it was read with. Bump the constant
when the presentation changes materially — `list_records` then reports those rows
as `copy_state: 'superseded'`, the panel shows **Earlier format**, and either
Download or **Save N copies** re-issues them. No migration is involved.

**Reachable from the row, not only from the tab.** The Agreements section is
where agreements are audited; it is not where a staff user is standing when a
partner rings and asks for their copy. **Download agreement** is therefore also
in the "…" menu of every portal-user row in all three tabs, through
`useAgreementDownload`. That path asks by *portal user*, because a row knows who
it is and not which acceptance is current — the server resolves the most recent
acceptance for that user, generates the copy if it does not exist yet, and mints
the same short-lived signed URL. A partner who has never accepted returns
`NO_AGREEMENT_ON_RECORD`, which the UI states plainly rather than surfacing a 404
or an empty PDF. Finance shows the item only for a contact that has a portal
account, since nothing else can have executed anything.

### It is set by the report design system

The document is composed from `reportDesign/` — the same stylesheet, page table,
primitives and palette roles as the ten migrated report formats. Nothing in
`partnerAgreementDocument.pure.ts` styles anything, and **there is not one
colour literal in it**; a test asserts that, and it is what keeps the file from
becoming a second design system.

The first version did carry its own `<style>` block, and a render showed what
that costs: a serif fallback where the container ships Inter, a section title
and a sub-clause set as the same object, an acknowledgment orphaned across a
page break, a 64-character hash running to the trim, and a hardcoded navy that
no tenant could change. Every one of those is a thing the shared sheet had
already solved for the reports.

The shape is: cover → contents → **Part 01, Parties and execution** (both
parties, the execution record, the acknowledgments as executed) → **Part 02, The
Agreement** (the full text, ending in the attestation and the two signature
blocks) → the closing company page.

Four decisions worth knowing before changing it:

- **The contents page numbers itself.** `target-counter(attr(href), page)`
  against the anchors the Markdown renderer puts on every heading, so a clause
  that moves takes its page number with it. Verified against the pinned engine.
- **Ragged right, not justified.** The one departure from the house defaults.
  The text is dense with unbreakable tokens (`AML/CTF`, `section 6-29`) and
  justification opens rivers around them.
- **Every field prints, whether or not it is populated.** A missing value is
  `Not recorded` in the muted ink rather than a dropped row, so two partners'
  copies are the same document with different values in it — not two different
  documents. The render spec asserts this against an empty record.
- **The closing page is earned.** For a tenant with no contact details and no
  disclaimer it would be a dark sheet carrying two lines, so it is omitted and
  the attestation ends the document. What is missing is reported through `gaps`.

`npx tsx scripts/reports/renderAll.mts --only partner-agreement` renders it,
measures every page and judges it beside the report formats. Its prose pages
measure 0.06–0.09 ink against a rubric floor of 0.08 calibrated on pages that
carry tables and figures — a full 34-line page of legal prose is simply less
inky than a page with a KPI strip on it. Read the page images, not the count.

**White-label.** The operator side is drawn from the Command Centre brand
snapshot — the tenant's colour, mark, company name and contact details, resolved
exactly as every report resolves them (`fetchReportBrandSnapshot`) — and
snapshotted onto the acceptance at generation, because branding is editable and
an executed agreement must keep saying what it said.

**Who can reach it.** `partner-agreements` is a private bucket with a
service-role policy and no `anon`/`authenticated` policy at all; the view is
granted to `service_role` only. A Command Centre user reaches a copy through
`partner-agreement-records`, which checks the admin module permission **of the
portal the record belongs to** — read from the record, never from the request —
before minting a 5-minute signed URL. Each download is written to
`security_audit_log`.
