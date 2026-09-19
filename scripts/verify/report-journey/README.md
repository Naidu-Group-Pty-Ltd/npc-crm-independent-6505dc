# The Investment report journey, verified in a real browser

`node scripts/verify/report-journey/run.mjs --report <investment_report id> [--expect-renderer weasyprint|browser]`

Drives the REAL application — report → edit → templates → publishing/export →
generate → send — in a real Chromium against the running Vite dev server, with
every Supabase request answered from fixtures and the final document drawn by
the SAME WeasyPrint version production pins. No credential, no network, no side
effect outside the process. About twenty seconds.

It is the **FRONT-END CHECK** in the mandatory loop
`change → front-end check → final PDF → content check → visual check → tests → commit`,
and it exits non-zero on: a page or component that does not mount, an edit that
does not persist, a template choice that does not persist, a control that does
nothing, a duplicated or legacy PDF button, a page left unclickable, a console
error, an uncaught error, a request nothing answered, a render that was not
asked for (or asked for twice), a PDF that did not arrive, or a send that
re-rendered instead of reusing the finalised document.

Artefacts land in `.verify/out/journey/<report>/`: numbered screenshots of each
stage, the downloaded PDF, `controls.json` (every control the page exposed) and
`journey.json` (every check, every request, every render, every write).

## Prerequisites

1. The dev server: `npx vite --host 127.0.0.1 --port 5173 --strictPort`.
2. WeasyPrint at the version `weasyprint-service/requirements.txt` pins,
   importable by `python3`. The run refuses to start on any other version —
   a document from a different engine is not evidence about production.
3. Chromium: Playwright's, at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`,
   or set `VERIFY_CHROMIUM`.
4. Fixtures in `.verify/fixtures/` (gitignored — they are real rows):

```
.verify/fixtures/
  <reportId>/report.json            row_to_json(investment_reports) for the report
  templates/<templateId>.json       the active report_templates rows (schema included)
  global_report_settings.json       select setting_key, setting_value from global_report_settings
  whitelabel_settings.json          the whitelabel_settings row (company + logo_config)
  assets/report.png, reportMono.png the brand marks logo_config points at
```

The reference set used for RS-1/RS-4 (all non-client, `client_property_id` null):

| role | id | why |
| --- | --- | --- |
| A — long | `09f8569e-21ca-48b9-a3b9-57f4793d0836` | 57k chars, financials, withheld grade, 34 overrides |
| B — medium | `c6ed90e6-8fa5-4d67-a061-e7dbb986ce71` | 50k chars, financials, **graded B/58**, 34 overrides |
| C — sparse | `8ef4bfc3-cf40-4511-b18f-98429c3237a9` | 40k chars, no financials, no score, no overrides |

## The other formats: `run-format.mjs`

`node scripts/verify/report-journey/run-format.mjs --format <cashflow|market_intelligence|comparison|report_qa> --record <id> [--template <id|name>] [--subject transcript|structured]`

The same double, the same engine, the same checks — for a format whose page is
not the Investment report's. Each entry in `FORMATS` names the page to open,
how to reach its template picker and its Generate control, what "Send" means
for it, and the `answers` its page needs on mount (vendor and model calls the
double would otherwise leave unfulfilled). Artefacts land in
`.verify/out/journey/<format>-<record8>-<template8>/`.

Fixture rows for these formats are arrays under the record's directory:

```
.verify/fixtures/<recordId>/tables/<table>.json    row_to_json(...) rows, e.g. marketing_intelligence_reports
```

and the double answers them wherever the page asks — PostgREST, the
`authenticated-data` gateway or `get-client-data` in list mode. A record with
no `report.json` is fine for these formats; the Investment runner still needs
one.

A format may declare `expectsRoute`: a subject the format produces through its
own edge function rather than a template (Report Q&A's structured write-up).
The double answers that route with a stand-in PDF and the run checks the
decision — no template render, one route call — rather than the document.

Reference set (all non-client): Cash Flow on report `09f8569e-…` (templates
`4af70118-…` Chancery, `ebb636c9-…` Board Pack Brief); Market Intelligence on
`c4d22645-f46b-43b7-b540-56655d40cd23` (template `70d29782-…` Chancery);
Comparison `23cc7e34-310b-4dd5-8c13-777ed22e0993` (template `23b7e18b-…`
Chancery, `tables/property_comparisons.json`); Report Q&A conversation
`a2400de4-ae23-4795-beb6-abfc40ffbc9c` (templates `ae7734d5-…` Chancery and
`233a95fe-…` Atelier; `tables/report_qa_conversations.json` and
`tables/report_qa_messages.json`).

## What the double answers

See the header of `supabaseDouble.mjs`. Anything it does not recognise is
answered `{}` and listed under `unfulfilled` in the manifest — and fails the
run, because a page that asked for something nobody supplied is a page that
was not really exercised.

## What it found on its first run

Three defects in the shipped front end, none visible in 8,572 passing unit
tests: a Dialog opened from a DropdownMenu left `<body>` with
`pointer-events: none` (eleven copies of `react-dismissable-layer`; see
`src/lib/__tests__/radixLayerSingleton.spec.ts`); the report page's primary
Download ignored two of the five content switches; and the send dialog nested
`<button>` inside `<button>` twice.
