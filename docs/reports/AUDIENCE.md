# Who a report is written for — investor, owner-occupier or both

## What was asked

The owner, 23 Sep 2026, twice. First: integrate an owner-occupier perspective
alongside the investment view in every report, for agents, brokers, advisers
and buyer's agencies — "flexibility is key". Then: make it "a toggle for it to
be on and off … so they can reflect whether or not they are targeting their set
clientele which is going to be either an investor or alternatively a
owner-occupied client … the reports that are going to be generated and
produced are going to be reflective of that specifically."

Every document this platform had produced was an investor's. The sections ask
what the property rents for, what it yields and what it costs to hold; the
headline figures are the price, the weekly rent, the yields and the weekly
position. A buyer who will live in the home asks different questions, and the
record already answers most of them — nothing had put those answers in front
of that reader.

## What the choice does

"Written for" is the first control on the report page's **Publishing & Export**
panel. It applies to every document produced from that page — Generate Client
PDF, the primary download and Send to Client — in the standard presentation and
in a chosen template alike, and it is remembered for that report in the
browser that chose it.

| | Investor | Owner-occupier | Both |
| --- | --- | --- | --- |
| The body | as stored, byte for byte | gains *Living Here: An Owner-Occupier's View*; loses the chapters whose whole subject is a letting | gains the section; loses nothing |
| Headline figures | as before | the rent, the yields, the weekly position, cash on cash and the vacancy allowance are withheld | as before |
| Financial / Snapshot dashboard | the investor band | a band of what a home buyer weighs: price, annual repayment, total cost, loan, deposit, rate, growth | the investor band |
| Cover wording | as before | the two places a tier promises a return are reworded | as before |
| Anything computed | — | nothing: no figure is recalculated, re-based or relabelled | — |

The chapters an owner-occupier's copy leaves out are named by section id
through the registry, never by matching words: the rental assessment and
yields, the tenant/vacancy chapter, the investor suitability profile and the
holding strategy. Two headings that resolve to the tenant chapter speak to a
buyer as well (`Tenant & Buyer Profile`, `…Occupier Personas`) and are kept by
name.

## The rules

**The audience decides what is PUBLISHED, never what is COMPUTED.** A figure
that describes a letting is withheld whole; a figure that is true of both — the
price, the loan, the repayment, the rates, the maintenance — is printed as the
record holds it. An owner-occupier's cash flow is a different model (no rent, a
home's insurance rather than a landlord's, land tax exempt on a principal place
of residence), and presenting the investor's with the rent struck out would be
a number nobody computed. One line is narrowed rather than withheld: *Land tax
and strata* becomes the record's own strata levy, because a home pays strata
and not land tax — the label stays true.

**A mixed section is never cut into.** A paragraph about rent inside a chapter
about demand is still that chapter, and prose is never scrubbed. Only a section
whose whole subject is the letting return leaves.

**Placement follows the document's own shape.** The owner-occupier's section
is set at the level the document writes its sections at (H1 on 842 of 1,199
stored reports, H2 on the rest — `detectSectionLevel`) and after its opening
run — the verdict, the snapshot, the strategic read — so a reader who will
live in the home meets it before the chapters.

## The owner-occupier's section

`ownerOccupierLens.pure.ts` composes it from the stored record and adds nothing
to it. Each row is a reading this platform took, or it is not drawn:

| Row | From | Rule |
| --- | --- | --- |
| Schools | the amenity lookup's nearest schools | up to three, nearest first, "by straight-line distance"; no rating (the stored rating is a placeholder 0) |
| Daily needs | nearest shopping, park and health care | the health-care category answers the nearest place that provides care — a chiropractor on the reference report — so it is never called a hospital |
| Transport | the GTFS stop register; the measured commute | the stop's straight-line distance and the register's own count; a commute only where its destination is named and is this property's own centre, never the retired `estimated` guess |
| Neighbourhood | the ABS Census projection | read only where `isCensusProjectionSource` recognises the source — a generated block that merely calls itself the Census is not read |
| Home loans | RBA statistical table F5 | the banks' discounted variable rate for an owner-occupier beside an investor's, same month |
| The land | the stored land use table | `landUseStanding`, the sentence the Due Diligence strategic read prints; its qualifications travel with it where the tier prints no planning register |

