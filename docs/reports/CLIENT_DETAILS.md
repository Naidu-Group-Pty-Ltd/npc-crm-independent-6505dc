# Client Details — the contract

The sixth format on the report design system, and the one that was in the worst
state — not because the document was badly designed, but because of what was
being done to it after it was built.

Route: `render-client-details-pdf`.
Canonical modules: `supabase/functions/_shared/reports/clientDetails/`.
Ledger: `client_details_renders` (migration `20260819000000`).

---

## 1. What was wrong with the shipping output

`FormaraPDFGenerator.tsx` (2,705 lines) builds careful HTML — per-property
blocks, equity bars, cash-flow indicators — writes it into a hidden iframe,
rasterises every page with **html2canvas**, and pastes the images into **jsPDF**.
Two mount sites, both in `ClientDetailsModal.tsx`: "Send to Finance" (`:269`) and
"Download Client Details PDF" (`:311`).

### D1 — every page of a client's fact-find is a picture

No selectable text, no search, no copy, no accessibility, no tagged structure.
The mortgage broker on the other end of "Send to Finance" — the first button on
the client toolbar, and the reason this document exists — cannot lift a single
figure out of it. **This is the whole of the migration's value.** Everything else
below is a bonus that falls out of not taking the raster step.

### D2 — the resolution depends on the data and on the adviser's laptop

```ts
const renderScale = totalHtmlElements > 8
  ? 1
  : deviceMemory <= 4 ? 1.25 : 1.6;
```

A client with more properties gets a **lower-resolution** document than one with
none, and two advisers pressing the same button on the same client produce
different files. `navigator.deviceMemory` is undefined in Safari and Firefox, so
those default to `4` and never reach the top tier.

### D3 — a two-minute cap, and the failure is the whole document

`generationDeadline = Date.now() + 120000` (`:472`), throwing "PDF generation
timed out". The records most likely to hit it are the ones with the most to say.

### D4 — our letterhead on a white-label tenant's document

`/templates/npc-formara-cover.jpg` is hardcoded twice (`:481`, `:2375`) as the
cover background, and `applyBrandGold(brand.brandColor)` (`:987`) mutates a gold
into the template around it. The same defect the Borrowing Capacity Snapshot was
migrated to fix, still shipping here.

### D5 — the document assumes a portfolio 97% of clients do not have

Measured before any code was written:

| | |
| --- | --- |
| clients | **771** |
| clients with **any** property | **26** |
| properties in total | 53 |
| employment rows / income rows | 39 / 26 |
| assets / liabilities / expenses | 99 / 96 / 506 |
| address history / second contacts | 54 / 13 |

The legacy opens on Properties Overview and follows it with per-property blocks
and a Portfolio Summary. For 745 clients that is a cover, some contact details,
and several pages of empty tables.

### D6 — emoji are load-bearing in the headings

`🏠 Owner Occupied`, `📈 Investment`, `🏛️ SMSF`, `💸 Personal Expenses`, and
`✓ ✗ ⏳ ▲ ▼ ●` for compliance status and cash-flow direction. Harmless when every
page is a raster of the browser's own rendering. **Tofu the moment the page is
real text**, because the design system's faces carry no emoji coverage.

### D7 — invisible to the design programme

Not in `DESIGN_SYSTEM.md`, no contract, no ledger. Its nine tables *are* in
`TABLE_TO_MODULE_MAP`, under `client_management` — which is correct, and decides
the new route's gate.

### D8 — no test named it

The only file mentioning Formara under a `__tests__` directory is
`rbacCrudContract.test.ts`, which is about permissions.

---

## 2. Where the boundary sits

**The server reads the record.** Everything this document says is a persisted row
in one of nine tables. Unlike the cash flow formats — where `CASH_FLOW.md` §1
argues the browser must own the arithmetic because a modal holds unsaved
overrides — there is nothing here the browser knows that the database does not.

