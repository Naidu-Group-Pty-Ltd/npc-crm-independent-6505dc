# Template parity: a template changes how a document looks and nothing else

The owner set the rule on 26 Sep 2026. For every report type other than the
five Investment tiers, a document drawn through a design-system template must
carry exactly the information the report's standard document carries. The
template decides how the document looks: its cover, colourway, typefaces and
running furniture. It never decides what the document says.

On 26 Sep 2026 each non-Investment report type's standard document and its
template document were rendered from the same real record, on the catalogue's
masters, and compared. **None of the nine carried the same information.** This
document records every difference found, the protection shipped while they are
fixed, and the rule a report type must pass before its templates are used
again.

## Why nothing caught it

The tests that existed checked wiring:

- each projection restates its format's normaliser;
- each master binds only paths the projection publishes;
- each master renders without an unresolved binding.

All three held, and the documents still differed. No test had ever rendered one
record through both paths and compared what each printed. A master can bind
only published paths and still leave half of them unbound, cap a list at three,
or state something the record does not say.

## What is in force now (Phase 0)

### The nine report types are held on their standard documents

`supabase/functions/_shared/reports/templateParity.pure.ts` is the one
register. `TEMPLATE_RELEASED_REPORT_TYPES` names the report types whose
template path is released, and today it names `investment` alone.

`tryTemplateDocument` reads the register before it reads the record or the
person's choice, so no delivery path can reach a template for a held report
type:

- the download, the email attachment and the portal publish all go through it;
- the report type is normalised first, so every alias is held with its format;
- anything not released is held, an unknown spelling included, so a new alias
  cannot release a format by accident.

A held report type is produced as its standard document for everyone, whatever
template they chose. The standard document is the complete one, so nothing is
lost.

**The person was told.** A choice that is kept but not applied must never look
like one that was honoured, so Phase 0 said so in three places: the chooser
("This report uses its standard layout for now"), the Template per report
format card ("On hold") and a notice beside every download with a saved
choice. Phase 2 made the choice apply, so all three now say what it does
instead (below).

The Cash Flow finalisation key records the template **in effect**, which is
none while the report type is held. A choice cannot change the key of a
document it did not change, and a document produced while held cannot be
served as the templated one after release.

### Report Q&A prints the answer chosen

The Q&A adapter is never told which answer was chosen, and every content page
of the Q&A masters draws `qa.answer`. So the templated "This answer" printed
the conversation's FIRST answer whatever was chosen, and the templated
"transcript" printed the first answer and none of the others.

The adapter now declines all three subjects, as it already did for the
structured write-up. `render-report-qa-pdf`, which is addressed by message and
paginates a transcript of any length, draws every Q&A document.

"Add to this chat" never takes the template path, because only the route
writes the chat message. The chat is said to hold the file only when the
route's answer names the message. When the message could not be written, the
file is saved to the person's downloads and they are told which of the two
happened. (`qaTemplateDeclines.spec.ts`)

### No clone's cover carries the house's tagline (seed v23)

All 500 family masters set "Your dedicated property partner", the house's own
tagline, as a literal under the cover wordmark. That included the Investment
masters. Every clone's templated cover therefore carried the house's words
under the clone's name.

The masters now bind `{{org.tagline}}`. `applyOrganisationProjection`
publishes it on the prime alone, with exactly the words the literal carried:

- the prime's covers print what they always printed, and the renderer draws
  every cover byte for byte as it drew it with the literal;
- a clone's cover draws no tagline, because a bound text block that resolves to
  nothing is not drawn.

`coverTaglineIsTheIssuers.spec.ts` renders all 500 covers both ways.

Seed `20261225090000_seed_template_library_v23_issuer_tagline.sql` and its
refresh `20261225100000_refresh_active_masters_from_library_v23.sql` carry it
to the library and to every unedited active master. Compared row by row with
v22:

- 500 of 543 rows differ, each in exactly one block, in `schema` and
  `preview_schema` alike;
- `required_bindings` gains `org.tagline`;
- the 43 voice templates are byte-identical.