Under the table: who answered the places and the stops (OpenStreetMap is
credited as its licence asks), and four checks about the ACT of buying a home —
the school catchment, the journey at the hour it is made, the duty and first
home buyer concessions, and (where the financial model is printed) the land tax
exemption. They are true of every property, which is why they can be written in
advance. A section of fewer than two rows is not drawn at all; an absence is
omitted, never worded; nothing is rated; no count that saturates at a
provider's page size is stated.

## Where it lives

| Module | Role |
| --- | --- |
| `_shared/reports/investment/audienceContent.pure.ts` | the policy, the letting keys and sections, `applyAudienceToMarkdown`, `audienceWording` |
| `_shared/reports/location/ownerOccupierLens.pure.ts` | the section |
| `_shared/reportBindingProjection.pure.ts` | withholds for a chosen template; publishes `report.ownerOccupier` |
| `scripts/template-library/investmentCompass/templates.ts` | the dashboard's two bands at one position (seed v20) |
| `src/lib/reports/investment/investmentPdfDocument.ts` | the standard presentation's band and sparklines |
| `src/lib/reports/investment/deliverInvestmentPdf.ts` | applies the audience to the body once, above the choice of presentation |
| `src/lib/reportTemplate/adapters/investmentReportAdapter.ts` | hands the audience to the projection |
| `InvestmentReportExportPanel.tsx`, `InvestmentReportView.tsx` | the control, remembered per report |

Specs: `reportAudience.spec.ts` (the policy, the section, the projection, and a
guard that no master's owner-occupier band can bind a letting figure) and
`audienceKpiParity.spec.ts` (both presentations draw the same figures for one
choice). The geometry gate renders the Compass, Financial Analysis and Snapshot
of every master a second time as an owner-occupier's copy.

## What is not done, and what is unverified

- **The model-written prose is still the investor's.** The choice is applied
  when a document is produced, so it reaches every stored report at once and
  costs nothing — but a sentence the generator wrote for an investor stays in a
  chapter an owner-occupier's copy keeps. Framing the prose itself needs the
  audience stored with the report (an additive `investment_reports.audience`
  column, which is a migration and needs the owner's approval), the generator
  and the condense/fork paths to read it, and a regeneration per report.
- **Only the report page offers the choice.** The client-portal publish, the
  client property report and the listing modal produce the investor's document,
  as they did; none of them has an export panel.
- **The cover title is unchanged** — "Investment Compass", "Financial Analysis
  Report". Renaming the product for an owner-occupier is a naming decision for
  the owner.
- **Shipped 23 Sep 2026; nothing has been drawn from production yet.** Merged
  as #2748 (`2efa52496`), every function redeployed (deploy run 681), seed v20
  applied (apply run 104: `template_library_release_baselines` 2,715 → 3,258,
  one baseline per catalogue entry) and then its refresh (run 105:
  `template_master_refresh_decisions` 80 → 98, eighteen active adopted
  masters classified). The frontend was published as Lovable deployment
  `e21fb279`, from a sandbox whose network policy refuses the published host,
  so the live build is accepted but not confirmed.
- **Which of the eighteen masters took v20 is unknown.** A master proven an
  unedited copy is refreshed; a customised one is deferred and keeps v19,
  where an owner-occupier's Financial Analysis and Snapshot draw the investor
  band with its letting tiles closed up (the Compass, the Due Diligence report
  and the Briefing need no seed change). The split needs a SQL read this work
  did not have; the query is in the footer of
  `20261219070000_refresh_active_masters_from_library_v20.sql`.
