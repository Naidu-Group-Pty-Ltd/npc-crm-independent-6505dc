# A clone's documents are its own

NPC's identity — its artwork, its name and tagline, its contact details and
its wording — belongs to the prime. On the prime, every document is drawn
exactly as it always was. A clone issues the same documents, with the same
content and the same delivery, under its own template.

The owner set the rule on 26 Sep 2026. These four points, in the owner's
words, are what the work answers to:

- NPC's artwork on the older documents should be *"a legacy, which will be
  deprecated and hidden on the clone and only available on the prime"*.
- *"I do not want any changes of the content and how the reports are being
  pushed, just the template"* — whereas *"everything from a white labeling
  component needs to be put through for the clone"*.
- Each tenant's own brand colour, and *"if they don't have any branding or
  logos, it falls back through to the Aurixa's default reporting branding"*.
- *"the Disclaimer that might be hardcoded as NPC Services or Naidu property
  consulting services"* is part of the artwork too.

Read this before touching `issuerIdentity.pure.ts`, `legacyDocumentBrand.ts`,
`legacyIssuerCover.ts`, `brandFamily.pure.ts`, `snapshot.pure.ts`
(`buildReportBrandSnapshot`, `issuerDisclaimerSetting`),
`organisationProjection.pure.ts`, `comparisonContactSection.pure.ts`, or any
PDF generator that draws a cover, a closing page or a contact block.

## 1. The deployment decides, never a name

A clone's settings rows can still hold the house's values — a seeded copy, a
restored backup, a disclaimer pasted across. So the prime is recognised by the
backend it talks to, never by a name a row can hold:

- in the browser, `isPrimeDeployment()` (`src/lib/primeDeployment.ts`);
- in an Edge Function, `deploymentKind(SUPABASE_URL)`.

Both fail closed: anything that is not the prime is a clone.

**What the prime's own build answers.** The browser reads the project ref from
`VITE_SUPABASE_URL`. The prime's Lovable `.env`, when it was last committed
(July 2026), set it to the project's own `https://dduzbchuswwbefdunfct.supabase.co`,
and the built-in fallback is the same URL, so the prime reads as the prime. One
configuration would break this: pointing the prime's build at a custom domain
for its Supabase API. The ref would then not parse, and every legacy document
would switch to the issuer's template. The same predicate already decides the
internal tooling pages and the Turnstile pairing, so a change like that would
show up there too.

**On the prime nothing is read that was not read before, and nothing is
withheld.** The prime's settings are its own. If the prime has been renamed on
its Branding or Report Settings page, it issues as that name, just as it always
did. Every `legacyDocumentBrand` loader takes the settings read as a thunk, so
the prime never makes a query it did not make before.

**On a clone the issuer is resolved once** (`resolveReportIssuer`): the report
contact's company name, then the Branding page's name, then Aurixa Systems. The
house trading under any variation of its name is passed over like a placeholder
(`isHouseTradingName`), so a clone never issues as NPC. This covers "NPC
Services Melbourne", "Naidu Property Consulting Services Group" and
`www.npcservices.com.au`. A stranger who shares the initials, such as "NPC
Realty", is not passed over.

## 2. What a clone never prints

| The house's… | Where it was | On a clone |
|---|---|---|
| Cover artwork | `npc_template.pdf`, `npc-cashflow-cover.jpg`, `npc_house_cover_art`, the cover editor's default background | The issuer's cover (`drawLegacyIssuerCover`, `investmentPdfCover.ts`): the mark, the name in tracked serif capitals, the title, the subject and a one-line standfirst, in the issuer's colours |
| Name and tagline | Closing pages, running feet, "Source: NPC projections", and the `# BRAND` / YOUR DEDICATED PROPERTY PARTNER masthead the generators write | The issuer's name. The tagline is left out (`investmentReportMasthead`, `withoutHouseMasthead`) |
| Contact details | Closing pages, the typeset letterhead, `org.*`, the Q&A letterhead, the comparison prompt's closing block | Left out. See the rule below |
| Wording | A stored disclaimer naming the house | The workspace default under the clone's own name, or the platform's statement under Aurixa Systems (`resolveReportDisclaimer`, `issuerDisclaimerSetting`) |