So the request is **one id**. That also closes a class of defect the other
formats live with: a document produced from what a component happened to have
fetched is a document whose contents depend on which screen produced it. This one
can be rendered from anywhere, including from nothing but a client id.

**No borrowing-capacity pages.** The legacy has a toggle (default off, `:380`)
that appends pages drawn by `drawBorrowingCapacitySections`. Borrowing capacity
already has its own migrated format with its own contract, charts and page band;
carrying a copy inside this document would mean two places to fix the same
defect. The legacy toggle keeps working.

---

## 3. Derive, never accept

`clients.total_portfolio_value` and `clients.total_debt` are stored columns and
**are not read**. Every total in `position` is summed from the rows the document
also prints, so a figure in the summary cannot disagree with the table it
summarises. A stored aggregate is a cache, and a cache printed beside what it
caches is a second answer waiting to be wrong.

The same rule drops `client_properties.total_monthly_expenditure` and
`net_monthly_cashflow` in favour of deriving both.

**Frequencies are converted once.** `client_expenses` carries `monthly_amount`
*and* `frequency` — a column name asserting something the schema does not
enforce. Every amount goes through `freqToMonthly`, the same function the income
path uses. All 506 stored rows say `monthly`, so today the conversion is the
identity; it is still the conversion.

**Council and water rates are annual** despite their `monthly_` prefix, and are
divided by twelve — the trap `finance.pure.ts` already documented.

---

## 4. One finance engine, two callers

`src/utils/householdFinance.ts` moved to
`_shared/reports/clientDetails/finance.pure.ts`. Its rules are unchanged and its
original header is reproduced in the new file.

The browser file is now the **binding**: it re-exports everything and supplies
the one thing a pure module cannot have — `getHecsRepayment`, which reaches
`policyEngine.ts` for the ATO bracket table. Every existing caller
(`BorrowingCapacityModal`, `FormaraPDFGenerator`, `borrowingCapacityPdfSections`)
keeps its exact behaviour.

**Measured while moving it: there is no `hecs` or `help` row in the record at
all.** The 96 liabilities are `other` (31), `credit_card` (28), `vehicle_loan`
(13), `personal_loan` (12), `student_loan` (10), `car_loan` (1) and `mortgage`
(1). Student debt is recorded as `student_loan`, which takes the ordinary path,
and all ten of those rows carry a captured repayment. So the branch that needed
the policy engine has never fired in production.

Two things that turned up and were left as found, both recorded rather than
fixed:

- `ASSUMED_TERMS` keys `car_loan` (1 row) but not `vehicle_loan` (13 rows), so a
  vehicle loan with no captured repayment would be estimated on generic terms.
  No such row exists.
- The `student_loan` type reaches the generic P&I estimate rather than an ATO
  bracket. Again, every row carries a captured repayment, so it does not bite.

`clientDetailsSourceOfTruth.spec.ts` asserts the browser file binds rather than
reimplements — it may add `hecsMonthlyFor`, and it may not take back
`byContact`, `ASSUMED_TERMS`, `estimatePIRepayment` or `sumTrueHolding`.

---

## 5. The document

Archetype `client-details`, `pageBudget: [4, 34]`, `contents: true`.

| # | Section | Slot | Appears when |
| --- | --- | --- | --- |
| 1 | Who this is about | chapter | always |
| 2 | Where they live | chapter | an owner-occupied property exists |
| 3 | Work and income | chapter | employment or income rows exist |
| 4 | What they own and owe | chapter | assets or liabilities exist |
| 5 | What they spend | chapter | expense rows exist |
| 6 | The property portfolio | wide-table | any investment or SMSF holding |
| 7 | Each property in turn | chapter | any investment or SMSF holding |
| 8 | Where they stand | chapter | always |

**Sections 1 and 8 are the document**, and D5 is why. A client with a name and an
address produces a five-page report that reads as finished — and its last page
says so in as many words:

> **No financial information is recorded for this client.** The record holds
> contact details but no income, assets, liabilities, expenses or property.
> Everything above is what we have. This document is complete — the record is
> not.

That sentence is the most useful thing this format can put in front of an adviser
about to send a record to a broker.

**The home is not in the portfolio.** A home is somewhere to live before it is an
asset. It has its own section and it counts in net worth — leaving it out would
understate what the client owns — but it is kept out of the holdings tables,
because counting it there overstates what they *invest*.

**Emoji are dropped, not carried** (D6). Property type, compliance status,
trustee type and the essential flag are all words; direction is the sign and the
tone that `renderDataTable`'s `signedKeys` already applies. The conversion
happens in `normalise.pure.ts` so a renderer cannot undo it, and
`normalise.spec.ts` asserts no emoji appears anywhere in a built payload.

---

## 6. The charts

Three, each returning `''` when its data is absent — which for this format is
the ordinary case.

1. **Income against commitments** (`renderBullet`). Four formats rejected this
   primitive with the same sentence: it needs a value against a target, and
   nothing in those documents was measured against a threshold. Here something
   is. The bands are 70% and 90% of commitments, drawn from the income itself
   because a household on $6,000 a month and one on $30,000 are not comparable in
   dollars.
2. **Where the money goes** (`renderDonut`). 506 expense rows is the densest
   thing the record holds and no document has ever summarised them. Categories,
   not lines; the tail past the eighth is gathered rather than dropped so the ring
   still sums to what they spend.
3. **Value against what is owed** (`renderBars`, explicit `tone`). Two bars a
   property, so the equity is the gap rather than a subtraction in the reader's
   head. One scale across every holding.

**Rejected:** a quadrant (no two comparable non-negative axes); a heatmap (prints
raw numbers — see `CASH_FLOW_COMPARISON.md`); a score wheel (one polygon per
call); a net-worth waterfall (assets less liabilities is two numbers, and the
Borrowing Capacity's waterfall was deleted for disagreeing with the figure
beneath it).

---

## 7. What the renders found

Five distinct record shapes rendered through local WeasyPrint and read page by
page: a name-only client (5pp), one with details and address history (7pp), one
with finances and no property (19pp), one with a home (19pp), and the largest
real shape — two contacts, four holdings, 100 expense rows (26pp).

Fixtures are fictional at the record's **measured dimensions**: longest property
address 55 characters, longest client address 47, longest employer name 57, most
expenses for one client 100 across 14 categories, most liabilities 16, most
assets 18, most address history 18, biggest portfolio 4. That stresses the layout
exactly as far as a real client would without moving anyone's PII into a file.

Five defects, none of which any test would have caught:

1. **The page band refused the 97% case on the very first render.** A name-only
   client is five pages against a floor of six. Refusing to render a client
   because little is recorded about them is refusing most of the book. Floor
   dropped to four.
2. **Every per-section budget under-declared, by up to six pages.** That is the
   dangerous direction: it lets a large record render past the ceiling while the
   spine reports that it did not. Replaced with three measured rates — address
   history 12 rows a page, ledger rows 16, expense lines 24 — that do not assume
   the first rows share the chapter's opening page.
3. **The bullet chart's sub-label ran off the left edge.** `renderBullet`
   right-aligns label and sub into a 138-unit gutter and clips. The figures moved
   to the caption.
4. **The expense donut's caption named the wrong total** — $54,739 of
   commitments beside a ring summing $32,010 of expenses. A sentence disagreeing
   with the chart above it by $22,729.
5. **"UNIT 7" as a column heading.** Half the addresses in the record open with a
   unit or lot number, so the first comma segment names nothing. `shortAddress`
   takes the street line with it and clips on a word; the matrix and the bar
   chart share it, so both pages name a property the same way.

And one from the data rather than the page: **all seven SMSF properties carry
none of the seven `smsf_*` columns**, so the legacy's "Fund Details & Compliance"
block, ticks and hourglasses included, has never had anything to show. The
section here is absent until something is recorded, and the guard shows the block
when *any* field is present rather than requiring a fund name — a compliance
status recorded without one is exactly what a broker looks for.