The order they go live in matters. `org.tagline` is published by the browser
(`adapters/organisation.ts` and the Market Intelligence adapter), so the
frontend that publishes it has to be live before the seed is applied. Applied
first, the prime's templated covers would lose the line until the frontend
caught up. The seed goes before its refresh, because the refresh reads the
release's baselines, which the seed writes.

**The seed is not the only guard, because it cannot reach everywhere.** Two
kinds of master never receive it: one somebody customised (the refresh copies
only masters still on their release baseline), and every master on a clone the
seed does not reach, since Mission Control's cascade never carries a seed this
size. So `routeReportThroughTemplate`, the one route every templated document
is drawn through, applies the same rule before either renderer reads the
template (`houseTaglineGuard.pure.ts`). On a clone, a block value that is
exactly the house's tagline is given the `{{org.tagline}}` binding v23 would
have given it. On the prime nothing is touched. `coverTaglineIsTheIssuers.spec.ts`
renders all 500 covers with the literal put back, through the guard, and
requires each to match the v23 cover byte for byte.

## What was found, report type by report type

These differences were measured on 26 Sep 2026. Each is closed in Phase 2 by
construction (below), and the release check proves it.

### Shared by every report type

- Every cover printed the house's tagline as fixed text. **Closed by seed v23.**
- A list or table with three or more slots is not drawn when only one item
  fills it, so a single recommendation hides the whole list.
- Content placed in a heading's intro line is lost on families that do not
  draw that line.
- The template prints the platform's standard disclaimer when no firm
  disclaimer is set; the standard document prints none.
- Charts are dropped where the same data sits in a table.
- The company name is resolved in the opposite order on the two paths: Report
  Settings first on the template path, Branding first on the standard path.

### Report Q&A: blocker

- "This answer" printed the first answer, whichever was chosen. **Closed by
  the decline.**
- "Full transcript" printed only the first answer; questions 2 to 7 were
  listed without answers and question 8 onward was not listed. **Closed by the
  decline.**
- An answer was limited to eight pages: on a real 28,690-character answer,
  Chancery printed about half.
- The page made false statements, such as "all 4 exchanges" and "The first
  exchange is set in full".
- "Add transcript to this chat" attached nothing and reported success.
  **Closed.**
- The structured write-up was already identical: it uses the standard route.

### 10 Year Cash Flow: blocker

- The figures are after tax, while every master says "No tax position is
  modelled".
- A stored scenario series could replace the series the adviser reviewed on
  screen (a test: −$8,200 a year against the reviewed −$3,500).
- Stored deposit, loan and rate figures overrode the reviewed ones ($150,000 at
  5.90% against $160,000 at 6.10%).
- Dropped: purchase price, market value, term, weekly rent and yields; the
  year-one table and the per-year rows; the stated assumptions, the notes, the
  projections caveat and "Prepared for".
- Added: holding-cost components, and a principal-and-interest repayment
  printed on interest-only loans.
- Recomputed: LVR against the purchase price instead of the market value.

### Borrowing Capacity: the template is never used

