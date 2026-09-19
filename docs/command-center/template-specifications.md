<!-- GENERATED FILE — do not edit by hand.
     Source: scripts/aurixa-templates/catalogue.py + theme.py
     Regenerate: python3 scripts/aurixa-templates/export_registry.py -->

# Template specifications

A complete design brief for each of the 40 templates, in the 24-point format. Everything not stated per template resolves from the design family — see [`design-families.md`](./design-families.md).

Each brief is buildable without interpretation: every section names the component from `scripts/aurixa-templates/components.py` that renders it, and every dynamic field names the binding path that fills it.

## Contents

- **Property & Buyer's Agency** — [Property Investment Report](#property-investment-report), [Property Due-Diligence Report](#property-due-diligence-report), [Property Acquisition Recommendation](#property-acquisition-recommendation), [Property Comparison Report](#property-comparison-report), [Suburb Analysis Report](#suburb-analysis-report), [Market & Area Research Report](#market-area-research-report), [Off-Market Opportunity Report](#off-market-opportunity-report), [House & Land Package Assessment](#house-land-package-assessment), [Commercial Property Assessment](#commercial-property-assessment), [Development Feasibility Report](#development-feasibility-report), [Portfolio Review Report](#portfolio-review-report)
- **Finance & Lending** — [Borrowing Capacity Report](#borrowing-capacity-report), [Finance Strategy Report](#finance-strategy-report), [Loan Comparison Report](#loan-comparison-report), [Lending Recommendation Report](#lending-recommendation-report), [Refinance Assessment](#refinance-assessment), [Equity Release Strategy](#equity-release-strategy), [Cash-Flow & Net Position Report](#cash-flow-net-position-report), [Serviceability Assessment](#serviceability-assessment), [Construction Finance Report](#construction-finance-report), [SMSF Finance Assessment](#smsf-finance-assessment), [Finance Approval Summary](#finance-approval-summary)
- **Client Forms & Onboarding** — [Client Fact-Find Form](#client-fact-find-form), [Client Onboarding Form](#client-onboarding-form), [Investor Goals Questionnaire](#investor-goals-questionnaire), [Property Brief Form](#property-brief-form), [Risk Profile Questionnaire](#risk-profile-questionnaire), [Document Collection Checklist](#document-collection-checklist), [Client Authority Form](#client-authority-form)
- **Compliance & Governance** — [AML & KYC Assessment](#aml-kyc-assessment), [Client Verification Summary](#client-verification-summary), [Compliance Review Report](#compliance-review-report), [Risk Assessment](#risk-assessment), [Audit Report](#audit-report), [File Review Summary](#file-review-summary)
- **Business & Advisory** — [Executive Business Report](#executive-business-report), [Client Proposal](#client-proposal), [Board Report](#board-report), [Quarterly Business Review](#quarterly-business-review), [Partnership Proposal](#partnership-proposal)

## Property & Buyer's Agency

### Property Investment Report

`property-investment-report`

Full investment case for a single property: the asset, the numbers, the risks and a clear buy / do-not-buy recommendation.

|  |  |
| --- | --- |
| **1. Template name** | Property Investment Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Investor clients and their advisers |
| **4. Primary use case** | Present a researched investment case for one property and record a recommendation the client can act on. |
| **5. Recommended page range** | 8–14 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Property Visual |
| **7. Visual style** | Property Visual — Image-led. Property photography, maps, location data and side-by-side comparison. Display Calibri, body Calibri. Banded tables, filled cards, bar section openers, density 0.95×. Property photography leads each major section; the metric panel under the executive summary is the reader's anchor point. |
| **8. Colour configuration** | Primary navy, accent cyan, support blue. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. Cyan accent so financial figures read as data rather than brand. |
| **9. Cover-page structure** | Full-bleed cover image band above a navy panel carrying the logo slot, eyebrow, title and subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. Cover image is the primary property photograph, 16:9, minimum 1600px wide. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Property hero image, title, client and issue control. | — |
| 2 | Executive summary | `executive_summary` | Headline verdict, three-paragraph case, four takeaways. | `{{report.executiveSummary}}` |
| 3 | Investment metrics | `metric_panel` | Purchase price, gross yield, weekly rent, cash required. | `{{property.metrics}}` |
| 4 | Property overview | `info_card` | Address, type, land and building area, beds/baths/car, year built. | `{{property.*}}` |
| 5 | Property gallery | `image_gallery` | Four to eight photographs with captions. | `{{property.images}}` |
| 6 | Location & amenity | `map_frame` | Map with amenity legend and a short locality narrative. | `{{property.location}}` |
| 7 | Financial analysis | `data_table` | Acquisition costs, income, expenses, net position, with totals. | `{{financials.acquisition}}` |
| 8 | Cash-flow projection | `chart_frame` | Ten-year net position line chart with an assumptions note. | `{{cashflow.series}}` |
| 9 | Comparable sales | `data_table` ↻ | Recent comparable sales with adjustment commentary. | `{{comparables[]}}` |
| 10 | Risks & mitigations | `risk_box` | Ranked risks with severity chips and mitigations. | `{{risks[]}}` |
| 11 | Recommendation | `recommendation_box` | Verdict, rationale, next steps, confidence. | `{{report.recommendation}}` |
| 12 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |
| 13 | Back cover | `back_cover` | Contact block and legal entity line. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Contents | `table_of_contents` | Section map for an 8+ page document. | The underlying data is present |
| Adviser | `adviser_profile` | Who prepared it and their credentials. | The underlying data is present |
| Appendix — data sources | `appendix_opener` | Full comparable evidence and data provenance. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `executive_summary`, `metric_panel`, `info_card`, `image_gallery`, `map_frame`, `data_table`, `chart_frame`, `risk_box`, `recommendation_box`, `adviser_profile`, `disclaimer_page`, `back_cover`

**14. Image requirements**

One 16:9 cover image (1600×900 minimum) plus 4–8 gallery images at 4:3 (1200×900 minimum). One static map export. Every image requires alt text; generation fails validation without it.

**15. Chart & table requirements**

One 10-year cash-flow line chart. Optional yield-vs-suburb bar chart. Two full-width tables (acquisition costs, comparables) with repeating headers and a totals row.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `property.* — address, type, land, building, beds, baths, cars, yearBuilt`
- `property.images[] — url, caption, altText`
- `financials.* — price, costs[], income[], expenses[], netPosition`
- `cashflow.series[] — year, income, expense, net`
- `comparables[] — address, soldPrice, soldDate, land, adjustment`
- `risks[] — description, severity, mitigation`
- `report.* — executiveSummary[], recommendation, confidence, nextSteps[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover with the property photograph visible — the most recognisable thumbnail in the library, so it should not be cropped past the image band.

**23. Use this template when**

- You have researched one property and need to present the whole case.
- The client needs a document they can take to a lender or partner.
- Photography and location context materially support the argument.

**24. Use a different template when**

- You are comparing two or more properties → `property-comparison-report`
- The client only needs the numbers → `cash-flow-net-position-report`
- You are assessing risk and defects before exchange → `property-due-diligence-report`

**Library metadata** — tier `growth` · priority `P1` · data `high` · images `high` · formality `professional` · audience `client-facing` · generator implemented

---

### Property Due-Diligence Report

`property-due-diligence-report`

Structured pre-exchange investigation: title, planning, building, environmental and contractual findings against a numbered checklist.

|  |  |
| --- | --- |
| **1. Template name** | Property Due-Diligence Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Buyer's agents, conveyancers, investor clients |
| **4. Primary use case** | Evidence that every due-diligence item was investigated, with findings and outstanding items recorded against each. |
| **5. Recommended page range** | 10–20 pages (11–25 pages — multi-section analysis with appendices) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. Every finding carries a numbered control reference and a status chip, so a reviewer can audit coverage without reading the prose. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Title, subject property, client, issue control. | — |
| 2 | Contents | `table_of_contents` | Required — the document is long. | — |
| 3 | Scope & limitations | `highlight_box` | What was and was not investigated, and on what date. | — |
| 4 | Summary of findings | `executive_summary` | Overall position and the items that block or condition exchange. | — |
| 5 | Findings register | `status_table` ↻ | Numbered controls with finding, evidence, reviewer and status. | `{{diligence.controls[]}}` |
| 6 | Title & ownership | `data_table` | Title particulars, encumbrances, easements. | `{{title.*}}` |
| 7 | Planning & zoning | `data_table` | Zoning, overlays, permitted use, restrictions. | `{{planning.*}}` |
| 8 | Outstanding items | `checklist` | What must be resolved before exchange. | `{{diligence.outstanding[]}}` |
| 9 | Risks & mitigations | `risk_box` | Residual risk after investigation. | — |
| 10 | Conclusion | `recommendation_box` | Proceed / proceed with conditions / do not proceed. | — |
| 11 | Approvals | `approval_block` | Preparer, reviewer, sign-off dates. | — |
| 12 | Evidence index | `appendix_opener` | Appendix A — document register with dates and sources. | — |
| 13 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Building & pest | `status_table` | Inspection findings by severity. | The underlying data is present |
| Environmental & hazard | `status_table` | Flood, bushfire, contamination, mining. | The underlying data is present |
| Strata / body corporate | `data_table` | Levies, sinking fund, minutes findings. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `highlight_box`, `executive_summary`, `status_table`, `data_table`, `checklist`, `risk_box`, `recommendation_box`, `approval_block`, `appendix_opener`, `disclaimer_page`

**14. Image requirements**

Optional defect photographs, 4:3, in an appendix gallery. Not used in the body — a due-diligence finding is a written finding.

**15. Chart & table requirements**

No charts. Four to six status tables with repeating headers; the findings register must survive 60+ rows without losing its header.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `diligence.controls[] — ref, item, finding, evidence, reviewer, status`
- `title.*, planning.*, strata.*`
- `inspections[], hazards[]`
- `diligence.outstanding[] — item, owner, due`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Frequently printed and filed. Control references are printed in the numeric face so they remain scannable in a bound copy.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You are investigating a property before exchange.
- You need an auditable record that each item was checked.
- A third party (lender, solicitor, co-investor) will review your work.

**24. Use a different template when**

- You are making the investment case → `property-investment-report`
- You need a short checklist to work from, not a report → `document-collection-checklist`

**Library metadata** — tier `growth` · priority `P1` · data `medium` · images `low` · formality `formal` · audience `client-facing` · generator implemented

---

### Property Acquisition Recommendation

`property-acquisition-recommendation`

A short, decisive advisory document: the recommendation, the reasoning behind it, the strategy for securing the asset, and what happens next.

|  |  |
| --- | --- |
| **1. Template name** | Property Acquisition Recommendation |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Retained buyer's agency clients |
| **4. Primary use case** | Recommend a specific acquisition and the negotiation strategy to secure it. |
| **5. Recommended page range** | 3–6 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Premium Advisory |
| **7. Visual style** | Premium Advisory — Consulting register. Generous spacing, elegant dividers, considered recommendations. Display Georgia, body Calibri. Ruled tables, outlined cards, numbered section openers, density 1.18×. Consulting register — the recommendation sits above the fold on page two and everything after it is support, not preamble. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | 40/60 vertical split — navy sidebar with logo, tagline and the prepared-for/prepared-by/issued stack; white field carrying eyebrow, title, accent rule and subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Split cover with prepared-for stack in the sidebar. | — |
| 2 | Recommendation | `recommendation_box` | The verdict, stated first. Rationale, next steps and confidence. | — |
| 3 | Why this property | `executive_summary` | The case in three to five paragraphs against the client's brief. | — |
| 4 | Alignment to your brief | `comparison_table` | Client requirement versus what this property delivers. | `{{brief.requirements[]}}` |
| 5 | Key numbers | `metric_panel` | Price guide, yield, cash required, hold cost. | — |
| 6 | Acquisition strategy | `process_flow` | Offer approach, terms, conditions, timing. | `{{strategy.steps[]}}` |
| 7 | What would change this recommendation | `risk_box` | Conditions and risks that would reverse the advice. | — |
| 8 | Your authority | `checklist` | What the client must approve for the agency to act. | — |
| 9 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Sign-off | `signature_block` | Client authority to proceed. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `recommendation_box`, `executive_summary`, `comparison_table`, `metric_panel`, `process_flow`, `risk_box`, `checklist`, `signature_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. One requirement-versus-delivered comparison table and one metric panel.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `brief.requirements[] — requirement, delivered, note`
- `strategy.steps[] — step, detail`
- `property.summary`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Split cover — the sidebar/field contrast is what distinguishes Premium Advisory in a grid of thumbnails.

**23. Use this template when**

- You are recommending one specific property to a retained client.
- The client needs to make a decision quickly.
- Full analysis already exists and this is the decision document.

**24. Use a different template when**

- The client needs the full research → `property-investment-report`
- You are recommending a lender or loan → `lending-recommendation-report`
- You are pitching for the engagement itself → `client-proposal`

**Library metadata** — tier `growth` · priority `P1` · data `medium` · images `low` · formality `presentation` · audience `client-facing` · generator implemented

---

### Property Comparison Report

`property-comparison-report`

Two to five properties assessed side by side against a common set of attributes, with a ranked outcome.

|  |  |
| --- | --- |
| **1. Template name** | Property Comparison Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Investor and owner-occupier clients |
| **4. Primary use case** | Help a client choose between shortlisted properties on consistent criteria. |
| **5. Recommended page range** | 6–12 pages, growing with the number of properties (Length follows the record count — grows with rows, properties or controls) |
| **6. Design family** | Property Visual |
| **7. Visual style** | Property Visual — Image-led. Property photography, maps, location data and side-by-side comparison. Display Calibri, body Calibri. Banded tables, filled cards, bar section openers, density 0.95×. Attribute-per-row comparison so a reader scans one criterion across all options; the recommended option is tinted, not just bolded. |
| **8. Colour configuration** | Primary navy, accent cyan, support blue. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-bleed cover image band above a navy panel carrying the logo slot, eyebrow, title and subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Title, client, number of properties compared. | — |
| 2 | How to read this report | `highlight_box` | The criteria, their weighting, and what the tint means. | — |
| 3 | Comparison at a glance | `comparison_table` ↻ | Every attribute across every property, recommended column highlighted. | `{{properties[]}}` |
| 4 | Scoring summary | `bar_chart` | Weighted score per property as a native bar chart. | — |
| 5 | Property profiles | `info_card` ↻ | One profile block per property: image, key facts, strengths, concerns. | `{{properties[]}}` |
| 6 | Financial comparison | `data_table` | Price, costs, income, net position per property. | `{{properties[].financials}}` |
| 7 | Recommendation | `recommendation_box` | Ranked outcome and reasoning. | — |
| 8 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Location comparison | `map_frame` | Each property mapped with amenity legend. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `highlight_box`, `comparison_table`, `bar_chart`, `info_card`, `data_table`, `map_frame`, `recommendation_box`, `disclaimer_page`

**14. Image requirements**

One hero image per property at 4:3, minimum 1200×900. The profile block reserves the same frame size for every property so an option with fewer photographs does not look weaker.

**15. Chart & table requirements**

One native weighted-score bar chart. Comparison table must remain legible at five columns; above five properties the generator splits into two tables rather than shrinking type.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `properties[] — address, images[], facts{}, financials{}, score, strengths[], concerns[]`
- `criteria[] — name, weight`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. On mobile the comparison table scrolls horizontally inside its own container with the attribute column pinned.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client is choosing between two and five shortlisted properties.
- You need consistent criteria applied to every option.
- The decision is a choice, not a yes/no.

**24. Use a different template when**

- There is only one property → `property-investment-report`
- You are comparing loans rather than properties → `loan-comparison-report`
- The client has already chosen → `property-acquisition-recommendation`

**Library metadata** — tier `growth` · priority `P1` · data `high` · images `high` · formality `professional` · audience `client-facing` · generator implemented

---

### Suburb Analysis Report

`suburb-analysis-report`

Location-level research: demographics, supply, demand, price and rent history, infrastructure and outlook for one suburb.

|  |  |
| --- | --- |
| **1. Template name** | Suburb Analysis Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Investor clients, internal research teams |
| **4. Primary use case** | Establish whether a location supports the client's investment strategy. |
| **5. Recommended page range** | 6–12 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Property Visual |
| **7. Visual style** | Property Visual — Image-led. Property photography, maps, location data and side-by-side comparison. Display Calibri, body Calibri. Banded tables, filled cards, bar section openers, density 0.95×. |
| **8. Colour configuration** | Primary navy, accent cyan, support blue. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-bleed cover image band above a navy panel carrying the logo slot, eyebrow, title and subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Suburb name, state, period covered, streetscape image. | — |
| 2 | Snapshot | `metric_panel` | Median price, 12-month growth, gross yield, vacancy rate. | — |
| 3 | Executive summary | `executive_summary` | The location thesis in brief. | — |
| 4 | Market performance | `chart_frame` | Median price and rent over 10 years. | `{{suburb.priceHistory}}` |
| 5 | Supply & demand | `chart_frame` | Listings, days on market, absorption. | `{{suburb.supplyDemand}}` |
| 6 | Demographics | `data_table` | Population, age profile, income, tenure. | `{{suburb.demographics}}` |
| 7 | Location map | `map_frame` | Suburb boundary, transport, schools, employment. | — |
| 8 | Outlook & risks | `risk_box` | What could change the thesis. | — |
| 9 | Conclusion | `recommendation_box` | Invest / monitor / avoid, with reasoning. | — |
| 10 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Infrastructure & amenity | `timeline` | Committed and proposed infrastructure with dates. | The underlying data is present |
| Comparable suburbs | `comparison_table` | This suburb against two to four alternatives. | The underlying data is present |
| Appendix — data sources | `appendix_opener` | Provenance and as-at dates. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `executive_summary`, `chart_frame`, `data_table`, `timeline`, `map_frame`, `comparison_table`, `risk_box`, `recommendation_box`, `appendix_opener`, `disclaimer_page`

**14. Image requirements**

One streetscape or aerial cover image. One suburb map export. Optional amenity photographs.

**15. Chart & table requirements**

Three to five charts: price history, rent history, supply/demand, optional demographic split. Every chart carries an as-at date in its source line — undated market data is misleading.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `suburb.* — name, state, postcode, medians{}, priceHistory[], supplyDemand[], demographics{}, infrastructure[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- Research is about a location rather than a specific property.
- A client is deciding where, not what, to buy.
- You need to evidence a location thesis.

**24. Use a different template when**

- The subject is one property → `property-investment-report`
- You need broad multi-region market commentary → `market-area-research-report`

**Library metadata** — tier `growth` · priority `P2` · data `high` · images `medium` · formality `professional` · audience `client-facing` · generator implemented

---

### Market & Area Research Report

`market-area-research-report`

Wider market commentary across several regions or asset classes, built for periodic publication rather than a single client decision.

|  |  |
| --- | --- |
| **1. Template name** | Market & Area Research Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Client base, subscribers, internal strategy |
| **4. Primary use case** | Publish a recurring market view that positions the organisation as a credible research voice. |
| **5. Recommended page range** | 10–20 pages (11–25 pages — multi-section analysis with appendices) |
| **6. Design family** | Modern Technology |
| **7. Visual style** | Modern Technology — SaaS-inspired. Card-led, data-forward, contemporary and digital-first. Display Calibri, body Calibri. Hairline tables, filled cards, tab section openers, density 1.05×. Card-led SaaS layout — each region is a repeating card block, so the same template serves a two-region and a twelve-region edition. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-width navy panel with no top rule; logo slot, eyebrow, title, subtitle and chip row, set in a single card block. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Edition title, period, panel cover. | — |
| 2 | Contents | `table_of_contents` | Required for a multi-region edition. | — |
| 3 | In this edition | `highlight_box` | Three to five headline findings. | — |
| 4 | National / state overview | `executive_summary` | The macro position. | — |
| 5 | Key indicators | `metric_panel` | Rates, growth, vacancy, listings. | — |
| 6 | Region profiles | `info_card` ↻ | One repeating card per region: indicators, chart, commentary. | `{{regions[]}}` |
| 7 | Comparative table | `data_table` | All regions on common indicators. | `{{regions[].indicators}}` |
| 8 | Outlook | `prose` | Forward view with stated assumptions. | — |
| 9 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |
| 10 | Back cover | `back_cover` | Contact and subscription details. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Methodology | `appendix_opener` | Sources, definitions, as-at dates. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `highlight_box`, `executive_summary`, `metric_panel`, `info_card`, `chart_frame`, `data_table`, `appendix_opener`, `disclaimer_page`, `back_cover`

**14. Image requirements**

Optional region imagery at 16:9. The layout must read correctly with no images at all — a research edition should not be blocked on photography.

**15. Chart & table requirements**

One chart per region plus two to three national charts. All charts share one axis convention across the edition.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `regions[] — name, indicators{}, chart, commentary[]`
- `edition.* — title, period, publishedAt`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer. Also exports to HTML for portal publication and email distribution.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You publish market commentary on a schedule.
- The document covers several regions or asset classes.
- The audience is your client base rather than one client.

**24. Use a different template when**

- The subject is one suburb → `suburb-analysis-report`
- The audience is one client making one decision → `property-investment-report`

**Library metadata** — tier `growth` · priority `P2` · data `high` · images `medium` · formality `professional` · audience `client-facing` · generator implemented

---

### Off-Market Opportunity Report

`off-market-opportunity-report`

An editorial presentation of a single off-market or pre-market opportunity for a high-value client, built to persuade as much as to inform.

|  |  |
| --- | --- |
| **1. Template name** | Off-Market Opportunity Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | High-net-worth clients, prestige buyers, private investors |
| **4. Primary use case** | Present a confidential opportunity in a form that matches the value of the asset and the expectations of the client. |
| **5. Recommended page range** | 4–8 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Luxury Presentation |
| **7. Visual style** | Luxury Presentation — Editorial and unhurried. Oversized display type, deep whitespace, prestige framing. Display Georgia, body Calibri, numerals Georgia. Ruled tables, outlined cards, numbered section openers, density 1.32×. Editorial — a full-page image cover, oversized serif display type, deep whitespace and a restrained palette. The least dense template in the library, deliberately. |
| **8. Colour configuration** | Primary midnight, accent cyan, support blue. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. Midnight primary rather than navy, cyan accent, no zebra banding. |
| **9. Cover-page structure** | Tall centred cover image, centred logo slot, wide-tracked eyebrow, oversized centred display title, accent rule, centred subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. Full-page hero photograph above a centred logo, eyebrow, oversized centred title and a single accent rule. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Hero photograph, opportunity title, confidentiality mark. | — |
| 2 | The opportunity | `executive_summary` | Two to four paragraphs of editorial narrative. No bullets. | — |
| 3 | The property | `image_gallery` | Four to eight full-width photographs with captions. | — |
| 4 | At a glance | `metric_panel` | Guide, land, accommodation, availability. | — |
| 5 | Terms & process | `process_flow` | How the opportunity may be secured. | — |
| 6 | Confidentiality | `highlight_box` | Explicit confidentiality and non-circulation terms. | — |
| 7 | Your adviser | `adviser_profile` | Named contact for the opportunity. | — |
| 8 | Back cover | `back_cover` | Contact block, discreet attribution. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Position | `map_frame` | Location and precinct context. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `executive_summary`, `image_gallery`, `metric_panel`, `map_frame`, `process_flow`, `highlight_box`, `adviser_profile`, `back_cover`

**14. Image requirements**

One full-bleed hero at 3:2 minimum 2400×1600, plus 4–8 gallery images at 3:2 minimum 1600×1067. Image quality is the template — the generator should reject images below the minimum rather than upscale them.

**15. Chart & table requirements**

None. Charts are visually wrong in this family; if the opportunity needs modelling, attach a separate financial report.

**16. White-label configuration points**

All 28 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

Template-specific additions:

| Area | Binding | Appears in |
| --- | --- | --- |
| Confidentiality mark | {{document.confidentiality}} | Cover, every page footer, confidentiality panel |

**17. Dynamic content fields**

- `opportunity.* — title, narrative[], guide, availability, terms[]`
- `property.images[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Intended for high-quality print. Specify 120gsm+ and full-bleed printing in the print dialogue guidance shown at export.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Full-bleed cover photograph with the title overlay — the most visually distinct card in the library.

**23. Use this template when**

- The asset and the client justify a presentation-grade document.
- Persuasion matters as much as analysis.
- Photography is strong and available at high resolution.

**24. Use a different template when**

- The client needs the investment numbers → `property-investment-report`
- Photography is weak or unavailable → `property-acquisition-recommendation`
- The document is a commercial pitch → `client-proposal`

**Library metadata** — tier `scale` · priority `P2` · data `low` · images `high` · formality `presentation` · audience `client-facing` · generator implemented

---

### House & Land Package Assessment

`house-and-land-assessment`

Assessment of a house-and-land or turnkey package: the land, the build contract, inclusions, staged payments and the completed-value position.

|  |  |
| --- | --- |
| **1. Template name** | House & Land Package Assessment |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Investor clients, first-home buyers |
| **4. Primary use case** | Test whether a package is priced and structured acceptably before contract. |
| **5. Recommended page range** | 6–12 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Property Visual |
| **7. Visual style** | Property Visual — Image-led. Property photography, maps, location data and side-by-side comparison. Display Calibri, body Calibri. Banded tables, filled cards, bar section openers, density 0.95×. |
| **8. Colour configuration** | Primary navy, accent cyan, support blue. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-bleed cover image band above a navy panel carrying the logo slot, eyebrow, title and subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Estate and lot identification, render as cover image. | — |
| 2 | Summary & verdict | `executive_summary` | Whether the package stacks up. | — |
| 3 | Package metrics | `metric_panel` | Land price, build price, total, completed value estimate. | — |
| 4 | Land | `info_card` | Lot, size, orientation, registration, covenants. | — |
| 5 | Build contract | `data_table` | Contract type, inclusions, exclusions, PC sums. | `{{build.contract}}` |
| 6 | Inclusions & upgrades | `data_table` ↻ | Line-by-line with cost impact. | `{{build.inclusions[]}}` |
| 7 | Payment schedule | `timeline` | Staged payments against build milestones. | `{{build.stages[]}}` |
| 8 | Completed value | `comparison_table` | Package cost against comparable completed stock. | — |
| 9 | Risks & mitigations | `risk_box` | Registration delay, build cost escalation, valuation shortfall. | — |
| 10 | Recommendation | `recommendation_box` | Proceed, renegotiate or decline. | — |
| 11 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

_All sections are required for this template._

**13. Data & content components**

`cover`, `executive_summary`, `metric_panel`, `info_card`, `data_table`, `timeline`, `comparison_table`, `risk_box`, `recommendation_box`, `disclaimer_page`

**14. Image requirements**

Builder render or estate plan as cover image; optional floor-plan and site-plan images in the body at 4:3.

**15. Chart & table requirements**

One staged-payment timeline and two tables (inclusions, comparables). Inclusions table must handle 40+ rows.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `build.* — contract{}, inclusions[], exclusions[], stages[], builder`
- `land.* — lot, estate, size, registration, covenants`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- The purchase is a house-and-land or turnkey package.
- The build contract materially affects the investment case.
- Staged payments and registration timing need to be explained.

**24. Use a different template when**

- The property is established stock → `property-investment-report`
- The project is a multi-dwelling development → `development-feasibility-report`

**Library metadata** — tier `scale` · priority `P3` · data `high` · images `medium` · formality `professional` · audience `client-facing` · generator implemented

---

### Commercial Property Assessment

`commercial-property-assessment`

Assessment of a commercial or industrial asset: tenancy, lease covenants, WALE, outgoings, capitalisation and the investment position.

|  |  |
| --- | --- |
| **1. Template name** | Commercial Property Assessment |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Commercial investors, SMSF trustees, corporate buyers |
| **4. Primary use case** | Assess a commercial asset on income durability rather than comparable sales. |
| **5. Recommended page range** | 8–16 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Executive Corporate |
| **7. Visual style** | Executive Corporate — Boardroom-ready. Formal, decisive, built around the executive summary. Display Cambria, body Calibri. Banded tables, filled cards, bar section openers, density 1×. Boardroom register. The tenancy schedule is the centrepiece and is given a full page. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Asset name, address, asset class. | — |
| 2 | Contents | `table_of_contents` | Required at this length. | — |
| 3 | Executive summary | `executive_summary` | Income thesis and the verdict. | — |
| 4 | Investment metrics | `metric_panel` | Passing yield, WALE, net income, capital value. | — |
| 5 | Asset overview | `info_card` | Title, zoning, area, construction, services. | — |
| 6 | Tenancy schedule | `data_table` ↻ | Tenant, area, term, expiry, rent, reviews, options. | `{{tenancies[]}}` |
| 7 | Lease expiry profile | `chart_frame` | Expiry by year against total income. | `{{tenancies.expiryProfile}}` |
| 8 | Income & outgoings | `data_table` | Net income reconciliation. | `{{financials.income}}` |
| 9 | Capitalisation analysis | `data_table` | Cap rate scenarios and value range. | `{{valuation.scenarios[]}}` |
| 10 | Risks & mitigations | `risk_box` | Vacancy, covenant, capex, obsolescence. | — |
| 11 | Recommendation | `recommendation_box` | Acquire, condition or decline. | — |
| 12 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Appendix — lease abstracts | `appendix_opener` | Per-tenancy abstracts. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `executive_summary`, `metric_panel`, `info_card`, `data_table`, `chart_frame`, `risk_box`, `recommendation_box`, `appendix_opener`, `disclaimer_page`

**14. Image requirements**

One asset photograph at 16:9 for the cover; optional floor-plate diagrams in the appendix.

**15. Chart & table requirements**

One lease-expiry profile chart. Tenancy schedule is the widest table in the library and may be generated in landscape.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `tenancies[] — tenant, area, commenced, expires, rent, reviews, options`
- `valuation.scenarios[] — capRate, value, assumption`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. The tenancy schedule may be generated on a landscape section; the generator switches page orientation for that section rather than shrinking the type.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- The asset is commercial, industrial or mixed-use.
- Income durability drives value more than comparable sales.
- Lease covenants and WALE need to be presented.

**24. Use a different template when**

- The asset is residential → `property-investment-report`
- The project is a development → `development-feasibility-report`

**Library metadata** — tier `scale` · priority `P3` · data `high` · images `medium` · formality `formal` · audience `client-facing` · generator implemented

---

### Development Feasibility Report

`development-feasibility-report`

Residual land value and profitability modelling for a development: costs, revenue, funding, programme and sensitivity.

|  |  |
| --- | --- |
| **1. Template name** | Development Feasibility Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Developers, investors, funders |
| **4. Primary use case** | Test whether a development proposal produces an acceptable return under stated assumptions, and how sensitive that return is. |
| **5. Recommended page range** | 12–24 pages (11–25 pages — multi-section analysis with appendices) |
| **6. Design family** | Financial Analytical |
| **7. Visual style** | Financial Analytical — Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. Display Calibri, body Calibri, numerals Consolas. Ledger tables, outlined cards, rule section openers, density 0.88×. Ledger-dense. Assumption panels precede every calculation block so no number appears without its basis. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Project name, site address, scheme summary. | — |
| 2 | Contents | `table_of_contents` | Required at this length. | — |
| 3 | Executive summary | `executive_summary` | Feasibility verdict and headline return. | — |
| 4 | Feasibility metrics | `metric_panel` | Residual land value, profit, margin on cost, IRR. | — |
| 5 | Assumptions | `info_card` | Every assumption in one place, with source and date. | `{{feasibility.assumptions}}` |
| 6 | Scheme & yield | `data_table` | Product mix, areas, counts. | `{{scheme.mix[]}}` |
| 7 | Revenue | `data_table` | Gross realisation by product with rates. | `{{feasibility.revenue[]}}` |
| 8 | Costs | `data_table` | Acquisition, construction, professional, statutory, finance, contingency. | `{{feasibility.costs[]}}` |
| 9 | Funding & cash flow | `chart_frame` | Drawdown and repayment against programme. | `{{funding.series}}` |
| 10 | Programme | `timeline` | Milestones from acquisition to settlement. | `{{programme[]}}` |
| 11 | Sensitivity analysis | `comparison_table` | Base, downside and upside on the three most sensitive inputs. | `{{feasibility.scenarios[]}}` |
| 12 | Risks & mitigations | `risk_box` | Planning, cost, market, funding, programme. | — |
| 13 | Conclusion | `recommendation_box` | Proceed, revise or abandon. | — |
| 14 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Appendix — full model | `appendix_opener` | Line-level model output. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `executive_summary`, `metric_panel`, `info_card`, `data_table`, `chart_frame`, `timeline`, `comparison_table`, `risk_box`, `recommendation_box`, `appendix_opener`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One funding/cash-flow chart, one sensitivity comparison. Cost and revenue tables routinely exceed 40 rows and must repeat headers and carry sub-totals per group plus a grand total.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `feasibility.* — assumptions{}, revenue[], costs[], scenarios[], residual, margin`
- `scheme.mix[], programme[], funding.series[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Financial tables may be generated in landscape. Numerals set in the monospaced face so columns align optically down the page.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A development scheme needs to be tested financially.
- A funder or partner will interrogate the assumptions.
- Sensitivity matters as much as the base case.

**24. Use a different template when**

- The purchase is a completed asset → `commercial-property-assessment`
- The scheme is a single house-and-land package → `house-and-land-assessment`

**Library metadata** — tier `scale` · priority `P3` · data `high` · images `low` · formality `formal` · audience `client-facing` · generator implemented

---

### Portfolio Review Report

`portfolio-review-report`

Periodic review of a client's whole property portfolio: performance, equity, debt, cash flow and recommended actions per asset.

|  |  |
| --- | --- |
| **1. Template name** | Portfolio Review Report |
| **2. Category** | Property & Buyer's Agency |
| **3. Intended audience** | Portfolio clients and their advisers |
| **4. Primary use case** | Review portfolio performance and agree the next set of actions. |
| **5. Recommended page range** | 8–20 pages, growing with the number of assets (Length follows the record count — grows with rows, properties or controls) |
| **6. Design family** | Premium Advisory |
| **7. Visual style** | Premium Advisory — Consulting register. Generous spacing, elegant dividers, considered recommendations. Display Georgia, body Calibri. Ruled tables, outlined cards, numbered section openers, density 1.18×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | 40/60 vertical split — navy sidebar with logo, tagline and the prepared-for/prepared-by/issued stack; white field carrying eyebrow, title, accent rule and subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client, portfolio, review period. | — |
| 2 | Contents | `table_of_contents` | Required beyond four assets. | — |
| 3 | Portfolio position | `metric_panel` | Total value, total debt, net equity, portfolio yield. | — |
| 4 | Executive summary | `executive_summary` | Performance and the headline actions. | — |
| 5 | Performance | `chart_frame` | Value and equity over the review period. | `{{portfolio.history}}` |
| 6 | Asset register | `data_table` ↻ | Every asset: value, debt, LVR, income, net position. | `{{portfolio.assets[]}}` |
| 7 | Debt profile | `data_table` | Facilities, rates, fixed expiries, offsets. | `{{portfolio.debt[]}}` |
| 8 | Cash-flow position | `data_table` | Consolidated portfolio cash flow. | `{{portfolio.cashflow}}` |
| 9 | Opportunities & risks | `risk_box` | Equity release, refinance, disposal, risk. | — |
| 10 | Recommended actions | `checklist` | Per-asset actions with owners and dates. | `{{portfolio.actions[]}}` |
| 11 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Asset profiles | `info_card` | One block per asset with performance and commentary. | The underlying data is present |
| Sign-off | `signature_block` | Client acknowledgement of the review. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `metric_panel`, `executive_summary`, `chart_frame`, `data_table`, `info_card`, `risk_box`, `checklist`, `signature_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One value/equity history chart, optional per-asset sparkline equivalents rendered as native bar rows. Asset register must handle 30+ assets without losing its header.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `portfolio.* — assets[], debt[], cashflow{}, history[], actions[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client holds more than one property and needs a consolidated view.
- You conduct scheduled portfolio reviews.
- Recommendations span several assets.

**24. Use a different template when**

- There is one asset → `property-investment-report`
- The focus is debt structure rather than assets → `finance-strategy-report`

**Library metadata** — tier `scale` · priority `P2` · data `high` · images `low` · formality `formal` · audience `client-facing` · generator implemented

---

## Finance & Lending

### Borrowing Capacity Report

`borrowing-capacity-report`

Assessed borrowing capacity across lenders, with the inputs, the assessment-rate treatment and the sensitivity that produced it.

|  |  |
| --- | --- |
| **1. Template name** | Borrowing Capacity Report |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Clients, brokers, buyer's agents |
| **4. Primary use case** | Tell a client what they can borrow, from whom, and what would change it. |
| **5. Recommended page range** | 5–10 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Financial Analytical |
| **7. Visual style** | Financial Analytical — Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. Display Calibri, body Calibri, numerals Consolas. Ledger tables, outlined cards, rule section openers, density 0.88×. Numbers first. The capacity figure is the largest element on page two, and every input that produced it is on the facing page. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client, assessment date, applicant count. | — |
| 2 | Assessed capacity | `metric_panel` | Maximum capacity, indicative purchase price, deposit required, LVR. | — |
| 3 | Summary | `executive_summary` | What the capacity means in practice. | — |
| 4 | Income | `data_table` | Income by applicant, type and shading. | `{{applicants[].income}}` |
| 5 | Commitments | `data_table` | Liabilities, repayments, declared and HEM-benchmarked living expenses. | `{{commitments[]}}` |
| 6 | Assessment assumptions | `info_card` | Assessment rate, buffer, shading, HEM basis, as-at date. | `{{assessment.assumptions}}` |
| 7 | Lender comparison | `bar_chart` | Capacity by lender as a native bar chart. | `{{lenders[]}}` |
| 8 | Lender detail | `data_table` ↻ | Capacity, assessment rate, policy notes per lender. | `{{lenders[]}}` |
| 9 | Sensitivity | `comparison_table` | Capacity at +1%, +2% and on a reduced income. | `{{assessment.sensitivity[]}}` |
| 10 | What would improve capacity | `checklist` | Concrete actions with estimated impact. | `{{assessment.levers[]}}` |
| 11 | Important information | `disclaimer_page` | Not credit assistance; indicative only; no guarantee of approval. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

_All sections are required for this template._

**13. Data & content components**

`cover`, `metric_panel`, `executive_summary`, `data_table`, `info_card`, `bar_chart`, `comparison_table`, `checklist`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One native lender-capacity bar chart — native rather than an image so the figures remain selectable and print in grayscale. Four to six tables with right-aligned monospaced numerals.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `applicants[] — name, incomeType, gross, shaded`
- `commitments[] — type, lender, limit, balance, repayment`
- `lenders[] — name, capacity, assessmentRate, notes`
- `assessment.* — rate, buffer, hem, assumptions{}, sensitivity[], levers[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Capacity figures are announced as text, not as chart images, so a screen-reader user receives the same numbers as a sighted one.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Routinely printed for client meetings. Fits comfortably in 10 pages and never relies on colour to distinguish lender rows.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client needs to know their borrowing position.
- You are comparing capacity across a lender panel.
- Sensitivity to rate rises must be shown.

**24. Use a different template when**

- The client needs a full finance strategy → `finance-strategy-report`
- The question is which loan, not how much → `loan-comparison-report`
- You are documenting an approval already obtained → `finance-approval-summary`

**Library metadata** — tier `scale` · priority `P1` · data `high` · images `none` · formality `professional` · audience `client-facing` · generator implemented

---

### Finance Strategy Report

`finance-strategy-report`

The client's whole debt strategy: current structure, target structure, sequencing, and the funding runway for planned acquisitions.

|  |  |
| --- | --- |
| **1. Template name** | Finance Strategy Report |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Investor clients, brokers, buyer's agents |
| **4. Primary use case** | Set out how a client's lending should be structured to reach their goals. |
| **5. Recommended page range** | 8–14 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Modern Technology |
| **7. Visual style** | Modern Technology — SaaS-inspired. Card-led, data-forward, contemporary and digital-first. Display Calibri, body Calibri. Hairline tables, filled cards, tab section openers, density 1.05×. Card-led. Current state and target state are presented as two matched card stacks so the delta is visible without reading. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-width navy panel with no top rule; logo slot, eyebrow, title, subtitle and chip row, set in a single card block. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client, strategy horizon, issue control. | — |
| 2 | Executive summary | `executive_summary` | The strategy in five sentences. | — |
| 3 | Position today | `metric_panel` | Total debt, blended rate, usable equity, current LVR. | — |
| 4 | Current structure | `data_table` | Every facility with rate, type, expiry. | `{{facilities[]}}` |
| 5 | Goals & constraints | `info_card` | What the strategy must achieve. | `{{goals}}` |
| 6 | Target structure | `data_table` | Proposed facilities and their purpose. | `{{strategy.target[]}}` |
| 7 | Current versus target | `comparison_table` | Side-by-side with the delta. | `{{strategy.delta}}` |
| 8 | Sequencing | `process_flow` | The order of moves and why order matters. | `{{strategy.sequence[]}}` |
| 9 | Funding runway | `chart_frame` | Capacity released against planned purchases. | `{{strategy.runway}}` |
| 10 | Risks and mitigations | `risk_box` | Rate, policy, valuation, timing. | — |
| 11 | What we need from you | `checklist` | Actions, owners and dates. | — |
| 12 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Contents | `table_of_contents` | Optional below 10 pages. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `executive_summary`, `metric_panel`, `data_table`, `info_card`, `comparison_table`, `process_flow`, `chart_frame`, `risk_box`, `checklist`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One funding-runway chart. Current-versus-target comparison must handle up to eight facilities per side.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `facilities[] — lender, purpose, limit, balance, rate, type, expiry`
- `strategy.* — target[], delta{}, sequence[], runway[]`
- `goals{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client's lending needs restructuring, not just a new loan.
- Several moves must happen in a specific order.
- The client is building a portfolio over years, not months.

**24. Use a different template when**

- The question is capacity → `borrowing-capacity-report`
- The question is which product → `loan-comparison-report`
- The client only wants to release equity → `equity-release-strategy`

**Library metadata** — tier `scale` · priority `P1` · data `high` · images `low` · formality `professional` · audience `client-facing` · generator implemented

---

### Loan Comparison Report

`loan-comparison-report`

Side-by-side comparison of shortlisted loan products on rate, fees, features, true cost over the intended hold period, and policy fit.

|  |  |
| --- | --- |
| **1. Template name** | Loan Comparison Report |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Clients, brokers |
| **4. Primary use case** | Evidence why a recommended product was selected over the alternatives. |
| **5. Recommended page range** | 3–7 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Financial Analytical |
| **7. Visual style** | Financial Analytical — Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. Display Calibri, body Calibri, numerals Consolas. Ledger tables, outlined cards, rule section openers, density 0.88×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client, loan purpose, comparison date. | — |
| 2 | What was compared | `highlight_box` | The shortlist, the criteria and the hold period assumed. | — |
| 3 | Product comparison | `comparison_table` ↻ | Every product on rate, comparison rate, fees, features. | `{{products[]}}` |
| 4 | True cost over term | `bar_chart` | Total cost over the assumed hold period per product. | — |
| 5 | Feature matrix | `status_table` | Offset, redraw, split, portability, construction — available or not. | `{{products[].features}}` |
| 6 | Recommendation | `recommendation_box` | The selected product and why. | — |
| 7 | Important information | `disclaimer_page` | Comparison basis, as-at date, no guarantee of approval. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Policy fit | `status_table` | How each lender treats the client's circumstances. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `highlight_box`, `comparison_table`, `bar_chart`, `status_table`, `recommendation_box`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One native true-cost bar chart. Comparison table holds up to five products; beyond five the generator emits a second table rather than reducing type size.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `products[] — lender, product, rate, comparisonRate, fees{}, features{}, policy{}`
- `comparison.* — holdPeriod, loanAmount, asAt`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Feature availability uses a glyph and a word, never a tick colour alone.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client is choosing between shortlisted loan products.
- You must evidence why one product was recommended.
- Comparison-rate and true-cost differences matter.

**24. Use a different template when**

- The question is how much, not which → `borrowing-capacity-report`
- The whole debt structure is under review → `finance-strategy-report`

**Library metadata** — tier `growth` · priority `P1` · data `high` · images `none` · formality `professional` · audience `client-facing` · generator implemented

---

### Lending Recommendation Report

`lending-recommendation-report`

A formal recommendation of a lender, product and structure, with the reasoning, alternatives considered and the disclosures that must accompany it.

|  |  |
| --- | --- |
| **1. Template name** | Lending Recommendation Report |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Clients, credit assessors, compliance reviewers |
| **4. Primary use case** | Document a credit recommendation to the standard a compliance review expects. |
| **5. Recommended page range** | 5–10 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Premium Advisory |
| **7. Visual style** | Premium Advisory — Consulting register. Generous spacing, elegant dividers, considered recommendations. Display Georgia, body Calibri. Ruled tables, outlined cards, numbered section openers, density 1.18×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | 40/60 vertical split — navy sidebar with logo, tagline and the prepared-for/prepared-by/issued stack; white field carrying eyebrow, title, accent rule and subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client, recommendation date, adviser and credential. | — |
| 2 | Recommendation | `recommendation_box` | Lender, product, structure, stated first. | — |
| 3 | Your objectives & requirements | `info_card` | As stated by the client, in the client's terms. | `{{objectives}}` |
| 4 | Your financial position | `data_table` | Income, commitments, assets, position. | — |
| 5 | Why this recommendation | `executive_summary` | Reasoning against the objectives. | — |
| 6 | Alternatives considered | `comparison_table` | What else was assessed and why it was not recommended. | `{{alternatives[]}}` |
| 7 | Costs & fees | `data_table` | Every fee, upfront and ongoing. | `{{costs[]}}` |
| 8 | Disclosures | `highlight_box` | Commission, referral benefits, conflicts, lender panel. | — |
| 9 | Risks & things to consider | `risk_box` | Rate, term, break costs, features. | — |
| 10 | Next steps | `process_flow` | From acceptance to settlement. | — |
| 11 | Acknowledgement | `signature_block` | Client acknowledgement of the recommendation. | — |
| 12 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

_All sections are required for this template._

**13. Data & content components**

`cover`, `recommendation_box`, `info_card`, `data_table`, `executive_summary`, `comparison_table`, `highlight_box`, `risk_box`, `process_flow`, `signature_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Four tables. The disclosures panel must never be an optional section — it is removed only by a licensee override.

**16. White-label configuration points**

All 29 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

Template-specific additions:

| Area | Binding | Appears in |
| --- | --- | --- |
| Credit licence / authorisation | {{org.acl}} | Cover, disclosures panel, footer |
| Aggregator / licensee | {{org.aggregator}} | Disclosures panel |

**17. Dynamic content fields**

- `objectives{}, alternatives[], costs[], disclosures{}`
- `recommendation.* — lender, product, structure, rationale[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. The disclosures panel is rendered as body text, not as a graphic, so it is extractable and searchable in the PDF.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You are formally recommending a credit product.
- The document will be reviewed by a licensee or aggregator.
- Disclosure obligations attach to the recommendation.

**24. Use a different template when**

- You are only comparing products → `loan-comparison-report`
- You are documenting an approval → `finance-approval-summary`

**Library metadata** — tier `scale` · priority `P2` · data `medium` · images `none` · formality `formal` · audience `client-facing` · generator implemented

---

### Refinance Assessment

`refinance-assessment`

Whether refinancing is worthwhile: current position, proposed position, switching costs, break-even point and net benefit over the hold period.

|  |  |
| --- | --- |
| **1. Template name** | Refinance Assessment |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Clients, brokers |
| **4. Primary use case** | Quantify whether a refinance is worth doing, and after how long it pays back. |
| **5. Recommended page range** | 3–6 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Financial Analytical |
| **7. Visual style** | Financial Analytical — Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. Display Calibri, body Calibri, numerals Consolas. Ledger tables, outlined cards, rule section openers, density 0.88×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client, current lender, assessment date. | — |
| 2 | Verdict | `recommendation_box` | Refinance or retain, with the net benefit. | — |
| 3 | Headline numbers | `metric_panel` | Monthly saving, total saving, switching cost, break-even months. | — |
| 4 | Current position | `data_table` | Facility, rate, balance, remaining term, fees. | — |
| 5 | Proposed position | `data_table` | Proposed facility on the same fields. | — |
| 6 | Switching costs | `data_table` | Discharge, break, application, valuation, legal. | `{{refinance.costs[]}}` |
| 7 | Break-even | `bar_chart` | Cumulative saving against switching cost by month. | — |
| 8 | Considerations | `risk_box` | Loss of features, term reset, credit impact. | — |
| 9 | Next steps | `checklist` | What the client must provide and by when. | — |
| 10 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

_All sections are required for this template._

**13. Data & content components**

`cover`, `recommendation_box`, `metric_panel`, `data_table`, `bar_chart`, `risk_box`, `checklist`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One native break-even bar chart. Three comparison tables.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `refinance.* — current{}, proposed{}, costs[], breakEvenMonths, netBenefit`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client is considering moving lenders.
- The break-even period is the deciding factor.
- Switching costs need to be made explicit.

**24. Use a different template when**

- The client wants to release equity → `equity-release-strategy`
- The whole structure is under review → `finance-strategy-report`

**Library metadata** — tier `scale` · priority `P2` · data `high` · images `none` · formality `professional` · audience `client-facing` · generator implemented

---

### Equity Release Strategy

`equity-release-strategy`

How much usable equity exists, how it can be accessed, what it costs and what it can fund.

|  |  |
| --- | --- |
| **1. Template name** | Equity Release Strategy |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Investor clients |
| **4. Primary use case** | Show a client the equity available across their assets and how to deploy it. |
| **5. Recommended page range** | 4–8 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Modern Technology |
| **7. Visual style** | Modern Technology — SaaS-inspired. Card-led, data-forward, contemporary and digital-first. Display Calibri, body Calibri. Hairline tables, filled cards, tab section openers, density 1.05×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-width navy panel with no top rule; logo slot, eyebrow, title, subtitle and chip row, set in a single card block. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client, valuation basis, assessment date. | — |
| 2 | Available equity | `metric_panel` | Total equity, usable at 80%, usable at 90%, cost to access. | — |
| 3 | Summary | `executive_summary` | What the equity can realistically fund. | — |
| 4 | Equity by asset | `data_table` ↻ | Value, debt, LVR, usable equity per property. | `{{assets[]}}` |
| 5 | Release options | `comparison_table` | Top-up, split, cross-collateralised, new facility. | `{{options[]}}` |
| 6 | Cost of access | `data_table` | Fees, LMI, valuation, rate impact. | `{{costs[]}}` |
| 7 | Risks | `risk_box` | Cross-collateralisation, LMI, valuation shortfall. | — |
| 8 | Next steps | `checklist` | Actions and evidence required. | — |
| 9 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Deployment plan | `process_flow` | What the released funds are for. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `executive_summary`, `data_table`, `comparison_table`, `process_flow`, `risk_box`, `checklist`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

Optional native bar chart of usable equity per asset. Asset table must handle 20+ properties.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `assets[] — address, value, debt, lvr, usableEquity`
- `options[], costs[], deployment[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client wants to know what equity they can access.
- Equity is spread across several assets.
- The cost and risk of access need to be explicit.

**24. Use a different template when**

- The question is total capacity → `borrowing-capacity-report`
- The whole structure is being redesigned → `finance-strategy-report`

**Library metadata** — tier `scale` · priority `P3` · data `high` · images `none` · formality `professional` · audience `client-facing` · generator implemented

---

### Cash-Flow & Net Position Report

`cash-flow-net-position-report`

Projected cash flow and net position over one to ten years, with the assumptions, the year-by-year detail and the sensitivity.

|  |  |
| --- | --- |
| **1. Template name** | Cash-Flow & Net Position Report |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Investor clients, accountants |
| **4. Primary use case** | Show what an asset or portfolio costs or returns, year by year, after tax. |
| **5. Recommended page range** | 5–12 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Financial Analytical |
| **7. Visual style** | Financial Analytical — Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. Display Calibri, body Calibri, numerals Consolas. Ledger tables, outlined cards, rule section openers, density 0.88×. The ten-year table is the document. Everything else supports it. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Subject, projection period, basis. | — |
| 2 | Position summary | `metric_panel` | Year-1 net position, 10-year cumulative, break-even year, after-tax cost. | — |
| 3 | Assumptions | `info_card` | Growth, rent growth, rate, vacancy, tax rate, depreciation basis. | `{{assumptions}}` |
| 4 | Year-by-year projection | `data_table` ↻ | Income, expenses, interest, depreciation, tax, net position by year. | `{{cashflow.years[]}}` |
| 5 | Net position over time | `chart_frame` | Cumulative net position line chart. | `{{cashflow.series}}` |
| 6 | Expense breakdown | `bar_chart` | Where the money goes in year one. | — |
| 7 | Sensitivity | `comparison_table` | Rate +1%/+2%, vacancy, rent variance. | `{{sensitivity[]}}` |
| 8 | Important information | `disclaimer_page` | Projections are not forecasts; not tax advice. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Commentary | `prose` | What the projection means. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `info_card`, `data_table`, `chart_frame`, `bar_chart`, `comparison_table`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One cumulative-position line chart, one native expense bar chart. The ten-year table is eleven columns wide and is generated in landscape on its own section.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `cashflow.years[] — year, income, expenses, interest, depreciation, tax, net`
- `assumptions{}, sensitivity[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. The projection section switches to landscape rather than shrinking the table. Numerals are monospaced so columns align down the page.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A client needs to see holding cost or return over time.
- Tax and depreciation materially change the picture.
- Sensitivity to rates or vacancy must be shown.

**24. Use a different template when**

- The question is capacity → `borrowing-capacity-report`
- The subject is a whole portfolio → `portfolio-review-report`

**Library metadata** — tier `growth` · priority `P1` · data `high` · images `none` · formality `professional` · audience `client-facing` · generator implemented

---

### Serviceability Assessment

`serviceability-assessment`

Internal working document showing the serviceability calculation for one lender, line by line, so a credit decision can be checked.

|  |  |
| --- | --- |
| **1. Template name** | Serviceability Assessment |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Brokers, credit support, compliance |
| **4. Primary use case** | Record and check the serviceability calculation behind a submission. |
| **5. Recommended page range** | 2–5 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Financial Analytical |
| **7. Visual style** | Financial Analytical — Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. Display Calibri, body Calibri, numerals Consolas. Ledger tables, outlined cards, rule section openers, density 0.88×. Working-paper register — no cover imagery, no marketing, every line numbered and traceable. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Minimal cover: client, lender, calculator version, date. | — |
| 2 | Outcome | `metric_panel` | Surplus/deficit, NSR, max loan, assessment rate. | — |
| 3 | Income | `data_table` | Every income line with shading applied. | `{{income[]}}` |
| 4 | Commitments | `data_table` | Every liability with assessment treatment. | `{{commitments[]}}` |
| 5 | Living expenses | `data_table` | Declared versus HEM, higher applied. | `{{expenses}}` |
| 6 | Calculation | `data_table` | The arithmetic, line by line, to the outcome. | `{{calculation[]}}` |
| 7 | Reviewer sign-off | `approval_block` | Prepared by, checked by, dates. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Policy notes | `status_table` | Lender policy items and how each was treated. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `data_table`, `status_table`, `approval_block`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Five tables. Every row carries a line reference so a reviewer can cite a specific figure.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L3** (Partner Branded).

**17. Dynamic content fields**

- `income[], commitments[], expenses{}, calculation[], policy[]`
- `assessment.* — lender, calculatorVersion, rate, buffer`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Printed and filed with the credit file. Fits 5 pages; no cover imagery.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. Internal document — excluded from client-facing preview and from any client portal share.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You need a checkable record of a servicing calculation.
- A reviewer or auditor will re-perform the arithmetic.
- The document stays inside the business.

**24. Use a different template when**

- The client is the reader → `borrowing-capacity-report`
- You are recommending a product → `lending-recommendation-report`

**Library metadata** — tier `scale` · priority `P2` · data `high` · images `none` · formality `operational` · audience `internal` · generator implemented

---

### Construction Finance Report

`construction-finance-report`

Funding structure for a construction or renovation project: facility structure, drawdown schedule, interest during construction and completion position.

|  |  |
| --- | --- |
| **1. Template name** | Construction Finance Report |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Clients, builders, lenders |
| **4. Primary use case** | Explain how a build will be funded and what it costs while it is building. |
| **5. Recommended page range** | 5–10 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Financial Analytical |
| **7. Visual style** | Financial Analytical — Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules. Display Calibri, body Calibri, numerals Consolas. Ledger tables, outlined cards, rule section openers, density 0.88×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Project, builder, lender, funding date. | — |
| 2 | Funding summary | `metric_panel` | Land facility, build facility, total, interest during construction. | — |
| 3 | Structure | `data_table` | Facilities, limits, rates, terms. | `{{facilities[]}}` |
| 4 | Drawdown schedule | `timeline` | Stage, trigger, amount, cumulative. | `{{drawdowns[]}}` |
| 5 | Interest during construction | `data_table` | Interest by stage and cumulative. | `{{idc[]}}` |
| 6 | Completion position | `data_table` | On-completion value, debt, LVR, servicing. | — |
| 7 | Conditions precedent | `checklist` | What must be satisfied before each drawdown. | `{{conditions[]}}` |
| 8 | Risks | `risk_box` | Cost overrun, delay, valuation, builder solvency. | — |
| 9 | Next steps | `process_flow` | From approval to first drawdown. | — |
| 10 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

_All sections are required for this template._

**13. Data & content components**

`cover`, `metric_panel`, `data_table`, `timeline`, `checklist`, `risk_box`, `process_flow`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

Drawdown timeline plus three tables. Optional cumulative drawdown chart.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `facilities[], drawdowns[], idc[], conditions[]`
- `project.* — builder, contractSum, term, completionValue`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- Funding is staged against build progress.
- Interest during construction materially affects the project.
- Conditions precedent must be tracked per drawdown.

**24. Use a different template when**

- The purchase is a completed turnkey package → `house-and-land-assessment`
- The project is a multi-unit development → `development-feasibility-report`

**Library metadata** — tier `scale` · priority `P3` · data `high` · images `low` · formality `professional` · audience `client-facing` · generator implemented

---

### SMSF Finance Assessment

`smsf-finance-assessment`

Assessment of a limited-recourse borrowing arrangement for a self-managed super fund, against fund, trustee, asset and lender requirements.

|  |  |
| --- | --- |
| **1. Template name** | SMSF Finance Assessment |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | SMSF trustees, accountants, advisers |
| **4. Primary use case** | Establish whether an SMSF borrowing arrangement is viable and compliant before it is entered into. |
| **5. Recommended page range** | 6–12 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Fund name, trustee, asset, assessment date. | — |
| 2 | Scope & limitations | `highlight_box` | This is not financial product, tax or legal advice. | — |
| 3 | Assessment outcome | `recommendation_box` | Viable, conditional or not viable. | — |
| 4 | Fund details | `info_card` | Fund, trustee structure, members, balance. | — |
| 5 | Structure requirements | `status_table` | Bare trust, holding trustee, deed provisions — each with status. | `{{structure.controls[]}}` |
| 6 | Contribution & liquidity | `data_table` | Contributions, rent, expenses, buffer. | `{{liquidity}}` |
| 7 | Lender requirements | `status_table` | Each requirement with evidence and status. | `{{lender.requirements[]}}` |
| 8 | Servicing | `data_table` | Fund-level servicing calculation. | — |
| 9 | Risks | `risk_box` | Liquidity, member event, single-asset concentration. | — |
| 10 | Outstanding items | `checklist` | What must be resolved and by whom. | — |
| 11 | Approvals | `approval_block` | Preparer, reviewer, dates. | — |
| 12 | Important information | `disclaimer_page` | Disclaimer, privacy, terms. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Professional referrals | `highlight_box` | Where independent advice is required. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `highlight_box`, `recommendation_box`, `info_card`, `status_table`, `data_table`, `risk_box`, `checklist`, `approval_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Three status tables and two calculation tables.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `fund.* — name, abn, trustees[], members[], balance`
- `structure.controls[], lender.requirements[], liquidity{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. The scope-and-limitations panel is the first content block after the cover and is never optional.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A fund is considering a limited-recourse borrowing arrangement.
- Structure and lender requirements must be evidenced.
- Several professionals will review the same document.

**24. Use a different template when**

- The borrower is an individual or trust → `borrowing-capacity-report`
- The subject is the asset rather than the structure → `commercial-property-assessment`

**Library metadata** — tier `scale` · priority `P3` · data `medium` · images `none` · formality `formal` · audience `client-facing` · generator implemented

---

### Finance Approval Summary

`finance-approval-summary`

A one-to-two page confirmation of an approval: what was approved, on what conditions, by when, and what happens next.

|  |  |
| --- | --- |
| **1. Template name** | Finance Approval Summary |
| **2. Category** | Finance & Lending |
| **3. Intended audience** | Clients, buyer's agents, solicitors |
| **4. Primary use case** | Confirm an approval in a form that can be forwarded to a third party. |
| **5. Recommended page range** | 1–3 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Minimal Professional |
| **7. Visual style** | Minimal Professional — Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. Display Arial, body Arial. Hairline tables, plain cards, rule section openers, density 0.92×. Deliberately plain and fast to generate — this document is produced in volume and forwarded by email within minutes of an approval. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Ruled masthead with organisation name and logo, then eyebrow, title and subtitle in a left-aligned stack. No fills. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Minimal masthead: client, lender, approval date. | — |
| 2 | Approval | `metric_panel` | Amount, rate, product, expiry. | — |
| 3 | Details | `info_card` | Applicants, security, purpose, LVR, term. | — |
| 4 | Conditions | `checklist` | Outstanding conditions with owners and dates. | `{{conditions[]}}` |
| 5 | Key dates | `timeline` | Finance date, expiry, settlement. | `{{dates[]}}` |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Next steps | `process_flow` | From here to settlement. | The underlying data is present |
| Important information | `disclaimer_page` | Approval is conditional and may be withdrawn. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `info_card`, `checklist`, `timeline`, `process_flow`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Two tables and a timeline. Must fit on one page when there are fewer than six conditions.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `approval.* — lender, amount, rate, product, expiry, lvr, term`
- `conditions[], dates[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer. Optimised for fast generation — target under two seconds per document.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- An approval has been issued and needs confirming in writing.
- A third party needs a forwardable summary.
- Speed matters more than presentation.

**24. Use a different template when**

- You are recommending a product → `lending-recommendation-report`
- The client needs the full position → `finance-strategy-report`

**Library metadata** — tier `growth` · priority `P2` · data `low` · images `none` · formality `operational` · audience `client-facing` · generator implemented

---

## Client Forms & Onboarding

### Client Fact-Find Form

`client-fact-find-form`

The primary intake form: personal details, employment, income, assets, liabilities and expenses, designed for completion on screen or on paper.

|  |  |
| --- | --- |
| **1. Template name** | Client Fact-Find Form |
| **2. Category** | Client Forms & Onboarding |
| **3. Intended audience** | Clients, with adviser support |
| **4. Primary use case** | Collect a complete financial position from a new client. |
| **5. Recommended page range** | 6–10 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Minimal Professional |
| **7. Visual style** | Minimal Professional — Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. Display Arial, body Arial. Hairline tables, plain cards, rule section openers, density 0.92×. Field-first. Every input cell carries the field affordance — pale fill, coloured underline — and lives in a table cell so Tab walks the form. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Ruled masthead with organisation name and logo, then eyebrow, title and subtitle in a left-aligned stack. No fills. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. Minimal ruled masthead rather than a panel cover; a form should not look like a report. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Masthead, form title, client reference. | — |
| 2 | Before you start | `highlight_box` | What is required and what to attach. | — |
| 3 | Applicant details | `definition_grid` ↻ | Two applicant columns, input styled. | `{{applicants[]}}` |
| 4 | Address history | `definition_grid` | Current and previous addresses. | — |
| 5 | Employment & income | `definition_grid` | Per applicant, with income breakdown. | — |
| 6 | Assets | `data_table` ↻ | Blank rows for asset entry. | — |
| 7 | Liabilities | `data_table` ↻ | Blank rows for liability entry. | — |
| 8 | Living expenses | `data_table` | Categorised expense lines with a total. | — |
| 9 | Declaration | `highlight_box` | What the client is confirming. | — |
| 10 | Signatures | `signature_block` | Applicant signatures and date. | — |
| 11 | Privacy & consent | `disclaimer_page` | Privacy notice and consent to collect. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Goals & objectives | `definition_grid` | Free-text objectives. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `highlight_box`, `definition_grid`, `data_table`, `signature_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Blank-row tables must repeat headers; the asset and liability tables ship with ten and eight blank rows and grow when pre-filled from platform data.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `applicants[] — title, firstName, surname, dob, contact{}, employment{}, income{}`
- `assets[], liabilities[], expenses{}, goals{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Every input cell has a visible, programmatically adjacent label; no field relies on placeholder text alone. Tab order follows reading order because inputs are table cells in document order.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Designed to be completed by hand as well as on screen — field cells are at least 7.6mm tall so handwriting fits.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. On mobile the two applicant columns stack to one column.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- Onboarding a new client who needs a full financial picture.
- The client will complete the form themselves.
- The data feeds borrowing capacity or a finance application.

**24. Use a different template when**

- You only need the property brief → `property-brief-form`
- You only need identity verification → `client-verification-summary`
- The client is already onboarded and only the brief has changed → `property-brief-form`

**Library metadata** — tier `launch` · priority `P1` · data `medium` · images `none` · formality `operational` · audience `client-facing` · generator implemented

---

### Client Onboarding Form

`client-onboarding-form`

Engagement-level onboarding: parties, scope of service, fees, authorities, communication preferences and consents.

|  |  |
| --- | --- |
| **1. Template name** | Client Onboarding Form |
| **2. Category** | Client Forms & Onboarding |
| **3. Intended audience** | New clients |
| **4. Primary use case** | Formalise the start of an engagement and capture the consents it depends on. |
| **5. Recommended page range** | 3–6 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Minimal Professional |
| **7. Visual style** | Minimal Professional — Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. Display Arial, body Arial. Hairline tables, plain cards, rule section openers, density 0.92×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Ruled masthead with organisation name and logo, then eyebrow, title and subtitle in a left-aligned stack. No fills. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Masthead, engagement reference, date. | — |
| 2 | Your details | `definition_grid` | Client and entity details, input styled. | — |
| 3 | Engagement scope | `info_card` | What is and is not included. | — |
| 4 | Fees | `data_table` | Fee basis, amounts, timing, refunds. | `{{fees[]}}` |
| 5 | Authorities | `checklist` | What the client authorises the organisation to do. | — |
| 6 | Communication preferences | `definition_grid` | Channel, frequency, contacts. | — |
| 7 | Consents | `checklist` | Privacy, credit reporting, marketing — each separate. | — |
| 8 | What happens next | `process_flow` | The first three steps of the engagement. | — |
| 9 | Signatures | `signature_block` | Client and organisation signatures. | — |
| 10 | Privacy & terms | `disclaimer_page` | Privacy notice and terms of engagement. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Welcome | `prose` | Short introduction to the engagement. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `definition_grid`, `info_card`, `data_table`, `checklist`, `process_flow`, `signature_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. One fee table.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `engagement.* — reference, scope[], exclusions[], startDate`
- `fees[], authorities[], consents[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Each consent is a separate checkbox with its own label — bundled consent is neither accessible nor lawful.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A new engagement is starting.
- Scope, fees and authorities need to be agreed in writing.
- Consents must be captured separately and evidenced.

**24. Use a different template when**

- You need the client's financial position → `client-fact-find-form`
- You are pitching, not onboarding → `client-proposal`

**Library metadata** — tier `launch` · priority `P1` · data `low` · images `none` · formality `professional` · audience `client-facing` · generator implemented

---

### Investor Goals Questionnaire

`investor-goals-questionnaire`

Structured discovery of a client's objectives, time horizon, target returns and constraints, in a form that produces comparable answers across clients.

|  |  |
| --- | --- |
| **1. Template name** | Investor Goals Questionnaire |
| **2. Category** | Client Forms & Onboarding |
| **3. Intended audience** | Investor clients |
| **4. Primary use case** | Capture investment objectives in a structured, comparable way. |
| **5. Recommended page range** | 3–6 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Modern Technology |
| **7. Visual style** | Modern Technology — SaaS-inspired. Card-led, data-forward, contemporary and digital-first. Display Calibri, body Calibri. Hairline tables, filled cards, tab section openers, density 1.05×. Card-led. Each theme is its own card so the form reads as a conversation rather than a schedule. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-width navy panel with no top rule; logo slot, eyebrow, title, subtitle and chip row, set in a single card block. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Panel cover with client and date. | — |
| 2 | How this is used | `highlight_box` | Why the answers matter. | — |
| 3 | Your objectives | `definition_grid` | Primary and secondary objectives. | — |
| 4 | Time horizon & targets | `definition_grid` | Horizon, target return, income need. | — |
| 5 | Capacity & constraints | `definition_grid` | Deposit, borrowing, cash-flow limits. | — |
| 6 | Risk appetite | `status_table` | Scaled responses with a plain-language anchor. | `{{risk.responses[]}}` |
| 7 | Property preferences | `definition_grid` | Type, location, condition, involvement. | — |
| 8 | Signatures | `signature_block` | Client confirmation of the record. | — |
| 9 | Privacy | `disclaimer_page` | Privacy notice. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Exclusions | `definition_grid` | What the client will not consider. | The underlying data is present |
| Summary | `executive_summary` | Adviser summary of what was heard. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `highlight_box`, `definition_grid`, `status_table`, `executive_summary`, `signature_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. One scaled-response table.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `goals{}, horizon{}, constraints{}, risk.responses[], preferences{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You need structured, comparable objectives from a client.
- The answers will drive a strategy or a property brief.
- Discovery happens before any recommendation.

**24. Use a different template when**

- You need regulated risk profiling → `risk-profile-questionnaire`
- You need the financial position → `client-fact-find-form`
- You need property specifics → `property-brief-form`

**Library metadata** — tier `launch` · priority `P2` · data `low` · images `none` · formality `professional` · audience `client-facing` · generator implemented

---

### Property Brief Form

`property-brief-form`

The search mandate: what the client is looking for, where, at what price, with what must-haves and deal-breakers.

|  |  |
| --- | --- |
| **1. Template name** | Property Brief Form |
| **2. Category** | Client Forms & Onboarding |
| **3. Intended audience** | Buyer's agency clients |
| **4. Primary use case** | Agree and record the search mandate before a search begins. |
| **5. Recommended page range** | 2–4 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Minimal Professional |
| **7. Visual style** | Minimal Professional — Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. Display Arial, body Arial. Hairline tables, plain cards, rule section openers, density 0.92×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Ruled masthead with organisation name and logo, then eyebrow, title and subtitle in a left-aligned stack. No fills. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Masthead, client, brief reference, date. | — |
| 2 | Purchase parameters | `definition_grid` | Purpose, budget range, timing, finance status. | — |
| 3 | Location | `definition_grid` | Target areas, acceptable areas, excluded areas. | — |
| 4 | Property requirements | `definition_grid` | Type, beds, baths, car, land, condition. | — |
| 5 | Must have / must not have | `comparison_table` | Two columns the client completes directly. | — |
| 6 | Agreed brief | `highlight_box` | The mandate in one paragraph. | — |
| 7 | Signatures | `signature_block` | Client and agent agreement to the brief. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Scoring weights | `data_table` | How competing options will be weighted. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `definition_grid`, `comparison_table`, `data_table`, `highlight_box`, `signature_block`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. One two-column comparison and one optional weighting table.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `brief.* — purpose, budget{}, timing, locations{}, requirements{}, mustHave[], mustNotHave[], weights[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A search is about to begin and the mandate must be agreed.
- The brief will be used to score shortlisted properties.
- Both parties need a record of what was agreed.

**24. Use a different template when**

- You need the client's objectives and risk appetite → `investor-goals-questionnaire`
- You are presenting search results → `property-comparison-report`

**Library metadata** — tier `launch` · priority `P2` · data `low` · images `none` · formality `operational` · audience `client-facing` · generator implemented

---

### Risk Profile Questionnaire

`risk-profile-questionnaire`

Scored risk-tolerance assessment with a recorded outcome, the client's acknowledgement, and any override with its reason.

|  |  |
| --- | --- |
| **1. Template name** | Risk Profile Questionnaire |
| **2. Category** | Client Forms & Onboarding |
| **3. Intended audience** | Clients, compliance reviewers |
| **4. Primary use case** | Establish and evidence a client's risk profile to a reviewable standard. |
| **5. Recommended page range** | 3–6 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Client, assessment date, assessor. | — |
| 2 | How this works | `highlight_box` | Scoring method and what the outcome means. | — |
| 3 | Questions | `status_table` ↻ | Numbered questions with scaled responses and per-question score. | `{{questions[]}}` |
| 4 | Score & profile | `metric_panel` | Total score, band, profile name. | — |
| 5 | Profile description | `info_card` | What the profile means in plain language. | `{{profile}}` |
| 6 | Client acknowledgement | `highlight_box` | The client confirms the outcome reflects their position. | — |
| 7 | Signatures | `signature_block` | Client and adviser. | — |
| 8 | Privacy | `disclaimer_page` | Privacy notice. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Override | `info_card` | Any adviser override with a documented reason. | The underlying data is present |
| Approvals | `approval_block` | Reviewer sign-off. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `highlight_box`, `status_table`, `metric_panel`, `info_card`, `signature_block`, `approval_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. One numbered question table that must handle 25+ rows with repeating headers.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `questions[] — ref, question, response, score`
- `profile{}, override{}, total`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Scaled responses are presented as labelled options, not as a graphic scale, so they are readable by assistive technology.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A risk profile must be established and evidenced.
- A compliance reviewer will check the scoring.
- An override must be documented with its reason.

**24. Use a different template when**

- You want informal discovery → `investor-goals-questionnaire`
- You are assessing transaction risk, not client risk → `risk-assessment`

**Library metadata** — tier `growth` · priority `P2` · data `medium` · images `none` · formality `formal` · audience `client-facing` · generator implemented

---

### Document Collection Checklist

`document-collection-checklist`

What the client must provide, who owns each item, when it is due, and its current status.

|  |  |
| --- | --- |
| **1. Template name** | Document Collection Checklist |
| **2. Category** | Client Forms & Onboarding |
| **3. Intended audience** | Clients and internal support staff |
| **4. Primary use case** | Chase and track the documents an application or engagement depends on. |
| **5. Recommended page range** | 1–3 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Minimal Professional |
| **7. Visual style** | Minimal Professional — Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. Display Arial, body Arial. Hairline tables, plain cards, rule section openers, density 0.92×. One table, no ornament. Regenerated frequently as items are received, so it must be fast to produce and instantly readable. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Ruled masthead with organisation name and logo, then eyebrow, title and subtitle in a left-aligned stack. No fills. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Masthead, client, matter, as-at date. | — |
| 2 | Summary | `metric_panel` | Required, received, outstanding, overdue. | — |
| 3 | Outstanding items | `status_table` ↻ | Item, why it is needed, owner, due date, status. | `{{documents[]}}` |
| 4 | How to send documents | `highlight_box` | Secure upload instructions — never 'email them to us'. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Received items | `status_table` | Completed items with received dates. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `status_table`, `highlight_box`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Two status tables, both of which must handle 40+ rows.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `documents[] — item, reason, owner, due, status, receivedAt`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer. Regenerated on demand; target under two seconds.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You are chasing documents from a client.
- Ownership and due dates need to be explicit.
- The list changes often and is reissued.

**24. Use a different template when**

- The items are compliance controls → `aml-kyc-assessment`
- The list is a due-diligence investigation → `property-due-diligence-report`

**Library metadata** — tier `launch` · priority `P2` · data `low` · images `none` · formality `operational` · audience `client-facing` · generator implemented

---

### Client Authority Form

`client-authority-form`

Written authority for the organisation to act, request information, or deal with a named third party on the client's behalf.

|  |  |
| --- | --- |
| **1. Template name** | Client Authority Form |
| **2. Category** | Client Forms & Onboarding |
| **3. Intended audience** | Clients, third parties receiving the authority |
| **4. Primary use case** | Obtain and evidence a specific, scoped authority to act. |
| **5. Recommended page range** | 2–3 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Minimal Professional |
| **7. Visual style** | Minimal Professional — Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. Display Arial, body Arial. Hairline tables, plain cards, rule section openers, density 0.92×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Ruled masthead with organisation name and logo, then eyebrow, title and subtitle in a left-aligned stack. No fills. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Masthead, client, authority reference, date. | — |
| 2 | Parties | `definition_grid` | Client, organisation, named third party. | — |
| 3 | Scope of authority | `checklist` | Each authorised act as a separate, tickable item. | — |
| 4 | Limitations | `highlight_box` | What this authority does not permit. | — |
| 5 | Duration | `definition_grid` | Start, end, revocation method. | — |
| 6 | Signatures | `signature_block` | Client signature, witness if required. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Privacy | `disclaimer_page` | Privacy notice. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `definition_grid`, `checklist`, `highlight_box`, `signature_block`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. One checklist and two grids. Must fit on one page in the common case.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `authority.* — reference, thirdParty, acts[], limitations[], start, end`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Each authorised act is separately tickable — a single blanket checkbox is not a scoped authority.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You need written authority to act or to obtain information.
- The authority must be scoped and time-limited.
- A third party will rely on the document.

**24. Use a different template when**

- You are onboarding the client → `client-onboarding-form`
- You need consent to collect personal information → `client-fact-find-form`

**Library metadata** — tier `launch` · priority `P3` · data `low` · images `none` · formality `formal` · audience `client-facing` · generator implemented

---

## Compliance & Governance

### AML & KYC Assessment

`aml-kyc-assessment`

Customer due-diligence record: identity, beneficial ownership, PEP and sanctions screening, source of funds, risk rating and the decision.

|  |  |
| --- | --- |
| **1. Template name** | AML & KYC Assessment |
| **2. Category** | Compliance & Governance |
| **3. Intended audience** | Compliance officers, auditors, regulators |
| **4. Primary use case** | Evidence that customer due diligence was performed and a risk-based decision was made and approved. |
| **5. Recommended page range** | 5–12 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. Every control has a reference, an evidence column, a reviewer and a status chip. The document is designed to be read by someone checking it, not by someone being sold to. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Customer, assessment date, assessor, case reference. | — |
| 2 | Assessment outcome | `recommendation_box` | Accept, accept with controls, or decline — with the risk rating. | — |
| 3 | Customer | `info_card` | Legal name, type, ABN/ACN, address, contact. | — |
| 4 | Identity verification | `status_table` ↻ | Each document verified: type, number, issuer, expiry, method, status. | `{{identity.documents[]}}` |
| 5 | Beneficial ownership | `status_table` ↻ | Each beneficial owner with percentage and verification status. | `{{beneficialOwners[]}}` |
| 6 | Screening | `status_table` | PEP, sanctions, adverse media — provider, date, result. | `{{screening[]}}` |
| 7 | Source of funds and wealth | `data_table` | Declared source, evidence obtained, assessment. | `{{sourceOfFunds}}` |
| 8 | Risk rating | `metric_panel` | Customer, product, channel, geography, overall. | — |
| 9 | Risk factors | `status_table` | Each factor with weighting and rationale. | `{{riskFactors[]}}` |
| 10 | Ongoing monitoring | `info_card` | Review frequency, triggers, next review date. | — |
| 11 | Approvals | `approval_block` | Assessor, compliance officer, dates. | — |
| 12 | Evidence index | `appendix_opener` | Appendix A — every document held, with dates and storage reference. | — |
| 13 | Important information | `disclaimer_page` | Retention period, confidentiality, tipping-off warning. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Enhanced due diligence | `status_table` | Additional measures where the rating requires them. | The underlying data is present |
| Outstanding items | `checklist` | What must be completed before onboarding. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `recommendation_box`, `info_card`, `status_table`, `data_table`, `metric_panel`, `checklist`, `approval_block`, `appendix_opener`, `disclaimer_page`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Five to seven status tables. The evidence index must handle 50+ rows across page breaks without losing its header.

**16. White-label configuration points**

All 29 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

Template-specific additions:

| Area | Binding | Appears in |
| --- | --- | --- |
| Reporting entity name | {{org.reportingEntity}} | Cover, approvals, evidence index |
| AML programme reference | {{compliance.programmeRef}} | Cover, footer |

**17. Dynamic content fields**

- `customer.* — legalName, type, abn, addresses[], contacts[]`
- `identity.documents[], beneficialOwners[], screening[], riskFactors[], edd[]`
- `sourceOfFunds{}, riskRating{}, monitoring{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Every status is a glyph plus a word plus a fill. A compliance document that fails in grayscale fails its purpose, because it will be printed and filed.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Printed and retained for the statutory retention period. No colour is load-bearing; the document is fully legible as a monochrome photocopy.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. Never surfaced in a client-facing portal. Access is restricted to users with the compliance permission.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- Onboarding a customer under AML/CTF obligations.
- A risk-based decision must be evidenced and approved.
- An auditor or regulator may later review the file.

**24. Use a different template when**

- You only need to confirm identity was verified → `client-verification-summary`
- You are reviewing the compliance programme itself → `compliance-review-report`
- You are assessing transaction risk → `risk-assessment`

**Library metadata** — tier `launch` · priority `P1` · data `medium` · images `none` · formality `formal` · audience `regulator` · generator implemented

---

### Client Verification Summary

`client-verification-summary`

A one-to-three page confirmation that identity verification was completed, by what method, on what date, with what result.

|  |  |
| --- | --- |
| **1. Template name** | Client Verification Summary |
| **2. Category** | Compliance & Governance |
| **3. Intended audience** | Internal staff, third parties requiring evidence of verification |
| **4. Primary use case** | Provide a short, shareable record that verification occurred. |
| **5. Recommended page range** | 1–3 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Customer, verification date, verifier, reference. | — |
| 2 | Verification outcome | `metric_panel` | Status, method, date, expiry of the verification. | — |
| 3 | Customer | `info_card` | Verified name, date of birth, address. | — |
| 4 | Documents verified | `status_table` | Type, number, issuer, expiry, verification method, status. | `{{identity.documents[]}}` |
| 5 | Verifier declaration | `highlight_box` | What the verifier is attesting. | — |
| 6 | Approvals | `approval_block` | Verifier and reviewer. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Screening result | `status_table` | PEP, sanctions, adverse media. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `info_card`, `status_table`, `highlight_box`, `approval_block`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. Two status tables. Fits one page for a simple individual customer.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `identity.documents[], screening[], verification{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. Internal by default; may be shared externally only where the organisation's policy permits.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- Someone needs proof that verification was completed.
- The full due-diligence file is too much to share.
- The record will be attached to another file.

**24. Use a different template when**

- You need the full due-diligence record → `aml-kyc-assessment`
- You are reviewing a file for completeness → `file-review-summary`

**Library metadata** — tier `launch` · priority `P1` · data `low` · images `none` · formality `formal` · audience `internal` · generator implemented

---

### Compliance Review Report

`compliance-review-report`

Periodic review of the organisation's compliance with its own obligations: scope, testing, findings, ratings and a remediation plan.

|  |  |
| --- | --- |
| **1. Template name** | Compliance Review Report |
| **2. Category** | Compliance & Governance |
| **3. Intended audience** | Boards, licensees, compliance committees, external reviewers |
| **4. Primary use case** | Report the outcome of a compliance review and the actions arising. |
| **5. Recommended page range** | 9–22 pages (11–25 pages — multi-section analysis with appendices) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Review period, scope, reviewer, date. | — |
| 2 | Contents | `table_of_contents` | Required. | — |
| 3 | Executive summary | `executive_summary` | Overall rating and headline findings. | — |
| 4 | Review scope & method | `info_card` | What was tested, how, and sample sizes. | — |
| 5 | Ratings summary | `metric_panel` | Findings by severity: high, medium, low, closed. | — |
| 6 | Findings register | `status_table` ↻ | Reference, obligation, finding, severity, owner, due date. | `{{findings[]}}` |
| 7 | Finding detail | `info_card` ↻ | One block per high-severity finding with evidence and root cause. | `{{findings.high[]}}` |
| 8 | Remediation plan | `checklist` | Actions with owners and target dates. | `{{remediation[]}}` |
| 9 | Approvals | `approval_block` | Reviewer, compliance officer, committee. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Previous findings | `status_table` | Status of findings from the prior review. | The underlying data is present |
| Appendix — testing evidence | `appendix_opener` | Sample lists and results. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `executive_summary`, `info_card`, `metric_panel`, `status_table`, `checklist`, `approval_block`, `appendix_opener`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

Optional native bar chart of findings by severity. Findings register must handle 100+ rows.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `findings[] — ref, obligation, finding, severity, owner, due, status`
- `remediation[], priorFindings[], review{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. Internal only. Never exposed to a client portal.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A scheduled compliance review has been completed.
- Findings must be rated, owned and tracked to closure.
- A committee or licensee will receive the report.

**24. Use a different template when**

- The subject is one customer file → `file-review-summary`
- The subject is one incident → `risk-assessment`
- The review is a formal audit → `audit-report`

**Library metadata** — tier `scale` · priority `P2` · data `medium` · images `none` · formality `formal` · audience `internal` · generator implemented

---

### Risk Assessment

`risk-assessment`

Structured assessment of a specific risk, transaction or arrangement: inherent risk, controls, residual risk and the decision.

|  |  |
| --- | --- |
| **1. Template name** | Risk Assessment |
| **2. Category** | Compliance & Governance |
| **3. Intended audience** | Compliance, management, risk committees |
| **4. Primary use case** | Assess and document a specific risk before a decision is taken. |
| **5. Recommended page range** | 3–8 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Subject, assessor, date, reference. | — |
| 2 | Decision | `recommendation_box` | Accept, accept with controls, or decline. | — |
| 3 | Context | `info_card` | What is being assessed and why. | — |
| 4 | Risk register | `status_table` ↻ | Reference, risk, likelihood, impact, inherent rating. | `{{risks[]}}` |
| 5 | Controls | `status_table` ↻ | Control, type, owner, effectiveness, residual rating. | `{{controls[]}}` |
| 6 | Residual position | `metric_panel` | Highest residual, count by rating. | — |
| 7 | Monitoring | `info_card` | Review frequency and escalation triggers. | — |
| 8 | Approvals | `approval_block` | Assessor and approver. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Treatment plan | `checklist` | Additional controls with owners and dates. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `recommendation_box`, `info_card`, `status_table`, `metric_panel`, `checklist`, `approval_block`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts — a risk matrix rendered as an image fails in grayscale and is unreadable to assistive technology. Likelihood and impact are stated as words in table columns.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `risks[] — ref, description, likelihood, impact, inherent`
- `controls[] — ref, control, owner, effectiveness, residual`
- `treatments[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers. Ratings are words with glyphs, never a coloured heat-map cell alone.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A specific risk or arrangement needs formal assessment.
- Controls and residual risk must be documented.
- A decision-maker needs the assessment on file.

**24. Use a different template when**

- The subject is a client's risk tolerance → `risk-profile-questionnaire`
- The subject is a periodic programme review → `compliance-review-report`

**Library metadata** — tier `growth` · priority `P2` · data `medium` · images `none` · formality `formal` · audience `internal` · generator implemented

---

### Audit Report

`audit-report`

Formal audit output: objective, scope, criteria, methodology, findings with evidence, opinion and management response.

|  |  |
| --- | --- |
| **1. Template name** | Audit Report |
| **2. Category** | Compliance & Governance |
| **3. Intended audience** | Boards, audit committees, external auditors |
| **4. Primary use case** | Report the result of a formal audit to the standard an audit committee expects. |
| **5. Recommended page range** | 9–25 pages (11–25 pages — multi-section analysis with appendices) |
| **6. Design family** | Compliance Structured |
| **7. Visual style** | Compliance Structured — Auditable by construction. Numbered controls, status columns, evidence trails. Display Calibri, body Calibri, numerals Consolas. Boxed tables, outlined cards, numbered section openers, density 0.9×. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header on a soft-neutral band with an accent underline; organisation left, document title right. Suppressed on page 1. Footer on a soft-neutral band with an accent top rule; same content. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Audit title, period, auditor, report date. | — |
| 2 | Contents | `table_of_contents` | Required. | — |
| 3 | Opinion | `recommendation_box` | The audit opinion, stated first. | — |
| 4 | Objective & scope | `info_card` | What was audited and against what criteria. | — |
| 5 | Methodology | `prose` | How the audit was conducted, including sampling. | — |
| 6 | Summary of findings | `metric_panel` | Findings by severity. | — |
| 7 | Detailed findings | `info_card` ↻ | One block per finding: criteria, condition, cause, effect, recommendation. | `{{findings[]}}` |
| 8 | Management response | `status_table` ↻ | Per finding: agreed, owner, target date, status. | `{{responses[]}}` |
| 9 | Approvals | `approval_block` | Auditor, reviewer, committee acceptance. | — |
| 10 | Appendix — evidence | `appendix_opener` | Sample lists, testing detail. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Follow-up of prior findings | `status_table` | Prior findings and closure status. | The underlying data is present |
| Appendix — criteria | `appendix_opener` | Standards and obligations applied. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `recommendation_box`, `info_card`, `metric_panel`, `status_table`, `approval_block`, `appendix_opener`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

Optional findings-by-severity bar chart. Findings and response tables must remain aligned by reference across page breaks.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `audit.* — objective, scope[], criteria[], methodology[], opinion`
- `findings[] — ref, criteria, condition, cause, effect, recommendation, severity`
- `responses[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Bound and retained. Section openers emit bookmarks so a 30-page PDF is navigable.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A formal audit has been completed.
- An audit committee or external party will receive it.
- Management responses must be recorded against each finding.

**24. Use a different template when**

- The review is internal monitoring → `compliance-review-report`
- The subject is one customer file → `file-review-summary`

**Library metadata** — tier `scale` · priority `P3` · data `medium` · images `none` · formality `formal` · audience `regulator` · generator implemented

---

### File Review Summary

`file-review-summary`

Quality-assurance review of a single client file against a standard checklist, with a pass/remediate outcome.

|  |  |
| --- | --- |
| **1. Template name** | File Review Summary |
| **2. Category** | Compliance & Governance |
| **3. Intended audience** | Compliance staff, team leaders |
| **4. Primary use case** | Record a file quality review and any remediation required. |
| **5. Recommended page range** | 2–4 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Minimal Professional |
| **7. Visual style** | Minimal Professional — Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity. Display Arial, body Arial. Hairline tables, plain cards, rule section openers, density 0.92×. Plain and fast — reviewers complete many of these per week, so the template carries no ornament and generates in seconds. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Ruled masthead with organisation name and logo, then eyebrow, title and subtitle in a left-aligned stack. No fills. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | File reference, adviser, reviewer, review date. | — |
| 2 | Outcome | `metric_panel` | Result, items checked, items failed, due date. | — |
| 3 | Review checklist | `status_table` ↻ | Each item with result and reviewer comment. | `{{checklist[]}}` |
| 4 | Approvals | `approval_block` | Reviewer and adviser acknowledgement. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Remediation | `checklist` | Items to fix, owner and due date. | The underlying data is present |
| Reviewer comments | `prose` | Free-text observations. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `status_table`, `checklist`, `approval_block`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

No charts. One status table of 20–60 rows.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `checklist[] — ref, item, result, comment`
- `remediation[], review{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. Internal only; excluded from client-facing preview.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You are reviewing a single file for quality or compliance.
- The outcome is pass, or pass with remediation.
- Reviews are performed in volume.

**24. Use a different template when**

- You are reviewing the programme, not a file → `compliance-review-report`
- The review is a formal audit → `audit-report`

**Library metadata** — tier `growth` · priority `P2` · data `low` · images `none` · formality `operational` · audience `internal` · generator implemented

---

## Business & Advisory

### Executive Business Report

`executive-business-report`

A formal business report for a leadership audience: position, performance, analysis, options and a recommendation.

|  |  |
| --- | --- |
| **1. Template name** | Executive Business Report |
| **2. Category** | Business & Advisory |
| **3. Intended audience** | Directors, executives, business owners |
| **4. Primary use case** | Present a business position and a recommended course of action to leadership. |
| **5. Recommended page range** | 8–16 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Executive Corporate |
| **7. Visual style** | Executive Corporate — Boardroom-ready. Formal, decisive, built around the executive summary. Display Cambria, body Calibri. Banded tables, filled cards, bar section openers, density 1×. Boardroom register. The executive summary is a full page and is written to be the only page some readers will read. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Report title, period, author, distribution. | — |
| 2 | Contents | `table_of_contents` | Required. | — |
| 3 | Executive summary | `executive_summary` | Position, findings, recommendation, on one page. | — |
| 4 | Performance at a glance | `metric_panel` | Four headline measures with movement. | — |
| 5 | Results against plan | `data_table` | Actual against target and prior period. | `{{performance[]}}` |
| 6 | Trend | `chart_frame` | The measure that matters most, over time. | `{{performance.series}}` |
| 7 | Key findings | `highlight_box` ↻ | Three to five findings with evidence. | `{{findings[]}}` |
| 8 | Options considered | `comparison_table` | Each option with cost, benefit, risk. | `{{options[]}}` |
| 9 | Recommendation | `recommendation_box` | The recommended option and why. | — |
| 10 | Risks | `risk_box` | What could go wrong and the mitigation. | — |
| 11 | Decisions required | `checklist` | What leadership must approve. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Background & context | `prose` | Why this report exists. | The underlying data is present |
| Implementation | `timeline` | Milestones, owners, dates. | The underlying data is present |
| Appendix | `appendix_opener` | Supporting analysis. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `table_of_contents`, `executive_summary`, `metric_panel`, `data_table`, `chart_frame`, `highlight_box`, `comparison_table`, `recommendation_box`, `risk_box`, `timeline`, `checklist`, `appendix_opener`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

One to three charts. Options comparison holds three to four options; beyond four, options belong in an appendix.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `performance[] — measure, actual, target, prior, variance`
- `findings[], options[], implementation[], decisions[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. Frequently read on a tablet in a meeting — the preview must be readable at 100% on a 10-inch screen without zoom.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- Leadership must make a decision from a written report.
- Options need to be compared and one recommended.
- The document will be tabled and minuted.

**24. Use a different template when**

- The audience is a board with a fixed agenda → `board-report`
- You are proposing work to a client → `client-proposal`
- The report is a periodic status update → `quarterly-business-review`

**Library metadata** — tier `scale` · priority `P1` · data `high` · images `low` · formality `formal` · audience `internal` · generator implemented

---

### Client Proposal

`client-proposal`

A commercial proposal: the client's situation, the proposed approach, the team, the fees, and why this organisation.

|  |  |
| --- | --- |
| **1. Template name** | Client Proposal |
| **2. Category** | Business & Advisory |
| **3. Intended audience** | Prospective clients |
| **4. Primary use case** | Win an engagement. |
| **5. Recommended page range** | 6–14 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Luxury Presentation |
| **7. Visual style** | Luxury Presentation — Editorial and unhurried. Oversized display type, deep whitespace, prestige framing. Display Georgia, body Calibri, numerals Georgia. Ruled tables, outlined cards, numbered section openers, density 1.32×. Editorial and confident. Generous whitespace, oversized display type, no dense tables before the fee section. |
| **8. Colour configuration** | Primary midnight, accent cyan, support blue. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Tall centred cover image, centred logo slot, wide-tracked eyebrow, oversized centred display title, accent rule, centred subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Client name, proposal title, date, hero image. | — |
| 2 | Your situation | `executive_summary` | Demonstrate understanding before proposing anything. | — |
| 3 | What we propose | `recommendation_box` | The approach in one clear statement. | — |
| 4 | Scope of work | `process_flow` | Phases with deliverables. | `{{scope.phases[]}}` |
| 5 | Deliverables | `checklist` | Exactly what the client receives. | `{{deliverables[]}}` |
| 6 | Your team | `adviser_profile` ↻ | Named people, repeated per team member. | `{{team[]}}` |
| 7 | Timeline | `timeline` | Indicative dates from engagement to completion. | — |
| 8 | Investment | `data_table` | Fees, inclusions, payment terms. | `{{fees[]}}` |
| 9 | Next steps | `process_flow` | How to accept. | — |
| 10 | Terms | `disclaimer_page` | Terms, validity period, privacy. | — |
| 11 | Back cover | `back_cover` | Contact block. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Why us | `highlight_box` | Evidence, not adjectives. | The underlying data is present |
| Case study | `info_card` | One relevant example with an outcome. | The underlying data is present |
| Acceptance | `signature_block` | Client acceptance block. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `executive_summary`, `recommendation_box`, `process_flow`, `checklist`, `adviser_profile`, `timeline`, `data_table`, `highlight_box`, `info_card`, `signature_block`, `disclaimer_page`, `back_cover`

**14. Image requirements**

One hero cover image at 3:2, minimum 2400×1600. Optional team photographs at 1:1, minimum 600×600.

**15. Chart & table requirements**

One fee table. No charts before the fee section — a proposal that opens with data reads as a report, not a pitch.

**16. White-label configuration points**

All 28 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

Template-specific additions:

| Area | Binding | Appears in |
| --- | --- | --- |
| Proposal validity period | {{proposal.validity}} | Cover meta, terms page |

**17. Dynamic content fields**

- `proposal.* — client, situation[], approach, validity`
- `scope.phases[], deliverables[], team[], fees[], caseStudy{}`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You are pitching for an engagement.
- Presentation quality affects the outcome.
- The proposal will be read by a decision-maker, not an analyst.

**24. Use a different template when**

- The engagement is already won → `client-onboarding-form`
- The proposal is to another business, not a client → `partnership-proposal`
- The audience wants analysis, not persuasion → `executive-business-report`

**Library metadata** — tier `growth` · priority `P1` · data `low` · images `medium` · formality `presentation` · audience `client-facing` · generator implemented

---

### Board Report

`board-report`

A paper prepared for a board meeting: purpose, background, discussion, recommendation and the resolution sought.

|  |  |
| --- | --- |
| **1. Template name** | Board Report |
| **2. Category** | Business & Advisory |
| **3. Intended audience** | Directors and company secretaries |
| **4. Primary use case** | Table a matter for board consideration and record the resolution sought. |
| **5. Recommended page range** | 3–8 pages (1–3 pages — a single decision, summary or form) |
| **6. Design family** | Executive Corporate |
| **7. Visual style** | Executive Corporate — Boardroom-ready. Formal, decisive, built around the executive summary. Display Cambria, body Calibri. Banded tables, filled cards, bar section openers, density 1×. Strictly conventional. A board paper that looks designed looks presumptuous; the design work here is invisible and lives in the typography and the discipline of the structure. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, organisation name, title, accent rule, subtitle, status chips. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header: organisation name left, document title right, accent rule beneath. Suppressed on page 1. Footer with a hairline top rule: confidentiality and document reference left; attribution, version and 'Page N of M' right. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Header | `cover` | Agenda item, meeting date, author, classification. | — |
| 2 | Purpose | `highlight_box` | Why this paper is before the board. | — |
| 3 | Recommendation | `recommendation_box` | The resolution sought, in board language. | — |
| 4 | Background | `prose` | What the board needs to know. | — |
| 5 | Discussion | `prose` | The analysis. | — |
| 6 | Risk & compliance | `risk_box` | Risk implications and how they are managed. | — |
| 7 | Resolution | `highlight_box` | The exact wording proposed. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Financial impact | `data_table` | Cost, benefit, budget position. | The underlying data is present |
| Options | `comparison_table` | Alternatives considered. | The underlying data is present |
| Attachments | `appendix_opener` | Attachment index. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `highlight_box`, `recommendation_box`, `data_table`, `risk_box`, `comparison_table`, `appendix_opener`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

Charts are discouraged. One financial impact table where relevant.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L3** (Partner Branded).

**17. Dynamic content fields**

- `paper.* — agendaItem, meetingDate, classification, purpose, resolution`
- `financialImpact[], options[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position. Printed into a board pack; the header block must survive being photocopied and must not rely on colour.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source. Internal, restricted. Classification is shown on every page.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A matter is being tabled for board decision.
- A resolution needs to be proposed in specific words.
- The paper will be included in a board pack.

**24. Use a different template when**

- The audience is management, not the board → `executive-business-report`
- The paper is a periodic performance update → `quarterly-business-review`

**Library metadata** — tier `scale` · priority `P2` · data `medium` · images `none` · formality `formal` · audience `internal` · generator implemented

---

### Quarterly Business Review

`quarterly-business-review`

Periodic performance review: results against targets, pipeline, client outcomes, issues and the plan for the coming period.

|  |  |
| --- | --- |
| **1. Template name** | Quarterly Business Review |
| **2. Category** | Business & Advisory |
| **3. Intended audience** | Leadership, partners, key clients |
| **4. Primary use case** | Review a period's performance and agree priorities for the next one. |
| **5. Recommended page range** | 6–14 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Modern Technology |
| **7. Visual style** | Modern Technology — SaaS-inspired. Card-led, data-forward, contemporary and digital-first. Display Calibri, body Calibri. Hairline tables, filled cards, tab section openers, density 1.05×. Dashboard-like. Metric cards and charts carry the story; prose is short and sits beneath the data it explains. |
| **8. Colour configuration** | Primary navy, accent blue, support cyan. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Full-width navy panel with no top rule; logo slot, eyebrow, title, subtitle and chip row, set in a single card block. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Period, business unit, presenter. | — |
| 2 | Period at a glance | `metric_panel` | Four headline measures with movement. | — |
| 3 | Summary | `executive_summary` | What happened and what it means. | — |
| 4 | Results against target | `data_table` | Measure, target, actual, variance. | `{{results[]}}` |
| 5 | Trend | `chart_frame` | Performance over the last four periods. | `{{results.series}}` |
| 6 | Issues & blockers | `risk_box` | What is impeding performance. | — |
| 7 | Priorities next period | `checklist` | Three to five priorities with owners. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

| Section | Component | Purpose | Include when |
| --- | --- | --- | --- |
| Pipeline | `bar_chart` | Pipeline by stage or value. | The underlying data is present |
| Client outcomes | `info_card` | Notable outcomes with evidence. | The underlying data is present |
| Appendix — detail | `appendix_opener` | Full measure detail. | The underlying data is present |

Optional sections are removable without damaging document flow: each is a complete block preceded by its own spacing, so removing it leaves no orphaned heading and no double gap.

**13. Data & content components**

`cover`, `metric_panel`, `executive_summary`, `data_table`, `chart_frame`, `bar_chart`, `info_card`, `risk_box`, `checklist`, `appendix_opener`

**14. Image requirements**

None. The template carries no image slots.

**15. Chart & table requirements**

Two to four charts. The trend chart uses the same axis convention every period so editions are comparable.

**16. White-label configuration points**

All 27 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

**17. Dynamic content fields**

- `results[] — measure, target, actual, variance, movement`
- `pipeline[], priorities[], issues[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- A period has closed and performance needs reviewing.
- The same measures are reported every period.
- Priorities for the next period must be agreed.

**24. Use a different template when**

- A single decision is needed → `executive-business-report`
- The audience is a board → `board-report`

**Library metadata** — tier `scale` · priority `P2` · data `high` · images `low` · formality `professional` · audience `internal` · generator implemented

---

### Partnership Proposal

`partnership-proposal`

A proposal to another business: the opportunity, the proposed structure, the commercial terms, and the activation plan.

|  |  |
| --- | --- |
| **1. Template name** | Partnership Proposal |
| **2. Category** | Business & Advisory |
| **3. Intended audience** | Prospective referral, finance and channel partners |
| **4. Primary use case** | Propose and win a commercial partnership. |
| **5. Recommended page range** | 6–12 pages (4–10 pages — a complete report with analysis and a recommendation) |
| **6. Design family** | Luxury Presentation |
| **7. Visual style** | Luxury Presentation — Editorial and unhurried. Oversized display type, deep whitespace, prestige framing. Display Georgia, body Calibri, numerals Georgia. Ruled tables, outlined cards, numbered section openers, density 1.32×. |
| **8. Colour configuration** | Primary midnight, accent cyan, support blue. Semantic colours (success / warning / alert / info) are fixed and excluded from white-label override. |
| **9. Cover-page structure** | Tall centred cover image, centred logo slot, wide-tracked eyebrow, oversized centred display title, accent rule, centred subtitle. Every cover closes with the issue-control grid: prepared for, client reference, prepared by, date of issue, document reference, version. |
| **10. Header & footer** | Running header with a hairline rule only. Suppressed on page 1. Footer with no rule; same content, reduced contrast. The footer is written to both the first-page and default footers, so the cover still carries document control. |

**11. Recommended sections**

| # | Section | Component | Purpose | Binding |
| --- | --- | --- | --- | --- |
| 1 | Cover | `cover` | Both organisations named, hero image, date. | — |
| 2 | The opportunity | `executive_summary` | Why this partnership, and why now. | — |
| 3 | Proposed structure | `recommendation_box` | How the partnership would work. | — |
| 4 | What each party brings | `comparison_table` | Two columns: contribution and benefit per party. | — |
| 5 | Client journey | `process_flow` | How a shared client moves between the parties. | `{{journey[]}}` |
| 6 | Commercial terms | `data_table` | Fee or commission structure, triggers, timing. | `{{terms[]}}` |
| 7 | Governance & boundaries | `highlight_box` | Licensing, disclosure and service boundaries. | — |
| 8 | Activation plan | `timeline` | From agreement to first referral. | `{{activation[]}}` |
| 9 | Next steps | `checklist` | What each party does next. | — |
| 10 | Terms | `disclaimer_page` | Confidentiality, validity, non-binding status. | — |
| 11 | Back cover | `back_cover` | Contact block for both parties. | — |

↻ marks a repeating section — it grows with the record count.

**12. Optional sections**

_All sections are required for this template._

**13. Data & content components**

`cover`, `executive_summary`, `recommendation_box`, `comparison_table`, `process_flow`, `data_table`, `highlight_box`, `timeline`, `checklist`, `disclaimer_page`, `back_cover`

**14. Image requirements**

One hero cover image at 3:2. The cover carries a two-logo lockup, so both logo slots must be sized identically — an unequal lockup reads as an unequal partnership.

**15. Chart & table requirements**

One commercial terms table. No charts.

**16. White-label configuration points**

All 29 library-standard points apply. Maximum white-label level: **L4** (Fully White-Labelled).

Template-specific additions:

| Area | Binding | Appears in |
| --- | --- | --- |
| Partner organisation logo | {{partner.logoUrl}} | Cover lockup, back cover |
| Partner organisation name | {{partner.name}} | Cover, throughout |

**17. Dynamic content fields**

- `partner.* — name, logo, contact{}`
- `journey[], terms[], activation[]`

Plus the library-standard set: `org.*`, `author.*`, `client.*`, `recipient.*`, `document.*`, `legal.*`, `brand.*`.

**18. Export requirements**

DOCX (editable, styles intact, header/footer live page fields), PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), HTML preview for the in-app viewer.

**19. Accessibility considerations**

Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — every status chip pairs a glyph and a word with its fill. Every image and chart frame carries a required alt-text binding; generation fails validation if alt text is empty. Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables declare a repeating header row so assistive technology can associate cells with headers.

**20. Print considerations**

A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: family fills differ in lightness, not hue alone. No content in the last 12mm of the page. Table header rows repeat across page breaks; no row splits across a page; no heading is stranded from its content. Duplex-safe — no design element depends on a recto/verso position.

**21. Mobile / web-preview considerations**

Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the viewer switches to a continuous single-column scroll with pinch-zoom; tables become horizontally scrollable within their own container rather than shrinking the page. The first page is the library thumbnail source.

**22. Recommended thumbnail presentation**

Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel dominate, with a category chip and length badge overlaid on the card.

**23. Use this template when**

- You are proposing a commercial partnership.
- Both organisations appear on the document.
- Terms and boundaries need to be set out before legal drafting.

**24. Use a different template when**

- You are proposing services to a client → `client-proposal`
- You are documenting an agreed partnership in legal terms → _outside this library_

**Library metadata** — tier `scale` · priority `P3` · data `low` · images `medium` · formality `presentation` · audience `partner` · generator implemented

---