---

## 8. The render path

1. **`verifyAuthOrNativeUser`, service-role refused.** Then
   `requireModulePermission(actor, 'client_management', 'can_view')` — **not
   `reports`**. Every table this reads is mapped to `client_management`; gating
   on `reports` would let someone read a client record through a report route
   when they cannot read it directly. Then `canAccessClient` for the row itself,
   because the module permission says *whether*, not *which*. A refusal there is
   403 rather than 404: the caller has already proved they may read client
   records, so the row's existence leaks nothing.
2. **Nine reads in one `Promise.all`**, and the **error checked before the data
   on every one**. A failed query returning nothing is not an empty table, and
   for this format the two are indistinguishable on the page — a client with no
   liabilities and a client whose liabilities failed to load produce the same
   document unless the route says otherwise.
3. **Brand snapshotted then referenced**; **resources checked before the POST**.
   The cover comes from the tenant's own asset and nowhere else (D4).
4. **No fallback, and every attempt leaves a row.**
5. **Not metered.** No model is involved anywhere in this format — the first in
   the programme with nothing to meter.

**Filename:** `Client Details - <Name> - <DD Mon YYYY>.pdf`, written for the
person who reads it in a downloads folder or an attachment row
(`readableFileName.pure.ts`, §12). It was `Client_Details_<Name>_<YYYY-MM-DD>.pdf`.
**Still a deliberate divergence from the legacy's**
`Formara_Form_<Name>_<date>.pdf`: "Formara" is a vendor's name for a broker
form standard, it appears nowhere on the document, and it means nothing to the
client or broker who receives it.

**Storage:** `client-details/<clientId>/<date>/<uuid>-<name>` in `client-files`,
the name made URL-safe (`storageSafeFileName`): the readable name is what a
person is handed, the key is where the bytes live.

---

## 9. The ledger

`client_details_renders`. Beyond the usual file, brand, timing and error columns:

| Column | The question it answers |
| --- | --- |
| `property_count` | how many of these documents have any portfolio in them — D5's question, and the one the whole structure turns on |
| `sections_included text[]` | why one client's file is five pages and another's twenty-six, without re-rendering either |

The client's details are **not** copied here. They are already rows in nine
tables and this document is a rendering of them; a snapshot in the ledger would
be a second answer to what the record says.

---

## 10. The legacy stays, and reaches the same three places

`FormaraPDFGenerator` still draws its document, still rasterises, and keeps all
three destinations. `ExportFormaraButton`, `ClientFormaraUpload` and
`ClientFormaraForms` are untouched.

The new control sits beside it and offers the **same three destinations**, which
is where the migration's value actually lands:

| Destination | What changes |
| --- | --- |
| Download | selectable, searchable text instead of page images |
| Attach to an email | the composer gets a real PDF |
| Send through the Finance Portal | the broker receives something they can copy figures out of |

`deliverClientDetailsPdf` returns the `Blob` for exactly that reason — both email
paths take one — with `save` opt-in, because two of the three callers do not want
a file on disk.

`requestClientDetailsPdf` takes **no legacy fallback**: the two documents are
genuinely different, one being a picture of the other's ancestor, so substituting
either would send a broker something nobody chose.

`legacyPathStays.spec.ts` carries the load, and every assertion in it was
verified by breaking the thing it guards. Two were found to be weak that way and
tightened: `toContain('canAccessClient')` was satisfied by the import line alone,
and `toContain('blob: Blob')` by an unrelated function parameter.

---

## 11. Deployment

1. Apply `20260819000000_client_details_render_path.sql`.
2. Deploy `render-client-details-pdf`.

Until then the new control fails with a message naming the buttons that work,
which keep working throughout.

---

## 8. The Template Builder path — the same record, fifty designs