- The browser looks the assessment up in a table it cannot see (0 of 128 rows
  by the repository's own measure), so the choice does nothing.
- Were it reached, it would drop the scenario comparison, recommendations past
  three, warnings past two of up to five, the audit trail's Effect and Rule
  columns and summary, and the LMI details.
- It would also word LMI wrongly for one of its modes and show a blank expense
  method for two methods.

### Client Details

- The primary contact's email, mobile, date of birth and gender are never
  printed.
- Dropped: the home section, the SMSF details, every expense line and the
  expense total, per-property equity and rent, employment contact details, and
  other income past its first line.
- False statements: "No income recorded" beside other income, and "every figure
  is summed from the rows it prints" once rows are dropped.
- Silent gaps: address history is cut at four entries with no note, and a
  failed read of related records prints as "nothing recorded".

### Portfolio

- The opening summary is not drawn on 18 of 50 masters, Chancery included.
- One page can show two different portfolio values, because the headline reads
  different fields from the body.
- Lists are capped with no note: strengths, concerns, risks, mitigations,
  recommendations, findings and verdicts.
- Dropped: the detailed recommendations, the 12-month action plan, the
  per-property analysis and most holdings columns.

### Property Comparison

- Strengths and concerns are printed for the first-ranked property only, three
  of each; a real record lost 14 bullets.
- Risk text is cut at 255 characters.
- Red flags appear only when there are two or more, and then only two;
  runners-up are capped at 2, "avoid" at 1 and alternative scenarios at 1.
- Missing: the ranking weights, "Prepared for" and two charts.
- Added: internal engineering remarks on 32 of 50 masters, and a claim about
  "the one the analysis would buy" on records with no pick.

### Market Intelligence

- Each layer gets three pages: on Chancery a 16,261-character layer prints
  about 7,700, with a note saying it continues. The standard document allows
  20,000 characters a section.
- Five sections are cut with no note: correlation, research, the executive
  summary, the briefing and the strategy.
- 6 of 60 sources are printed, under a reference to a "full edition" that does
  not exist.
- Events are capped.
- On an unbranded clone the template prints a platform advisory close that the
  standard document suppresses.

### Commercial & Industrial Capacity: the figures are identical

- A first render has no Analysis section, because the template path never
  generates one.
- Next actions vanish when nothing is outstanding.
- The funding-shortfall warning is missing on 21 of 50 masters, Chancery
  included.
- The engine's own disclaimer is printed by none of the 50 masters.
- The method trail shows 5 of 20 steps and points to a document the reader
  does not have.

### Cash Flow Comparison: cannot use a template

- It has no adapter, and its delivery never asks for a template. The 50 masters
  exist only as previews on sample data.
- Wired up as they stand, they would still fall short: they are fixed at ten
  years and carry only cumulative figures.

## What is in force now (Phase 2)

The approach is **design from the template, content from the standard
composer**. A master's page sequence is a second statement of what a report
says, and two statements drift, so for the nine held report types a chosen
template no longer supplies pages. It supplies the design, and the report
type's own route draws every page in it. A field added to a composer reaches
every design the day it is added, where fixing the masters field by field is
nine report types × 50 masters and drifts again at the next composer change.

### What a design is, and where it comes from

The typefaces, the colourway, the cover's ground, and how tables and section
headings are ruled. `templateDesign.pure.ts` resolves it from one of two
names:

- **a catalogue design**: one of the fifty (`pb-01` … `de-05`) in one of its
  family's ten colourways. It is resolved from code alone
  (`templateDesignCatalogue.generated.pure.ts`, regenerated by
  `npm run templates:design:generate` and checked by
  `npm run templates:design:check`), so it means the same thing on every
  deployment;
- **a `report_templates` row**: its own tokens decide the colours and faces,
  so a template somebody edited in the Template Builder prints as edited, and
  its library lineage supplies the rest.

The cover's ground is one of three, as the catalogue draws it: the whole sheet
in the field colour (19 of the 50), a band across its head (18), or paper
(13, six of them framed).

### How it reaches the document

- **Asked where the route is called.** Every `request*` function in the
  browser asks `standardDesignFor` (`standardDesign.ts`) for the person's
  choice and sends it to the route: a download, an email attachment and a
  portal publish all go through one of them.
- **Resolved once, on the server.** Each of the nine routes resolves the
  design with `templateDesignRead.ts`, which reads only the row's tokens and
  lineage (never its pages, which run to megabytes on some rows). A row is
  honoured only where the Template Builder would list it for this person and
  the chooser would offer it for this report type
  (`templateDesignRoute.pure.ts`).
- **Drawn as a stylesheet.** `buildReportCss` appends the design's rules
  (`templateDesignCss.pure.ts`) after the standard sheet. With no design
  nothing is appended, and every report type's document is byte for byte what
  it was.

### What is refused, and why a refusal never costs the document

Every colour arrives from a column somebody can edit, and every face is a name
written into a stylesheet. So a colour must be `#RRGGBB`, a face must be one
the print container holds, and the resolved palette must pass the contrast
audit every document passes. What cannot be honoured stays at the standard
value and is named; a design with no usable palette is refused whole.

The route then draws the standard document and answers with what it drew
(`DesignEcho`). The browser shows a refusal in the route's own words. It also
speaks when a route answers nothing about a design it was sent, which is a
deployment older than designs: a standard document handed over in silence
looks exactly like a choice that was honoured.

### Identical by construction, and proved

`templateDesignParity.spec.ts` draws each held report type's longest document
with no design and under 141 designs: each of the fifty in its default
colourway, and every colourway of every family. It holds each `<body>` to the
standard document's, byte for byte, apart from the colours and faces painted
inside its charts. All 500 design and colourway combinations pass the contrast
audit.

The design sheet may restyle what is on the page. It may never add, remove,
hide, reorder or re-case a word, so the spec reads the sheet and refuses
`display: none`, `content`, `text-transform` and `visibility`.

### What the person is told

- The chooser: "Your template sets this report's design", with the report
  type named, above the designs.
- The Template per report format card marks each such format "Design".
- A download says nothing unless the design was refused or went unanswered,
  because the choice was honoured.

### Nine documents with no template of their own wear the choice too

Nine documents are drawn in the browser (jsPDF, a print stylesheet, a picture
of the page, a Word or an Excel file) and have no template of their own. Each
is made from a report type a person chooses a template for, and wears the
design chosen for it. `DRAWN_DOCUMENTS` in `templateDesignRoute.pure.ts` is
the register:

| Document | Wears the design chosen for |
|---|---|
| Strategy Rationale | Borrowing Capacity |
| Commercial Investment Report | Commercial & Industrial Capacity |
| Industrial Investment Report | Commercial & Industrial Capacity |
| Commercial 10-year cash flow | Commercial & Industrial Capacity |
| Commercial and Industrial intake pack | Commercial & Industrial Capacity |
| Client Property Analysis | Portfolio |
| Quantitative market report | Market Intelligence |
| Overview snapshot | Market Intelligence |
| Call log export | Client Details |

A drawn document can honour three parts of a design exactly (`drawnDesign.pure.ts`):

- its colours, as the family the drawn documents already take on a clone;
- its cover's ground;
- whether the cover is framed.

It honours the faces approximately: a serif heading face is set in Times, and
every other face keeps Helvetica. Embedding the design's own faces would add a
font file to every download.

`drawnDocumentDesign.ts` reads the choice exactly as a route would. It never
throws:

- nothing chosen, or a choice that cannot be read at all, is the house design,
  byte for byte;
- a choice that was read and cannot be honoured is said in the routes' words.

The chooser names these documents under each report type ("Also sets the
design of the Strategy Rationale, which is drawn without a template of its
own."). `drawnDocumentDesign.spec.ts` fails if a document in the register is
never asked for, because an entry nothing reads makes that promise with
nothing behind it.

**The lender packet's cover sheet is not in the register.** It is drawn in the
finance partner's session, which cannot read the adviser's choice. Whose
design it should wear is an owner decision (below).

Verified by rendering the real generators with no choice and in three
catalogue designs, and comparing each PDF with the previous commit's object by
object (streams decoded, timestamps and the random file identifier set aside).
With no choice these draw exactly the objects they drew before:

- the Strategy Rationale and the Overview snapshot, and the Borrowing Capacity
  and Market Intelligence legacy PDFs (which share the brand code changed
  here), on the prime and on three kinds of clone;
- the Industrial Investment Report wherever no value wraps;
- the call log export, driven through its own dialog.

The documents that differ, deliberately, are listed under "Defects found"
below. The Client Property Analysis and the C&I cash flow print are not drawn
as PDFs by this code (one is a picture of the page, the other the browser's
print dialog); their no-choice path hands over the page's own colours and the
original stylesheet string unchanged. The print's stylesheet is decided in
`tenYearCashFlowPrintStyle.ts` rather than in the card, because a print window
is a document the application's tokens do not reach. Its house sheet is pinned
by checksum to the string the card used to inline.

### The intake pack on a clone, and in a design

The Commercial and Industrial intake pack is a pair of approved files (a Word
form and an Excel workbook), pinned by checksum and never regenerated.
`packPresentation.ts` presents a copy at download time. The stored files are
untouched.

- **On the prime with no design,** the approved file is handed over exactly as
  supplied, and nothing is read or re-zipped.
- **On a clone,** the house's name in the form becomes the clone's name. Where
  the clone has named nobody, it becomes the pack's own placeholders
  ("Company Name", "(Company/Business Name)"). The file's `lastModifiedBy` is
  cleared. A clone's copy that still names the house after that is **refused
  rather than handed over** (`PackStillNamesTheHouse`). Its consent clause
  would otherwise have a clone's client consent to another business.
- **In a design,** only the approved file's three brand colours change, each
  to a colour at least as legible as the one it replaces.

### Defects found and fixed on the way

- **The quantitative market report printed figures it did not hold.** Its PDF
  read a report shape the pipeline stopped writing, and every read had a
  default, so every download said:
  - "stable momentum with a 0.0% increase";
  - a median listing price of "$0" and a data confidence of "0.0%";
  - a market health of "Low".

  It then drew:
  - a field-coverage table from thresholds on that zero;
  - a confidence distribution of fixed shares;
  - "Agency 1…5" and "Top Suburb 1…5" charts;
  - a week of activity from `Math.random()`;
  - ten Perth suburbs at invented prices, whatever the market.

  It now prints only what the row holds (`quantitativeReportFacts.ts`,
  `quantitativeCharts.ts`): the same pipeline row went from 13 pages to 8.
  Three rules came with it:
  - **each series is drawn once**, in the pipeline's own order (its rows share
    one creation time);
  - **the contents page is numbered from the pages actually drawn**;
  - **the methodology states only the method used**: no "public records
    databases", no "AI-powered analytics engine".

  Older reports stored data confidence as a 0–1 share, which the page printed
  as a per cent ("0.8%"). It is now read on its own scale. The report page's
  own cards read the same fields and printed "$N/A" on every pipeline report.
  They now read the same facts as the PDF.

  Older reports that carry insights **crashed the report page**. They are
  stored as `{ category, priority, text }`, and the page rendered the object.
  The page now prints the words.
- **The quantitative pipeline itself builds four charts from something other
  than what they are called** (next section). The PDF leaves those four out
  for reports the current pipeline version made, and draws them again for a
  later version. `quantitativeCharts.spec.ts` reads the pipeline and fails if
  it changes those charts without bumping `REPORT_VERSION`.
- **The Commercial Investment Report's page numbers.** A fixed "Page N" was
  drawn under the running footer on every page, so each page carried two
  numbers.
- **The Industrial Investment Report's address overlapped the next field** when
  it wrapped. Values now wrap inside their own column and the row grows
  (`drawnGrid.ts`). A row whose values fit is unchanged. "Fit" means fit with
  a 4 mm gutter before the next column, so a value that used to run into those
  last 4 mm, touching its neighbour, is now set on two lines.

### Decisions for the owner

These were found and deliberately not changed here:

1. **The lender packet's cover sheet.** It is drawn in the finance partner's
   session. Should it wear the adviser's design, which needs the choice
   carried in the packet, or the partner's own brand?
2. **Client Property Analysis prints a grade a model invented.** The analysis
   asks a model for a letter grade, and the document prints it. Every other
   grade in the product comes from the scoring engine or is withheld.
3. **The intake pack on a clone** is a transformed copy of the approved file.
   Is naming the clone in the approved pack acceptable, or should clones be
   issued their own approved pair?
4. **The C&I 10-year cash flow's print route.** It prints an HTML page through
   the browser's print dialog, beside the typeset Commercial Capacity report.
   Should it be retired?
5. **The quantitative pipeline's own charts.** Version 1 of
   `quantitative-report-pipeline` builds four charts that do not match their
   titles:
   - "Pricing Trends" is the daily listing count again;
   - "Data Confidence Trends" repeats one 0–1 figure, rounded to 0 or 1;
   - "Suburb Performance Matrix" and "Price vs Volume Analysis" pair every
     suburb with the whole market's average price.

   It also:
   - stores the suburb chart twice;
   - counts "no suburb" as a suburb in `unique_suburbs`. The PDF takes it
     off only where the suburb chart (the ten busiest) shows that bucket, so a
     report whose no-suburb listings fall below the ten can still print one
     suburb too many;
   - writes findings that call the no-suburb bucket a suburb ("Unknown Suburb
     has the highest listing concentration") and name the smallest price band
     as the key finding.

   Fixing them at the source changes what new reports store, so it is a
   pipeline change with its own version bump. Until then the report page, a
   staff screen, still draws every chart the pipeline stored, those four
   included, while the PDF a client receives leaves them out. The page was
   left as it was because it is where staff can see what the pipeline built.

### The release audit (26 Sep 2026)

Before this release went live, every document-producing surface was
inventoried and the whole diff reviewed. These were fixed:

- **An unbranded clone's market report named the platform as its author.** It
  said Aurixa "prepared" the report, owned its copyright and offered
  "advisory". Aurixa only supplies the software, so that report now prints the
  platform's own disclaimer (`PLATFORM_DISCLAIMER`), with no "prepared by", no
  copyright line and no advisory tagline.
- **The market report's PDF counted charts it could not draw**: a line with one
  point, a pie with nothing in it. It now leaves them out and does not count
  them. It also listed a finding twice when it was both high-priority and a
  warning.
- **The market report's fallback said nothing.** When the full report could not
  be drawn, the pipeline's simpler stored copy was downloaded under the same
  "PDF Downloaded" message. It now says a different copy was downloaded.
- **The Cash Flow Comparison handed the AI invented figures.** A property with
  no recorded interest rate or LVR was described as 5.5% and 80%, and a missing
  price or rent as $0. The AI is now given nothing for a figure the record does
  not hold, and is told to say it is not recorded.
- **The Client Property Analysis invented an analysis** when the AI's reply
  could not be read: a score and grade from the yield alone, stock strengths
  and risks, and a ten-year projection at 5%. It now says the analysis failed.
- **The Property Comparison's "legacy layout" download never downloaded.**
  Storage refused the upload for every user, after the AI formatting had been
  paid for. The file is now handed straight to the browser (`COMPARISON.md`
  §8).
- **A clone's templated cover could still print the house's tagline** from a
  customised master, or from any master the v23 seed never reached. That is
  now guarded where the document is drawn (the v23 section above).
- **The chooser described held types as ranked.** It said "Choosing
  automatically" and "Standard generator" for report types that, with nothing
  chosen, use their own standard design. It now says standard design. It also
  says two further things where the choice is made:
  - that the Cash Flow choice also dresses the Cash Flow Comparison;
  - that a "legacy layout" download is drawn without the design.
- **Under 31 of the 50 designs, the Commercial & Industrial Capacity report
  cut text off its "Financial periods" table.** That table is wider than the
  text area, and the standard document keeps all of it only because it spills
  into the right margin. A design clipped it: raised surfaces set
  `overflow: hidden` on tables, and a narrower body or a wider header face
  made the overrun worse. The Evidence column was cut or lost, and on some
  designs so were the Adjusted EBITDA figures. The parity spec could not see
  it, because the markup was byte-identical: **identical markup is not an
  identical page.** The design sheet now clips nothing, and a numeric
  column's head may wrap between words (`fitRules` in
  `templateDesignCss.pure.ts`, pinned for every design by
  `templateDesignParity.spec.ts`). Measured over all 459 renders (nine report
  types, each standard and under all fifty designs): 31 designs lost text
  before, none after, no page count changed, and the standard documents are
  byte-identical.
- **A design's secondary text could fall below the 7:1 print floor** on its
  pale panels: 225 of the 500 design and colourway combinations measured
  6.33–6.99:1 there. The muted ink is now held to 7:1 on the washes as well as
  on the page (`familyFromDesignPalette`).
- **A template that could not be read was reported as one that was gone.** A
  database fault, a missing row and a permission refusal all said "no longer
  available to you … choose another". A fault now says to try again, and that
  the choice is still set (`template_unreadable`, on the server and in the
  browser alike).
- **A catalogue design that has left the catalogue** now draws the standard
  document and says so, instead of refusing the whole request. Nothing sends
  one today, because the browser sends a template's id and not its code.
- **Smaller fixes:**
  - The intake pack now carries a business name containing `$` or characters
    XML cannot hold without corrupting the file (`packPresentation.ts`).
  - Safari no longer cancels the intake pack download: the file's link is kept
    for 1.5 s after the click.
  - The C&I cash flow print window falls back to the standard document if the
    design cannot be written into it.
- **Security**, recorded in
  [`TEMPLATE_BROKER_TABLES.md`](../security/TEMPLATE_BROKER_TABLES.md):
  - the Template Builder's broker exposed staff credentials and integration
    keys to any staff login;
  - the design read now asks the Template Builder's own `view` permission
    before it reads a template row.

Found and recorded for the owner rather than changed:

6. **The "legacy layout" downloads do not wear the chosen design.** They are:
   - Borrowing Capacity, Cash Flow (and its Flatten and Print View), and the
     Cash Flow Comparison;
   - Portfolio "Download & Save PDF", and Client Details' Formara;
   - the Report Q&A editors and transcript, and Market Intelligence.

   The chooser now says so. Their generators already accept a design through
   `loadLegacyDocumentBrand`, so each could take one, or be retired. Portfolio
   is the one where this matters most: its legacy generator is still how a
   Portfolio report is first created, and the file it stores is what the
   portal publishes.
7. **Missing figures still print as $0, 0% or "N/A" in several legacy
   documents.** These are the Portfolio legacy PDF, the Cash Flow Print View,
   the legacy cash flow comparison, the Commercial and Industrial reports, the
   Overview snapshot and the legacy Borrowing Capacity PDF.
   `monthlyFigureOrUnavailable` is the pattern to follow.
8. **The Cash Flow Comparison prints a score the AI gave, with no scale.** The
   typeset document prints it as "Score given", the legacy one as
   "Score"/"Overall Score". Keep it qualified as it is, or drop it.
9. **The Template Builder can export a held report type's real record through
   a template's own pages** ("Load sample from real report", then any export).
   That is the page-drawing the hold withholds everywhere else. It needs the
   Template Builder's `edit` permission.
10. **The report library's "Download" is the stored markdown as a .txt file.**
    It is not scrubbed, so its "N/A" cells and `{{…}}` chart directives come
    with it, and the viewer's copy is logged as a PDF download.
11. **The scheduled Market Intelligence email** attaches whatever PDF the report
    row holds, in the design it was downloaded in. The email's signature,
    banner and disclaimer come from the Branding page with no clone guard.
12. **Documents stored before this release are served as stored.** That covers
    a clone's PDFs made before the 26 Sep white-label work, and any held report
    type drawn through a template's pages before the hold. Finding them needs a
    storage query this work did not run.
13. **Outside the reporting scope**, and so not touched here:
    - **The Buyer's Agent Agreement.** It names the house on a clone. On a
      clone with no email set, it routes the agent's DocuSign signature to the
      house mailbox.
    - **The finance portal.** The commission statement, the RCTI record and
      the compliance print carry the house's palette and name.
14. **Unreachable code** could be deleted:
    - about 1,400 lines after `return data;` in `useReportGenerator.tsx`;
    - `report-qa`'s `send-email` and `export-pdf` actions;
    - `ClientPDFGenerator`, which nothing mounts;
    - `render-investment-report-pdf`, which nothing calls.
15. **Smaller items:**
    - The Q&A transcript copies page 1 of an uploaded template PDF with no
      check for house identity.
    - The disclaimer block's defaults ("ABN 00 000 000 000") print if an author
      leaves them unbound.
    - The Commercial report's discounted cash flow uses assumptions it does not
      show: 1.5% selling costs and 5% vacancy.
16. **Nothing records which design a document was drawn in.** The route says
    so when it answers (`DesignEcho`), and the document shows it. But no row
    records it: not the report, not the render ledger. Recording it would
    answer "which design did this client receive?" after the fact.

## Releasing a report type's pages

Every held report type already takes the chosen template's design. Releasing
one means letting a template's own PAGES draw it, and a report type joins
`TEMPLATE_RELEASED_REPORT_TYPES` only when all three of these hold:

1. **Its parity check passes in CI.** For the same real record, on every
   master, everything the standard document prints is found in the template
   document, and the template document states nothing the record does not
   support.
2. **The owner has read one sample PDF** of the report type through a template.
3. **The register is edited**, in one line, in the pull request that carries
   the check.

A surface must never release a report type by itself. The register is read by
the one function every delivery path calls, and `templateParity.spec.ts` pins
its contents, so a release is a reviewed change to the register and its test
together, never a side effect of other work.
