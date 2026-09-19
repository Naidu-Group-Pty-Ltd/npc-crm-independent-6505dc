# The eight-section correction — what was measured and what changed

Instruction of 18 September 2026. The five supplied PDFs were **not** approved
as final client outputs, and passing automated checks does not establish that
their content, presentation and consistency meet the required standard. This
records what was found by execution against the real stored documents, what
changed, and what is still blocked.

Branch `claude/adoring-hopper-g02tdt`, PR #2692.

---

## 1. The provider and the white-label architecture

Aurixa Systems is the reporting platform: it supplies the structure, the
analysis, the quality controls and the **default** presentation. NPC Services
is a customer organisation using its white-label capability — one
organisation's presentation of the reports, not the engine's identity.

That architecture already existed. `issuerIdentity.pure.ts` has held
`PLATFORM_ISSUER_NAME = 'Aurixa Systems'` and a `NON_IDENTITIES` set since the
S4 round, and `whitelabel_settings` / `global_report_settings` have always been
where an organisation's name, marks, colour, contact details and disclaimer
come from. **No new branding interface, settings workflow or Template Builder
entry point was added.**

One thing was wrong, and it was one literal. `companyBlock.pure.ts` carried its
own fallback company name — `'Property Consulting'` — which is a string
`issuerIdentity.pure.ts` already lists among the names that are *the absence of
a brand rather than a brand*, beside `dashboard`, `NPC` and `property report`.
So a deployment that had configured nothing printed:

| Surface | Before | After |
| --- | --- | --- |
| Issuer line | Aurixa Systems | Aurixa Systems |
| Running foot, every body page | Property Consulting | Aurixa Systems |
| Closing page lockup | PROPERTY CONSULTING | AURIXA SYSTEMS |

Two answers to one question, in one document, neither chosen by anybody.
`FALLBACK_COMPANY_NAME` is now `PLATFORM_ISSUER_NAME`, and `printableCompanyName`
asks the exported `isNonIdentity`, so a settings row still holding a placeholder
— a restored backup, a copied clone — is treated as unconfigured rather than
printed.

### The three-organisation check

`src/lib/reportDesign/__tests__/whiteLabelIdentity.spec.ts` renders three
organisations through the real assembler (`buildReportBrandSnapshot` →
`resolveSnapshotBrand`) and checks each document for the OTHER two's identities
as well as its own:

| Organisation | Masthead | Brand colour | Disclaimer |
| --- | --- | --- | --- |
| Aurixa default (nothing configured) | Aurixa Systems | none | platform, and a deployment that never identified itself cannot switch it off |
| NPC Services | Naidu Property Consulting Services | `#D9A520` | its own |
| A synthetic second customer | Meridian Property Partners | `#2F6F4F` | its own, never with the platform's appended |

The third organisation is **invented for the test**. No other customer's name,
ABN, telephone number, address or mark appears in the file. The spec also pins
that the platform default carries no tenant colour at all and that house cover
art is never a white-label fallback.

The design system's import rule had to be corrected to let the presentation
layer ask the identity layer who the issuer is. It required a *sibling*
`.pure.ts` import on the stated reason that "Edge Functions cannot resolve
anything else", which is not true — a relative path into another `_shared`
directory resolves in Deno exactly as a sibling does, confirmed across all 413
entry points. The replacement is **stricter**: still relative, still `.pure.ts`,
and now required to exist on disk, which the sibling pattern never checked.

---

## 3. The seven content defects

The `.verify/fixtures` corpus holds the subjects the instruction names — **48
Redfern Street, Cowra** in three tiers and **1/27D Mitchell Street** in four.
Every finding below was produced by running the new rules over the real stored
`report_content`, not over a synthetic document.

### 3.1 VERIFY-EDIT in all five deliverables

Diagnosed to one line. `scripts/verify/report-journey/run.mjs:133` declares
``const MARK = `[VERIFY-EDIT ${Date.now()}]` ``, types it into the report to
prove the edit path persists, asserts it was written through the broker and read
back — and the **same run** then finalises that document. The acceptance PDFs
were contaminated by the harness's own edit-persistence test.

The fixture is reset between the two now (`restoreReportFields`, restoring from
a pristine clone held by the Supabase double), so the ordinary run produces a
clean document. `KEEP_VERIFY_EDIT=1` keeps the marker through to the PDF when
edit-preservation is what is being demonstrated.

It is a **fixture reset, not a scrubber**. A scrubber that deleted bracketed
text from stored content would delete a real user's edit just as readily; this
can only ever write what the fixture already said, so it cannot reach a
customer's content at all. `measure.mjs` additionally fails any document
carrying the marker — the check that would have caught it either way.

### 3.2 $467 on page 12 and $450 on page 17

Traced through the producer, the composition and the record. Executing both
paths against the real row:

```
stored     keyMetrics: annualNet -23,383  weeklyNet -450
reconciled keyMetrics: annualNet -24,273  weeklyNet -467
weeklyRent 445, occupancyWeeks 50 -> contractual 23,140, occupied 22,250
gap 890 a year = 17.12 a week — the two unlet weeks, exactly
```