Everything above is the **render route**: `render-client-details-pdf`, one
archetype, `pageBudget: [4, 34]`, a WeasyPrint container that can paginate.

`/admin/template-builder` can now activate one of **50 design templates** for
`report_type = 'client_details'` instead, drawn in the ten Investment Compass
families. `clientDetailsAdapter` drives them, and it reads the same nine tables
through the same `buildClientDetails` — one reader, two renderers, one answer to
every question in §3 and §4 above. `formara`, the legacy generator's own name
for this document, aliases to the same adapter so a template stored under it is
activatable rather than stranded.

### The family pages cannot paginate, so the bounding moved

The archetype route flows: a 100-row expense table becomes three pages. A family
master is absolutely positioned and cannot — a table that runs long does not
spill onto the next page, it prints over whatever follows. So
`clientDetailsProjection.pure.ts` bounds every collection, and every bound is
measured:

| Collection | Max in the record | Family masters draw | Clients above it |
| --- | --- | --- | --- |
| Expense rows | **100** | grouped, never listed | — |
| Expense categories | 14 | 14 | 0 |
| Assets | 18 | 8 | 2 of 20 |
| Liabilities | 16 | 8 | 1 of 18 |
| Properties | 4 | 4 | 0 |
| Employment | 3 | 3 | 0 |
| Address history | 18 | 4 | 2 of 18 |

**Expenses are grouped rather than truncated.** One client records 100 rows and
the average among the thirteen who record any is 39 — no cap short enough to fit
a page leaves a useful document, and a category total is what a broker reads
anyway. Grouping is safe on the payload and would not be on the column:
`expense_category` is stored as `groceries` beside `Groceries` and
`health_insurance` beside `Housing`, and `humanise()` has already folded them.

Where a cap does bite the page says so, with the count from the record beside
it. That is `PORTFOLIO.md`'s F4: the finding against the shipping generator is
not that it stops, it is that it stops "with nothing on the page saying so".

### D5 is the design, not a special case

742 of the 775 clients hold nothing financial. Every financial page in these
masters carries `conditional: clientDetails.hasFinancials`, so a conditional
page costs nothing when it does not render — the same fifty masters produce a
5-page document for those 742 and up to 13 for the other 33.

The closing page draws **two blocks at one position** under opposite
conditionals: the summary of where the client stands, or §5's sentence. Exactly
one renders, and `clientDetailsCatalogue.spec.ts` asserts both directions.

`hasFinancials` is deliberately not `netWorth > 0`: a client holding a property
worth exactly what is owed on it has a net worth of zero and a great deal
recorded, and one with only liabilities has a negative net worth and the same.

### What this format can bind that the others cannot

`{{client.name}}`. `clients` is the source table, so the document is genuinely
about a named person — and this is the only one of the six formats where that
binding resolves. The Borrowing Capacity, Comparison and Cash Flow masters name
their subject instead, because their source tables carry no client at all; all
three shipped a blank cover title before that was measured.

### The routing read named two columns that do not exist

`resolveRoutingContext` selected `id, first_name, last_name, updated_at,
created_at` from `clients`. **The table has neither `first_name` nor
`last_name`** — it stores `primary_first_name` / `primary_surname`, plus the
secondary applicant's pair. PostgREST does not drop an unknown column, it fails
the whole statement with `42703`; supabase-js returned `{ data: null, error }`;
the function's `if (error || !data) return null` turned that into "no such
client" for **all 775 of them**. Routing resolves before binding, so the fifty
masters were unreachable through the product path for every client in the
database.

It was invisible for the reason this class always is. `buildBindingContext`
selects `*` on the same table and was therefore always correct, so the
production-fit harness, the catalogue specs and every render in this programme
exercised the document happily while the one read that decides whether a
document may be produced at all failed on contact with the schema. The same
misspelling had already 404'd `render-borrowing-capacity-pdf` for every client
once, which is why `_shared/clientName.ts` exists and exports
`CLIENT_NAME_COLUMNS` as a single string — so a caller cannot ask for three of
the four columns, or invent a fourth spelling. The routing read now uses it.

