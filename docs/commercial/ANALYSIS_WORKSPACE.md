# The Commercial & Industrial Analysis Workspace

Read this before touching `/calculators`, `src/components/commercial/workspace/`,
`src/lib/ciAssessment/analysis*.ts`, or anything that decides where a standalone
analysis is stored.

## 1. What was wrong, measured

The standalone calculator suite (`PropertyCalculators.tsx`, 986 lines) was not
short of capability. It was short of a **record**.

- **Nothing was persisted.** The entire deal lived in
  `utils/commercial/commercialDealState.ts` — a Zustand store created at page
  load with no storage of any kind. A refresh, a crash or a click on a link
  discarded every input. Business-critical state existed only in browser memory.
- **"Generate Report" produced no document.** It set `reportGeneratedAt` in
  React state, dispatched a `window` event and returned. No PDF, no storage
  object, no render record, nothing on a client. The button was enabled by a
  readiness calculation derived from hand-written field-name lists
  (`requiredReportHints`, `reportSectionsRequired`) matched by string against
  that transient store.
- **Seven command surfaces competed** on one screen: a Calculator Command
  Centre hero, a domain panel, an Active Property Header, a Calculator Property
  Bar repeating it, Global Generation Controls, a workflow readiness strip, an
  assumption drawer, plus per-card actions. Each offered a next action. None was
  authoritative.
- **Every calculator held its own copy of the deal.** The same purchase price,
  rent and rate were entered per card, so two cards could disagree about the
  same building and a ten-year cash flow could be run against a loan the
  assessment never proposed.

## 2. What it is now

One workspace, over the platform's existing durable spine.

**The analysis _is_ an assessment record.** There is no new table, no
"calculator session", no second client model and no second property model. An
analysis and an assessment are the same object seen from two ends — the
calculator suite simply had no durable end. That gives it, for free and without
a second implementation: a stable id and reference, autosave with version
conflict detection, immutable calculation runs, a client link with
reconciliation, an audit trail, and a rendered report filed against it.

```
Context → Property → Income & lease → Ownership & portfolio → Lending
        → Valuation → Forecast → Results → Report
```

Ordered by data dependency, not taste: a yield needs an income, an income needs
a lease, a lease needs a property.

| Concern | Where it lives | Reused from |
| --- | --- | --- |
| Persistence, autosave, conflicts | `useCiAssessment` | assessment workspace |
| Lending figures | `runAssessment` (`engine.ts`) | assessment workspace |
| Investment figures | `runAnalysis` (`analysisEngine.ts`) | `capRateEngine`, `dcfEngine` |
| Property/income/ownership/lending fields | `Step*` components | assessment workspace, verbatim |
| Client linking + reconciliation | `StepClientLink` | assessment workspace |
| Report | `useCapacityReport` → `commercial_capacity` | the platform's own route |
| Template choice | `ReportTemplateSelector` | Templates ecosystem |

## 3. The analysis payload section

`AssessmentPayload.analysis` (`lib/ciAssessment/analysis.ts`) carries the three
things a lending assessment has no opinion about: valuation rate assumptions,
forecast assumptions, and industrial site metrics.

Two rules keep it safe on historical records:

- **It is optional and read through `analysisOf()`**, which merges over
  defaults. An assessment written before it existed opens with sane assumptions
  rather than `undefined` reaching a discounted cash flow — where it would not
  error, it would quietly produce a number.
- **`hydrateAssessmentPayload` does not add it.** An autosave of an untouched
  historical assessment must not write a set of assumptions nobody chose.

## 4. Units, and why they are pinned by tests

The two analysis engines disagree, and both conventions are load-bearing:

- `capRateEngine.valuationGapPct` is a **ratio** — `0.28` means 28%.
- `dcfEngine`'s IRRs are **already percentages** — `15.21` means 15.21%.

Displaying either without knowing which shipped a $1.4m gap on a $5m asset as
"0.3% of price" and a healthy return as "1521.3%". Neither is a type error;
both were caught by looking at the rendered page. `analysisWorkspace.test.ts`
pins both conventions.

## 5. Report readiness answers to the server

`workspaceReadiness.ts` is not a second opinion about whether a document may be
produced. **Blocking** is exactly what `render-commercial-capacity-pdf` refuses:
validation errors, no saved calculation run, an assessment that is not complete.
Everything else — an unlinked client, an analysis section with no inputs,
figures that have moved since the run — is a **warning**, disclosed on the page
and in the document, because a report generated with disclosure is a legitimate
business outcome and inventing a restriction the business does not have is not.

## 6. Old links

`planBootstrap` (`workspaceBootstrap.ts`) is pure so that bookmarks are test
cases rather than hopes:

| Arrival | Behaviour |
| --- | --- |
| `?workspace=<id>` | Opens that analysis. Canonical. |
| `?domain=…&propertyId=…` (legacy) | Creates an analysis **around that property** — the link meant "analyse this building". |
| Bare `/calculators` | Offers recent analyses and a way to start one. Deliberately does **not** mint a record on arrival. |

`/calculators/classic` still serves the pre-workspace suite, unchanged, until
every engine it holds has a stage. It is not linked from the workspace.

## 7. What is deliberately not here

- **No new report format.** The workspace produces the registered
  `commercial_capacity` document through the same hook the assessments list and
  the client tab use. A second format would mean a second adapter, a second
  template binding and a second renderer for the same numbers.
- **No JSON "report".** The old suite's only export was a JSON blob; the client
  document is a rendered PDF or it is nothing.
- **No portal delivery claim.** The old page treated `sessionStorage` as
  distribution. Where the workspace cannot deliver, it says where the document
  is filed and stops.