`reconcileStoredFinancials` **re-bases** the metrics from the contractual rent
onto `weeklyRent × occupancyWeeks`, which is `calculateKeyMetrics`' own
definition. `composeFinancialChapters` calls it and printed `| Weekly net
position | -$467 |` twice; the strategy read did not, and the prose said
"$450 a week — $23,383 a year".

**Neither figure is wrong.** The document gave them the same name. Two changes,
neither touching an assumption or a formula: the fork hands **one** record to
both producers, and the row names its basis — `Weekly net position (50 of 52
weeks let)` — where an occupancy assumption under 52 exists, unchanged at 52
weeks or where the record states none. Verified: labelling the row drops the
finding from error to warning, which is the designed behaviour for a stated
second basis.

### 3.3 Interest-only $444,000 at 6.5% against $33,677

Found on the real Cowra Financial Analysis, verbatim:

```
| Loan amount | $444,000 |
| Interest rate (User specified) | 6.5% |
| Annual repayments (first year) | $33,677 |
```

A year's interest on that balance at that rate is **$28,860**; the figure
printed is **$4,817** higher, which is a principal-and-interest repayment. The
finding names all three lines and says: *establish it at the producer — the
label, the term recorded against the loan, or the figure the schedule was built
from — and do not change the accepted assumption to make the page agree with
itself.*

The single arithmetic expression in the detector is a year's interest on a
stated balance, which **is** the definition of an interest-only payment and is
already computed by `interestOnlyMonthlyPaymentFor`. A spec strips the comments
and fails on any exponent, growth rate or tax rate appearing in the code, so it
cannot become a second financial calculator.

### 3.4 B/62 against "Total Score: 60/100 (Overall Risk Score)"

Found on the real Mitchell Street Executive Briefing, verbatim:

```
- Total Score: 60/100 (Overall Risk Score)
```

One line, two claims, and a reader takes the first. The rule catches a figure
published under the overall assessment's own label while naming a different
metric. A risk score, a property-fit reading and an investor-readiness figure
are legitimate and are **not** the investment assessment; printed under its
label they read as a second opinion about the same question. (The same corpus's
Snapshot carries `Property Fit Score: 72`, `Overall Risk Score: 60` and
`Investor Readiness Score: 75` beside `Score: N/A/100`.)

### 3.5 Cowra's bedrooms and bathrooms

Found on the real Compass **and** the real Due Diligence report, verbatim:

```
- **Primary target tenant:** Local families with one or two children seeking a
  3-bedroom home with a yard
- Exact bedroom and bathroom count is not recorded, requiring confirmation to
  ensure layout meets target tenant expectations
```

The rule excludes any sentence about comparables, nearby or neighbouring stock,
the suburb's typical dwelling or a median — a neighbouring property cannot
establish this property's configuration, which is the rule
`evidenceClaims.pure.ts` already pays for.

### 3.6 Numerical graphics with no stated basis

Asked for, then checked. The generator's visual rules now require every figure
to state its dataset, period, geography and units in the sentence introducing it
or the line under it, with *state the finding in words* as the alternative where
none can be given. `findFiguresWithoutABasis` reads the finished markdown for
the eleven primitives that draw numbers a reader acts on, and rule 15 discloses
what it finds as a **warning**.

Removal would be wrong here: an occupier mix from the Census and one a model
chose look identical on the page, and `suppressUnrecordedVerdictVisuals` cannot
tell them apart either — it judges a declared 0–100 rating scale, and a tenure
share declares none. Deleting a sound figure to silence a warning takes real
data off the page. The remedy is a caption.

Measured on the corpus: 3–12 unbased figures per document.

Two readings had to be corrected by execution. A basis three sentences above a
figure was not found at all, because markdown separates every block with a blank
line and the window was counted in raw lines — it counts lines that carry text
now. And `{{donut: Register 4, Model 3, Portal 2}}` satisfied the rule by naming
a register as a **slice** of its own mix, so a directive can no longer vouch for
itself.

### 3.7 Empty columns, incomplete references, placeholders

`dropEmptyTableColumns` removes a column that is empty in every body row;
`stripEmptyCitations` removes a bracket the model opened and could not fill.
Both run on the **read** path in `presentStoredMarkdown`, so every stored report
repairs for every reader with no migration and no stored byte overwritten.

Three guards keep the column rule from removing a meaningful limitation. Only a
**literally empty** cell counts — a dash is a value in this product and a column
of them is a column of facts. The first column is never removed, because it is
the row's label. And a table is never reduced below two columns. A clean
document comes back byte-identical.

### What the two NEW rules actually did, measured

Swept over all eight distinct documents in the corpus:

| | |
| --- | --- |
| empty columns removed | **0** |
| empty citations removed | **0** |
| documents byte-identical after the whole read path | 5 of 8 |
| documents that GREW | 0 |
| total characters removed | 3,384 |

**Every one of those 3,384 characters is the placeholder scrub that already
shipped** — the Mitchell Street Briefing's 2,731, the Snapshot's 570, the Due
Diligence's 83. The two rules added this round fire on **none** of these eight
documents.