The rule that follows: **a column name is not checked by TypeScript anywhere on
this path** — every row crosses the boundary as `Record<string, any>` — so
`__tests__/adapterSelectColumns.spec.ts` checks each one against the generated
`src/integrations/supabase/types.ts`, which mirrors the live schema. It covers
the select list *and* the filters, because `.eq('is_actve', true)` raises the
same `42703` as a mistyped select, and because the nine-table load above is nine
`select('*')` reads whose only column references are their filters.

### The name on the page was the name in the box

`clients` stores names as they were typed, and they were typed in lower case:
**746 of the 775 records have an all-lowercase first name and 740 an
all-lowercase surname.** `toContacts` set them on the page exactly as stored,
so the fixture this format is measured against — a real two-person record —
opened with "lavanethaan ravachandran & Kunjimon Koothy", two casings in one
line, on a document whose purpose is to be sent to a broker.

This was not a house style, it was a divergence between two documents of the
same record: `FormaraPDFGenerator`, the legacy generator this format replaces,
has always run the same four columns through `smartCapitalize`, so the
rasterised PDF a client already receives says "Lavanethaan Ravachandran". The
normaliser now composes a person's name with `personName`, which imports that
same function rather than restating it.

Two rules come out of it. **Only a name may be re-cased.** `joinName` also
composes a vehicle's make and model, where title-casing turns "BMW X5" into
"Bmw X5" — so the casing lives in a second helper and a spec asserts the asset
description is untouched. And **one composition, used by both callers**:
`composeClientName` is exported and the adapter titles the document with it,
because the routing context used to compose `first + surname` while the
document composed `first + middle + surname` and joined a couple with "&" —
so the eleven records carrying a middle name, and the thirteen describing two
people, produced a file titled for a differently-named person than the pages
named. The routing read selects the two middle-name columns on top of
`CLIENT_NAME_COLUMNS` rather than widening that constant, because the
Borrowing Capacity cover deliberately prints two parts.

### The preview picker offered the 96% that has nothing in it

**34 of the 775 clients hold any property, asset, liability, employment or
expense record at all.** `listRecentReports` ordered by `updated_at`, so
"preview with one of your own reports" mostly produced a document of empty
tables — the one thing that view exists to avoid, since sample data already
proves the design and only a real record can show how it holds real numbers.

Most of the list is now clients that have records, and the rest is whatever is
most recent. Not all of it, deliberately: a client with a name and nothing else
is this format's ordinary case (D5 above) and the masters are built around it,
so both shapes stay one click away. The five reads that decide this are a
preference and not a requirement — a table the caller cannot read contributes
nothing rather than emptying the picker.

See [`../template-library/07-investment-compass-families.md`](../template-library/07-investment-compass-families.md)
for the design system these 50 masters are drawn in.

---

## 12. The audit (1 Oct 2026)

The fifth document in the report audit, after the Intelligence Hub Summary, the
Portfolio Performance Review, the Borrowing Capacity Snapshot and the Strategy
Rationale Brief. The five record shapes of §7 were drawn through the production
normaliser, composer and renderer in the standard layout and every one of the
fifty catalogue designs, measured from WeasyPrint 69.0's own box tree, and read
page by page.

### What was wrong

**The layout was a set of separate pages.** Every section opened a page, so a
record holding a name and nothing else was five pages, each of its two sections
on a page of its own — the ordinary case, since 742 of the 775 clients hold
nothing financial (§8) — and the largest record was 25. Subheads such as "Primary
contact" and "Liabilities" were set within a point of the section they sat in,
and read as rival titles. Tables split wherever the page ended: across the 255
documents measured, 56 splits left a single row on one side of a break. The portfolio matrix
took a landscape sheet of its own, a third full, its columns headed by addresses
clipped at thirty characters ("Unit 14, 238-242 Great…").

