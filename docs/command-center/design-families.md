<!-- GENERATED FILE — do not edit by hand.
     Source: scripts/aurixa-templates/catalogue.py + theme.py
     Regenerate: python3 scripts/aurixa-templates/export_registry.py -->

# Design families

Eight coordinated treatments sharing one palette, one type scale and one component library. Families differ on the axes a reader actually perceives — cover architecture, density, rule weight, fill versus hairline, type pairing — not on palette novelty. Eight palettes would read as a clip-art pack; eight treatments of one palette read as a designed system.

## Shared foundations

Every family inherits these. A family may not override them, which is what keeps the library coherent.

| Role | Hex | Used for |
| --- | --- | --- |
| Midnight | `#071527` | Luxury Presentation primary, back cover |
| Navy | `#0C2340` | Primary: cover panels, section bars, table heads |
| Navy mid | `#16375C` | Secondary bands, chips on dark |
| Aurixa blue | `#1D6FE0` | Accent: numbers, rules, chips, metric figures |
| Blue deep | `#1554AE` | Modern Technology table heads, info tone |
| Blue tint / pale | `#DCE8FB` / `#F2F7FE` | Recommendation panels, total rows, highlighted comparison columns |
| Aurixa cyan | `#12B0CE` | Accent for Property Visual and Luxury |
| Cyan tint / pale | `#D5F1F7` / `#EEFAFC` | Accent panels where cyan is the accent |
| Paper / mist / cloud | `#FFFFFF` / `#F7F9FC` / `#EDF1F7` | Page, zebra banding, label cells |
| Line / line strong | `#DCE3ED` / `#C2CDDC` | Hairlines and frames |
| Ink / soft / faint | `#10192A` / `#4C5B73` / `#8493A8` | Body, captions, placeholder text |
| Field | `#F4F8FE` | The one colour that means 'type here' |
| Success | `#0F8A5F` | Pass, clear, complete, low risk — **fixed** |
| Warning | `#B26A00` | Review, pending, medium risk — **fixed** |
| Alert | `#B3261E` | Fail, escalate, high risk — **fixed** |
| Info | `#1554AE` | Informational callouts — **fixed** |

Semantic colours are excluded from white-label override in code, not by convention. A partner palette that could turn a warning green would make the library actively dangerous in compliance documents.

**Type scale** — one scale across all 40 templates, so a reader moving between two templates never re-learns what a heading looks like. Cover title 30pt, section opener 17pt, sub-section 12.5pt, block heading 10.5pt, body 9.5pt, small body 8.5pt, label 7.5pt, micro 7pt, KPI figure 16–22pt. Families vary face, weight, tracking and density — never the scale.

**Geometry** — A4, 16mm side margins, 24mm head, 20mm foot, 178mm content width. Landscape sections (297×210) are available for wide financial tables.

## Executive Corporate

_Boardroom-ready. Formal, decisive, built around the executive summary._

**Templates (3):** `commercial-property-assessment`, `executive-business-report`, `board-report`

| Attribute | Treatment |
| --- | --- |
| Visual identity | Boardroom-ready. Formal, decisive, built around the executive summary. |
| Typography | Display **Cambria**, body **Calibri**, numerals **Calibri**. Display tracking +0.2pt, label tracking 1.5pt, body line height 1.34. |
| Colour | Primary `navy`, accent `blue`, support `cyan`. Semantic colours fixed. |
| Density | 1× base padding, 10pt between sections. |
| Cover | `band` — navy band panel with an accent top rule, no cover image |
| Section dividers | `bar` — accent number chip beside a filled navy title bar |
| Tables | `banded` — filled header, zebra body rows, hairline separators. Header fill `navy`, zebra on. |
| Charts | `solid` — solid series fills from the ten-step data ramp |
| Images | `framed` — hairline frame with caption beneath |
| Header / footer | Header `rule`, footer `rule`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | Board reports; Executive business reports; Strategic recommendations; Quarterly reviews |

## Modern Technology

_SaaS-inspired. Card-led, data-forward, contemporary and digital-first._

**Templates (5):** `market-area-research-report`, `finance-strategy-report`, `equity-release-strategy`, `investor-goals-questionnaire`, `quarterly-business-review`