That is worth stating plainly, because an earlier draft of this document and of
the pull request implied otherwise. The empty columns and empty citation
brackets are on the five PDFs supplied for acceptance, which are **not** in this
corpus; the rules are therefore **preventive here and corrective there**, and
nothing in this round has been shown to remove an empty column from a document
anyone has seen. A rule that has not yet fired is not a repair that has already
happened.

---

## 4. The risk register

The section was declared as `Risk | Level | Why It Matters | Required Check` —
four columns, one of them an explanation and another an instruction, over
roughly eight risks inside a 550-word cap. A grid is the wrong container for two
paragraphs, so what printed was the paragraph-heavy table the instruction
describes. Measured on the corpus: **17 to 23** register cells per document run
past what fits on one line.

`riskRegister.pure.ts` declares the shape once and both ends read it:

- a **summary register** a reader can scan — `Risk | Exposure | Evidence`, each
  cell a phrase;
- a **detail block** per material risk carrying **Finding**, **Evidence**,
  **Implication**, **Next check**.

That is the legacy long-form report's educational strength restated as a
contract — *explain what important findings mean, why they matter, and what the
reader should verify* — and it is the same shape `planningControlGuide` and
`infrastructureGuide` already use, so a reader meets one pattern across the
document rather than three.

Three rules. **Exposure and evidence are different questions and never one
column**; a test asserts the two vocabularies share no value. **A register cell
is a phrase, never a paragraph** — twelve words, which is what sets on one line
at the register's column width, stated to the model and enforced by the
validator from the same constant. And **a detail block is offered for a material
risk, never for every row** — eight blocks under eight rows is the same table
with more white space, and a `Not assessed` row carries no finding to explain.

The section's own rules are untouched: `Not assessed`, the prohibition on an
evidence chip vouching for the rating beside it, and the crime / environment /
planning / supply coverage.

---

## 6. Evidence, and what it does and does not establish

Every finding in §3 was produced by executing the new rules over the real stored
`report_content` of the named subjects. That is a **retained-data replay**: it
establishes composition and detection against production content. It does not
prove fresh acquisition, model generation, resume or scoring.

| Defect | Found on | By |
| --- | --- | --- |
| VERIFY-EDIT | the harness itself | reading `run.mjs:133` |
| $467 vs $450 | Cowra financial | executing both producers against the row |
| interest-only vs $33,677 | Cowra financial | rule 14, verbatim three lines |
| score under the wrong label | Mitchell briefing | rule 14, verbatim one line |
| bed/bath asserted and withheld | Cowra compass + strategic | rule 14, verbatim two lines |
| unbased figures | all eight documents | rule 15, 3–12 each |
| paragraph-heavy register | all eight documents | rule 16, 17–23 cells each |
| placeholders | Mitchell briefing / snapshot / strategic | the read path, 2,731 / 570 / 83 characters — all from the scrub that already shipped |
| empty columns / citations | **none of the eight** | the two new read-path rules fire on 0 of 8; preventive here, corrective on the supplied PDFs |

### Regressions added

| Spec | Pins |
| --- | --- |
| `documentConsistency.spec.ts` | the four contradictions, with the owner's own figures as fixtures |
| `weeklyCashBasis.spec.ts` | the two bases and the label that separates them |
| `figureBasis.spec.ts` | a figure names its dataset, period or model basis |
| `riskRegister.spec.ts` | summary register plus detail blocks; exposure ≠ evidence |
| `emptyColumnHygiene.spec.ts` | an empty column goes; a column of dashes stays |
| `whiteLabelIdentity.spec.ts` | three organisations, no leakage |

No check was weakened and no financial baseline was refreshed. The Deno
type-check baseline is held at 334 across 413 entry points.

---

## 7–8. What is still blocked, stated once

**Fresh generation through the deployed candidate.** §8 asks for ten PDFs from
fresh Compass reports for Annabelle and Pallas plus four derived formats each.
Two things stand in the way and neither is worked around:

1. **The Annabelle and Pallas report rows are not reachable from this session.**
   `.verify/fixtures` holds 64 rows covering Cowra, Mitchell Street and
   Moranbah; neither subject is among them. The Supabase MCP server exposes no
   `execute_sql` in this session, so the rows cannot be fetched here. This is the
   **SQL tool being unavailable or denied in this session — not a disconnected
   server**, and it is not bypassed through Lovable, another database endpoint, a
   deployed function or a different credential. The minimum action is either
   `execute_sql` exposed on the Supabase MCP server, or the two rows placed under
   `.verify/fixtures/<id>/report.json`.
2. **Fresh generation needs this release deployed**, which is §7 and follows the
   merge.

The subjects' identifiers are known from `.verify/out/planning-probe.json`:
Annabelle `9bd41c05-7f9b-41e8-819a-a029f4121369` (18 Annabelle Crescent,
Kellyville NSW 2155) and Pallas `3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753` (262
Pallas Street, Maryborough QLD 4650).

**The Cowra and Mitchell examples were rechecked rather than avoided.** Every
defect in §3 is measured on those two subjects, which is what the instruction
asked for.