**The words were the database's.** Each of these printed on a client's record:

| Printed | What the record held |
| --- | --- |
| `1984-03-17` | a date of birth |
| `Nab`, `Commonwealth bank` | the provider as typed: `NAB`, `Commonwealth Bank` |
| `Internet phone`, `Gym fitness` | the expense form's own categories, `Internet and phone`, `Gym and fitness` |
| `Est. P&I @ 9% / 5yr`, `3% of credit limit` | the finance engine's note to itself, as the basis of a figure |
| `Family Tax Benefit (Secondary)` | an income line, beside a column already saying whose |
| `…, Wentworth Point, NSW 2127, Australia` | an Australian address, as one line |
| `Primary contact — details` | the caption, repeating the subhead above it |

**The summary disagreed with the record or repeated it.** It sat above the
contact details as a lede, so a reader met "The record holds…" before learning
whose record it was. On an empty record it said what the closing callout says, in
other words, a page earlier. It counted the home's value and not the home ("holds
1 property worth $1,500,000" for a home and an investment), and it wrote "$0 of
debt" for a property owned outright.

**Figures about things the record does not hold.** A client with no property was
shown "Property value $0", "Property debt $0" and "Property equity $0", and a
"$0 held" figure at the head of Where they stand. The home's sidenote explained
"the portfolio tables" to a client who has none. A record of one person carried a
Contact column on every table, saying the same name on every row. The matrix's
caption repeated the section's standfirst ("Every holding, side by side") and
then vouched for the software: the net "cannot disagree with the two rows above
it".

**The export surface.** One button, "Typeset details", with the template choice
at the foot of its destinations menu; and a file named
`Client_Details_Rohan_Mehta_Castellano___Imogen_Castellano_2026-09-30.pdf`.

### What it does now

- **The sections run on as memo sections**
  (`openChapter(…, { runOn, memo: true })`), as the Portfolio review's do: each
  follows the last on the same page, and a section heading is never left at a
  foot. Subheads are set one modular step below the section title
  (`SECTION_SUBHEAD_CLASS`).
- **The summary sits under the contents**, as "About this record", and says
  only what the record says: who the household is, what it holds and owes, and
  income against commitments. An empty record has no summary at all, because
  the closing section already says so. The holdings count takes the home in
  wherever the value does, and a property with no loan is "no debt recorded
  against it".
- **One rule decides whether a record holds any finances**:
  `recordHoldsFinancials` in `payload.pure.ts`. There were two, and they
  disagreed in both directions. The document's closing section was numeric (net
  worth, income and commitments all zero), so a property worth exactly what is
  owed on it, with no repayment or income recorded, was told "No financial
  information is recorded". The template projection's `hasFinancials` read the
  collections and never the income, so a client whose only record is a pension
  drew that sentence on every template master while the standard document set
  out the income. The summary, the closing section and the projection all read
  the one rule now.
- **Tables are kept by estimated height** (`keptTable`, `leadRows: 2`), the
  rule the Hub and the Portfolio review use: a short table moves whole, a long
  one splits with at least two rows on each side. Assets and liabilities carry a
  total row. The Contact column is drawn only where the record names two people,
  and a row then names the person by first name.
- **Up to five holdings are drawn side by side on the section's own page**
  (`reportDesign/portraitMatrix.pure.ts`), headed by the whole street line
  (`streetLine`, which never clips, because these heads wrap), and kept whole:
  eight lines read across as one comparison, and split six and two the net
  figures turned over to a page of their own. That is a new `KeepOptions`
  field, `wholeUpToRows`, with its default unchanged. The module is the
  Portfolio review's matrix, moved rather than copied; the Portfolio review
  renders byte for byte as before (hashed for 1, 3, 5, 6 and 10 holdings in the
  standard layout and all fifty designs). Past five holdings the landscape sheet
  stays, with the clipped heading, because its columns cannot wrap.
