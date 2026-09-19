# Templates, not agreements

> Read this before adding anything to `_shared/agreements/`, before restoring
> a deleted module from history, and before wiring an agreement into referrals,
> commissions or compliance. `agreementTemplatesOnly.spec.ts` enforces it.

## The decision

The platform used to run the whole formation of a partner referral/commission
agreement between two independent businesses:

| Stage | What the platform did |
| --- | --- |
| Draft | a guided wizard over a locked template |
| Internal review | approve / return, recorded |
| Issue | froze a version, stored a PDF, put it in the partner's portal |
| Review | partner accepted, or pinned change requests to clauses |
| Amend | issuer answered in place and reissued |
| Execute | typed signature from both sides, IP and user-agent hashed |
| After | executed master stored, status tracked, both portals synchronised |

**That has been retired.** Facilitating, recording and stepping through the
formation of a contract between two other parties made the platform look like a
participant in — and arguably a party to, or a service provider warranting — a
commercial relationship it has no part in. The instruments are real ones under
Australian credit law: licence and credit representative numbers, aggregator
terms, AML/CTF obligations. The platform is not in a position to stand behind
any of it.

What replaces it is narrow and deliberate: **the two templates remain as
optional resources either party may download, adapt and use — or ignore.**

## The rule

> Downloading a template is the end of the platform's involvement.

Nothing is issued, accepted, executed or tracked. Nothing is stored about
whether two parties reached an agreement. The wording that says so lives in
`_shared/agreements/templateResource.pure.ts` and is rendered from there by
every surface, so the Command Centre and the Finance Portal cannot come to say
different things about what a download means.

## What that looks like in the architecture

**One component, both portals.** `AgreementTemplateResources` is rendered by
the Command Centre page and by the Finance Portal dashboard. Two
implementations would drift, and the first thing to drift would be how firmly
each side is told the platform is not involved.