**The contact rule has two halves, and the second is what makes it hold.**

- A field that names the house is left out. That covers its mailbox and its
  website.
- Every field of a row that is the house's own is left out too
  (`isHouseContactRow`: the row's own company name is the house's).

The house's phone line, its office address and its ABN are digits and a street.
They name nobody, so no reading of the value can recognise them.

When a seeded row was first rendered, it printed NPC's landline, office and ABN
under "Aurixa Systems". Only the mailbox and website had been withheld. A
document that says less is recoverable: the clone sets its own company name and
its details print. A document that names another business's ABN is not
recoverable. The Report Settings, white-label and brand-config sources each
apply the same rule, per source (`organisationProjection.pure.ts` judges each
field by the row that supplied it).

## 3. Which surfaces, and where each one decides

| Document | Decided in | Prime | Clone |
|---|---|---|---|
| Standard Investment presentation (pdf-lib) | `standardPresentationBrand.ts`, `investmentPdfCover.ts`, `investmentPdfIssuerPage.ts` | NPC artwork | Issuer cover, brand family, issuer closing page |
| Borrowing Capacity Snapshot (jsPDF) | `BorrowingCapacityPDFReport.tsx` + `borrowingCapacityPdfSections.ts` | Unchanged | Issuer cover, palette, closing page |
| Strategy Rationale brief | `StrategyRationalePDF.ts` | Unchanged | Same |
| Cash Flow legacy export | `CashFlowAnalysisModal.tsx` | Unchanged | Same |
| Portfolio analysis (pdf-lib) | `PortfolioAnalysisPDFGenerator.tsx` + `borrowingCapacityPdfLibSections.ts` | Unchanged | Same |
| Formara client form | `FormaraPDFGenerator.tsx` | Unchanged | Same |
| Report Q&A editors | `ConversationReportEditor.tsx`, `MessageReportEditor.tsx` | Unchanged | Same |
| Market Intelligence (jsPDF) | `MarketIntelligencePDFGenerator.ts` | Unchanged | Issuer palette; the Why/Contact boxes only where a business is named |
| Overview snapshot | `OverviewSnapshotPDF.ts` | Unchanged | Issuer palette and closing page |
| Cover editor preview | `cover-editor/types.ts` (`defaultCoverBackground`) | NPC cover | No house artwork |
| The ten typeset routes (WeasyPrint) | `buildReportBrandSnapshot` + `issuerDisclaimerSetting` | Unchanged | House names and house rows left out |
| `org.*` bound by a chosen template | `applyOrganisationProjection(…, deployment)` | Unchanged | Issuer's name, house rows left out |
| The Q&A PDF the server emails | `documentLetterhead` (`report-qa`) | Unchanged | Issuer's name, house line left out |
| Formatted comparison — closing block the model is told to write | `comparisonContactSection` | The block it always carried, verbatim | The clone's own details, or no section where nobody can be contacted |
| Legacy Investment HTML route (no current caller) | `render-investment-report-pdf` | Unchanged | No house artwork; issuer's name, contact and disclaimer; "Source: <issuer> projections" |
| The narrative masthead the generators write | `investmentReportMasthead` | The block it always wrote | Issuer's name, no tagline |
| The report viewer | `withoutHouseMasthead` | Unchanged | Tagline and a heading naming the house left out of the opening block |

The typeset routes never fetch a logo from outside their own project's storage
(`fetchBrandAssets.ts`). A logo URL copied from the prime's rows is therefore
refused on a clone, before this work and still.