- **The words are the record's.** Dates are set as dates (`17 March 1984`, and
  `01 Feb 2024` in a table), and a date that cannot be read is kept as it was
  recorded rather than lost. A provider is printed as typed. Categories are
  named as the expense form names them. The basis of a servicing figure is said
  in words — "Estimated: principal and interest at 9% over 5 years",
  "Estimated: 3% of the limit", "As recorded" — and a note the translation does
  not know is printed as written, never guessed (`liabilityBasis`). An address is
  one line in the Australian form, a country named only when it is not
  Australia, and a suburb the street line already ends with is not printed twice
  (`addressLine`, judged by position, because streets are named after the
  suburbs they run through).
- **Nothing is drawn about what the record does not hold.** Without property,
  Where they stand has no property rows and no property figure; it reads
  "Assets" and "Liabilities", and leads with what share of income is committed.
  The home's sidenote is drawn only where there is a portfolio to keep it out of.
  The matrix's caption says only which lines are monthly.
- **The choice sits beside the act.** "Choose template" is its own button before
  "Export PDF" (`ChooseTemplateButton`), as on the Hub, the Portfolio review,
  the Borrowing Capacity Snapshot and both comparisons; the caret keeps the
  three destinations. The file is
  `Client Details - Rohan Mehta-Castellano & Imogen Castellano - 30 Sep 2026.pdf`
  (§8).

### Measured

Each shape drawn in the standard layout and the fifty designs (51 documents a
shape), measured on WeasyPrint 69.0 with the render service's own options. A
page "more than a quarter empty" is a body page whose foot is more than a
quarter of the content box below its last line; the cover, the contents page and
the closing page are not body pages, and the last body page is left out of the
gap statistics, because a document ends where it ends.

| Record shape | Pages, standard | Pages, all 51 | Body pages more than a quarter empty | Emptiest measured page | Mean fill | Splits leaving one row alone |
| --- | --- | --- | --- | --- | --- | --- |
| A name and nothing else | 5 → 4 | 255 → 204 | 51 → 0 | 43.1% → none measured¹ | 63.7% → —¹ | 0 → 0 |
| Details and 18 addresses | 7 → 6 | 348 → 306 | 42 → 0 | 85.2% → 23.9% | 72.1% → 87.5% | 7 → 0 |
| Finances, no property | 14 → 12 | 705 → 604 | 145 → 57 | 87.3% → 40.7% | 77.1% → 85.4% | 9 → 0 |
| Finances and a home | 16 → 13 | 817 → 661 | 155 → 116 | 93.3% → 33.1% | 75.8% → 87.9% | 12 → 0 |
| The largest record | 25 → 22 | 1,266 → 1,106 | 306 → 192 | 94.0% → 52.4% | 78.6% → 87.4% | 28 → 0 |
| **All five** | | **3,391 → 2,881** | **699 → 365** | | | **56 → 0** |

¹ Its one body page is now its last, which the gap statistics leave out.

What remains part-empty is a whole block moving to the next page: a section's
heading with the table it opens, or a contact's details with their subhead. The
worst, 52% on one page of the largest record, is the Property portfolio's
heading and its matrix moving past the last page of a 100-line expense list. A
matrix split to fill that space would print its net figures on the next page,
which is the defect the whole-matrix rule exists to stop.

### Not changed

- **The legacy `FormaraPDFGenerator`** is untouched (§10).
- **The fifty Template Builder masters** (§8, second) are unchanged. They bind
  the projection, whose one change is `hasFinancials`: a record whose only entry
  is income now draws its summary rather than the empty-record sentence.
- **The order of the sections** is unchanged.
- **The chart labels** keep `shortAddress`: a bar's label cannot wrap.

`render.spec.ts`, `normalise.spec.ts` and `ClientDetailsDownloadButton.spec.tsx`
pin each of these on the document's markup and the record's words. The page
measurements behind them are taken on the engine and are not something a unit
test can hold.