**The document is the author's file, shipped unchanged.** See
[the section below](#the-document-is-a-file-not-a-render) — this is the part
that changed most recently, and the reasoning is worth reading before touching
`templateFiles.pure.ts` or the download.

**No request an application records.** `templateDownloads.ts` fetches a static
path under `/templates/finance-portal/`. No Edge Function is invoked and
nothing is written, so there is no record that a template was taken, by whom,
or for which partner — the platform cannot report on something it never
observed. Stated precisely rather than over-claimed: fetching a static file is
a request to the origin, the same as loading an image on the page. What is true
is that nothing in the application's own record names who took it.

**No brand on either copy.** Neither portal stamps the tenant's colour or mark.
The supplied cover is built around a `<<COMPANY NAME>>` placeholder — its
author's intent is that whoever uses it fills their own name in, in Word — and
a blank template carrying one side's identity reads as that side's prepared
offer rather than a neutral starting point. Both portals therefore hand over
byte-identical files. (The Command Centre used to apply the tenant's brand; it
no longer does, because the branded copy and the supplied copy were two
different-looking documents claiming to be the same template.)

**The document no longer claims the platform.** `documentHtml.pure.ts` used to
print *"Generated securely through Aurixa Systems"* behind a
`showPlatformAttribution` flag. The flag is now inert.

## The document is a file, not a render

These two instruments existed in this repository **three times**, and no reader
could tell which one a download would give them:

| Where | How | State when this was found |
| --- | --- | --- |
| `scripts/finance-portal-templates/build_*.py` → `public/templates/finance-portal/Aurixa_*.docx` | Python builders | Superseded. Still carried the `REFERRAL WORKFLOW` section the document owner **withdrew** on 9 Aug, under the old clause numbering, labelled "Version 3.0". Nothing in the UI linked to it. |
| `src/lib/agreements/docx.ts` + the content modules | browser renderer | What the desk served. Correct wording, this codebase's typesetting. |
| The documents their author maintains | authored externally | Not in the repository at all. |

That is how "the template keeps reverting to the old version" happens, and it
happened repeatedly. **The author's file is now the artefact**, at
`public/templates/finance-portal/`, declared in
`_shared/agreements/templateFiles.pure.ts`. The other two are deleted rather
than dormant: a dormant generator is one `npm run` away from writing a second,
staler document beside the real one, and `agreementTemplatesOnly.spec.ts` and
`verify_templates.py` both fail if one comes back.

Re-typesetting a legal instrument on every download was the wrong shape. A
presentation choice made in this codebase is a change to a document two
businesses are going to sign, and the person who owns that document has already
made those choices.

### What holds the wording to account instead

The locked content modules did not become decoration — they became the
**specification**. `agreementTemplateFiles.spec.ts` opens each shipped `.docx`
and asserts that every subclause, section heading, note and responsibility
bullet the modules define is present verbatim, with each `{{field}}` resolved
to the bracket text an unfilled template prints. When the documents in this
change were installed, that check passed on all 88 subclauses, 25 section
headings, 23 notes and 20 bullets across the two files.

That is stronger than rendering was. A renderer can only be as right as its own
content; this reads the artefact a partner will actually open. The same suite
also checks the package is one Word can open (required parts, no dangling
relationship or undefined style), that byte length and SHA-256 match the
manifest, and that no tenant identity appears anywhere in the package —
including `docProps`, which a renderer never wrote and which is where Word puts
the author's name.

### Replacing a document

1. Drop the new file in over the old one, same name.
2. Update `byteLength` and `sha256` in `templateFiles.pure.ts`
   (`sha256sum public/templates/finance-portal/<file>`).
3. Run `npx vitest run src/lib/agreements/__tests__/`.

What it reports missing is wording the reviewed template had and the new file
does not. If the new document deliberately drops a clause, the content module
is what has to change first — that is the review step, and it is a diff a
person can read.

### What the desk shows

Each card lists the document's sections — badge, heading, and what the section
covers — read from the same modules the shipped file is checked against, so the
page cannot describe a document different from the one it hands over. The pages
the template itself says to delete before issue are marked as such. Version and
file size are shown before the button, because a download should hold no
surprises.

## What was removed

Three Edge Functions — `manage-partner-agreements`, `finance-portal-agreements`
and `agreement-centre-render` — with their `config.toml` declarations and
registry entries. Eleven shared modules: the lifecycle state machine, partner
access, recipients, annotations, the sync cursor, the portal receipt, document
revisions, the renderer, the issue email, the activation delivery sweep and the
anchor probe. On the client: the register, the wizard, the detail workspace,
the legacy register, the partner inbox, the agreement room, the action card and
their hooks.

Then, when the download became the shipped file: the browser DOCX renderer
(`src/lib/agreements/docx.ts`, `docxTheme.ts`) and its two specs, the two
Python agreement builders and `docx_kit.py`, the orphaned
`TemplateLibraryDialog`, and `docs/portals/AGREEMENT_CENTRE.md` — 194 lines
describing the retired lifecycle as though it were live.

Ten template modules remain, and the spec asserts that list exactly. Three of
them — `documentHtml.pure.ts`, `contentOverrides.pure.ts` and
`additionalClauses.pure.ts` — no longer have a production caller: the first was
the PDF renderer, the other two applied a negotiated amendment before a render.
They are kept because deleting them is a separate decision from integrating a
document, and because the amendment model is the part of the retirement that
would be hardest to reconstruct. Nothing calls them; do not assume they work.

## What was deliberately NOT removed

**The data.** `partner_agreements` and its five companion tables still hold 6
rows, 5 of which were issued and 1 of which a partner opened. **Nothing was
ever executed** — 0 signatures, 0 executed versions, 0 active agreements — so
no contract was formed here that needs preserving for enforceability. The rows
are kept anyway, because destroying the record of what the platform did is
irreversible and is its own decision to take advice on, and because keeping
them costs nothing now that no code path writes to them.

**Portal Access / AML-CTF Compliance Passport agreements.**
`partner-agreement-records` covers the terms partners accept to *use the
portal*. Those are Aurixa's own agreements with its own users — not a contract
between two independent parties — and they are untouched.

**Agency agreements.** `manage-agency-agreements` and the `agency_agreements`
table are a different feature (agency ↔ client) and are untouched.

**`referrals.agreement_id`.** The column survives on historical rows; nothing
resolves it any more.

## Dependencies that were severed, and how

`manage-partner-referrals` stopped reading `partner_agreements` in all four
places: the governing-agreement join on `get`, the version snapshot on
`create`, the fee summary in the consent statement, and
`list_active_agreements` — which now returns `{ agreements: [] }` **without a
query**. The action is kept rather than deleted so a browser running an older
bundle gets an empty picker instead of `unknown_action`, which would surface as
an error toast on a page that is otherwise working. This coupling was already
inert in production: it filtered on `status = 'active'`, of which there were
zero.

`finance-portal-login` and `finance-portal-accept-invite` no longer sweep for
undelivered agreement notifications.

`PartnerCompliance` holds an empty agreement list rather than losing its
termination panel and incident linkage, which are compliance features in their
own right.

## Old links

Every retired route redirects instead of 404-ing, because the links are in
bookmarks, emails and activity trails, and a 404 reads as a fault:

| Was | Now |
| --- | --- |
| `/partner-agreements` | the template desk (kept, repurposed) |
| `/partner-agreements/new`, `/register`, `/:id`, `/:id/edit` | → `/partner-agreements` |
| `/finance/agreements`, `/finance/agreements/:id` | → `/finance` (dashboard) |

"Agreements" is gone from the partner's navigation: templates are a resource on
the dashboard, not a destination that still looks like an inbox.

### And a way back out

The desk is `paletteOnly` in the navigation registry — no sidebar entry — so
every arrival is a one-way door: the ⌘K palette, the Finance Partners admin
page, one of the four redirects above, or a bookmark. It carries a Back
control, and that control is **not** `navigate(-1)`.

`navigate(-1)` is a browser step. It is right when the user walked here from
another page in the app, and wrong on a bookmark, an emailed link, a fresh tab,
a refresh — and wrong on a redirect, because `<Navigate replace>` does not add
an entry, so stepping back lands on whatever preceded the old link the user
followed. A Back button that silently leaves the product is worse than none.

`src/lib/navigation/pageBack.ts` decides: step back when React Router's
`history.state.idx` is above zero, and otherwise address `/dashboard` by path
with `replace` — replace, so the browser's own back button does not walk
straight back into the page they just left. The label follows the behaviour:
"Back" when it is a step back, "Back to Dashboard" when it is not. The Overview
is the fallback rather than the admin page that links here, because this route
is gated on the `agreements` module and that one on admin rights.

### What the desk no longer says

It used to open with *"Issuing and executing partner agreements through the
platform has been retired. The templates are still here…"* — `WORKFLOW_RETIRED_NOTICE`.
Removed at the product owner's direction. An explanation of a change has an
expiry, and until it is removed it is the first thing every routine visitor
reads before the thing they came for. The page still identifies itself by its
title and `TEMPLATE_RESOURCE_INTRO`, and the retired routes still redirect here
rather than 404. `agreementTemplatesOnly.spec.ts` asserts the constant is gone
rather than merely unrendered, so it cannot return as a fix for a question that
was already settled.

## If this is ever reversed

Everything is in git. But note what the removal actually bought: the neutral
position is now **structural** rather than a setting. Hiding the workflow
behind a flag would have left `issue_to_partner` live and the tables still
recording — the platform still doing the thing, just undiscoverably, which is
worse in a due-diligence conversation than doing it in the open.
