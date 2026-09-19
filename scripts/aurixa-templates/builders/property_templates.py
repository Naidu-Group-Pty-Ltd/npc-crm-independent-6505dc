"""Builders for the property templates.

Each function takes a resolved ``Theme`` and a ``Fill``, and returns nothing —
it writes into the document it is given. Section order matches the ``sections``
tuple of the corresponding ``TemplateSpec`` in ``catalogue.py``, so the built
artefact and the published brief cannot diverge.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import components as C  # noqa: E402
from content import Fill  # noqa: E402
from oxml import page_break  # noqa: E402
from theme import Theme  # noqa: E402


# ==========================================================================
# Property Investment Report — Property Visual
# ==========================================================================

def property_investment_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Property investment analysis",
        title=f("report.title", "Property Investment Report"),
        subtitle=f("property.address",
                   "12 Example Street, Northbridge NSW 2063 — a researched investment "
                   "case covering the asset, the numbers, the risks and a recommendation."),
        chips=["RESEARCHED", "MODELLED", "RECOMMENDED"],
        image_caption=f("property.images.0.caption", "Street elevation, facing north"),
    )
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Executive summary"), ("02", "Investment metrics"),
        ("03", "Property overview"), ("04", "Location & amenity"),
        ("05", "Financial analysis"), ("06", "Cash-flow projection"),
        ("07", "Comparable sales"), ("08", "Risks & mitigations"),
        ("09", "Recommendation"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "The case in brief")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "The property meets the mandate on yield, holding cost and location, "
                   "with two risks that are manageable."),
        paragraphs=f.text("report.executiveSummary", [
            "The subject property is a three-bedroom freestanding house on 512m² in an "
            "established residential pocket 11km from the CBD. It presents in original but "
            "sound condition and has been continuously tenanted for the last four years.",
            "On the assumptions set out in this report the property produces a gross yield "
            "of 4.6% and a first-year after-tax holding cost of $84 per week, which is "
            "within the budget agreed in the client brief. The suburb has recorded 6.1% "
            "compound annual growth over ten years against a metropolitan average of 5.4%.",
            "Two matters require attention before exchange: the tenancy runs to a fixed "
            "term expiring in four months, and the building report identifies rising damp "
            "to the rear wall. Both are quantified in the risk section and neither is "
            "assessed as material to the recommendation.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Gross yield of 4.6% clears the 4.2% threshold in the client brief.",
            "After-tax holding cost of $84/week is inside the agreed $150/week budget.",
            "Rising damp remediation is estimated at $6,500 and should be negotiated.",
            "Recommended maximum offer is $865,000.",
        ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "02", "Investment metrics", "Headline position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("PURCHASE PRICE", f("financials.price", "$865,000"), "Recommended maximum"),
        ("GROSS YIELD", f("financials.grossYield", "4.6%"), "On appraised rent"),
        ("WEEKLY RENT", f("financials.weeklyRent", "$765"), "Appraised range $750–780"),
        ("CASH REQUIRED", f("financials.cashRequired", "$212,400"), "Incl. costs, 20% deposit"),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "03", "Property overview", "The asset")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Property particulars", fields=[
        ("Address", f("property.address", "12 Example Street, Northbridge NSW 2063")),
        ("Property type", f("property.type", "Freestanding house")),
        ("Land area", f("property.landArea", "512 m²")),
        ("Building area", f("property.buildingArea", "148 m²")),
        ("Bedrooms / bathrooms", f("property.bedBath", "3 / 1")),
        ("Car spaces", f("property.carSpaces", "2 (lock-up garage)")),
        ("Year built", f("property.yearBuilt", "1968")),
        ("Zoning", f("property.zoning", "R2 Low Density Residential")),
        ("Current tenancy", f("property.tenancy", "Fixed term to 14/11/2026 at $740/week")),
        ("Condition", f("property.condition", "Original, structurally sound")),
    ])
    C.gap(doc, theme)
    C.image_gallery(doc, theme, count=4, columns=2, captions=[
        f("property.images.0.caption", "Street elevation"),
        f("property.images.1.caption", "Living and dining"),
        f("property.images.2.caption", "Kitchen, original"),
        f("property.images.3.caption", "Rear yard and garage"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "04", "Location & amenity", "Why here")
    C.gap(doc, theme)
    C.map_frame(doc, theme, title="Subject and amenity",
                alt_text="Map showing the subject property, transport, schools and retail",
                legend=[("●", "Subject property"), ("▲", "Rail"), ("■", "Schools"),
                        ("◆", "Retail")])
    C.gap(doc, theme, 0.6)
    C.prose(doc, theme, f.text("property.locationNarrative", [
        "The property sits on the northern side of the street, three streets from the "
        "primary retail strip and 900 metres from the station. The catchment primary "
        "school is within 1.2km and is at capacity, which historically supports family "
        "demand in the immediate blocks.",
    ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "05", "Financial analysis", "Acquisition and holding")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Basis", "Amount", "Notes"],
        f.rows("financials.acquisition", [
            ["Purchase price", "Recommended maximum", "$865,000", "—"],
            ["Stamp duty", "NSW, investor", "$34,290", "Estimate"],
            ["Legal and conveyancing", "Fixed fee", "$1,800", "Quoted"],
            ["Building and pest", "Fixed fee", "$650", "Completed"],
            ["Lender and valuation fees", "Estimate", "$1,100", "Lender dependent"],
            ["Buyer's agency fee", "Per engagement", "$14,200", "Incl. GST"],
        ], ["{{item}}", "{{basis}}", "{{amount}}", "{{notes}}"], count=5),
        widths=[52, 40, 32, 54], numeric_cols={2},
        total_row=["Total acquisition cost", "", f("financials.totalCost", "$917,040"), ""],
        caption="Acquisition costs",
        note="Stamp duty is an estimate only and must be confirmed with the client's "
             "conveyancer. Figures exclude GST unless stated.")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Item", "Annual", "Weekly", "Basis"],
        f.rows("financials.holding", [
            ["Rental income", "$39,780", "$765", "Appraised"],
            ["Council rates", "-$2,140", "-$41", "Actual"],
            ["Water and sewer", "-$1,180", "-$23", "Actual"],
            ["Insurance", "-$1,650", "-$32", "Quoted"],
            ["Property management", "-$2,745", "-$53", "6.9% incl. GST"],
            ["Repairs allowance", "-$1,500", "-$29", "Assumption"],
            ["Loan interest", "-$41,472", "-$798", "6.4% on $648,000"],
        ], ["{{item}}", "{{annual}}", "{{weekly}}", "{{basis}}"], count=6),
        widths=[58, 34, 30, 56], numeric_cols={1, 2},
        total_row=["Pre-tax position", f("financials.preTax", "-$10,907"),
                   f("financials.preTaxWeekly", "-$210"), ""],
        caption="First-year holding position")
    page_break(doc)

    C.section_opener(doc, theme, "06", "Cash-flow projection", "Ten-year view")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Cumulative after-tax position",
                  kind="line chart", binding="{{cashflow.series}}",
                  caption="Ten years, nominal",
                  source=f("cashflow.source", "Aurixa cash-flow model"),
                  alt_text="Cumulative after-tax net position turns positive in year six")
    C.gap(doc, theme, 0.6)
    C.info_card(doc, theme, title="Projection assumptions", fields=[
        ("Capital growth", f("assumptions.growth", "4.5% p.a.")),
        ("Rental growth", f("assumptions.rentGrowth", "3.0% p.a.")),
        ("Interest rate", f("assumptions.rate", "6.40%, interest only 5 years")),
        ("Vacancy allowance", f("assumptions.vacancy", "2 weeks p.a.")),
        ("Marginal tax rate", f("assumptions.taxRate", "39% incl. Medicare")),
        ("Depreciation", f("assumptions.depreciation", "Quantity surveyor estimate")),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "07", "Comparable sales", "Evidence for the price")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Address", "Sold", "Price", "Land", "Beds", "Adjustment"],
        f.rows("comparables", [
            ["8 Sample Avenue", "Jun 2026", "$872,000", "498 m²", "3", "−$10,000 (condition)"],
            ["21 Test Road", "May 2026", "$845,000", "521 m²", "3", "+$15,000 (position)"],
            ["4 Example Street", "Apr 2026", "$910,000", "540 m²", "4", "−$45,000 (size)"],
            ["17 Demo Close", "Mar 2026", "$838,000", "486 m²", "3", "+$22,000 (renovated)"],
        ], ["{{address}}", "{{soldDate}}", "{{soldPrice}}", "{{land}}", "{{beds}}",
            "{{adjustment}}"], count=4),
        widths=[54, 26, 30, 24, 18, 46], numeric_cols={2},
        caption="Recent comparable sales",
        note="Adjustments are the analyst's assessment relative to the subject property.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "08", "Risks & mitigations", "What could go wrong")
    C.gap(doc, theme)
    C.risk_box(doc, theme, risks=f.tuples("risks", [
        ("Rising damp to the rear wall requires remediation",
         "Medium", "Obtain a fixed-price rectification quote and negotiate a price "
                   "reduction of no less than the quoted amount before exchange."),
        ("Fixed tenancy expires in four months at below-market rent",
         "Low", "Rent is $25/week below appraisal; re-letting at market improves yield. "
                "Budget two weeks vacancy at changeover."),
        ("Interest rates rise beyond the assumed 6.40%",
         "Medium", "Position is stress-tested at +2%; holding cost rises to $214/week, "
                   "which exceeds the client's stated budget."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "09", "Recommendation", "The decision")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Proceed to offer at or below $865,000, subject to building and "
                         "pest, finance, and a price adjustment for damp remediation."),
        rationale=f.text("report.rationale", [
            "The property clears the yield and holding-cost thresholds set in the client "
            "brief, is supported by four adjusted comparable sales, and sits in a suburb "
            "with a ten-year growth record above the metropolitan average. The identified "
            "defects are quantifiable and are best dealt with as a price adjustment rather "
            "than a condition of the contract.",
        ]),
        actions=f.items("report.nextSteps", [
            "Obtain a fixed-price damp rectification quote.",
            "Issue an offer at $865,000 less the quoted rectification amount.",
            "Confirm finance approval covers the adjusted purchase price.",
            "Instruct the conveyancer to review the residential tenancy agreement.",
        ]),
        confidence=f("report.confidence", "High"))
    C.gap(doc, theme)
    C.adviser_profile(doc, theme,
                      bio=f("author.bio",
                            "Licensed buyer's agent specialising in established "
                            "residential stock across the lower north shore."),
                      credentials=f.items("author.credentialList", [
                          "Licensed real estate agent (NSW)",
                          "Member, Real Estate Buyers Agents Association",
                      ]))

    C.appendix_opener(doc, theme, "A", "Data sources & provenance",
                      "Every figure in this report and where it came from.")
    C.gap(doc, theme, 0.6)
    C.data_table(doc, theme, ["Data", "Source", "As at"],
                 f.rows("appendix.sources", [
                     ["Comparable sales", "State valuer-general records", "01/07/2026"],
                     ["Rental appraisal", "Independent managing agent", "18/07/2026"],
                     ["Suburb growth", "Aurixa market data", "30/06/2026"],
                     ["Building condition", "Licensed building inspector", "22/07/2026"],
                 ], ["{{data}}", "{{source}}", "{{asAt}}"], count=4),
                 widths=[60, 80, 38])
    C.disclaimer_page(doc, theme)
    C.back_cover(doc, theme)


# ==========================================================================
# Property Acquisition Recommendation — Premium Advisory
# ==========================================================================

def property_acquisition_recommendation(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Advisory recommendation",
        title=f("report.title", "Property Acquisition Recommendation"),
        subtitle=f("report.subtitle",
                   "Our recommendation on the property we believe you should acquire, "
                   "the reasoning behind it and the strategy to secure it."),
        chips=["ADVISORY", "DECISION-READY"])
    page_break(doc)

    C.recommendation_box(
        doc, theme,
        title="Our recommendation",
        recommendation=f("report.recommendation",
                         "Acquire 12 Example Street, Northbridge at or below $865,000 "
                         "on a 42-day settlement with a five-day building and pest "
                         "condition."),
        rationale=f.text("report.rationale", [
            "Of the eleven properties assessed against your brief this quarter, this is "
            "the only one that satisfies every stated requirement without compromise on "
            "land size, and it does so inside your budget.",
        ]),
        actions=f.items("report.nextSteps", [
            "Confirm your authority to offer at the recommended level.",
            "We issue the offer and manage negotiation.",
            "Building and pest inspections are booked within 48 hours of acceptance.",
        ]),
        confidence=f("report.confidence", "High"))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "01", "Why this property", "The case")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="Summary",
        headline=f("report.headline",
                   "It meets every requirement in your brief, at a price supported by "
                   "four comparable sales."),
        paragraphs=f.text("report.summary", [
            "Your brief set a firm minimum of 500m² of land, a maximum of 12km from the "
            "CBD, and a gross yield above 4.2%. Nine of the eleven properties we assessed "
            "failed on land size alone. Of the two that qualified, this property is the "
            "better positioned and the more defensible on price.",
            "The seller's circumstances favour a shorter settlement, which gives us a "
            "genuine non-price lever in the negotiation. We believe that lever is worth "
            "between $15,000 and $25,000 against the guide.",
        ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "02", "Alignment to your brief", "Requirement by requirement")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Your requirement", "This property"],
        attributes=[
            ("Land size", [f("brief.land", "Minimum 500 m²"),
                           f("property.landArea", "512 m² ✔")]),
            ("Distance to CBD", [f("brief.distance", "Within 12 km"),
                                 f("property.distance", "11.2 km ✔")]),
            ("Gross yield", [f("brief.yield", "Above 4.2%"),
                             f("property.yield", "4.6% ✔")]),
            ("Budget", [f("brief.budget", "Up to $900,000"),
                        f("property.price", "$865,000 ✔")]),
            ("Bedrooms", [f("brief.beds", "3 or more"), f("property.beds", "3 ✔")]),
            ("Condition", [f("brief.condition", "No major structural work"),
                           f("property.condition", "Sound; cosmetic only ✔")]),
            ("Tenancy", [f("brief.tenancy", "Tenanted preferred"),
                         f("property.tenancy", "Fixed term to Nov 2026 ✔")]),
        ],
        caption="Your brief against this property", winner_index=1)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "03", "Key numbers", "The financial position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("RECOMMENDED OFFER", f("financials.offer", "$865,000"), "Maximum"),
        ("GROSS YIELD", f("financials.grossYield", "4.6%"), "On appraised rent"),
        ("CASH REQUIRED", f("financials.cashRequired", "$212,400"), "Incl. all costs"),
        ("HOLDING COST", f("financials.holdingCost", "$84/wk"), "After tax, year one"),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "04", "Acquisition strategy", "How we secure it")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("strategy.steps", [
        ("Open", "Offer at $848,000 with a 42-day settlement and a five-day condition."),
        ("Hold", "Do not improve on price before the agent brings a counter."),
        ("Improve", "Move to $858,000 only against a written counter above $875,000."),
        ("Ceiling", "$865,000. We will not recommend exceeding this."),
        ("Secure", "Exchange within five business days of acceptance."),
    ], ("{{step.name}}", "{{step.detail}}"), count=4))
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="What would change this recommendation",
               risks=f.tuples("risks", [
                   ("Building report identifies structural movement",
                    "High", "We withdraw the recommendation and resume the search."),
                   ("Competing offer pushes the price beyond $865,000",
                    "Medium", "We do not compete beyond the ceiling; two alternatives "
                              "remain under assessment."),
                   ("Finance approval does not cover the adjusted price",
                    "Medium", "Confirm approval before the offer is issued."),
               ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "05", "Your authority", "What we need from you")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("authority.items", [
        "I authorise an opening offer of $848,000.",
        "I authorise a maximum offer of $865,000.",
        "I authorise a 42-day settlement.",
        "I confirm finance is in place to the recommended level.",
    ]), title="Authority to act")
    C.gap(doc, theme, 0.7)
    C.signature_block(doc, theme, [
        ("Client authority", ["Name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("For the agency", [f"Name: {f('author.name', 'A. Nguyen')}", "Signature:",
                            "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Off-Market Opportunity Report — Luxury Presentation
# ==========================================================================

def off_market_opportunity_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Private & confidential",
        title=f("opportunity.title", "A Harbourside Residence, Off Market"),
        subtitle=f("opportunity.subtitle",
                   "An opportunity offered privately, ahead of any public campaign."),
        image_caption=f("opportunity.coverCaption",
                        "North-east aspect across the harbour"),
        prepared_for=False)
    page_break(doc)

    C.section_opener(doc, theme, "", "The opportunity", "")
    C.gap(doc, theme)
    C.prose(doc, theme, f.text("opportunity.narrative", [
        "The property has been held by one family since 1974. It has not been offered "
        "publicly, and the owners have asked that it not be. We have been given a "
        "four-week window to introduce it to a small number of qualified buyers before "
        "any decision is made about a campaign.",
        "It occupies 1,140 square metres on the high side of a cul-de-sac, with a "
        "north-east aspect and unimpeded water views from the principal living level. "
        "The house is substantial and original. It is habitable as it stands and will "
        "reward either a considered restoration or a replacement dwelling, subject to the "
        "usual approvals.",
        "Opportunities of this kind on this street reach the open market perhaps once in "
        "a decade. We are able to arrange an inspection at short notice.",
    ]), size=theme.type_scale.body + 0.5)
    C.gap(doc, theme)

    C.metric_panel(doc, theme, [
        ("GUIDE", f("opportunity.guide", "$6.4m – $6.9m"), "Private treaty"),
        ("LAND", f("property.landArea", "1,140 m²"), "High side, north-east"),
        ("ACCOMMODATION", f("property.accommodation", "5 · 3 · 4"), "Bed · bath · car"),
        ("AVAILABILITY", f("opportunity.availability", "4 weeks"), "Private window"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "The property", "")
    C.gap(doc, theme)
    C.image_gallery(doc, theme, count=4, columns=2, height_mm=52, captions=[
        f("property.images.0.caption", "Principal living level, north-east aspect"),
        f("property.images.1.caption", "Terrace and gardens"),
        f("property.images.2.caption", "Original kitchen and family room"),
        f("property.images.3.caption", "Street approach"),
    ])
    C.gap(doc, theme)
    C.map_frame(doc, theme, title="Position", height_mm=64,
                alt_text="Map showing the property's position within the precinct",
                legend=[("●", "The property"), ("▲", "Ferry"), ("■", "Village")])
    page_break(doc)

    C.section_opener(doc, theme, "", "Terms & process", "")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("opportunity.process", [
        ("Register", "Confirm interest and complete the confidentiality undertaking."),
        ("Inspect", "Private inspection by appointment, weekdays only."),
        ("Offer", "Written offer with evidence of funds and settlement terms."),
        ("Decide", "The owners will consider offers at the close of the window."),
    ], ("{{step.name}}", "{{step.detail}}"), count=4))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="Confidentiality",
        text=f("opportunity.confidentiality",
               "This document is provided in confidence to a named recipient. It may not "
               "be forwarded, reproduced, published or discussed with any third party, "
               "including other agents, without our written consent. The owners have not "
               "authorised a public campaign and the property is not currently for sale "
               "on the open market."))
    C.gap(doc, theme)
    C.adviser_profile(doc, theme,
                      bio=f("author.bio",
                            "Handles private and pre-market transactions across the "
                            "eastern harbour precincts."),
                      credentials=f.items("author.credentialList", [
                          "Licensed real estate agent",
                          "Twenty-two years in prestige transactions",
                      ]))
    C.back_cover(doc, theme)


# ==========================================================================
# Property Due-Diligence Report — Compliance Structured
# ==========================================================================

def property_due_diligence_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Pre-exchange investigation",
        title=f("report.title", "Property Due-Diligence Report"),
        subtitle=f("property.address",
                   "12 Example Street, Northbridge NSW 2063 — title, planning, building, "
                   "environmental and contractual findings against a numbered register."),
        chips=["INVESTIGATED", "EVIDENCED", "AUDITABLE"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("", "Scope & limitations"), ("", "Summary of findings"),
        ("1", "Findings register"), ("2", "Title & ownership"),
        ("3", "Planning & zoning"), ("4", "Building & pest"),
        ("5", "Environmental & hazard"), ("6", "Strata / body corporate"),
        ("7", "Outstanding items"), ("8", "Risks & mitigations"),
        ("9", "Conclusion"), ("A", "Evidence index"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "Scope & limitations", "Read this first")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Scope & limitations",
        text=f("diligence.scope",
               "This report records the results of the investigations listed below, "
               "carried out on the dates stated. It is not a valuation, a structural "
               "engineering assessment, a survey, or legal advice on the contract. "
               "Matters outside the listed scope have not been investigated and no "
               "opinion is expressed on them."),
        items=f.items("diligence.scopeItems", [
            "Investigation period: 18 July 2026 to 29 July 2026.",
            "Contract of sale reviewed: version dated 16 July 2026.",
            "Physical inspection: 22 July 2026, by a licensed building inspector.",
            "Not investigated: structural engineering, survey, pool compliance.",
        ]))
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="Summary of findings",
        headline=f("report.headline",
                   "Two findings condition exchange; neither prevents it. Three items "
                   "remain outstanding."),
        paragraphs=f.text("report.summary", [
            "Twenty-eight due-diligence items were investigated. Twenty-three returned "
            "clear, two returned findings that should condition exchange, and three "
            "remain outstanding pending third-party responses.",
            "The two conditioning findings are rising damp to the rear wall, quantified "
            "at $6,500, and a positive covenant requiring maintenance of a shared "
            "boundary retaining wall. Both are addressable by price adjustment or by a "
            "special condition.",
        ]))
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("ITEMS INVESTIGATED", f("diligence.total", "28"), "In scope"),
        ("CLEAR", f("diligence.clear", "23"), "No action"),
        ("FINDINGS", f("diligence.findings", "2"), "Condition exchange"),
        ("OUTSTANDING", f("diligence.outstanding", "3"), "Awaiting response"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "1", "Findings register", "Every item investigated")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Item", "Finding", "Evidence", "Reviewer", "Status"],
        rows=f.tuples("diligence.controls", [
            (["1.1", "Title search", "Fee simple, no caveats", "Title search 29/07",
              "RP", "Clear"], "clear"),
            (["1.2", "Encumbrances", "Positive covenant — shared retaining wall",
              "Title search 29/07", "RP", "Review"], "review"),
            (["1.3", "Easements", "Sewer easement, rear 1.5m", "Sewer diagram 29/07",
              "RP", "Clear"], "clear"),
            (["1.4", "Zoning", "R2 Low Density Residential", "Planning certificate 24/07",
              "RP", "Clear"], "clear"),
            (["1.5", "Overlays", "None applicable", "Planning certificate 24/07",
              "RP", "Clear"], "clear"),
            (["1.6", "Building — structure", "Sound, no movement", "Inspection 22/07",
              "BI", "Clear"], "clear"),
            (["1.7", "Building — moisture", "Rising damp, rear wall",
              "Inspection 22/07", "BI", "Fail"], "fail"),
            (["1.8", "Pest", "No active infestation", "Inspection 22/07", "BI",
              "Clear"], "clear"),
            (["1.9", "Flood", "Not flood affected", "Council response 25/07", "RP",
              "Clear"], "clear"),
            (["1.10", "Bushfire", "Not bushfire prone", "Planning certificate 24/07",
              "RP", "Clear"], "clear"),
            (["1.11", "Contamination", "No recorded notices", "EPA search 25/07", "RP",
              "Clear"], "clear"),
            (["1.12", "Swimming pool", "Not applicable", "n/a", "RP", "N/A"], "n/a"),
            (["1.13", "Tenancy agreement", "Fixed to 14/11/2026 at $740/week",
              "Lease provided 20/07", "RP", "Clear"], "clear"),
            (["1.14", "Council building approvals", "Awaiting council response",
              "Requested 24/07", "RP", "Pending"], "pending"),
            (["1.15", "Sewer service diagram", "Awaiting Sydney Water",
              "Requested 24/07", "RP", "Pending"], "pending"),
            (["1.16", "Road widening proposal", "Awaiting council response",
              "Requested 24/07", "RP", "Pending"], "pending"),
        ], (["{{ref}}", "{{item}}", "{{finding}}", "{{evidence}}", "{{reviewer}}",
             "Pending"], "pending"), count=6),
        widths=[16, 42, 56, 38, 22, 26],
        caption="Due-diligence register")
    page_break(doc)

    C.section_opener(doc, theme, "2", "Title & ownership", "What the title shows")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Particular", "Detail", "Source", "Effect"],
        f.rows("title.detail", [
            ["Folio identifier", "12/456789", "Title search 29/07/2026", "—"],
            ["Registered proprietors", "Two, joint tenants", "Title search 29/07/2026",
             "Both must execute"],
            ["Tenure", "Fee simple (Torrens)", "Title search 29/07/2026", "—"],
            ["Mortgages", "One registered, to be discharged",
             "Title search 29/07/2026", "Discharge on settlement"],
            ["Caveats", "None", "Title search 29/07/2026", "—"],
            ["Covenants", "Positive covenant — shared retaining wall maintenance",
             "Title search 29/07/2026", "Ongoing obligation to the purchaser"],
            ["Easements", "Sewer easement, rear 1.5m", "Sewer diagram 29/07/2026",
             "Restricts rear building envelope"],
        ], ["{{particular}}", "{{detail}}", "{{source}}", "{{effect}}"], count=5),
        widths=[38, 62, 40, 42], caption="Title particulars")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "3", "Planning & zoning", "What may be done with the land")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Control", "Position", "Source", "Effect"],
        f.rows("planning.detail", [
            ["Zone", "R2 Low Density Residential", "Planning certificate 24/07/2026",
             "Dwelling permitted with consent"],
            ["Minimum lot size", "550 m²", "Planning certificate 24/07/2026",
             "512 m² — subdivision not available"],
            ["Height of buildings", "8.5 m", "Planning certificate 24/07/2026",
             "Two storeys achievable"],
            ["Floor space ratio", "0.5:1", "Planning certificate 24/07/2026",
             "256 m² gross floor area"],
            ["Heritage", "Not listed; not in a conservation area",
             "Planning certificate 24/07/2026", "No heritage constraint"],
            ["Acid sulfate soils", "Class 5", "Planning certificate 24/07/2026",
             "Consent required for works below 1m"],
        ], ["{{control}}", "{{position}}", "{{source}}", "{{effect}}"], count=5),
        widths=[38, 56, 44, 44], caption="Planning controls")
    page_break(doc)

    C.section_opener(doc, theme, "4", "Building & pest", "Physical condition")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Element", "Finding", "Severity", "Est. cost", "Status"],
        rows=f.tuples("inspections", [
            (["4.1", "Roof and gutters", "Serviceable; gutters require cleaning",
              "Minor", "$400", "Clear"], "clear"),
            (["4.2", "Rear wall", "Rising damp, active", "Major", "$6,500", "Fail"], "fail"),
            (["4.3", "Subfloor", "Adequate ventilation, dry", "None", "—", "Clear"], "clear"),
            (["4.4", "Wet areas", "Original; waterproofing at end of life",
              "Moderate", "$9,000", "Review"], "review"),
            (["4.5", "Electrical", "Switchboard has RCD protection", "None", "—",
              "Clear"], "clear"),
            (["4.6", "Timber pests", "No active infestation; no prior damage",
              "None", "—", "Clear"], "clear"),
        ], (["{{ref}}", "{{element}}", "{{finding}}", "{{severity}}", "{{cost}}",
             "Pending"], "pending"), count=5),
        widths=[16, 40, 62, 26, 26, 26], caption="Building and pest findings")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "5", "Environmental & hazard", "External risk")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Hazard", "Position", "Source", "Status"],
        rows=f.tuples("hazards", [
            (["5.1", "Flood", "Not flood affected", "Council response 25/07/2026",
              "Clear"], "clear"),
            (["5.2", "Bushfire", "Not bushfire prone", "Planning certificate",
              "Clear"], "clear"),
            (["5.3", "Contamination", "No recorded notices", "EPA record search",
              "Clear"], "clear"),
            (["5.4", "Mine subsidence", "Not in a declared district", "Subsidence search",
              "Clear"], "clear"),
            (["5.5", "Coastal erosion", "Not applicable", "n/a", "N/A"], "n/a"),
        ], (["{{ref}}", "{{hazard}}", "{{position}}", "{{source}}", "Pending"],
            "pending"), count=5),
        widths=[16, 40, 58, 44, 26], caption="Hazard searches")
    page_break(doc)

    C.section_opener(doc, theme, "7", "Outstanding items", "Before exchange")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("diligence.outstandingItems", [
        "Council building-approval history — requested 24/07, response outstanding.",
        "Sydney Water sewer service diagram — requested 24/07, response outstanding.",
        "Council road-widening proposal search — requested 24/07, response outstanding.",
    ]), title="Outstanding", with_owner=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "8", "Risks & mitigations", "Residual position")
    C.gap(doc, theme)
    C.risk_box(doc, theme, risks=f.tuples("risks", [
        ("Rising damp to the rear wall, active", "High",
         "Fixed-price rectification quote obtained at $6,500. Negotiate a price "
         "reduction of no less than that amount, or make exchange conditional on "
         "rectification."),
        ("Positive covenant — shared retaining wall maintenance", "Medium",
         "Obtain the covenant terms and confirm the current state of the wall. Budget "
         "for a share of future maintenance."),
        ("Wet-area waterproofing at end of life", "Medium",
         "Not a defect today. Budget $9,000 within three years."),
        ("Three searches outstanding at the date of this report", "Medium",
         "Do not exchange before all three are received and reviewed."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Conclusion",
        recommendation=f("report.conclusion",
                         "Proceed with conditions. Do not exchange until the three "
                         "outstanding searches are received, and adjust the price by no "
                         "less than $6,500 for the damp rectification."),
        rationale=f.text("report.conclusionRationale", [
            "Nothing found in the investigation is a reason to withdraw. Two findings "
            "are quantifiable and are best handled commercially rather than as contract "
            "conditions; the three outstanding searches are routine and are expected to "
            "return clear.",
        ]),
        actions=f.items("report.conclusionActions", [
            "Obtain the three outstanding search responses.",
            "Negotiate the price adjustment for damp rectification.",
            "Instruct the conveyancer on the positive covenant.",
        ]),
        confidence=f("report.confidence", "High"))
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Prepared by", f("author.name", "R. Patel, Buyer's Agent"), "Complete"),
        ("Reviewed by", f("reviewer.name", "A. Nguyen, Principal"), "Complete"),
    ], ("{{role}}", "{{name}}", "Pending"), count=2))

    C.appendix_opener(doc, theme, "A", "Evidence index",
                      "Every document obtained for this investigation.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Ref", "Document", "Obtained from", "Dated", "Held"],
        f.rows("appendix.evidence", [
            ["1.1", "Title search", "Land registry", "29/07/2026", "DD-0418-01"],
            ["1.3", "Sewer service diagram", "Water authority", "29/07/2026", "DD-0418-02"],
            ["1.4", "Planning certificate", "Local council", "24/07/2026", "DD-0418-03"],
            ["1.6", "Building and pest report", "Licensed inspector", "22/07/2026",
             "DD-0418-04"],
            ["1.11", "Contamination record search", "Environment authority", "25/07/2026",
             "DD-0418-05"],
            ["1.13", "Residential tenancy agreement", "Vendor's agent", "20/07/2026",
             "DD-0418-06"],
        ], ["{{ref}}", "{{document}}", "{{source}}", "{{dated}}", "{{held}}"], count=5),
        widths=[16, 62, 44, 28, 28])
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Property Comparison Report — Property Visual
# ==========================================================================

def property_comparison_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Shortlist assessment",
        title=f("report.title", "Property Comparison Report"),
        subtitle=f("report.subtitle",
                   "Three shortlisted properties assessed against consistent criteria, "
                   "weighted to your brief, with a ranked outcome."),
        chips=["3 PROPERTIES", "WEIGHTED", "RANKED"],
        image_caption=f("report.coverCaption", "Preferred option — 12 Example Street"))
    page_break(doc)

    C.section_opener(doc, theme, "01", "How to read this report", "Method")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Criteria and weighting",
        text=f("report.method",
               "Each property is scored out of 10 against seven criteria drawn from your "
               "brief. Criteria are weighted, so a strong result on land size counts for "
               "more than a strong result on aspect. The recommended option is tinted in "
               "every table; a tint is a recommendation, not a fact."),
        items=f.items("criteria.weights", [
            "Land size — weight 20%",
            "Yield — weight 20%",
            "Location and amenity — weight 20%",
            "Condition — weight 15%",
            "Growth evidence — weight 15%",
            "Tenancy position — weight 10%",
        ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "02", "Comparison at a glance", "Every attribute, side by side")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=[f("properties.0.short", "12 Example St"),
                        f("properties.1.short", "48 Sample Ave"),
                        f("properties.2.short", "9 Test Rd")],
        attributes=[
            ("Price guide", ["$860,000 – $880,000", "$900,000 – $930,000",
                             "$780,000 – $810,000"]),
            ("Land", ["512 m²", "430 m²", "604 m²"]),
            ("Accommodation", ["3 · 1 · 2", "3 · 2 · 1", "3 · 1 · 1"]),
            ("Appraised rent", ["$765/wk", "$730/wk", "$700/wk"]),
            ("Gross yield", ["4.6%", "4.1%", "4.5%"]),
            ("Distance to CBD", ["11.2 km", "9.8 km", "14.6 km"]),
            ("Distance to station", ["900 m", "450 m", "2.1 km"]),
            ("Condition", ["Original, sound", "Renovated 2023", "Original, damp"]),
            ("10-year suburb growth", ["6.1% p.a.", "5.8% p.a.", "5.2% p.a."]),
            ("Tenancy", ["Fixed to Nov 2026", "Vacant", "Periodic"]),
            ("Est. cash required", ["$212,400", "$226,800", "$194,600"]),
            ("Weighted score", ["8.4 / 10", "7.1 / 10", "6.3 / 10"]),
        ],
        caption="Shortlist", winner_index=0)
    page_break(doc)

    C.section_opener(doc, theme, "03", "Scoring summary", "Weighted outcome")
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="Weighted score out of 10", maximum=10,
                rows=f.tuples("properties.scores", [
                    ("12 Example St", 8.4, "8.4"),
                    ("48 Sample Ave", 7.1, "7.1"),
                    ("9 Test Rd", 6.3, "6.3"),
                ], ("{{property.short}}", 5, "{{property.score}}"), count=3),
                note="Scores are the weighted sum of the seven criteria above. They "
                     "express our assessment against your brief, not market value.")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Criterion", "Weight", "12 Example St", "48 Sample Ave", "9 Test Rd"],
        f.rows("criteria.scores", [
            ["Land size", "20%", "9", "6", "10"],
            ["Yield", "20%", "9", "6", "8"],
            ["Location and amenity", "20%", "8", "10", "4"],
            ["Condition", "15%", "7", "10", "3"],
            ["Growth evidence", "15%", "9", "8", "6"],
            ["Tenancy position", "10%", "8", "4", "7"],
        ], ["{{criterion}}", "{{weight}}", "{{a}}", "{{b}}", "{{c}}"], count=6),
        widths=[52, 24, 34, 34, 34], numeric_cols={2, 3, 4},
        total_row=["Weighted score", "100%", "8.4", "7.1", "6.3"],
        caption="Score by criterion")
    page_break(doc)

    C.section_opener(doc, theme, "04", "Property profiles", "One block per property")
    C.gap(doc, theme)
    for index, (short, strengths, concerns) in enumerate(f.tuples("properties.profiles", [
        ("12 Example Street, Northbridge",
         ["Largest yield of the three at 4.6%.",
          "512 m² clears your 500 m² minimum.",
          "Tenanted to November at close to market rent."],
         ["Rising damp to the rear wall, quantified at $6,500.",
          "Single bathroom; a second is achievable but not budgeted."]),
        ("48 Sample Avenue, Northbridge",
         ["Best located — 450 m to the station.",
          "Renovated in 2023; no capital works expected for a decade."],
         ["430 m² is below your 500 m² minimum.",
          "Yield of 4.1% is below your 4.2% threshold.",
          "Vacant — two to four weeks' rent forgone at settlement."]),
        ("9 Test Road, Northbridge",
         ["Largest land holding at 604 m².",
          "Lowest cash requirement of the three."],
         ["2.1 km from the station, outside your stated preference.",
          "Active damp and dated wet areas; $28,000 of work identified.",
          "Weakest ten-year growth evidence of the three suburbs."]),
    ], ("{{property.address}}", ["{{property.strengths}}"], ["{{property.concerns}}"]),
            count=3)):
        C.subsection(doc, theme, f"Option {index + 1} — {short}", before=0 if index == 0 else 10)
        C.image_frame(doc, theme, height_mm=42,
                      placeholder=f"[  {short.split(',')[0].upper()}  ]",
                      alt_text=f"Street elevation of {short}",
                      caption=f("properties.caption", "Street elevation"))
        C.gap(doc, theme, 0.4)
        C.responsibility_columns(
            doc, theme, ("Strengths", list(strengths)), ("Concerns", list(concerns)),
            tones=("success", "alert"))
    page_break(doc)

    C.section_opener(doc, theme, "05", "Financial comparison", "What each one costs")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "12 Example St", "48 Sample Ave", "9 Test Rd"],
        f.rows("properties.financials", [
            ["Assumed purchase price", "$865,000", "$915,000", "$795,000"],
            ["Acquisition costs", "$52,040", "$55,100", "$47,800"],
            ["Immediate works identified", "$6,500", "$0", "$28,000"],
            ["Total capital outlay", "$923,540", "$970,100", "$870,800"],
            ["Deposit at 20%", "$173,000", "$183,000", "$159,000"],
            ["Cash required", "$212,400", "$226,800", "$194,600"],
            ["Annual rental income", "$39,780", "$37,960", "$36,400"],
            ["Annual holding cost, after tax", "$4,368", "$9,204", "$6,240"],
        ], ["{{item}}", "{{a}}", "{{b}}", "{{c}}"], count=6),
        widths=[64, 40, 40, 40], numeric_cols={1, 2, 3},
        emphasis_rows={3, 5}, caption="Financial comparison",
        note="Assumes 80% LVR at 6.40% interest only, and a 39% marginal tax rate.")
    C.gap(doc, theme)
    C.map_frame(doc, theme, title="All three properties", height_mm=62,
                alt_text="Map showing all three shortlisted properties relative to "
                         "transport and the CBD",
                legend=[("①", "12 Example St"), ("②", "48 Sample Ave"),
                        ("③", "9 Test Rd"), ("▲", "Rail")])
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Pursue 12 Example Street. Hold 48 Sample Avenue as a fallback "
                         "and set 9 Test Road aside."),
        rationale=f.text("report.rationale", [
            "12 Example Street is the only option that satisfies every stated requirement "
            "in your brief, and it does so at the lowest after-tax holding cost of the "
            "three. Its one material defect is quantified and negotiable. 48 Sample "
            "Avenue is the better-presented property but fails on land size and yield, "
            "both of which you weighted at 20%. 9 Test Road is cheapest to buy and the "
            "most expensive to hold.",
        ]),
        actions=f.items("report.nextSteps", [
            "Authorise an offer on 12 Example Street.",
            "Register interest in 48 Sample Avenue without offering.",
            "Withdraw from 9 Test Road.",
        ]),
        confidence=f("report.confidence", "High"))
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Suburb Analysis Report — Property Visual
# ==========================================================================

def suburb_analysis_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Location research",
        title=f("suburb.name", "Northbridge, NSW 2063"),
        subtitle=f("report.subtitle",
                   "Demographics, supply, demand, price and rent history, infrastructure "
                   "and outlook — and whether the location supports your strategy."),
        chips=["10-YEAR DATA", "AS AT 30/06/26"],
        image_caption=f("suburb.coverCaption", "Typical streetscape, Northbridge"))
    page_break(doc)

    C.section_opener(doc, theme, "01", "Snapshot", "Where the market sits today")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("MEDIAN — HOUSE", f("suburb.medianHouse", "$1,842,000"), "12 months to Jun 26"),
        ("12-MONTH GROWTH", f("suburb.growth12", "+4.8%"), "Houses"),
        ("GROSS YIELD", f("suburb.yield", "2.9%"), "Houses"),
        ("VACANCY", f("suburb.vacancy", "1.1%"), "Below the 2.5% balance point"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Executive summary", "The location thesis")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "A supply-constrained, owner-occupier-dominated suburb with strong "
                   "ten-year growth and a yield too low for a cash-flow strategy."),
        paragraphs=f.text("report.summary", [
            "Northbridge has recorded 6.1% compound annual growth over ten years against "
            "a metropolitan average of 5.4%. The outperformance is explained almost "
            "entirely by supply: the suburb is fully built out, holds a 550m² minimum lot "
            "size, and has averaged 41 house sales a year against a stock of roughly "
            "2,100 dwellings — a turnover rate of under 2%.",
            "The same constraint produces the weakness. Gross yield of 2.9% is well below "
            "the 4.2% threshold in your brief, and vacancy at 1.1% reflects an "
            "owner-occupier market rather than a deep rental one. Seventy-one per cent of "
            "dwellings are owner-occupied.",
            "The suburb suits a growth-weighted, long-hold strategy funded from other "
            "income. It does not suit a portfolio that needs each asset to carry itself.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Ten-year growth of 6.1% p.a. against a 5.4% metropolitan average.",
            "Yield of 2.9% is below your 4.2% threshold — this is a growth play.",
            "Turnover under 2% of stock per year; expect to wait for the right property.",
            "No material new supply is possible under the current planning controls.",
        ]))
    page_break(doc)

    C.section_opener(doc, theme, "03", "Market performance", "Ten years of price and rent")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Median price and median rent, 10 years",
                  kind="dual-axis line chart", binding="{{suburb.priceHistory}}",
                  height_mm=56, caption="Houses only; medians are 12-month rolling",
                  source=f("suburb.source", "Valuer-general and rental bond data"),
                  alt_text="Median price rose from $1.02m to $1.84m over ten years while "
                           "median rent rose from $760 to $1,020 per week")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Period", "Median price", "Change", "Median rent", "Yield", "Sales"],
        f.rows("suburb.performance", [
            ["FY2022", "$1,612,000", "+12.4%", "$880", "2.8%", "58"],
            ["FY2023", "$1,548,000", "−4.0%", "$920", "3.1%", "44"],
            ["FY2024", "$1,671,000", "+7.9%", "$960", "3.0%", "39"],
            ["FY2025", "$1,758,000", "+5.2%", "$990", "2.9%", "36"],
            ["FY2026", "$1,842,000", "+4.8%", "$1,020", "2.9%", "41"],
        ], ["{{period}}", "{{median}}", "{{change}}", "{{rent}}", "{{yield}}",
            "{{sales}}"], count=5),
        widths=[30, 36, 26, 30, 24, 22], numeric_cols={1, 2, 3, 4, 5},
        caption="Five-year detail",
        note="Medians on fewer than 40 sales a year move on composition as much as on "
             "value; read the trend, not any single year.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Supply & demand", "What is available and who wants it")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Listings, days on market and absorption",
                  kind="combination chart", binding="{{suburb.supplyDemand}}",
                  height_mm=52, caption="Rolling three-month", source="Listing data",
                  alt_text="Listing volumes fell 31% over three years while days on "
                           "market fell from 42 to 26")
    C.gap(doc, theme, 0.6)
    C.bar_chart(doc, theme, caption="Days on market by year",
                rows=f.tuples("suburb.dom", [
                    ("FY2022", 42, "42 days"), ("FY2023", 51, "51 days"),
                    ("FY2024", 34, "34 days"), ("FY2025", 29, "29 days"),
                    ("FY2026", 26, "26 days"),
                ], ("{{period}}", 30, "{{days}}"), count=5),
                note="Shorter days on market with falling listing volume indicates demand "
                     "outstripping supply rather than improving marketing.")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Demographics", "Who lives here")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Measure", "Suburb", "Greater metro", "Read"],
        f.rows("suburb.demographics", [
            ["Population", "5,940", "—", "Stable; +1.2% over five years"],
            ["Median age", "42", "37", "Established households"],
            ["Median household income", "$3,410/wk", "$2,180/wk", "High income base"],
            ["Owner-occupied", "71%", "58%", "Shallow rental market"],
            ["Rented", "24%", "36%", "Limited tenant pool"],
            ["Family households", "78%", "66%", "Schools drive demand"],
            ["Dwellings — separate house", "84%", "56%", "Little unit stock"],
        ], ["{{measure}}", "{{suburb}}", "{{metro}}", "{{read}}"], count=6),
        widths=[52, 30, 34, 62], numeric_cols={1, 2}, caption="Demographic profile")
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("suburb.infrastructure", [
        ("2027", "Primary school hall and library", "Committed; $14m, funded"),
        ("2028", "Arterial road upgrade", "Committed; adds a lane each way"),
        ("2029", "Retail precinct redevelopment", "Proposed; DA not lodged"),
    ], ("{{when}}", "{{what}}", "{{detail}}"), count=3),
        caption="Infrastructure & amenity — committed and proposed")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Location map", "The catchment")
    C.gap(doc, theme)
    C.map_frame(doc, theme, title="Suburb and catchment", height_mm=68,
                alt_text="Map showing the suburb boundary, rail, schools and the "
                         "employment centre",
                legend=[("▬", "Suburb boundary"), ("▲", "Rail"), ("■", "Schools"),
                        ("◆", "Retail"), ("●", "Employment")])
    C.gap(doc, theme, 0.7)
    C.comparison_table(
        doc, theme, subject_labels=["Northbridge", "Willoughby", "Naremburn"],
        attributes=[
            ("Median — house", ["$1,842,000", "$2,410,000", "$2,180,000"]),
            ("10-year growth p.a.", ["6.1%", "5.6%", "5.9%"]),
            ("Gross yield", ["2.9%", "2.6%", "2.7%"]),
            ("Vacancy", ["1.1%", "1.4%", "1.2%"]),
            ("Owner-occupied", ["71%", "64%", "61%"]),
            ("Annual sales", ["41", "96", "72"]),
        ],
        caption="Comparable suburbs", winner_index=0)
    page_break(doc)

    C.section_opener(doc, theme, "07", "Outlook & risks", "What could change the thesis")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Outlook & risks", risks=f.tuples("risks", [
        ("Yield compression continues as prices outrun rents", "Medium",
         "Already at 2.9%. A growth-weighted strategy tolerates this; a cash-flow "
         "strategy does not, and should look elsewhere."),
        ("Turnover under 2% means long search times", "Medium",
         "Budget six to twelve months. A retained search materially improves access to "
         "pre-market stock in a suburb this tightly held."),
        ("Planning controls are relaxed, adding supply", "Low",
         "The 550m² minimum lot size has been unchanged for eleven years and the council "
         "has no draft amendment on exhibition. Monitor annually."),
        ("Interest rates stay higher for longer", "Medium",
         "A 2.9% yield is highly sensitive to holding cost. Stress-test at +2% before "
         "committing."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Conclusion", "Invest, monitor or avoid")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Conclusion",
        recommendation=f("report.conclusion",
                         "Invest — but only within a growth-weighted, long-hold strategy "
                         "that does not require the asset to carry itself."),
        rationale=f.text("report.conclusionRationale", [
            "The supply constraint that produces the growth record is structural and "
            "unlikely to change under the current planning controls. That is a durable "
            "advantage. The corresponding yield of 2.9% is equally structural, and no "
            "amount of property selection within the suburb will fix it.",
        ]),
        actions=f.items("report.conclusionActions", [
            "Confirm you can fund a 2.9%-yield asset from other income.",
            "Stress-test the holding position at +2% on rates before proceeding.",
            "Expect a six-to-twelve-month search; consider a retained mandate.",
        ]),
        confidence=f("report.confidence", "High"))
    C.appendix_opener(doc, theme, "A", "Data sources",
                      "Every figure in this report and where it came from.")
    C.gap(doc, theme, 0.6)
    C.data_table(doc, theme, ["Data", "Source", "As at"],
                 f.rows("appendix.sources", [
                     ["Median prices and sales volume", "State valuer-general", "30/06/2026"],
                     ["Median rents and vacancy", "Rental bond authority", "30/06/2026"],
                     ["Demographics", "National census and estimates", "2021, updated 2025"],
                     ["Listings and days on market", "Aurixa market data", "30/06/2026"],
                     ["Infrastructure", "Local council capital works plan", "May 2026"],
                 ], ["{{data}}", "{{source}}", "{{asAt}}"], count=5),
                 widths=[62, 78, 38])
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Market & Area Research Report — Modern Technology
# ==========================================================================

def market_area_research_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text=f("edition.period", "Quarterly edition — Q2 FY2026"),
        title=f("edition.title", "Market & Area Research"),
        subtitle=f("edition.subtitle",
                   "Conditions across four regions, the indicators that moved, and what "
                   "we expect over the next two quarters."),
        chips=["4 REGIONS", "QUARTERLY", "AS AT 30/06/26"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("", "In this edition"), ("", "National / state overview"),
        ("", "Key indicators"), ("1", "Region profiles"),
        ("2", "Comparative table"), ("3", "Outlook"), ("A", "Methodology"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "In this edition", "Five findings")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="In this edition", text="",
        items=f.items("edition.findings", [
            "Listing volumes fell in all four regions for a third consecutive quarter.",
            "Rental growth slowed to 2.1% from 4.8% a year earlier.",
            "The inner-ring / outer-ring price gap narrowed for the first time since 2021.",
            "Vacancy remains below 1.5% in three of the four regions.",
            "Days on market fell in every region despite flat auction clearance.",
        ], count=5))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "", "National / state overview", "The macro position")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="Overview",
        headline=f("edition.headline",
                   "Supply, not demand, is now the binding constraint in every region we "
                   "cover."),
        paragraphs=f.text("edition.overview", [
            "Listing volumes across the four regions fell 14% year on year, the third "
            "consecutive quarterly decline. Days on market fell in every region despite "
            "auction clearance rates being broadly flat, which is the signature of a "
            "market where buyers are competing over less stock rather than bidding more "
            "aggressively for the same stock.",
            "Rental growth decelerated sharply — 2.1% for the quarter against 4.8% in the "
            "corresponding quarter last year — while vacancy stayed below 1.5% in three "
            "of four regions. That combination suggests rents have reached an "
            "affordability ceiling rather than that supply has improved.",
        ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "", "Key indicators", "Across all four regions")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("MEDIAN GROWTH", f("edition.growth", "+3.2%"), "12 months, weighted"),
        ("RENTAL GROWTH", f("edition.rentGrowth", "+2.1%"), "Down from 4.8%"),
        ("VACANCY", f("edition.vacancy", "1.4%"), "Weighted average"),
        ("LISTINGS", f("edition.listings", "−14%"), "Year on year"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "1", "Region profiles", "One block per region")
    C.gap(doc, theme)
    for index, (name, fields, commentary) in enumerate(f.tuples("regions", [
        ("Lower North Shore",
         [("Median — house", "$2,180,000"), ("12-month growth", "+4.1%"),
          ("Median rent", "$1,090/wk"), ("Gross yield", "2.6%"),
          ("Vacancy", "1.1%"), ("Days on market", "24")],
         "Tightest market of the four. Listing volumes fell 19% and days on market fell "
         "to 24. Yield compression continued; this region is now a growth-only "
         "proposition for all but the highest-income buyers."),
        ("Inner West",
         [("Median — house", "$1,742,000"), ("12-month growth", "+3.4%"),
          ("Median rent", "$980/wk"), ("Gross yield", "2.9%"),
          ("Vacancy", "1.3%"), ("Days on market", "27")],
         "The narrowing of the inner-ring / outer-ring gap is most visible here. Growth "
         "moderated while outer regions accelerated, which we read as an affordability "
         "constraint rather than a loss of appeal."),
        ("Northern Beaches",
         [("Median — house", "$2,410,000"), ("12-month growth", "+2.2%"),
          ("Median rent", "$1,150/wk"), ("Gross yield", "2.5%"),
          ("Vacancy", "1.6%"), ("Days on market", "34")],
         "The weakest of the four on both growth and days on market, and the only region "
         "where vacancy rose. Transport constraints continue to cap demand from buyers "
         "who commute daily."),
        ("Western Corridor",
         [("Median — house", "$1,048,000"), ("12-month growth", "+5.8%"),
          ("Median rent", "$720/wk"), ("Gross yield", "3.6%"),
          ("Vacancy", "1.4%"), ("Days on market", "31")],
         "Strongest growth and the only region with a yield above 3%. Infrastructure "
         "delivery is the driver and also the risk: two of the three committed projects "
         "have slipped by more than a year."),
    ], ("{{region.name}}", [("Median — house", "{{region.median}}")],
        "{{region.commentary}}"), count=4)):
        C.subsection(doc, theme, name, before=0 if index == 0 else 11)
        C.info_card(doc, theme, title=name, fields=list(fields), columns=3)
        C.gap(doc, theme, 0.4)
        C.prose(doc, theme, [commentary], size=theme.type_scale.body_sm)
        if index == 1:
            page_break(doc)
    page_break(doc)

    C.section_opener(doc, theme, "2", "Comparative table", "All regions, common indicators")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Region", "Median", "12-mth", "Rent", "Yield", "Vacancy", "DOM", "Listings"],
        f.rows("regions.indicators", [
            ["Lower North Shore", "$2,180,000", "+4.1%", "$1,090", "2.6%", "1.1%", "24",
             "−19%"],
            ["Inner West", "$1,742,000", "+3.4%", "$980", "2.9%", "1.3%", "27", "−12%"],
            ["Northern Beaches", "$2,410,000", "+2.2%", "$1,150", "2.5%", "1.6%", "34",
             "−9%"],
            ["Western Corridor", "$1,048,000", "+5.8%", "$720", "3.6%", "1.4%", "31",
             "−16%"],
        ], ["{{name}}", "{{median}}", "{{growth}}", "{{rent}}", "{{yield}}",
            "{{vacancy}}", "{{dom}}", "{{listings}}"], count=4),
        widths=[46, 34, 24, 24, 22, 24, 18, 24],
        numeric_cols={1, 2, 3, 4, 5, 6, 7},
        caption="All regions at a glance",
        note="DOM is median days on market. Listings is the change in new listing volume "
             "against the corresponding quarter last year.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "3", "Outlook", "Two quarters ahead")
    C.gap(doc, theme)
    C.prose(doc, theme, f.text("edition.outlook", [
        "We expect listing volumes to stay below the five-year average through the next "
        "two quarters. The usual spring lift will occur but from a lower base, and we do "
        "not expect it to relieve the supply constraint in the three inner regions.",
        "Rental growth should continue to decelerate. Vacancy below 1.5% would normally "
        "signal further rent rises, but the deceleration from 4.8% to 2.1% over four "
        "quarters, against unchanged vacancy, points to an affordability ceiling. We "
        "expect rents to track wages rather than vacancy from here.",
        "The Western Corridor is the region most likely to surprise, in either direction. "
        "Its growth advantage rests on infrastructure delivery, and two of three "
        "committed projects have already slipped more than a year.",
    ]))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="What would change this view",
        text="A material change in credit policy, or a movement in the cash rate of more "
             "than 50 basis points in either direction, would invalidate the outlook "
             "above. We would publish an interim note rather than wait for the next "
             "quarterly edition.")
    C.appendix_opener(doc, theme, "A", "Methodology",
                      "Definitions, sources and as-at dates for every indicator.")
    C.gap(doc, theme, 0.6)
    C.data_table(doc, theme, ["Indicator", "Definition", "Source", "As at"],
                 f.rows("appendix.methodology", [
                     ["Median price", "12-month rolling median, houses only",
                      "State valuer-general", "30/06/2026"],
                     ["Median rent", "New bonds lodged, all dwelling types",
                      "Rental bond authority", "30/06/2026"],
                     ["Gross yield", "Annualised median rent over median price",
                      "Derived", "30/06/2026"],
                     ["Vacancy", "Vacant rental stock over total rental stock",
                      "Aurixa market data", "30/06/2026"],
                     ["Days on market", "Median days from first listing to exchange",
                      "Aurixa market data", "30/06/2026"],
                 ], ["{{indicator}}", "{{definition}}", "{{source}}", "{{asAt}}"], count=5),
                 widths=[38, 68, 44, 28])
    C.disclaimer_page(doc, theme)
    C.back_cover(doc, theme)


# ==========================================================================
# House & Land Package Assessment — Property Visual
# ==========================================================================

def house_and_land_assessment(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Turnkey package assessment",
        title=f("report.title", "House & Land Package Assessment"),
        subtitle=f("package.identity",
                   "Lot 148, Riverbend Estate — land, build contract, inclusions, staged "
                   "payments and the completed-value position."),
        chips=["ASSESSED", "CONTRACT REVIEWED"],
        image_caption=f("package.coverCaption", "Builder render — Facade B"))
    page_break(doc)

    C.section_opener(doc, theme, "01", "Summary & verdict", "Does the package stack up")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "The package is priced $41,000 above comparable completed stock and "
                   "should be renegotiated before contract."),
        paragraphs=f.text("report.summary", [
            "The land and build together total $784,500. Three comparable completed "
            "dwellings of similar size in the same estate have sold between $726,000 and "
            "$752,000 in the last six months, which puts the package roughly 5.5% above "
            "the completed market.",
            "The gap is concentrated in the upgrade schedule. $38,400 of upgrades has "
            "been added to a base contract of $412,000, and only about half of that "
            "spend is recoverable in a valuation.",
            "Registration is the other exposure. The lot is not registered and the "
            "estimated registration date has already moved twice. A build cannot start "
            "before registration, and the fixed-price period on the build contract runs "
            "for only 180 days.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Package is $41,000 above comparable completed stock.",
            "$38,400 of upgrades; approximately half is recoverable at valuation.",
            "Lot registration has slipped twice; the build price is fixed for 180 days only.",
            "Recommend renegotiating the upgrade schedule before signing.",
        ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Package metrics", "The headline numbers")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("LAND", f("package.landPrice", "$334,100"), "Lot 148, 448 m²"),
        ("BUILD", f("package.buildPrice", "$450,400"), "Incl. upgrades"),
        ("TOTAL", f("package.total", "$784,500"), "Excl. acquisition costs"),
        ("COMPLETED VALUE", f("package.completedValue", "$743,000"), "Est. — comparables"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "03", "Land", "The lot")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Lot particulars", columns=2, fields=[
        ("Lot and estate", f("land.lot", "Lot 148, Riverbend Estate, Stage 6")),
        ("Land area", f("land.area", "448 m²")),
        ("Frontage", f("land.frontage", "12.5 m")),
        ("Orientation", f("land.orientation", "Rear north-east")),
        ("Registration status", f("land.registration", "Unregistered")),
        ("Estimated registration", f("land.regDate", "Q2 2027 — revised twice")),
        ("Fall across the lot", f("land.fall", "1.4 m — site costs allowed")),
        ("Covenants", f("land.covenants", "Design covenant; facade approval required")),
        ("Easements", f("land.easements", "Drainage easement, 1.0 m rear")),
        ("Land price", f("land.price", "$334,100")),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Build contract", "What is being contracted")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Element", "Position", "Assessment"],
        f.rows("build.contract", [
            ["Contract type", "Fixed price, HIA new homes", "Standard; no amendments sought"],
            ["Base contract", "$412,000", "Market rate for the floor plan"],
            ["Upgrades", "$38,400", "Approximately half recoverable at valuation"],
            ["Fixed-price period", "180 days from signing",
             "Expires before the estimated registration date"],
            ["Build period", "44 weeks from slab", "Standard for the builder"],
            ["Liquidated damages", "$180 per week", "Below the market rent forgone of $520"],
            ["Provisional sums", "$14,200 — site costs",
             "Not fixed; exposure if the fall is worse than surveyed"],
            ["Prime cost items", "$9,600 — fixtures", "Allowances are below the display level"],
        ], ["{{element}}", "{{position}}", "{{assessment}}"], count=6),
        widths=[46, 56, 76], caption="Contract terms",
        note="Provisional sums and prime cost items are estimates, not fixed prices. "
             "Together they represent $23,800 of open exposure.")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Inclusions & upgrades", "Line by line")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Category", "Included", "Upgrade cost", "Recoverable"],
        f.rows("build.inclusions", [
            ["Ducted air conditioning", "Comfort", "No", "$9,800", "High"],
            ["Stone benchtops throughout", "Kitchen", "40mm base", "$6,200", "High"],
            ["Upgraded appliance package", "Kitchen", "Base package", "$4,400", "Medium"],
            ["Floor tiles to living areas", "Flooring", "Carpet base", "$5,600", "Medium"],
            ["Landscaping and driveway", "External", "No", "$7,200", "High"],
            ["Fencing", "External", "No", "$3,400", "High"],
            ["Facade upgrade — Facade B", "External", "Facade A", "$1,800", "Low"],
        ], ["{{item}}", "{{category}}", "{{included}}", "{{cost}}", "{{recoverable}}"],
            count=6),
        widths=[62, 34, 32, 30, 30], numeric_cols={3},
        total_row=["Total upgrades", "", "", "$38,400", ""],
        caption="Upgrade schedule",
        note="'Recoverable' is our assessment of how much of each upgrade a valuer would "
             "reflect in the completed value. Landscaping, fencing and air conditioning "
             "recover well; facade and appliance upgrades generally do not.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Payment schedule", "Staged against build progress")
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("build.stages", [
        ("On signing", "Deposit — 5%", "$22,520 · cumulative $22,520"),
        ("Slab", "Base stage — 15%", "$67,560 · cumulative $90,080"),
        ("Frame", "Frame stage — 20%", "$90,080 · cumulative $180,160"),
        ("Lock-up", "Lock-up stage — 25%", "$112,600 · cumulative $292,760"),
        ("Fixing", "Fixing stage — 20%", "$90,080 · cumulative $382,840"),
        ("Completion", "Final — 15%", "$67,560 · cumulative $450,400"),
    ], ("{{stage.trigger}}", "{{stage.name}}", "{{stage.amount}}"), count=6),
        caption="Progress payment schedule")
    page_break(doc)

    C.section_opener(doc, theme, "07", "Completed value", "Against comparable stock")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["This package", "14 Riverbend Dr", "27 Willow Way", "8 Elm Court"],
        attributes=[
            ("Status", ["To be built", "Sold Jun 2026", "Sold Apr 2026", "Sold Feb 2026"]),
            ("Land", ["448 m²", "462 m²", "441 m²", "455 m²"]),
            ("Building", ["198 m²", "204 m²", "191 m²", "202 m²"]),
            ("Accommodation", ["4 · 2 · 2", "4 · 2 · 2", "4 · 2 · 2", "4 · 2 · 2"]),
            ("Price", ["$784,500", "$752,000", "$726,000", "$741,000"]),
            ("Landscaped", ["Included", "Yes", "Yes", "Yes"]),
            ("Age at sale", ["New", "2 years", "1 year", "3 years"]),
        ],
        caption="Package against comparable completed stock", winner_index=None)
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Basis", "Value", "Method"],
        f.rows("valuation.basis", [
            ["Comparable median", "$741,000", "Median of three comparable sales"],
            ["Adjusted for building area", "$743,000", "Adjusted to 198 m²"],
            ["Package price", "$784,500", "Land plus build plus upgrades"],
            ["Variance", "−$41,500", "Package above adjusted comparable value"],
        ], ["{{basis}}", "{{value}}", "{{method}}"], count=4),
        widths=[56, 34, 88], numeric_cols={1}, emphasis_rows={3},
        caption="Completed-value assessment")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Risks & mitigations", "What could go wrong")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Risks & mitigations", risks=f.tuples("risks", [
        ("Registration slips again and the fixed-price period expires", "High",
         "Negotiate a fixed-price period tied to registration rather than to signing, or "
         "a price-rise cap of CPI."),
        ("Valuation at completion comes in below the package price", "High",
         "A $41,500 shortfall would require additional cash at settlement. Obtain an "
         "'as if complete' valuation before signing."),
        ("Provisional sums and prime cost items exceed allowances", "Medium",
         "$23,800 of open exposure. Request a fixed site-cost quote after a full "
         "geotechnical report."),
        ("Build overruns and liquidated damages under-compensate", "Medium",
         "LDs are $180/week against $520/week of rent forgone. Seek an increase or "
         "budget the difference."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "09", "Recommendation", "Proceed, renegotiate or decline")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Renegotiate before signing. Remove or reprice the low-recovery "
                         "upgrades, tie the fixed-price period to registration, and "
                         "obtain an 'as if complete' valuation."),
        rationale=f.text("report.rationale", [
            "The package is sound in structure and the builder is reputable. The problem "
            "is price, and it is concentrated in a $38,400 upgrade schedule that a "
            "valuer will only partly recognise. Removing the facade and appliance "
            "upgrades alone closes roughly $6,200 of the gap at no practical cost to the "
            "finished dwelling.",
        ]),
        actions=f.items("report.nextSteps", [
            "Remove the facade upgrade and revert the appliance package to base.",
            "Request a fixed-price period tied to registration, not to signing.",
            "Obtain an 'as if complete' valuation before the cooling-off period expires.",
            "Request a fixed site-cost quote following a geotechnical report.",
        ]),
        confidence=f("report.confidence", "High"))
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Commercial Property Assessment — Executive Corporate
# ==========================================================================

def commercial_property_assessment(doc, theme: Theme, f: Fill) -> None:
    title = "Commercial Property Assessment"
    C.cover(
        doc, theme,
        eyebrow_text="Income asset assessment",
        title=f("report.title", title),
        subtitle=f("asset.identity",
                   "42–48 Industrial Drive, Wetherill Park — a multi-tenanted industrial "
                   "asset assessed on income durability, covenant and capitalisation."),
        chips=["INDUSTRIAL", "MULTI-TENANTED", "WALE 4.1 YRS"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Executive summary"), ("02", "Investment metrics"),
        ("03", "Asset overview"), ("04", "Tenancy schedule"),
        ("05", "Lease expiry profile"), ("06", "Income & outgoings"),
        ("07", "Capitalisation analysis"), ("08", "Risks & mitigations"),
        ("09", "Recommendation"), ("A", "Lease abstracts"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "The income thesis")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "A durable industrial income stream at a fair price, with a single "
                   "concentration risk that should be priced in rather than ignored."),
        paragraphs=f.text("report.summary", [
            "The asset comprises four tenancies over 4,820m² of building area on a "
            "9,140m² site in an established industrial precinct. Passing net income is "
            "$742,000 against an asking price of $10.6m, a passing yield of 7.0%.",
            "Income durability is good. Weighted average lease expiry is 4.1 years, all "
            "four leases carry fixed 3.5% annual reviews, and the precinct's vacancy rate "
            "has been below 2% for eleven consecutive quarters.",
            "The concentration is the issue. Tenancy 1 represents 47% of income and its "
            "lease expires in 2.3 years with a single three-year option. If that option "
            "is not exercised the asset re-rates materially, and the price should reflect "
            "that risk rather than assume it away.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Passing yield of 7.0% on $742,000 net income.",
            "WALE of 4.1 years with fixed 3.5% reviews across all four leases.",
            "Tenancy 1 is 47% of income and expires in 2.3 years.",
            "Recommended maximum is $10.2m, a 7.3% passing yield.",
        ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Investment metrics", "Headline position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("PASSING YIELD", f("metrics.passingYield", "7.00%"), "On asking price"),
        ("NET INCOME", f("metrics.netIncome", "$742,000"), "Passing, per annum"),
        ("WALE", f("metrics.wale", "4.1 yrs"), "By income"),
        ("RATE PER m²", f("metrics.ratePerSqm", "$2,199"), "Building area"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "03", "Asset overview", "The physical asset")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Asset particulars", columns=2, fields=[
        ("Address", f("asset.address", "42–48 Industrial Drive, Wetherill Park NSW")),
        ("Title", f("asset.title", "Freehold, single title")),
        ("Site area", f("asset.siteArea", "9,140 m²")),
        ("Building area", f("asset.buildingArea", "4,820 m²")),
        ("Site cover", f("asset.siteCover", "52.7%")),
        ("Zoning", f("asset.zoning", "E4 General Industrial")),
        ("Construction", f("asset.construction", "Concrete tilt panel, metal deck roof")),
        ("Year built", f("asset.yearBuilt", "2008; office fit-out refurbished 2021")),
        ("Clearance", f("asset.clearance", "8.2 m to underside of portal")),
        ("Loading", f("asset.loading", "6 recessed docks, 2 on-grade")),
        ("Power", f("asset.power", "800 amp three phase")),
        ("Car parking", f("asset.parking", "62 spaces at grade")),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Tenancy schedule", "Who pays, how much, until when")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Tenancy", "Tenant", "Area m²", "Commenced", "Expires", "Net rent p.a.",
         "$/m²", "Review", "Options"],
        f.rows("tenancies", [
            ["1", "Logistics operator", "2,240", "Nov 2021", "Nov 2028", "$348,700",
             "$156", "3.5% fixed", "1 × 3 yrs"],
            ["2", "Food manufacturer", "1,180", "Mar 2023", "Mar 2031", "$194,700",
             "$165", "3.5% fixed", "1 × 5 yrs"],
            ["3", "Trade supplier", "820", "Jul 2024", "Jul 2029", "$133,250",
             "$163", "3.5% fixed", "2 × 3 yrs"],
            ["4", "Light assembly", "580", "Jan 2025", "Jan 2030", "$92,800",
             "$160", "3.5% fixed", "1 × 3 yrs"],
        ], ["{{ref}}", "{{tenant}}", "{{area}}", "{{commenced}}", "{{expires}}",
            "{{rent}}", "{{rate}}", "{{review}}", "{{options}}"], count=4),
        widths=[20, 46, 24, 28, 26, 34, 22, 30, 28],
        numeric_cols={2, 5, 6},
        total_row=["", "Total / weighted", "4,820", "", "", "$769,450", "$160", "", ""],
        caption="Tenancy schedule",
        note="Rents are net of outgoings, which are fully recoverable under all four "
             "leases. Passing net income after a 3.5% structural vacancy allowance is "
             "$742,000.")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Lease expiry profile", "When income is at risk")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Income expiring by financial year",
                  kind="column chart", binding="{{tenancies.expiryProfile}}",
                  height_mm=52, caption="Percentage of passing income",
                  source="Lease schedule",
                  alt_text="47% of income expires in FY2029, with the remainder spread "
                           "across FY2030 to FY2032")
    C.gap(doc, theme, 0.6)
    C.bar_chart(doc, theme, caption="Income expiring by year, before options",
                rows=f.tuples("tenancies.expiry", [
                    ("FY2029", 47, "47% — $348,700"),
                    ("FY2030", 12, "12% — $92,800"),
                    ("FY2031", 18, "18% — $133,250"),
                    ("FY2032", 26, "26% — $194,700"),
                ], ("{{year}}", 25, "{{share}}"), count=4),
                maximum=50,
                note="If every option is exercised the FY2029 exposure moves to FY2032 "
                     "and WALE extends to 6.4 years. Options are the tenant's to exercise, "
                     "not the landlord's.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Income & outgoings", "Net income reconciliation")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Amount p.a.", "Recoverable", "Net effect"],
        f.rows("financials.income", [
            ["Gross passing rent", "$769,450", "—", "$769,450"],
            ["Structural vacancy allowance (3.5%)", "-$26,931", "No", "-$26,931"],
            ["Council rates", "-$41,200", "Yes", "$0"],
            ["Land tax", "-$68,400", "Yes", "$0"],
            ["Water and sewer", "-$9,800", "Yes", "$0"],
            ["Insurance", "-$18,600", "Yes", "$0"],
            ["Repairs and maintenance", "-$22,000", "Partial", "-$8,800"],
            ["Management fee", "-$23,084", "No", "-$23,084"],
        ], ["{{item}}", "{{amount}}", "{{recoverable}}", "{{net}}"], count=6),
        widths=[74, 34, 30, 40], numeric_cols={1, 3},
        total_row=["Net passing income", "", "", "$742,000"],
        caption="Income and outgoings",
        note="Outgoings are fully recoverable under all four leases except for capital "
             "and structural repairs, which are the landlord's.")
    page_break(doc)

    C.section_opener(doc, theme, "07", "Capitalisation analysis", "What it is worth")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Capitalisation rate", "Implied value", "$/m²", "Comment"],
        f.rows("valuation.scenarios", [
            ["6.50%", "$11,415,000", "$2,368", "Below precinct evidence"],
            ["6.75%", "$10,993,000", "$2,281", "Precinct evidence, long WALE"],
            ["7.00%", "$10,600,000", "$2,199", "Asking price"],
            ["7.25%", "$10,234,000", "$2,123", "Recommended maximum"],
            ["7.50%", "$9,893,000", "$2,052", "If Tenancy 1 does not renew"],
        ], ["{{rate}}", "{{value}}", "{{rate_sqm}}", "{{comment}}"], count=5),
        widths=[42, 40, 28, 68], numeric_cols={1, 2}, emphasis_rows={3},
        caption="Value at a range of capitalisation rates",
        note="Precinct evidence over the last twelve months ranges from 6.60% to 7.40%, "
             "with the tighter rates on assets with longer WALE and stronger covenants.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Risks & mitigations", "Income at risk")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Risks & mitigations", risks=f.tuples("risks", [
        ("Tenancy 1 is 47% of income and expires in 2.3 years", "High",
         "Price at 7.25% rather than 7.00% to reflect the concentration. Begin renewal "
         "discussions at least twelve months before expiry."),
        ("Covenant strength is not investment grade on any tenancy", "Medium",
         "Obtain three years of financial statements and a bank guarantee of no less "
         "than six months' rent for each tenancy."),
        ("Capital expenditure — roof and hardstand", "Medium",
         "Roof is at 18 years against a 25-year life. Budget $340,000 within five years "
         "and reflect it in the price."),
        ("Precinct capitalisation rates soften", "Medium",
         "A 50 basis point softening reduces value by approximately $710,000. Long WALE "
         "and fixed reviews provide partial protection."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "09", "Recommendation", "Acquire, condition or decline")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Acquire at or below $10,200,000 — a 7.25% passing yield — "
                         "subject to satisfactory tenant financials and bank guarantees."),
        rationale=f.text("report.rationale", [
            "The asset's fundamentals are sound: a tight precinct, fully recoverable "
            "outgoings, fixed reviews and a building specification that suits the current "
            "and likely future tenant profile. The 25 basis point discount to the asking "
            "price is not a negotiation posture; it is the price of a 47% income "
            "concentration expiring inside three years.",
        ]),
        actions=f.items("report.nextSteps", [
            "Request three years of financial statements for each tenancy.",
            "Require bank guarantees of six months' rent as a condition.",
            "Commission a roof and hardstand condition report.",
            "Issue an offer at $10,200,000 subject to the above.",
        ]),
        confidence=f("report.confidence", "High"))
    C.appendix_opener(doc, theme, "A", "Lease abstracts",
                      "One abstract per tenancy, with the terms that drive value.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Ref", "Term", "Tenancy 1", "Tenancy 2", "Tenancy 3", "Tenancy 4"],
        f.rows("appendix.leases", [
            ["A.1", "Outgoings", "Full net", "Full net", "Full net", "Full net"],
            ["A.2", "Review basis", "3.5% fixed", "3.5% fixed", "3.5% fixed", "3.5% fixed"],
            ["A.3", "Market review", "At option", "At option", "At option", "At option"],
            ["A.4", "Bank guarantee", "3 months", "6 months", "3 months", "None"],
            ["A.5", "Make good", "Full", "Full", "Full", "Partial"],
            ["A.6", "Assignment", "Consent", "Consent", "Consent", "Consent"],
        ], ["{{ref}}", "{{term}}", "{{t1}}", "{{t2}}", "{{t3}}", "{{t4}}"], count=6),
        widths=[16, 46, 32, 32, 32, 32])
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Development Feasibility Report — Financial Analytical
# ==========================================================================

def development_feasibility_report(doc, theme: Theme, f: Fill) -> None:
    title = "Development Feasibility Report"
    C.cover(
        doc, theme,
        eyebrow_text="Residual land value & profitability",
        title=f("report.title", title),
        subtitle=f("project.identity",
                   "18–22 Sample Road, Marrickville — a 24-apartment scheme tested for "
                   "profitability, funding and sensitivity."),
        chips=["24 UNITS", "RESIDUAL LV", "STRESS-TESTED"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Executive summary"), ("02", "Feasibility metrics"),
        ("03", "Assumptions"), ("04", "Scheme & yield"), ("05", "Revenue"),
        ("06", "Costs"), ("07", "Funding & cash flow"), ("08", "Programme"),
        ("09", "Sensitivity analysis"), ("10", "Risks & mitigations"),
        ("11", "Conclusion"), ("A", "Full model"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "Does the scheme work")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "The scheme returns 17.4% on cost at a land price of $4.2m — above "
                   "hurdle, but only 2.4 points above, and the margin is thin to "
                   "construction cost."),
        paragraphs=f.text("report.summary", [
            "On the assumptions in section three, a 24-apartment scheme produces a gross "
            "realisation of $22.8m against a total development cost of $19.4m, a "
            "development profit of $3.38m and a margin on cost of 17.4%. The residual "
            "land value at a 20% hurdle is $3.72m against an asking price of $4.2m.",
            "The scheme therefore works at the hurdle only if the land is acquired below "
            "the asking price, or if construction comes in below the $4,180 per square "
            "metre allowed. Neither is unreasonable, but both are required.",
            "Sensitivity is dominated by construction cost. A 5% increase — well inside "
            "the range seen in the last three years — removes $640,000 of profit and "
            "takes the margin on cost to 14.1%, below hurdle.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Margin on cost of 17.4% against a 20% hurdle at the asking land price.",
            "Residual land value at hurdle is $3.72m; the asking price is $4.2m.",
            "A 5% construction cost increase takes the scheme below hurdle.",
            "Do not proceed at the asking price without a fixed-price build contract.",
        ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Feasibility metrics", "The headline outcome")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("RESIDUAL LAND VALUE", f("feasibility.residual", "$3.72m"), "At 20% hurdle"),
        ("DEVELOPMENT PROFIT", f("feasibility.profit", "$3.38m"), "At asking land price"),
        ("MARGIN ON COST", f("feasibility.margin", "17.4%"), "Hurdle 20%"),
        ("PROJECT IRR", f("feasibility.irr", "21.8%"), "Ungeared, 30 months"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "03", "Assumptions", "Every input, with its basis and date")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Feasibility assumptions", columns=2, fields=[
        ("Land price", f("assumptions.land", "$4,200,000 — asking")),
        ("Scheme", f("assumptions.scheme", "24 apartments over 4 levels")),
        ("Saleable area", f("assumptions.saleable", "2,184 m²")),
        ("Construction rate", f("assumptions.buildRate", "$4,180/m² GFA — QS advice")),
        ("Professional fees", f("assumptions.profFees", "9.5% of construction")),
        ("Statutory contributions", f("assumptions.contributions", "$1,140,000 — s7.11")),
        ("Contingency", f("assumptions.contingency", "5% of construction")),
        ("Selling costs", f("assumptions.sellingCosts", "3.2% of gross realisation")),
        ("Finance rate", f("assumptions.financeRate", "8.95% — senior debt")),
        ("LVR / LCR", f("assumptions.lvr", "65% of GRV")),
        ("Programme", f("assumptions.programme", "30 months to final settlement")),
        ("Hurdle", f("assumptions.hurdle", "20% margin on cost")),
    ], footnote="Construction rate is from a quantity surveyor's elemental estimate dated "
                "18 July 2026. Contributions are from the council's current contributions "
                "plan and are subject to indexation at the date of the construction "
                "certificate.")
    page_break(doc)

    C.section_opener(doc, theme, "04", "Scheme & yield", "What is being built")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Product", "Count", "Avg area m²", "Total area m²", "Rate $/m²",
                     "Avg price", "Gross realisation"],
        f.rows("scheme.mix", [
            ["1 bed", "6", "58", "348", "$10,200", "$591,600", "$3,549,600"],
            ["2 bed", "12", "88", "1,056", "$10,600", "$932,800", "$11,193,600"],
            ["2 bed + study", "4", "104", "416", "$10,800", "$1,123,200", "$4,492,800"],
            ["3 bed", "2", "182", "364", "$10,300", "$1,874,600", "$3,749,200"],
        ], ["{{product}}", "{{count}}", "{{avgArea}}", "{{totalArea}}", "{{rate}}",
            "{{avgPrice}}", "{{gross}}"], count=4),
        widths=[38, 20, 28, 30, 28, 34, 42],
        numeric_cols={1, 2, 3, 4, 5, 6},
        total_row=["Total", "24", "91", "2,184", "$10,440", "", "$22,985,200"],
        caption="Product mix and yield",
        note="Rates are from comparable off-the-plan sales in the precinct over the last "
             "nine months, adjusted for level, aspect and completion date.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "05", "Revenue", "Gross realisation")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Basis", "Amount"],
        f.rows("feasibility.revenue", [
            ["Apartment sales", "24 units per the mix above", "$22,985,200"],
            ["Car space sales", "8 surplus spaces at $65,000", "$520,000"],
            ["Storage cage sales", "18 cages at $12,000", "$216,000"],
            ["Less selling and marketing", "3.2% of gross realisation", "-$758,000"],
            ["Less GST — margin scheme", "Estimated", "-$1,412,000"],
        ], ["{{item}}", "{{basis}}", "{{amount}}"], count=5),
        widths=[62, 66, 50], numeric_cols={2},
        total_row=["Net realisation", "", "$21,551,200"],
        caption="Revenue")
    page_break(doc)

    C.section_opener(doc, theme, "06", "Costs", "Every line, grouped")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Group", "Item", "Basis", "Amount"],
        f.rows("feasibility.costs", [
            ["Acquisition", "Land", "Asking price", "$4,200,000"],
            ["Acquisition", "Stamp duty and legals", "NSW", "$232,000"],
            ["Construction", "Building works", "2,940 m² GFA at $4,180", "$12,289,200"],
            ["Construction", "Contingency", "5% of construction", "$614,460"],
            ["Professional", "Design and consultants", "9.5% of construction",
             "$1,167,474"],
            ["Professional", "Project management", "1.5% of construction", "$184,338"],
            ["Statutory", "Section 7.11 contributions", "Council plan", "$1,140,000"],
            ["Statutory", "Authority and certification", "Estimate", "$186,000"],
            ["Finance", "Interest and line fees", "8.95%, 30 months", "$1,284,000"],
            ["Holding", "Rates, insurance, security", "30 months", "$96,000"],
        ], ["{{group}}", "{{item}}", "{{basis}}", "{{amount}}"], count=8),
        widths=[34, 58, 50, 36], numeric_cols={3},
        total_row=["", "Total development cost", "", "$21,393,472"],
        caption="Development costs",
        note="Construction is 57% of total cost, which is why the sensitivity in "
             "section nine is dominated by the build rate.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "07", "Funding & cash flow", "Drawdown against programme")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Debt drawdown and repayment against programme",
                  kind="area chart", binding="{{funding.series}}", height_mm=54,
                  caption="30 months, peak debt $11.4m",
                  source="Aurixa feasibility model",
                  alt_text="Debt peaks at $11.4m in month 24 and is repaid from "
                           "settlements between months 27 and 30")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Facility", "Limit", "Rate", "Drawn at peak", "Purpose"],
        f.rows("funding.facilities", [
            ["Land facility", "$2,730,000", "8.45%", "$2,730,000", "65% of land price"],
            ["Construction facility", "$9,940,000", "8.95%", "$8,670,000",
             "Progress claims"],
        ], ["{{facility}}", "{{limit}}", "{{rate}}", "{{drawn}}", "{{purpose}}"], count=2),
        widths=[44, 34, 24, 34, 46], numeric_cols={1, 2, 3},
        total_row=["Peak debt", "$12,670,000", "", "$11,400,000", ""],
        caption="Funding structure",
        note="Peak debt of $11.4m is 49.6% of gross realisation and 53.3% of total "
             "development cost, both inside typical senior-debt parameters.")
    page_break(doc)

    C.section_opener(doc, theme, "08", "Programme", "Acquisition to final settlement")
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("programme", [
        ("Month 0", "Land settlement", "Land facility drawn; DA lodged"),
        ("Month 7", "Development consent", "Assumed; 7-month assessment"),
        ("Month 9", "Construction certificate", "Contributions paid on CC"),
        ("Month 10", "Construction commences", "44-week build programme"),
        ("Month 12", "Sales launch", "Off-the-plan; 60% pre-sale target"),
        ("Month 24", "Practical completion", "Peak debt $11.4m"),
        ("Month 26", "Occupation certificate", "Strata registration"),
        ("Month 27", "Settlements commence", "Debt repayment begins"),
        ("Month 30", "Final settlement", "Facility discharged"),
    ], ("{{when}}", "{{what}}", "{{detail}}"), count=6), caption="Development programme")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "09", "Sensitivity analysis", "The three inputs that matter")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Base", "Build +5%", "Revenue −5%", "Programme +6 mths", "Upside"],
        attributes=[
            ("Total cost", ["$21.39m", "$22.03m", "$21.39m", "$21.65m", "$21.39m"]),
            ("Net realisation", ["$21.55m", "$21.55m", "$20.47m", "$21.55m", "$22.63m"]),
            ("Development profit", ["$3.38m", "$2.74m", "$2.30m", "$3.12m", "$4.46m"]),
            ("Margin on cost", ["17.4%", "14.1%", "11.8%", "16.0%", "22.9%"]),
            ("Against 20% hurdle", ["Below", "Below", "Below", "Below", "Above"]),
            ("Residual land value", ["$3.72m", "$3.12m", "$2.68m", "$3.48m", "$4.74m"]),
        ],
        caption="Sensitivity", winner_index=4)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "10", "Risks & mitigations", "What could break it")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Risks & mitigations", risks=f.tuples("risks", [
        ("Construction cost exceeds the QS estimate", "High",
         "Construction is 57% of cost and a 5% overrun takes the scheme below hurdle. Do "
         "not proceed without a fixed-price design-and-construct contract."),
        ("Planning consent takes longer than seven months or is refused", "High",
         "Make the land contract conditional on development consent, or price the land at "
         "the unconditional discount."),
        ("Pre-sale target of 60% is not met", "Medium",
         "Senior debt is conditional on pre-sales. Model a six-month delay and confirm "
         "the facility permits it."),
        ("Apartment values soften before settlement", "Medium",
         "A 5% fall removes $1.08m of profit. Off-the-plan contracts transfer some of "
         "this risk but increase settlement default exposure."),
        ("Statutory contributions are indexed upward before CC", "Low",
         "$1.14m is indexed quarterly. Budget a 4% increase and pay early where "
         "permitted."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=5))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "11", "Conclusion", "Proceed, revise or abandon")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Conclusion",
        recommendation=f("report.conclusion",
                         "Proceed only at a land price at or below $3,720,000 and with a "
                         "fixed-price construction contract. Do not proceed at the "
                         "$4,200,000 asking price on a cost-plus build."),
        rationale=f.text("report.conclusionRationale", [
            "The scheme is viable but the margin is thin, and the thinness is entirely "
            "attributable to two variables that can both be fixed contractually: the "
            "land price and the build rate. Fixing both converts a marginal feasibility "
            "into a sound one. Fixing neither leaves a 17.4% margin exposed to a "
            "construction market that has moved more than 5% in each of the last three "
            "years.",
        ]),
        actions=f.items("report.conclusionActions", [
            "Offer $3,720,000 for the land, conditional on development consent.",
            "Tender the build as fixed-price design and construct before committing.",
            "Confirm the senior debt facility permits a six-month pre-sale delay.",
            "Re-run this feasibility on the tendered build price before settlement.",
        ]),
        confidence=f("report.confidence", "High"))
    C.appendix_opener(doc, theme, "A", "Full model",
                      "Line-level model output supporting the summaries above.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Line", "Description", "Quantity", "Rate", "Amount"],
        f.rows("appendix.model", [
            ["1.01", "Land acquisition", "1", "$4,200,000", "$4,200,000"],
            ["1.02", "Transfer duty", "1", "$232,000", "$232,000"],
            ["2.01", "Demolition and site preparation", "1", "$186,000", "$186,000"],
            ["2.02", "Substructure", "2,940 m²", "$412", "$1,211,280"],
            ["2.03", "Superstructure", "2,940 m²", "$1,860", "$5,468,400"],
            ["2.04", "Fit-out and finishes", "2,940 m²", "$1,240", "$3,645,600"],
            ["2.05", "Services", "2,940 m²", "$560", "$1,646,400"],
            ["2.06", "External works and landscaping", "1", "$131,520", "$131,520"],
        ], ["{{line}}", "{{description}}", "{{qty}}", "{{rate}}", "{{amount}}"], count=8),
        widths=[20, 74, 26, 28, 32], numeric_cols={3, 4})
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Portfolio Review Report — Premium Advisory
# ==========================================================================

def portfolio_review_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Annual portfolio review",
        title=f("report.title", "Portfolio Review"),
        subtitle=f("report.subtitle",
                   "Performance, equity, debt and cash flow across four assets — and the "
                   "actions we recommend for the coming year."),
        chips=["4 ASSETS", "FY2026"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Portfolio position"), ("02", "Executive summary"),
        ("03", "Performance"), ("04", "Asset register"), ("05", "Debt profile"),
        ("06", "Cash-flow position"), ("07", "Opportunities & risks"),
        ("08", "Recommended actions"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Portfolio position", "Where you stand")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("TOTAL VALUE", f("portfolio.value", "$4,912,000"), "4 assets, Jun 2026"),
        ("TOTAL DEBT", f("portfolio.debt", "$2,847,000"), "Across 5 facilities"),
        ("NET EQUITY", f("portfolio.equity", "$2,065,000"), "42.0% of value"),
        ("PORTFOLIO YIELD", f("portfolio.yield", "3.8%"), "Gross, weighted"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Executive summary", "The year in review")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "The portfolio grew $312,000 in value and $41,000 in equity, but the "
                   "cash-flow position deteriorated by $18,400 — and one asset is now "
                   "dragging the whole portfolio."),
        paragraphs=f.text("report.summary", [
            "Portfolio value rose 6.8% to $4,912,000 over the year, ahead of the 5.9% "
            "weighted market movement across the four locations. Net equity rose to "
            "$2,065,000 and portfolio LVR improved from 60.4% to 58.0%.",
            "Cash flow moved the other way. The after-tax position worsened by $18,400, "
            "driven almost entirely by 21 Test Road, which has been vacant for eleven "
            "weeks of the year and carries the portfolio's only interest-only facility "
            "reverting to principal and interest in March.",
            "Three of the four assets are performing to expectation. The fourth is not, "
            "and has not for two consecutive years. This review recommends a decision on "
            "it rather than another year of monitoring.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Value up 6.8%; portfolio LVR improved to 58.0%.",
            "After-tax cash flow deteriorated by $18,400.",
            "21 Test Road has underperformed for two consecutive years.",
            "$284,000 of usable equity is available for a fifth acquisition.",
        ]))
    page_break(doc)

    C.section_opener(doc, theme, "03", "Performance", "Value and equity over the period")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Portfolio value and equity, five years",
                  kind="stacked area chart", binding="{{portfolio.history}}",
                  height_mm=54, caption="Value, debt and net equity",
                  source="Aurixa portfolio model",
                  alt_text="Portfolio value rose from $3.68m to $4.91m over five years "
                           "while debt stayed broadly flat, so equity more than doubled")
    C.gap(doc, theme, 0.6)
    C.bar_chart(doc, theme, caption="12-month value movement by asset",
                rows=f.tuples("portfolio.movement", [
                    ("4 Example St", 9.1, "+9.1%"),
                    ("12 Sample Ave", 7.4, "+7.4%"),
                    ("9 Demo Close", 6.2, "+6.2%"),
                    ("21 Test Rd", 1.8, "+1.8%"),
                ], ("{{asset.short}}", 5, "{{asset.movement}}"), count=4),
                maximum=10,
                note="21 Test Road has now underperformed the portfolio average in each "
                     "of the last two years.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Asset register", "Every asset, every measure")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Asset", "Acquired", "Cost", "Value", "Debt", "LVR", "Rent p.a.", "Net p.a."],
        f.rows("portfolio.assets", [
            ["4 Example St", "Mar 2019", "$742,000", "$1,284,000", "$412,000", "32.1%",
             "$41,600", "$6,240"],
            ["12 Sample Ave", "Aug 2021", "$865,000", "$1,196,000", "$389,000", "32.5%",
             "$38,480", "$4,810"],
            ["9 Demo Close", "Feb 2023", "$1,024,000", "$1,318,000", "$864,000", "65.6%",
             "$46,800", "-$8,920"],
            ["21 Test Rd", "Nov 2023", "$1,096,000", "$1,114,000", "$1,182,000", "106.1%",
             "$34,320", "-$24,180"],
        ], ["{{address}}", "{{acquired}}", "{{cost}}", "{{value}}", "{{debt}}", "{{lvr}}",
            "{{rent}}", "{{net}}"], count=4),
        widths=[42, 28, 32, 34, 32, 22, 30, 30],
        numeric_cols={2, 3, 4, 5, 6, 7}, emphasis_rows={3},
        total_row=["Portfolio", "", "$3,727,000", "$4,912,000", "$2,847,000", "58.0%",
                   "$161,200", "-$22,050"],
        caption="Asset register",
        note="21 Test Road's LVR exceeds 100% because the facility was drawn to fund "
             "acquisition costs and the asset has appreciated only 1.6% since purchase.")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Debt profile", "Facilities, rates and expiries")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Facility", "Security", "Limit", "Balance", "Rate", "Type", "Expiry"],
        f.rows("portfolio.debt", [
            ["F1", "4 Example St", "$420,000", "$412,000", "6.14%", "P&I variable", "—"],
            ["F2", "12 Sample Ave", "$395,000", "$389,000", "6.22%", "P&I variable", "—"],
            ["F3", "9 Demo Close", "$870,000", "$864,000", "6.09%", "IO fixed", "Aug 2027"],
            ["F4", "21 Test Rd", "$1,110,000", "$1,104,000", "6.44%", "IO variable",
             "Mar 2027"],
            ["F5", "21 Test Rd (2nd)", "$80,000", "$78,000", "7.10%", "Equity release",
             "—"],
        ], ["{{ref}}", "{{security}}", "{{limit}}", "{{balance}}", "{{rate}}", "{{type}}",
            "{{expiry}}"], count=5),
        widths=[20, 44, 30, 30, 22, 32, 26], numeric_cols={2, 3, 4},
        total_row=["", "Portfolio", "$2,875,000", "$2,847,000", "6.28%", "", ""],
        caption="Debt profile",
        note="F4 reverts from interest only to principal and interest in March 2027, "
             "which will increase repayments by approximately $1,840 per month.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Cash-flow position", "Consolidated")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "FY2025", "FY2026", "Movement"],
        f.rows("portfolio.cashflow", [
            ["Gross rental income", "$154,700", "$161,200", "+$6,500"],
            ["Vacancy", "-$4,180", "-$11,420", "-$7,240"],
            ["Operating expenses", "-$34,900", "-$36,780", "-$1,880"],
            ["Loan interest", "-$168,400", "-$178,850", "-$10,450"],
            ["Pre-tax position", "-$52,780", "-$65,850", "-$13,070"],
            ["Depreciation", "-$41,200", "-$38,600", "+$2,600"],
            ["Tax effect at 39%", "$36,672", "$40,776", "+$4,104"],
        ], ["{{item}}", "{{prior}}", "{{current}}", "{{movement}}"], count=6),
        widths=[68, 34, 34, 34], numeric_cols={1, 2, 3},
        total_row=["After-tax position", "-$3,650", "-$22,050", "-$18,400"],
        caption="Consolidated cash flow")
    page_break(doc)

    C.section_opener(doc, theme, "07", "Opportunities & risks", "What to act on")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Opportunities & risks", risks=f.tuples("risks", [
        ("21 Test Road has underperformed for two consecutive years", "High",
         "LVR above 100%, eleven weeks vacant, and a facility reverting to P&I in March. "
         "Decide this year: dispose, or re-let and refinance with a documented "
         "three-year hold thesis."),
        ("F4 reverts to principal and interest in March 2027", "High",
         "Adds approximately $22,000 a year to outgoings on the portfolio's weakest "
         "asset. Refinance or extend the interest-only period before December."),
        ("$284,000 of usable equity is idle", "Medium",
         "Sitting in 4 Example Street and 12 Sample Avenue at LVRs around 32%. "
         "Deployable into a fifth acquisition without breaching the 70% portfolio LVR "
         "constraint."),
        ("Portfolio yield of 3.8% cannot fund further acquisition from income", "Medium",
         "Any fifth acquisition must be yield-accretive or funded from external income. "
         "Target a minimum 4.5% gross."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Recommended actions", "For the coming year")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("portfolio.actions", [
        "Decide on 21 Test Road by 30 September — dispose or commit to a documented hold.",
        "Refinance or extend the interest-only period on F4 before December.",
        "Obtain valuations on 4 Example Street and 12 Sample Avenue to confirm usable "
        "equity.",
        "Review the management arrangement on 21 Test Road — eleven weeks vacant is not "
        "a market outcome.",
        "If proceeding to a fifth acquisition, set a minimum gross yield of 4.5%.",
    ], count=5), title="Actions", with_owner=True)
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Reviewed with the client", ["Name:", "Signature:",
                                      "Date:  ____ / ____ / ______"]),
        ("For the organisation", [f"Name: {f('author.name', '{{author.name}}')}",
                                  "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme)