**An issuer's cover keeps its typography.** The covers and running heads drawn
for an issuer set their text through `winAnsiTypographic`. It keeps what
WinAnsi carries (the en and em dash, the curly quotes, the bullet, the
ellipsis) and maps or drops only what the standard fonts cannot encode. The
first clone render set the Strategy Rationale's "Scenario — Finance Hand-off"
with a hyphen, because the shared `winAnsiSafe` flattens every dash to ASCII.
That function still draws the prime's own artwork cover, unchanged.

## 4. The brand family — "additional colours as part of the variations"

The drawn documents were composed around NPC's house pair: a gold and a navy,
plus a set of washes. One tenant colour cannot stand in for all of those roles.
Poured into the navy's place, a light brand makes every heading unreadable.
Poured into the washes, it floods them.

So `resolveBrandFamily` expands the brand colour into the roles a drawn
document needs:

- `accent`
- `accentInk` — type on paper, 7:1
- `accentOnField` — type and rules on the dark field, 7:1
- `deep` — the brand's own hue darkened for headings and table heads, 10:1
- `onDeep`
- `wash` and `stripe` — pale tints for callouts and alternate rows
- `hairline`

The semantic reds and greens, the dark field and the inks stay the palette's.
A tenant cannot make risk green.

- **No brand colour:** the family is Aurixa's platform gold on obsidian,
  matching every design-system document an unbranded deployment prints.
- **Where the colour comes from:** `whitelabelBrandColour`, which reads
  `theme_config.brandColour` and falls back to `primary_color`. This is the
  same reading the typeset routes use.
- **Portfolio and Formara grow their gold ramp from the same colour**
  (`highlightColourFor`, 26 Sep 2026). Both documents grow a ramp — the
  highlight, a lighter and a deeper shade, and a pale tint — from ONE colour
  (`getBrandPdfPalette`). It used to be the app's accent everywhere, so on a
  clone the highlights followed the app's accent while the deep shade, the
  cover and the closing page followed the Branding page: one document, two
  brand colours. On a clone the ramp now grows from the family's own source
  (the Branding page's colour, or Aurixa's gold where none is set). Only the
  source changes; the ramp is grown exactly as before. On the prime it is still
  the app's accent, applied with the same value before anything is drawn.

## 5. What does not change

- **Content.** Every figure, sentence, section and table is the same on the
  prime and on every clone. Rendered page counts are equal across the prime and
  all three clone modes for every document measured.
- **Delivery.** Exits, storage objects and the portal are untouched.
- **The model's persona follows the issuer (§9).** This bullet used to read
  "not changed": the owner then asked for it as a commercial-readiness item.
  On the prime every prompt is byte-identical to what it was.

## 6. Verified

- **The prime is object-identical to the pre-work tree for the jsPDF
  documents.** Borrowing Capacity, Strategy Rationale, Market Intelligence and
  Overview were rendered from the same fixtures on `c27bdc60a` and on this
  change, then compared object by object (streams decoded, timestamps
  normalised): all four IDENTICAL. The comparator does see a change: prime
  against a clone render differs in 64 to 2,348 objects.
- **The standard presentation was already compared the same way** when its
  cover became the issuer's (`PROPERTY_PHOTOGRAPHS.md` §10).
- **Clone renders were inspected page by page** in three modes: own brand with
  a mark and a teal colour, rows seeded from the prime, and nothing configured.
  Each showed the issuer's cover, palette and closing page; Aurixa Systems with
  the platform's statement where no business is named; and no NPC name, contact
  value or wording.
- **The component generators, audited hunk by hunk.** Cash Flow, Portfolio,
  Formara, the two Q&A editors and the two borrowing-capacity section modules
  were each diffed against `c27bdc60a` by a separate review pass. Every hunk
  runs only on a clone, reproduces the original value exactly, or is a type or
  comment. None changes what the prime draws. The review rests on one
  precondition: `loadLegacyDocumentBrand` answers "house" before it reads
  anything, so the settings reads added for clones never run on the prime.
  The two section modules were also byte-compared against the baseline for
  three datasets each, and both matched: the jsPDF module with a fixed date
  and file id, and the pdf-lib module. Passing the pdf-lib module a clone
  palette changed its output, which shows the comparison can detect a
  difference.
