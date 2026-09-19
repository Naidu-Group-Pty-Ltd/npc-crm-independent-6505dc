# Investment Property Report — template workflow and binding audit

**RF-7.2A. Read-only. The workflow was NOT modified.**

---

## §1 The template authority boundary

The rule this audit exists to test. A template is **presentation**, never
**business logic**.

| Templates MAY control | Templates MAY NOT control |
| --- | --- |
| logo, branding, typography, colours | authoritative facts |
| layout, spacing, page breaks | financial calculations |
| cover style, card style, table style | scoring calculations |
| chart styling | market calculations |
| headers and footers | source precedence |
| permitted section arrangement | evidence trust |
| number **formatting** | unavailable-data substitution |
| | finance assumptions, projections |
| | factual narrative inputs |

## §2 The current workflow, end to end

```
generated report (investment_reports row)
  → selectableTemplatesForFormat()        report_templates WHERE is_active AND report_type ∈ {investment, investment_compass}
  → operator picks                        report_template_selections  (user_id, format) → template_id
  → resolveTemplateSelection()            reads the SELECTION first, then the ranking; never instead of it
  → projectInvestmentReport(row)          ← the ONLY place a template's facts come from
  → bindings resolved                     bindingResolver.resolveBindable
  → brand snapshot applied                reportDesign/snapshot.pure.ts  (brand_snapshot_id on the row)
  → render-template-pdf                   WeasyPrint
  → on ANY failure → render-investment-report-pdf (legacy WeasyPrint)
  → deliverInvestmentPdf → download / send / portal
```

Measured state of the workflow:

| Question | Answer |
| --- | --- |
| Active templates, all formats | **16** (all `engine = weasyprint`, all `tier = compass`) |
| Active **investment** templates | **4** (`investment` ×1, `investment_compass` ×3) |
| Template library entries | 543 |
| Stored user selections | **5** |
| Where the template id is stored | `report_template_selections`, keyed by **(user, format)** — *not* on the report row |
| Where the template **version** is stored | `report_templates.version` — but **not captured onto the report** |
| Can selection occur after generation? | **Yes** — selection is read at render time, not at generation |
| Do preview and download use the same template? | **Yes** — both go through `resolveTemplateSelection` |
| Does changing template change report facts? | **No** — see §4 |
| Fallback if the template render fails | legacy `render-investment-report-pdf`; throws only if **both** engines fail |
| Do historical reports retain their original template/version? | **No** — a re-render uses whatever is selected *now*. See §6.1. |
| Brand snapshot | `brand_snapshot_id` on the report row; resolved by `reportDesign/snapshot.pure.ts`; unbranded falls back to **Aurixa Systems** |

## §3 The binding census

All 4 active investment templates, every `{{…}}` occurrence extracted from
`config` + `schema`:

| Namespace | Occurrences | Distinct paths | Source |
| --- | ---: | ---: | --- |
| `property` | 423 | 11 | `projectInvestmentReport` |
| `report` | 410 | 3 | `projectInvestmentReport` |
| `narrative` | 160 | 1 | `projectReportNarrative` (`report_content`) |
| `financials` | 120 | 24 | `projectInvestmentReport` |
| `assessment` | 84 | 18 | `projectInvestmentReport` |
| `org` | 48 | 10 | `organisationProjection` |
| `recommendation` | 36 | 6 | `projectInvestmentReport` |
| `assumptions` | 24 | 4 | `financial_calculations.assumptions` |
| `summary` | 8 | 2 | `projectInvestmentReport` |
| `risks` | 4 | 1 | `projectInvestmentReport` |
| `opportunities` | 3 | 1 | `projectInvestmentReport` |
| **Total** | **1,320** | **81** | |

## §4 Classification — and why fact parity holds by construction

Scanned across all 4 active investment templates:

| Hazard | Occurrences |
| --- | ---: |
| Handlebars blocks (`{{#if}}`, `{{#each}}`) | **0** |
| Nullish defaults (`??`) inside a binding | **0** |
| Inline arithmetic (`{{ x * 1.05 }}`) | **0** |
| Helper calls | **0** |
| **Raw column reads** (`financial_calculations`, `investment_score`, `demographics_data`, `location_intelligence`, `manual_overrides`) | **0** |
| Formatter pipes (`currency`, `percent`, `percent:0`, `number`) | 4 templates |

**Every one of the 81 paths is a plain lookup.** No template computes, defaults,
transforms meaning, substitutes a fallback, reads a raw column, or duplicates
business logic.

| Classification | Paths | Note |
| --- | ---: | --- |
| **SAFE** — pure presentation | **81** | every binding, including the formatter pipes |
| **MIGRATE LATER** — should eventually bind to the Fact Contract | 81 | all of them, once RF-7.2B+ adopts the contract; they bind the projection today, which is correct for now |
| **DANGEROUS** — can produce a fact different from another template | **0 in use** | but see §5 |

**Cross-template fact parity therefore holds by construction, not by luck**:
every template reads one projection of one row. Two templates cannot disagree
about a number because neither computes one.

## §5 The two hazards that are real but not currently firing

### 5.1 The binding language permits business logic

`bindingResolver.ts` supports `{{= price * 0.052 | currency}}` — an inline
expression evaluated against the bound data, plus `{{=name}}` computed-field
references. **No active investment template uses either** (0 occurrences), but
the mechanism permits exactly what §1 forbids. A template author — or an
imported or converted template — can add one, and it would compute a fact that
another template does not have.

**Classification: DANGEROUS (capability).** Not changed here. The remedy is a
guard, not a rewrite: refuse `{{=` in a production-safe template.

### 5.2 A formatter turns an absent value into zero

Proved by execution:

| Bound value | `{{x \| percent:0}}` | `{{x \| currency}}` | `{{x}}` |
| --- | --- | --- | --- |
| key missing | `""` | `""` | `""` |
| explicit `null` | **`"0%"`** | **`"$0"`** | `""` |
| empty string | **`"0%"`** | **`"$0"`** | `""` |
| genuine `0` | `"0%"` | `"$0"` | `"0"` |

`applyFilters` runs **before** the null check and `Number(null)` is `0`. Today
this never fires because `reportBindingProjection.put()` refuses `undefined`,
`null` and `''`, so an absent fact is a missing key. **The guarantee rests on
that single function.**

Note the second half: a genuine zero and an absence render identically. The
output cannot distinguish "cash flow is zero" from "cash flow is unknown".

**Classification: DANGEROUS (latent).** Not changed here — it is a production
behaviour change.

## §6 Workflow findings, not changed

### 6.1 A historical report does not retain the template it was rendered with

Selection is `(user, format)`, read at render time. Re-rendering a 2025 report
today uses today's selection and today's template version. `report_templates`
carries `version`, and nothing copies it onto `investment_reports`.

**Impact:** a client asking for "the same report again" can receive a
differently-laid-out document. The **facts** are unchanged (§4), so this is a
presentation-fidelity issue rather than a factual one.

### 6.2 Selection is keyed by user, not by report or workspace

Two operators in one workspace can render the same report under different
templates. Again presentation-only.

### 6.3 Only 5 selections exist

With 4 active investment templates and 543 library entries, the ranking — not
the operator — is choosing the template on virtually every render.

## §7 What RF-7.2B must accept as its acceptance condition

Not built here; recorded so it is not re-derived:

```
Report Fact Contract  ==  presentation model facts
                      ==  Viewer facts
                      ==  PDF facts
   for every template, including white-labelled ones
```

RF-7.2A establishes that the right-hand side is currently produced by **one**
projection for all templates, which is what makes that invariant reachable.