| Attribute | Treatment |
| --- | --- |
| Visual identity | SaaS-inspired. Card-led, data-forward, contemporary and digital-first. |
| Typography | Display **Calibri**, body **Calibri**, numerals **Calibri**. Display tracking -0.3pt, label tracking 1.6pt, body line height 1.36. |
| Colour | Primary `navy`, accent `blue`, support `cyan`. Semantic colours fixed. |
| Density | 1.05× base padding, 9pt between sections. |
| Cover | `panel` — full-width navy panel, no top rule, chips inline, no cover image |
| Section dividers | `tab` — accent tab above a soft-neutral title block |
| Tables | `hairline` — filled header, hairline separators only. Header fill `blue_deep`, zebra on. |
| Charts | `gradient` — solid fills with a lighter secondary tint for comparison series |
| Images | `inset` — inset within a card block |
| Header / footer | Header `minimal`, footer `minimal`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | Finance strategy; Portfolio reviews; Project status; Implementation plans |

## Premium Advisory

_Consulting register. Generous spacing, elegant dividers, considered recommendations._

**Templates (3):** `property-acquisition-recommendation`, `portfolio-review-report`, `lending-recommendation-report`

| Attribute | Treatment |
| --- | --- |
| Visual identity | Consulting register. Generous spacing, elegant dividers, considered recommendations. |
| Typography | Display **Georgia**, body **Calibri**, numerals **Calibri**. Display tracking +0.1pt, label tracking 1.8pt, body line height 1.42. |
| Colour | Primary `navy`, accent `blue`, support `cyan`. Semantic colours fixed. |
| Density | 1.18× base padding, 12pt between sections. |
| Cover | `split` — 40/60 navy sidebar and white field, no cover image |
| Section dividers | `numbered` — large accent numeral beside a display title over an accent rule |
| Tables | `ruled` — filled header, no zebra, ruled separators. Header fill `navy`, zebra off. |
| Charts | `outline` — outlined series with minimal fill, for low-ink families |
| Images | `framed` — hairline frame with caption beneath |
| Header / footer | Header `rule`, footer `rule`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | Acquisition recommendations; Client proposals; Advisory reports; Partnership proposals |

## Property Visual

_Image-led. Property photography, maps, location data and side-by-side comparison._

**Templates (4):** `property-investment-report`, `property-comparison-report`, `suburb-analysis-report`, `house-and-land-assessment`

| Attribute | Treatment |
| --- | --- |
| Visual identity | Image-led. Property photography, maps, location data and side-by-side comparison. |
| Typography | Display **Calibri**, body **Calibri**, numerals **Calibri**. Display tracking -0.2pt, label tracking 1.4pt, body line height 1.32. |
| Colour | Primary `navy`, accent `cyan`, support `blue`. Semantic colours fixed. |
| Density | 0.95× base padding, 9pt between sections. |
| Cover | `fullbleed` — cover image band above the navy panel, cover image slot |
| Section dividers | `bar` — accent number chip beside a filled navy title bar |
| Tables | `banded` — filled header, zebra body rows, hairline separators. Header fill `navy`, zebra on. |
| Charts | `solid` — solid series fills from the ten-step data ramp |
| Images | `full` — full-width, edge-to-edge within the content column |
| Header / footer | Header `rule`, footer `rule`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | Property investment reports; Suburb analysis; Property comparisons; Off-market opportunities |

## Financial Analytical

_Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules._

**Templates (7):** `development-feasibility-report`, `borrowing-capacity-report`, `loan-comparison-report`, `refinance-assessment`, `cash-flow-net-position-report`, `serviceability-assessment`, `construction-finance-report`

| Attribute | Treatment |
| --- | --- |
| Visual identity | Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. |
| Typography | Display **Calibri**, body **Calibri**, numerals **Consolas**. Display tracking -0.2pt, label tracking 1.2pt, body line height 1.28. |
| Colour | Primary `navy`, accent `blue`, support `cyan`. Semantic colours fixed. |
| Density | 0.88× base padding, 8pt between sections. |
| Cover | `band` — navy band panel with an accent top rule, no cover image |
| Section dividers | `rule` — inline title with a heavy accent underline |
| Tables | `ledger` — vertical column rules, right-aligned monospaced numerals. Header fill `navy`, zebra on. |
| Charts | `ledger` — chart is secondary to the table; native bar rows preferred |
| Images | `none` — no image components; the family carries no photography |
| Header / footer | Header `rule`, footer `rule`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | Borrowing capacity; Cash-flow projections; Loan comparisons; Serviceability assessments |