- **Unit tests:** `houseIdentity.spec.ts`, `cloneServerIdentity.spec.ts`,
  `legacyDocumentBrand.spec.ts` and `brandFamily.spec.ts` hold both halves of
  every rule — the prime reads as stored, a clone withholds.

## 7. Not verified — PENDING

- **Cash Flow and the two Q&A editors were not rendered whole.** Their
  generators live inside React components; the Cash Flow modal alone is 6,000
  lines that no unit harness mounts. Their prime path was audited instead (§6).
  PENDING a browser render of each, prime and clone. Portfolio and Formara have
  since been rendered in a browser, on the prime and on a simulated clone (§15).
- **The prime's live bundle was not read.** Its domain answers a Cloudflare
  challenge, which this work does not get past. PENDING a check after publish
  that the prime still prints NPC's artwork on each legacy document.
- **No real clone has drawn any of these documents.** PENDING a clone deploy.
- **The white-label Edge Function changes are deployed.** #2775 merged on
  26 Sep 2026 and all eighteen functions it changed were redeployed between
  03:24 and 03:35 UTC. The follow-up (§9–§11, #2778) merged and was deployed
  the same day. §12–§15 are PENDING merge and deploy, which need the owner's
  approval.

## 8. The uploaded PDF's words (a separate fix, same change)

The report form's PDF path read `data.pdfContent` from `parse-property-pdf`, a
field that function has never returned. It reads pages as images and answers
fields. So a report made from an uploaded brochure was written as though the
document had no words in it.

The browser now reads the text layer (`readUploadedDocumentText`) and bounds it
(`uploadedDocumentText.pure.ts`):

- **The front of the document, never its end.** A brochure ends on the
  builder's other estates.
- **8,000 characters**, cut at a paragraph.
- **Nothing from a scan.**

The generator bounds an uploaded document from its front
(`UPLOADED_DOCUMENT_MAX_BYTES`, `head`). A listing page is still cut as before.
Every section now reads the words, not only the first invocation's (§10).

## 9. Who the writer works for

Every report writer opens its prompt with a persona: "You are an expert
Australian property investment analyst for `<company>`", "a trusted property
investment advisor at `<company>`". Every one took `<company>` from Report
Settings (`getBrandConfig`). On a clone whose row was seeded from the prime's,
the model was told it worked for NPC. Market Intelligence then printed that
name in the document itself: a heading "How `<company>` Would Approach This",
"`<company>` is a strategic property advisory", and its call to action. A clone
that had named nobody got the placeholder "Property Consulting".

The writer now works for the business the document is issued under
(`writerFirm.pure.ts`, read at the edge by `writerIdentity.ts`):

- **On the prime nothing changes.** The writer is told exactly the name it was
  always told, and nothing new is read. Proven by running main's and this
  change's Market Intelligence prompt builders under Deno with the prime's name
  (26,831 bytes each, byte-identical across four builders and three report
  types), and by substituting the prime's name into the old and new sources of
  the other writers, where only the lines that compute the name differ.
- **On a clone the writer works for the clone's own business:** its report
  contact name, then its Branding page name (`resolveReportIssuer`). Never the
  house, however a row spells it.
- **Where a clone has named nobody, the writer works for no business.** The
  document is then issued under the platform, and the platform's disclaimer,
  printed on that same document, says the analysis was not prepared by Aurixa
  Systems and that Aurixa Systems is not a buyer's agent. A persona "advisor at
  Aurixa Systems" would have the prose say the opposite. So every persona drops
  its "for `<company>`" clause instead: "You are an expert Australian property
  investment analyst." A prompt-library template has the firm taken out the way
  each sentence can lose it (`withoutFirmToken`), and every built-in template
  is held to reading cleanly by a test that reads the catalogue's own source.

It covers the five report writers (`generate-investment-report`,
`regenerate-report-qualitative`, `condense-investment-report`, `report-qa`,
`generate-market-intelligence-report`), the masthead the Investment generators
write, and the template AI author, whose cover designs were told they were "for
NPC Property Services investment reports". Q&A's summary no longer asks the
model to print "Prepared by: `<company>`" where the platform issues it.

**The typeset Market Intelligence close had the same fault.** It printed "Why
`<issuer>`? `<issuer>` is a strategic property advisory …" and "Contact
`<issuer>` …" on every document, so an unbranded clone's read "Aurixa Systems
is a strategic property advisory" above a disclaimer saying the opposite. The
older browser generator already left that close out for the platform. The
typeset route now does too (`brandCloseCallouts`), and its page budget counts
the callouts it actually prints, so no empty "Your Next Steps" chapter is drawn.

**The same class outside the report writers is closed in §12.** The email
copilot, the dashboard assistant and the user guide read Report Settings, and
Market Updates Q&A called itself "the NPC Australian property-market
intelligence analyst" on every deployment. They are not report writers, so they
follow the workspace rather than the report issuer.

## 10. The document's words, for every section

A report made from an uploaded brochure or a listing link carries the
document's words into its prompt. Only the first invocation of a generation
receives them: they arrive in `propertyDetails`, and a continuation — every
invocation after the first — is sent `{ reportId, propertyAddress,
continueFrom }`. A Compass is written across several invocations, so the first
batch of sections was written from the brochure and every later one as though
there had been no document.

The first invocation now keeps the context it composed, and every later
invocation handed no document of its own reads it back
(`reportDocumentContext.pure.ts`). The stored copy holds the words (already
bounded), the extracted specifications and where the words came from.

- **It lives in the private `listing-images` bucket**, at
  `report-sources/<reportId>/document.json`, beside the report's photographs
  but under its own prefix. No migration, and nothing that lists a photograph
  folder sees it.
- **A kept copy stands in only for the same report at the same address.** A
  document about another property is worse than none.
- **Only a record this module wrote is read.** Anything malformed, of another
  version or larger than anything written here is ignored.
- **Keeping and reading never fail a report.** Both give up after five
  seconds, and a copy that cannot be kept costs the later sections the
  document, which is what they had before.
- **A continuation composes exactly what the first invocation composed.** The
  prompt section is built from the kept fields alone (a test holds the block
  to reading nothing from the request). Main's inline code and the new block
  were evaluated on the same inputs, and the section is byte-identical, for an
  uploaded PDF and for listings with and without a URL, with the new side fed a
  record that has been through JSON.

A regeneration of the same report without a document reads the kept copy too,
so it is written from the same evidence as the first generation.

Deleting the report removes the kept document with its photographs and plans
(§14). One thing it does not do:

- **It cannot keep what has no bucket.** `listing-images` is created by a
  migration, and rows a migration inserts do not always reach a clone
  (`CLONE_PROVISIONING_GAPS.md`). Where the bucket is missing, the log says
  `NOT kept` and the report is written exactly as it was before this change.

## 11. Verified and not verified (the follow-up)

- Unit tests: `writerFirm.spec.ts`, `reportDocumentContext.spec.ts`,
  `legacyDocumentBrand.spec.ts` (the highlight ramp), and the Market
  Intelligence `render` and `sections` specs. Three standing guards now pin
  the change too. `compassDocumentContract.spec.ts` pins the contract's new
  argument. The Investment single-source guard requires the new module's
  bridge. The Market Intelligence guard keeps its import allow-list closed:
  the close compares against `FALLBACK_COMPANY_NAME`, the name the masthead
  itself falls back to, which lives in the design system it may import.
- Each rule was broken on purpose, one at a time, and the spec that holds it
  failed every time.
- **PENDING:** a real clone generating a report with the new persona, and a
  real brochure report written across several invocations. Both need the
  functions deployed and spend model calls.
- **Done since (§15):** a browser render of Portfolio and Formara, on the prime
  and on a simulated clone.

## 12. Who the tools speak for

The report writers were moved onto the issuer in §9. Nothing else that speaks
was:

- The email copilot's seven prompts, the dashboard assistant and the user guide
  took the company name from Report Settings. A clone whose row still held
  NPC's name drafted replies signed "Naidu Property Consulting Services Team".
- Market Updates Q&A and the finance portal's copilot named NPC in their
  personas, as a literal, on every deployment.
- On every clone the solicitor portal told a solicitor to "Contact NPC to
  reopen it". A Command Centre message with no sender was signed "NPC Command
  Centre", and its threads were labelled the same. A finance partner's ping was
  headed "[NPC ping — …]". The conversation export named "NPC Services" as its
  author, and authenticator apps listed a clone's staff under "NPC Property
  Dashboard".

They now speak for the workspace (`workspaceIdentity.pure.ts`, read at the edge
by `workspaceIdentity.ts`):

- **On the prime nothing changes.** Each site keeps the words it always had:
  Report Settings' name where it read one, its literal where it had one. A site
  that printed a literal reads nothing new.
- **On a clone the business is the clone's own.** That is its Report Settings
  name, then its Branding page name, then the name Mission Control provisioned
  it under (`MISSION_CONTROL_AGENCY_NAME`) — the order a clone's email already
  follows. A placeholder is not a name, and the house's name is never the
  clone's, whichever row holds it.
- **Where a clone names nobody, nobody is named.** Not NPC, not "Property
  Consulting", and not Aurixa, which is not the business these tools work for.
  Every sentence is written to read whole without a name.

The provisioned name counts here and not on a document. A document with nothing
named is issued under the platform, and its writer follows its issuer so the
prose and the cover agree (§9). A drafted email, an assistant and a portal label
are not documents: they belong to the workspace, and the workspace's provisioned
name is the one its mail is already sent under.

It covers `email-copilot`, `ai-dashboard-agent`, `user-guide-assistant`,
`market-updates-qa`, `finance-portal-ai-copilot`, the partner ping in
`finance-portal-batch9-10`, the Command Centre's signature and thread label in
`legal-matters-admin`, the closed-matter refusal in
`solicitor-portal-intelligence`, the export's author in
`build-conversations-export-worker`, and the authenticator issuer in
`security-step-up`. Two prompts gave the model a worked example naming NPC: an
ad set in `analyze-meta-ads-phase2`, and the "NPC view" label the Investment
generator forbids. A clone's model now sees neither name, because a model
repeats the example it is shown. `writerIdentity.ts` reads the Branding page
through the same shared reader.

## 13. The labels a partner and a member of staff read

The partner portals and several staff screens were written for the prime. On
every clone a solicitor was offered a "Direct line to the NPC team", a finance
partner pinged an "NPC owner", matters arrived "Flagged by NPC", and staff chose
a report tier described as carrying the "NPC view".

Each of those literals now reaches the page through `houseLabel(prime, clone)`
(`src/lib/houseLabel.ts`). The first argument is the prime's words, verbatim,
and the second is what a clone reads. The deployment is the backend the build
talks to (`isPrimeDeployment`), fixed when the app is built, so a label never
changes while a page is open.

- **The prime reads exactly what it read.** All 39 sites in 23 files were
  compared with the tree before the change: every literal that named the house
  is now a first argument, byte for byte, with JSX text compared as React
  renders it.
- **A clone reads the staff side as "the Command Centre".** It is the product's
  own name for it: the sign-in page carries it on every deployment, and several
  of these screens already used it beside "NPC". Where the house was only the
  source of something, a clone's sentence leaves the source out rather than
  naming a stand-in ("New referrals will appear here.").
- **The closed door names nobody.** `InternalToolingGuard` renders its notice
  only on a clone, and it said the page was "part of NPC Services' own
  operations". It now says the page is internal tooling for another deployment.

`houseLabelsGuard.spec.ts` holds this from both sides. A literal naming the
house is the first argument of `houseLabel`, or it is recorded with the reason
it stays. A reason that no longer matches anything fails, so the list cannot go
stale. A clone's words never name the house, "Property Consulting" or Aurixa,
and they differ from the prime's. Both words are literals, and no call site
passes the deployment in, because `true` there would put the house back on
every clone. A file-local stand-in for the helper also fails.

Six places keep the name, each recorded in the spec with its reason:

- GHL incident tooling, which renders nothing on a clone.
- The intake pack's machine marker. Renaming it would make every issued pack
  unreadable.
- Two AML/KYC surfaces, which the owner keeps out of this work.
- Developer tooling that no page renders.
- The report registry, whose content the owner asked to be left alone.

## 14. Deleting a report removes what it kept

A report owns three folders in the private `listing-images` bucket: its
photographs with the record that vouches for them, its floor plans, and the
document context its first invocation kept (§10). Deleting a report used to
delete the row and nothing else. Every file stayed, and nothing could read it
any more: a derived report reaches its parent's folder only through
`parent_report_id` or `derived_from_report_id`, and both are `ON DELETE SET
NULL`.

Both routes that delete `investment_reports` rows now remove those folders:
`manage-investment-reports` (`delete` and `bulkDelete`) and
`manage-automation-settings` (`clearStuckReports`). The rules are in
`reportStorage.pure.ts` and the calls in `reportStorageRemoval.ts`:

- **Only what a delete actually removed.** The folders are those of the ids the
  delete statement returned, never of an id a caller only asked about.
- **Only a report's own folders.** A folder is built from a row id or from
  nothing. Every path is checked against the report's folders before removal,
  so none can name another report, a listing's images or the top of the bucket.
- **Only objects.** A listed sub-folder is a prefix and is never passed to a
  removal; the floor plans are listed in their own right.
- **It never fails the delete.** It never throws, and it is bounded in time as
  a whole: 5 seconds for one report, 20 for a bulk delete. Whatever the budget
  did not reach is logged as unfinished, and a file left behind costs what
  every delete cost before.
- **The rendered PDF stays.** A client portal can hold a copy of a report
  someone later deletes, and removing it would take the document out of that
  client's portal.

One thing the same work found and closed: `bulkDelete` with a status filter
deleted matching reports across the whole deployment, not the caller's own,
for any signed-in user who sent it. It now requires an administrator, checked
before the query runs. Its only screen in the product is dead code, so nothing
that works today changes.

Three things it does not do:

- **Files from reports deleted before this change stay.** Removing them is a
  sweep across the bucket, which is destructive and needs the owner's approval.
- **A capture that is already running when the report is deleted** can still
  write its files afterwards.
- **A delete by id checks only that the caller is signed in.** A single delete,
  or a bulk delete given a list of ids, removes any report on the deployment,
  whoever made it, exactly as before this change: the function runs as the
  service role and checks neither ownership nor a permission. Whether it should
  require the Generated Reports permission is the owner's decision, because
  adding one could stop staff who delete reports today.

## 15. Verified and not verified (this change)

- Unit tests: `workspaceIdentity.spec.ts` (both halves of every rule, and each
  prime site against its old words), `houseLabelsGuard.spec.ts` and
  `reportStorage.spec.ts`. `reportStorage.spec.ts` runs the removal against an
  in-memory store, including a failing list, a failing removal, a throwing
  client and a store that never answers. It also holds the source to the rule
  that each delete statement is followed by one removal of what it returned.
- Each rule was broken on purpose, one at a time, and a spec failed every time.
  For the labels that is ten mutations: a bare literal, a clone naming NPC or
  Aurixa, a pinned deployment, a local stand-in, a recorded literal moved, a
  clone equal to the prime, the closed door naming NPC, a wrapper around words
  that do not name the house, and a clone argument that is not a literal.
- **Portfolio and Formara in a browser.** The real app in Chromium, every
  backend request answered by `scripts/verify/report-journey/supabaseDouble.mjs`,
  synthetic data, and the clone simulated by building against a made-up project
  ref. The same branding row had a purple app accent, a teal Branding page
  colour and a clone business name. The share of saturated ink on every page
  measured:

  | Document | Teal (Branding page) | Purple (app accent) | Gold (house) |
  |---|---|---|---|
  | Portfolio, prime | 0% | 22.1% | 32.7% (house cover and closing page) |
  | Portfolio, clone | 86.9% (every page) | 0% | 0.3% |
  | Formara, prime | 0% | 28.2% | 16.6% (house cover) |
  | Formara, clone | 96.7% (every page) | 0% | 1.0% |

  The prime keeps NPC's cover and the app accent exactly as before. The clone
  opens on its own cover, in its Branding page colour.
- **Closing the tab while brochure pictures are filed** (§8 of
  `PROPERTY_PHOTOGRAPHS.md`), in the same harness: 14 of 14 checks pass. The
  browser asks before closing or reloading, "stay" keeps the page, and once the
  pictures are filed the form clears and nothing is asked. With the hold taken
  out of the source, the tab closed with no prompt, so the check can see the
  defect.
- None of this is an acceptance of the live application. **PENDING:** a real
  clone using the tools, reading the portals and deleting a report, after the
  functions and the frontend are deployed.

## 16. The intake pack and the quantitative report

Two documents still named the house on a clone after §§1–15. Both are closed by
Phase 2 of the template programme
([`TEMPLATE_PARITY.md`](./TEMPLATE_PARITY.md)).

**The Commercial and Industrial intake pack** is a pair of files the owner
approved: a Word form and an Excel workbook. They are pinned by checksum and
handed over as supplied. Both name the house, including in the consent clause a
client signs. `packPresentation.ts` presents a copy at download time, and the
stored files and their checksums are untouched.

- **The prime** with no design chosen receives the approved file exactly as
  supplied. Nothing is read or re-zipped.
- **A clone** receives a copy that names the clone's business. Where the clone
  has named no business, the copy uses the pack's own placeholders ("Company
  Name", "(Company/Business Name)"), never the platform's name, because
  Aurixa is not a party to the client's consent. The file's `lastModifiedBy`
  is cleared.
- **A copy that still names the house after that is refused**
  (`PackStillNamesTheHouse`). The person is asked to try again. The document
  is never handed over with another business's name in its consent clause.
- **The name is read by `loadCloneIssuerName`.** It answers `undefined` on the
  prime, the clone's own name on a clone, and `null` where the clone has named
  nobody. Unlike the document issuer, it never answers Aurixa, because this
  name goes into a clause the client signs.

**The quantitative market report** printed the Report Settings name on every
deployment. On a clone it now prints the issuer, as every other legacy document
does (§1): the clone's own business, or Aurixa Systems where it has named none.
On the prime nothing changes.

## 17. Verified and not verified (Phase 2)

- `packPresentation.test.ts` (512 tests) covers:
  - every catalogue design's colours against the approved ones for legibility;
  - the Word and Excel parts round-tripping through the parser;
  - that only the parts named change, and that a clone's copy never names the
    house.
- `packDownload.test.ts` covers the three answers: the approved file, a
  presented copy, and a refused one.
- `intakePackDownloads.test.tsx` drives the panel's download through all three.
- The quantitative report was rendered from a pipeline-shaped row on the prime
  and on a clone that has named nobody. The prime's cover and running head read
  "NAIDU PROPERTY CONSULTING SERVICES"; the clone's read "AURIXA SYSTEMS".
- **PENDING:** a real clone downloading the intake pack and the quantitative
  report, after the frontend is published.