## Minimal Professional

_Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity._

**Templates (7):** `finance-approval-summary`, `client-fact-find-form`, `client-onboarding-form`, `property-brief-form`, `document-collection-checklist`, `client-authority-form`, `file-review-summary`

| Attribute | Treatment |
| --- | --- |
| Visual identity | Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. |
| Typography | Display **Arial**, body **Arial**, numerals **Arial**. Display tracking +0pt, label tracking 1.1pt, body line height 1.3. |
| Colour | Primary `navy`, accent `blue`, support `cyan`. Semantic colours fixed. |
| Density | 0.92× base padding, 8pt between sections. |
| Cover | `minimal` — ruled masthead, no fills, no cover image |
| Section dividers | `rule` — inline title with a heavy accent underline |
| Tables | `hairline` — filled header, hairline separators only. Header fill `cloud`, zebra off. |
| Charts | `outline` — outlined series with minimal fill, for low-ink families |
| Images | `none` — no image components; the family carries no photography |
| Header / footer | Header `minimal`, footer `minimal`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | Client forms; Checklists; Internal summaries; High-volume generation |

## Luxury Presentation

_Editorial and unhurried. Oversized display type, deep whitespace, prestige framing._

**Templates (3):** `off-market-opportunity-report`, `client-proposal`, `partnership-proposal`

| Attribute | Treatment |
| --- | --- |
| Visual identity | Editorial and unhurried. Oversized display type, deep whitespace, prestige framing. |
| Typography | Display **Georgia**, body **Calibri**, numerals **Georgia**. Display tracking +0.6pt, label tracking 2.6pt, body line height 1.48. |
| Colour | Primary `midnight`, accent `cyan`, support `blue`. Semantic colours fixed. |
| Density | 1.32× base padding, 15pt between sections. |
| Cover | `editorial` — tall centred image, centred oversized display title, cover image slot |
| Section dividers | `numbered` — large accent numeral beside a display title over an accent rule |
| Tables | `ruled` — filled header, no zebra, ruled separators. Header fill `midnight`, zebra off. |
| Charts | `outline` — outlined series with minimal fill, for low-ink families |
| Images | `full` — full-width, edge-to-edge within the content column |
| Header / footer | Header `minimal`, footer `minimal`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | Prestige property presentations; Investment opportunities; Executive proposals; High-value client packs |

## Compliance Structured

_Auditable by construction. Numbered controls, status columns, evidence trails._

**Templates (8):** `property-due-diligence-report`, `smsf-finance-assessment`, `risk-profile-questionnaire`, `aml-kyc-assessment`, `client-verification-summary`, `compliance-review-report`, `risk-assessment`, `audit-report`

| Attribute | Treatment |
| --- | --- |
| Visual identity | Auditable by construction. Numbered controls, status columns, evidence trails. |
| Typography | Display **Calibri**, body **Calibri**, numerals **Consolas**. Display tracking +0pt, label tracking 1.3pt, body line height 1.3. |
| Colour | Primary `navy`, accent `blue`, support `cyan`. Semantic colours fixed. |
| Density | 0.9× base padding, 8pt between sections. |
| Cover | `band` — navy band panel with an accent top rule, no cover image |
| Section dividers | `numbered` — large accent numeral beside a display title over an accent rule |
| Tables | `boxed` — fully boxed cells for audit legibility. Header fill `navy`, zebra off. |
| Charts | `ledger` — chart is secondary to the table; native bar rows preferred |
| Images | `none` — no image components; the family carries no photography |
| Header / footer | Header `band`, footer `band`. Header suppressed on page 1; footer written to both first-page and default footers. |
| Suitable for | AML and KYC; Audit reports; Risk assessments; File reviews; Verification summaries |
