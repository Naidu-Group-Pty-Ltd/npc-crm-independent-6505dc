"""Builders for the finance templates."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import components as C  # noqa: E402
from content import Fill  # noqa: E402
from oxml import page_break  # noqa: E402
from theme import Theme  # noqa: E402


# ==========================================================================
# Borrowing Capacity Report — Financial Analytical
# ==========================================================================

def borrowing_capacity_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Assessed borrowing position",
        title=f("report.title", "Borrowing Capacity Report"),
        subtitle=f("report.subtitle",
                   "What you can borrow, from whom, on what assumptions, and what would "
                   "change it."),
        chips=["ASSESSED", "MULTI-LENDER", "STRESS-TESTED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Assessed capacity", "Headline position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("MAXIMUM CAPACITY", f("assessment.maxCapacity", "$1,284,000"), "Highest on panel"),
        ("INDICATIVE PRICE", f("assessment.indicativePrice", "$1,590,000"), "At 80% LVR"),
        ("DEPOSIT REQUIRED", f("assessment.deposit", "$318,000"), "Plus costs"),
        ("ASSESSMENT RATE", f("assessment.rate", "9.15%"), "Incl. 3% buffer"),
    ])
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="What this means",
        headline=f("report.headline",
                   "Your capacity varies by $214,000 across the panel — lender selection "
                   "matters more than rate at your income profile."),
        paragraphs=f.text("report.summary", [
            "Assessed capacity ranges from $1,070,000 to $1,284,000 depending on how each "
            "lender treats your rental income and your existing credit card limits. The "
            "spread is driven almost entirely by rental shading policy: lenders applying "
            "80% shading assess $34,000 less annual income than those applying 90%.",
            "Reducing your credit card limits from $28,000 to $10,000 would add "
            "approximately $96,000 to capacity at every lender on the panel, because "
            "limits are assessed at 3.8% of the limit regardless of the balance drawn.",
        ]))
    page_break(doc)

    C.section_opener(doc, theme, "02", "Inputs", "What the assessment is built on")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Applicant", "Income type", "Gross annual", "Shading", "Assessed"],
        f.rows("applicants", [
            ["Applicant 1", "PAYG base salary", "$142,000", "100%", "$142,000"],
            ["Applicant 1", "Bonus (2-year average)", "$18,000", "80%", "$14,400"],
            ["Applicant 2", "PAYG base salary", "$98,000", "100%", "$98,000"],
            ["Joint", "Rental — 4 Example St", "$31,200", "80%", "$24,960"],
            ["Joint", "Rental — 12 Sample Ave", "$28,600", "80%", "$22,880"],
        ], ["{{applicant}}", "{{incomeType}}", "{{gross}}", "{{shading}}", "{{assessed}}"],
            count=5),
        widths=[34, 52, 32, 22, 32], numeric_cols={2, 4},
        total_row=["Total assessed income", "", "$317,800", "", "$302,240"],
        caption="Income")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Commitment", "Lender", "Limit / balance", "Actual", "Assessed"],
        f.rows("commitments", [
            ["Home loan — 4 Example St", "Lender A", "$412,000", "$2,310/mo", "$3,140/mo"],
            ["Home loan — 12 Sample Ave", "Lender B", "$389,000", "$2,180/mo", "$2,965/mo"],
            ["Credit card", "Lender A", "$18,000", "$0/mo", "$684/mo"],
            ["Credit card", "Lender C", "$10,000", "$0/mo", "$380/mo"],
            ["Car loan", "Lender D", "$24,400", "$610/mo", "$610/mo"],
        ], ["{{type}}", "{{lender}}", "{{limit}}", "{{actual}}", "{{assessed}}"], count=5),
        widths=[54, 30, 34, 28, 30], numeric_cols={2, 3, 4},
        total_row=["Total assessed commitments", "", "", "", "$7,779/mo"],
        caption="Commitments",
        note="Credit card limits are assessed at 3.8% of the limit each month whether or "
             "not the card is drawn.")
    C.gap(doc, theme, 0.7)
    C.info_card(doc, theme, title="Assessment assumptions", columns=2, fields=[
        ("Assessment rate", f("assessment.rate", "9.15% (product rate + 3.00% buffer)")),
        ("Living expenses basis", f("assessment.hem", "Higher of declared and HEM")),
        ("Declared expenses", f("assessment.declared", "$5,840/month")),
        ("HEM benchmark", f("assessment.hemValue", "$6,120/month — applied")),
        ("Rental shading", f("assessment.rentalShading", "80% unless stated")),
        ("Bonus shading", f("assessment.bonusShading", "80%, two-year average")),
        ("Assessment date", f("assessment.date", "31/07/2026")),
        ("Dependants", f("assessment.dependants", "2")),
    ], footnote="Assessment rates and policies change frequently. This assessment is "
                "indicative only and is not an approval or an offer of credit.")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Lender comparison", "Where capacity differs")
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="Assessed capacity by lender",
                rows=f.tuples("lenders.chart", [
                    ("Lender A", 1284000, "$1,284,000"),
                    ("Lender B", 1218000, "$1,218,000"),
                    ("Lender C", 1155000, "$1,155,000"),
                    ("Lender D", 1092000, "$1,092,000"),
                    ("Lender E", 1070000, "$1,070,000"),
                ], ("{{lender.name}}", 1, "{{lender.capacity}}"), count=4),
                note="Capacity is the maximum loan each lender's calculator returns on the "
                     "inputs above. It is not an approval.")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Lender", "Capacity", "Assessment rate", "Rental shading", "Policy note"],
        f.rows("lenders", [
            ["Lender A", "$1,284,000", "8.95%", "90%", "Accepts bonus at 80% over 2 years"],
            ["Lender B", "$1,218,000", "9.10%", "85%", "Adds 15% to declared expenses"],
            ["Lender C", "$1,155,000", "9.15%", "80%", "Assesses cards at 3.8% of limit"],
            ["Lender D", "$1,092,000", "9.40%", "80%", "Shades bonus to 50%"],
            ["Lender E", "$1,070,000", "9.55%", "75%", "Does not accept bonus income"],
        ], ["{{name}}", "{{capacity}}", "{{rate}}", "{{shading}}", "{{note}}"], count=5),
        widths=[28, 32, 32, 28, 60], numeric_cols={1},
        emphasis_rows={0}, caption="Lender detail")
    page_break(doc)

    C.section_opener(doc, theme, "04", "Sensitivity", "What changes the answer")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Base case", "Rate +1%", "Rate +2%", "Income −10%"],
        attributes=[
            ("Assessed capacity", [f("sensitivity.base", "$1,284,000"),
                                   f("sensitivity.rate1", "$1,168,000"),
                                   f("sensitivity.rate2", "$1,064,000"),
                                   f("sensitivity.income", "$1,142,000")]),
            ("Indicative price", ["$1,590,000", "$1,455,000", "$1,330,000", "$1,418,000"]),
            ("Change", ["—", "−$116,000", "−$220,000", "−$142,000"]),
            ("Deposit required", ["$318,000", "$291,000", "$266,000", "$284,000"]),
        ],
        caption="Capacity under stress", winner_index=0)
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("assessment.levers", [
        "Reduce credit card limits from $28,000 to $10,000 — adds approximately $96,000.",
        "Clear the car loan balance of $24,400 — adds approximately $71,000.",
        "Provide a third year of bonus history — adds approximately $34,000 at Lender A.",
        "Increase the rental appraisal evidence on 12 Sample Avenue — adds approximately "
        "$18,000 where shading is 90%.",
    ]), title="What would improve capacity", columns=1)
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Important",
        text=f("report.caveat",
               "This report is an indicative assessment of borrowing capacity. It is not "
               "credit assistance, an application, a pre-approval or an offer of credit. "
               "Lender policies, assessment rates and benchmarks change without notice and "
               "each lender will form its own view on a full application."))
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Finance Strategy Report — Modern Technology
# ==========================================================================

def finance_strategy_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Debt structure & funding plan",
        title=f("report.title", "Finance Strategy Report"),
        subtitle=f("report.subtitle",
                   "How your lending should be structured to support the next three "
                   "acquisitions, and the order the moves need to happen in."),
        chips=["STRATEGY", "SEQUENCED", "STRESS-TESTED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "The strategy in brief")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "Split the cross-collateralised facilities first, then release equity — "
                   "doing it the other way round costs you a full valuation cycle."),
        paragraphs=f.text("report.summary", [
            "Your four properties are currently secured under two cross-collateralised "
            "facilities with a single lender. That structure has produced a blended rate "
            "0.34% above market and, more importantly, means any equity release requires "
            "revaluation of all four assets together.",
            "The recommended structure separates each property into a standalone facility "
            "across two lenders, with a dedicated equity release facility against the two "
            "assets that have grown most. This releases $340,000 of usable equity and "
            "reduces the blended rate to 6.18%.",
            "Sequencing matters. Releasing equity before splitting the facilities would "
            "lock the current lender's valuations in for a further six months.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Unwind cross-collateralisation before any equity release.",
            "Blended rate falls from 6.52% to 6.18% — $9,180 per year.",
            "$340,000 of usable equity is released, funding two acquisitions.",
            "The full sequence takes approximately 14 weeks.",
        ]))
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("TOTAL DEBT", f("position.totalDebt", "$1,847,000"), "Across 4 assets"),
        ("BLENDED RATE", f("position.blendedRate", "6.52%"), "Current"),
        ("USABLE EQUITY", f("position.usableEquity", "$340,000"), "At 80% LVR"),
        ("CURRENT LVR", f("position.lvr", "63.4%"), "Portfolio"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "02", "Position today", "Current structure")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Facility", "Security", "Limit", "Balance", "Rate", "Type", "Expiry"],
        f.rows("facilities", [
            ["Facility 1", "4 Example St + 12 Sample Ave", "$801,000", "$789,400", "6.44%",
             "P&I variable", "—"],
            ["Facility 2", "21 Test Rd + 9 Demo Cl", "$1,062,000", "$1,057,600", "6.58%",
             "IO fixed", "03/2027"],
        ], ["{{name}}", "{{security}}", "{{limit}}", "{{balance}}", "{{rate}}", "{{type}}",
            "{{expiry}}"], count=3),
        widths=[26, 52, 26, 26, 20, 28, 22], numeric_cols={2, 3, 4},
        caption="Current facilities",
        note="Both facilities are cross-collateralised. No property can be released, sold "
             "or revalued independently under this structure.")
    C.gap(doc, theme, 0.7)
    C.info_card(doc, theme, title="Goals & constraints", columns=1, fields=[
        ("Objective", f("goals.objective",
                        "Acquire two further investment properties over 24 months")),
        ("Constraint", f("goals.constraint",
                         "Total portfolio LVR must remain below 70%")),
        ("Constraint", f("goals.constraint2",
                         "No additional cash contribution available")),
        ("Preference", f("goals.preference",
                         "Reduce exposure to a single lender")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "03", "Target structure", "Where we are going")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Facility", "Security", "Limit", "Purpose", "Lender", "Type"],
        f.rows("strategy.target", [
            ["A1", "4 Example St", "$412,000", "Standalone investment", "Lender A", "IO variable"],
            ["A2", "12 Sample Ave", "$389,000", "Standalone investment", "Lender A", "IO variable"],
            ["B1", "21 Test Rd", "$524,000", "Standalone investment", "Lender B", "P&I variable"],
            ["B2", "9 Demo Close", "$522,000", "Standalone investment", "Lender B", "P&I variable"],
            ["B3", "21 Test Rd (2nd)", "$340,000", "Equity release — deposits", "Lender B",
             "IO variable"],
        ], ["{{name}}", "{{security}}", "{{limit}}", "{{purpose}}", "{{lender}}", "{{type}}"],
            count=4),
        widths=[22, 40, 26, 48, 26, 28], numeric_cols={2},
        emphasis_rows={4}, caption="Proposed facilities")
    C.gap(doc, theme, 0.7)
    C.comparison_table(
        doc, theme, subject_labels=["Today", "Target", "Change"],
        attributes=[
            ("Facilities", ["2", "5", "+3"]),
            ("Lenders", ["1", "2", "+1"]),
            ("Cross-collateralised", ["Yes — all four", "No", "Removed"]),
            ("Blended rate", ["6.52%", "6.18%", "−0.34%"]),
            ("Annual interest", ["$120,424", "$115,146", "−$5,278"]),
            ("Usable equity accessible", ["$0", "$340,000", "+$340,000"]),
            ("Portfolio LVR", ["63.4%", "69.1%", "+5.7%"]),
        ],
        caption="Current versus target", winner_index=1)
    page_break(doc)

    C.section_opener(doc, theme, "04", "Sequencing", "The order matters")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("strategy.sequence", [
        ("Valuations", "Order upfront valuations on all four assets with Lender B."),
        ("Split", "Refinance 21 Test Rd and 9 Demo Close to Lender B as standalone facilities."),
        ("Unwind", "Release the remaining two securities from Facility 2 with Lender A."),
        ("Restructure", "Convert the Lender A exposure into two standalone facilities."),
        ("Release", "Establish the $340,000 equity release facility against 21 Test Rd."),
        ("Deploy", "Funds available for the next two acquisitions."),
    ], ("{{step.name}}", "{{step.detail}}"), count=5))
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Funding runway", kind="stacked column chart",
                  binding="{{strategy.runway}}", height_mm=54,
                  caption="Capacity released against planned acquisitions, 24 months",
                  source="Aurixa funding model",
                  alt_text="Released equity covers both planned deposits with $42,000 headroom")
    C.gap(doc, theme)
    C.risk_box(doc, theme, risks=f.tuples("risks", [
        ("Valuations come in below the assumed figures",
         "High", "The equity release reduces proportionally. Order upfront valuations "
                 "before committing to the refinance."),
        ("Lender B policy changes during the 14-week sequence",
         "Medium", "Obtain formal approval on all four facilities before discharging "
                   "anything with Lender A."),
        ("Break costs on the fixed facility expiring 03/2027",
         "Medium", "Break cost is estimated at $4,100. Sequence step 2 after the fixed "
                   "period expires, or accept the cost against the $5,278 annual saving."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("strategy.actions", [
        "Confirm you accept the estimated $4,100 break cost.",
        "Provide the last two years of tax returns for both applicants.",
        "Authorise upfront valuations on all four properties.",
        "Confirm the target acquisition timeline has not changed.",
    ]), title="What we need from you", columns=1)
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Loan Comparison Report — Financial Analytical
# ==========================================================================

def loan_comparison_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Product shortlist",
        title=f("report.title", "Loan Comparison Report"),
        subtitle=f("report.subtitle",
                   "Four shortlisted products compared on rate, fees, features, policy "
                   "fit and true cost over your intended hold period."),
        chips=["4 PRODUCTS", "TRUE COST", "AS AT 31/07/26"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "What was compared", "Method and basis")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Comparison basis",
        text=f("comparison.basis",
               "Every figure below is calculated on the same loan amount, the same hold "
               "period and the same repayment type. A comparison run on different "
               "assumptions is not a comparison."),
        items=f.items("comparison.basisItems", [
            "Loan amount: $648,000 (80% of $810,000).",
            "Repayment type: interest only for five years, then principal and interest.",
            "Assumed hold period: seven years.",
            "Rates as at 31 July 2026; all lenders on the panel were assessed.",
            "True cost includes interest, establishment, ongoing and discharge fees.",
        ]))
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("LOWEST RATE", f("comparison.lowestRate", "6.09%"), "Lender C"),
        ("LOWEST TRUE COST", f("comparison.lowestCost", "$281,940"), "Lender A, 7 years"),
        ("SPREAD", f("comparison.spread", "$18,620"), "Best to worst"),
        ("RECOMMENDED", f("comparison.recommended", "Lender A"), "See section 05"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "02", "Product comparison", "Rate, fees and structure")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=[f("products.0.short", "Lender A"), f("products.1.short", "Lender B"),
                        f("products.2.short", "Lender C"), f("products.3.short", "Lender D")],
        attributes=[
            ("Product", ["Investment IO Package", "Investor Variable",
                         "Basic Investor", "Investor Plus"]),
            ("Interest rate", ["6.14%", "6.22%", "6.09%", "6.34%"]),
            ("Comparison rate", ["6.41%", "6.38%", "6.12%", "6.59%"]),
            ("Establishment fee", ["$0", "$395", "$0", "$600"]),
            ("Annual package fee", ["$395", "$0", "$0", "$395"]),
            ("Discharge fee", ["$350", "$350", "$300", "$395"]),
            ("Offset account", ["Included", "Included", "Not available", "Included"]),
            ("Redraw", ["Free", "Free", "$25 per redraw", "Free"]),
            ("Splits", ["Up to 6, no fee", "Up to 4, no fee", "Not available",
                        "Up to 8, no fee"]),
            ("Rate lock", ["Available, $750", "Available, $500", "Not available",
                           "Available, $600"]),
            ("True cost, 7 years", ["$281,940", "$285,610", "$283,180", "$300,560"]),
        ],
        caption="Shortlisted products", winner_index=0)
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="True cost over the assumed seven-year hold",
                rows=f.tuples("products.trueCost", [
                    ("Lender A", 281940, "$281,940"),
                    ("Lender C", 283180, "$283,180"),
                    ("Lender B", 285610, "$285,610"),
                    ("Lender D", 300560, "$300,560"),
                ], ("{{product.short}}", 1, "{{product.trueCost}}"), count=4),
                note="True cost is total interest plus all fees over seven years on the "
                     "stated assumptions. It is not the comparison rate, which assumes a "
                     "25-year term on a $150,000 loan.")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Feature matrix", "Available or not")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Feature", "Lender A", "Lender B", "Lender C", "Availability"],
        rows=f.tuples("products.features", [
            (["100% offset", "Yes", "Yes", "No", "Pass"], "pass"),
            (["Free redraw", "Yes", "Yes", "No", "Pass"], "pass"),
            (["Unlimited splits", "6 max", "4 max", "None", "Review"], "review"),
            (["Portability", "Yes", "Yes", "Yes", "Pass"], "pass"),
            (["Construction option", "No", "Yes", "No", "Review"], "review"),
            (["Fixed-rate option", "Yes", "Yes", "Yes", "Pass"], "pass"),
            (["Rate lock at application", "Yes, $750", "Yes, $500", "No", "Review"],
             "review"),
        ], (["{{feature}}", "{{a}}", "{{b}}", "{{c}}", "Pending"], "pending"), count=6),
        widths=[52, 30, 30, 30, 30], caption="Features by product",
        note="Feature availability is stated as a word as well as a fill, so this table "
             "reads correctly in grayscale.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "04", "Policy fit", "How each lender treats your position")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Your circumstance", "Lender treatment", "Lender", "Status"],
        rows=f.tuples("products.policy", [
            (["4.1", "Bonus income, two-year history", "Accepted at 80%", "Lender A",
              "Pass"], "pass"),
            (["4.2", "Bonus income, two-year history", "Accepted at 50%", "Lender B",
              "Review"], "review"),
            (["4.3", "Rental income from two properties", "Shaded to 90%", "Lender A",
              "Pass"], "pass"),
            (["4.4", "Rental income from two properties", "Shaded to 80%", "Lender C",
              "Review"], "review"),
            (["4.5", "Credit card limits of $28,000", "Assessed at 3.8% of limit", "All",
              "Review"], "review"),
            (["4.6", "Existing exposure with Lender A", "Within single-lender limit",
              "Lender A", "Pass"], "pass"),
        ], (["{{ref}}", "{{circumstance}}", "{{treatment}}", "{{lender}}", "Pending"],
            "pending"), count=6),
        widths=[16, 56, 52, 30, 26], caption="Policy assessment")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Lender A, Investment IO Package. Lowest true cost over seven "
                         "years, the only lender accepting your bonus income at 80%, and "
                         "the full feature set you asked for."),
        rationale=f.text("report.rationale", [
            "Lender C has the lowest headline rate but no offset account, and on the "
            "$40,000 balance you typically hold that costs approximately $2,440 a year in "
            "forgone interest offset — more than the 0.05% rate difference saves.",
            "Lender A's $395 annual package fee is recovered by the offset benefit inside "
            "the first year, and its bonus-income treatment materially improves your "
            "capacity for the next acquisition.",
        ]),
        actions=f.items("report.nextSteps", [
            "Confirm you want the offset account and are comfortable with the package fee.",
            "Decide whether to pay $750 to lock the rate at application.",
            "Provide the last two years of bonus statements.",
        ]),
        confidence=f("report.confidence", "High"))
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Comparison basis and currency",
         "Rates, fees and policies are as at the date stated on the cover and change "
         "without notice. This report compares products; it is not an application, an "
         "approval or an offer of credit, and no lender is bound by anything in it."),
    ])


# ==========================================================================
# Cash-Flow & Net Position Report — Financial Analytical
# ==========================================================================

def cash_flow_net_position_report(doc, theme: Theme, f: Fill) -> None:
    title = "Cash-Flow & Net Position Report"
    C.cover(
        doc, theme,
        eyebrow_text="Ten-year projection",
        title=f("report.title", title),
        subtitle=f("report.subtitle",
                   "What this asset costs or returns, year by year, after tax — with the "
                   "assumptions that produced it and the sensitivity around them."),
        chips=["10 YEARS", "AFTER TAX", "STRESS-TESTED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Position summary", "Headline outcome")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("YEAR 1 NET", f("summary.year1", "-$4,368"), "After tax, per year"),
        ("10-YEAR CUMULATIVE", f("summary.cumulative", "$68,420"), "Nominal, after tax"),
        ("BREAK-EVEN YEAR", f("summary.breakEven", "Year 6"), "Cash-flow positive"),
        ("WEEKLY COST, YEAR 1", f("summary.weekly", "$84"), "After tax"),
    ])
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="What this means",
        headline=f("report.headline",
                   "The property costs $84 a week after tax in year one and turns "
                   "cash-flow positive in year six."),
        paragraphs=f.text("report.summary", [
            "On the assumptions in section two, the property runs at a small after-tax "
            "deficit for the first five years and is cash-flow positive from year six. "
            "Cumulative after-tax cash flow over ten years is positive at $68,420, before "
            "any capital growth.",
            "The projection is most sensitive to the interest rate. A sustained two "
            "percentage point rise moves the year-one weekly cost from $84 to $214 and "
            "pushes break-even from year six to year nine.",
        ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "02", "Assumptions", "Every input, with its basis")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Cumulative after-tax net position",
                  kind="line chart", binding="{{cashflow.series}}", height_mm=54,
                  caption="Ten years, nominal", source="Aurixa cash-flow model",
                  alt_text="Cumulative after-tax position crosses zero during year six "
                           "and reaches $68,420 by year ten")
    C.gap(doc, theme, 0.6)
    C.info_card(doc, theme, title="Projection assumptions", columns=2, fields=[
        ("Purchase price", f("assumptions.price", "$865,000")),
        ("Loan amount", f("assumptions.loan", "$692,000 (80% LVR)")),
        ("Interest rate", f("assumptions.rate", "6.40%, interest only 5 years")),
        ("Capital growth", f("assumptions.growth", "4.5% p.a. — 10-year suburb average")),
        ("Starting rent", f("assumptions.rent", "$765 per week — appraised")),
        ("Rental growth", f("assumptions.rentGrowth", "3.0% p.a.")),
        ("Vacancy allowance", f("assumptions.vacancy", "2 weeks per year")),
        ("Management fee", f("assumptions.management", "6.9% incl. GST")),
        ("Expense inflation", f("assumptions.inflation", "2.5% p.a.")),
        ("Marginal tax rate", f("assumptions.taxRate", "39% incl. Medicare levy")),
        ("Depreciation", f("assumptions.depreciation", "Quantity surveyor schedule")),
        ("Ownership", f("assumptions.ownership", "Joint, 50/50")),
    ], footnote="Projections are not forecasts. Every figure that follows depends on "
                "these assumptions holding, and none of them will hold exactly.")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Cumulative after-tax net position",
                  kind="line chart", binding="{{cashflow.series}}", height_mm=58,
                  caption="Ten years, nominal", source="Aurixa cash-flow model",
                  alt_text="Cumulative after-tax position crosses zero during year six "
                           "and reaches $68,420 by year ten")

    # The eleven-column projection needs the width; the alternative is shrinking
    # the type until the table is unreadable.
    # A Word section is a page-setup marker in the same body, so the container
    # stays `doc` and only the theme changes to the landscape geometry.
    land = C.begin_landscape(doc, theme, title)
    C.section_opener(doc, land, "03", "Year-by-year projection", "The model output")
    C.gap(doc, land)
    C.data_table(
        doc, land,
        ["Year", "Rent", "Vacancy", "Expenses", "Interest", "Pre-tax", "Deprec.",
         "Taxable", "Tax effect", "After tax", "Cumulative"],
        f.rows("cashflow.years", [
            ["1", "$39,780", "-$1,530", "-$9,215", "-$44,288", "-$15,253", "-$11,400",
             "-$26,653", "$10,395", "-$4,858", "-$4,858"],
            ["2", "$40,973", "-$1,576", "-$9,445", "-$44,288", "-$14,336", "-$9,800",
             "-$24,136", "$9,413", "-$4,923", "-$9,781"],
            ["3", "$42,202", "-$1,623", "-$9,682", "-$44,288", "-$13,391", "-$8,600",
             "-$21,991", "$8,576", "-$4,815", "-$14,596"],
            ["4", "$43,468", "-$1,672", "-$9,924", "-$44,288", "-$12,416", "-$7,700",
             "-$20,116", "$7,845", "-$4,571", "-$19,167"],
            ["5", "$44,772", "-$1,722", "-$10,172", "-$44,288", "-$11,410", "-$7,000",
             "-$18,410", "$7,180", "-$4,230", "-$23,397"],
            ["6", "$46,115", "-$1,774", "-$10,426", "-$42,104", "-$8,189", "-$6,400",
             "-$14,589", "$5,690", "-$2,499", "-$25,896"],
            ["7", "$47,499", "-$1,827", "-$10,687", "-$40,982", "-$5,997", "-$5,900",
             "-$11,897", "$4,640", "-$1,357", "-$27,253"],
            ["8", "$48,924", "-$1,882", "-$10,954", "-$39,798", "-$3,710", "-$5,500",
             "-$9,210", "$3,592", "-$118", "-$27,371"],
            ["9", "$50,392", "-$1,938", "-$11,228", "-$38,549", "-$1,323", "-$5,100",
             "-$6,423", "$2,505", "$1,182", "-$26,189"],
            ["10", "$51,904", "-$1,996", "-$11,509", "-$37,232", "$1,167", "-$4,800",
             "-$3,633", "$1,417", "$2,584", "-$23,605"],
        ], ["{{year}}", "{{rent}}", "{{vacancy}}", "{{expenses}}", "{{interest}}",
            "{{preTax}}", "{{depreciation}}", "{{taxable}}", "{{taxEffect}}",
            "{{afterTax}}", "{{cumulative}}"], count=10),
        widths=[16, 26, 24, 26, 26, 24, 24, 24, 25, 25, 26],
        numeric_cols={1, 2, 3, 4, 5, 6, 7, 8, 9, 10},
        total_row=["Total", "$456,029", "-$17,540", "-$103,242", "-$420,105", "-$84,858",
                   "-$72,200", "-$157,058", "$61,253", "-$23,605", ""],
        caption="Ten-year after-tax cash flow",
        note="Negative figures are outflows. 'Tax effect' is the reduction in tax payable "
             "from the taxable loss at the stated marginal rate; it is a benefit only to "
             "the extent there is other income to offset.")
    C.end_landscape(doc, theme, title)

    C.section_opener(doc, theme, "04", "Expense breakdown", "Where year one goes")
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="Year-one expenses by category",
                rows=f.tuples("expenses.breakdown", [
                    ("Loan interest", 44288, "$44,288"),
                    ("Property management", 2745, "$2,745"),
                    ("Council rates", 2140, "$2,140"),
                    ("Insurance", 1650, "$1,650"),
                    ("Repairs allowance", 1500, "$1,500"),
                    ("Water and sewer", 1180, "$1,180"),
                ], ("{{expense.name}}", 1, "{{expense.amount}}"), count=5),
                note="Interest is 82% of year-one outgoings, which is why the projection "
                     "is more sensitive to rates than to anything else.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "05", "Sensitivity", "What changes the answer")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Base", "Rate +1%", "Rate +2%", "Vacancy 6 wks", "Rent -10%"],
        attributes=[
            ("Year-1 after tax", ["-$4,858", "-$9,077", "-$13,296", "-$7,655", "-$7,285"]),
            ("Year-1 weekly", ["-$93", "-$175", "-$256", "-$147", "-$140"]),
            ("Break-even year", ["Year 6", "Year 8", "Year 9", "Year 7", "Year 8"]),
            ("10-year cumulative", ["-$23,605", "-$58,420", "-$93,235", "-$41,180",
                                    "-$52,940"]),
        ],
        caption="After-tax position under stress", winner_index=0)
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Read this alongside the projection",
        text=f("report.caveat",
               "This is a projection on stated assumptions, not a forecast. It excludes "
               "capital growth, which is the return most investors are actually buying, "
               "and it excludes selling costs and capital gains tax. It is not tax advice; "
               "the depreciation and tax figures should be confirmed with the client's "
               "accountant against their whole position."))
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Lending Recommendation Report — Premium Advisory
# ==========================================================================

def lending_recommendation_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Credit recommendation",
        title=f("report.title", "Lending Recommendation"),
        subtitle=f("report.subtitle",
                   "The lender, product and structure we recommend, why, what else we "
                   "considered, and the disclosures that accompany it."),
        chips=["RECOMMENDATION", "DISCLOSED"])
    page_break(doc)

    C.recommendation_box(
        doc, theme,
        recommendation=f("recommendation.statement",
                         "Lender A — Investment IO Package, $648,000, interest only for "
                         "five years, split 70/30 variable and fixed, with a 100% offset "
                         "against the variable portion."),
        rationale=f.text("recommendation.rationale", [
            "This structure meets your stated priority of minimising outgoings during the "
            "build phase while preserving the flexibility to make lump-sum reductions "
            "once the second property settles.",
        ]),
        actions=f.items("recommendation.actions", [
            "Confirm you accept the $395 annual package fee.",
            "Confirm the 70/30 variable/fixed split.",
            "Provide the outstanding documents listed in section eight.",
        ]),
        confidence=f("recommendation.confidence", "High"))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "01", "Your objectives & requirements",
                     "As you described them to us")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Your objectives", columns=1, fields=[
        ("Primary objective", f("objectives.primary",
                                "Acquire a second investment property within 12 months")),
        ("Repayment preference", f("objectives.repayment",
                                   "Minimise outgoings during the build phase")),
        ("Rate preference", f("objectives.rate",
                              "Some certainty; comfortable with partial variable")),
        ("Features required", f("objectives.features",
                                "Offset account; ability to make lump-sum reductions")),
        ("Term", f("objectives.term", "30 years")),
        ("Stated constraints", f("objectives.constraints",
                                 "No cross-collateralisation; single lender exposure "
                                 "below $1.5m")),
    ], footnote="These are recorded as you described them. If any of them has changed, "
                "tell us before you act on this recommendation.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Your financial position", "What we assessed")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Applicant 1", "Applicant 2", "Combined"],
        f.rows("position", [
            ["Gross income", "$160,000", "$98,000", "$258,000"],
            ["Assessed income after shading", "$156,400", "$98,000", "$254,400"],
            ["Existing commitments", "—", "—", "$7,779/mo"],
            ["Declared living expenses", "—", "—", "$5,840/mo"],
            ["Applied living expenses (HEM)", "—", "—", "$6,120/mo"],
            ["Assets", "—", "—", "$1,842,000"],
            ["Liabilities", "—", "—", "$853,400"],
            ["Net position", "—", "—", "$988,600"],
        ], ["{{item}}", "{{a1}}", "{{a2}}", "{{combined}}"], count=6),
        widths=[68, 36, 36, 38], numeric_cols={1, 2, 3},
        caption="Financial position as assessed")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Why this recommendation", "Against your objectives")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="Reasoning",
        headline=f("report.headline",
                   "Lender A is the only option on the panel that meets all five of your "
                   "stated requirements without compromise."),
        paragraphs=f.text("report.reasoning", [
            "You asked for minimised outgoings during the build phase. Interest only for "
            "five years reduces the monthly commitment by approximately $1,140 against "
            "principal and interest, and Lender A permits interest only on an investment "
            "purpose without an interest-rate loading.",
            "You asked for some rate certainty. A 70/30 split fixes $194,400 for three "
            "years while leaving $453,600 variable and fully offset, so lump-sum "
            "reductions remain available once the second property settles.",
            "You asked not to cross-collateralise. Lender A will take the new security "
            "standalone. Two lenders on the panel would not, and one would only at a "
            "higher rate.",
            "The alternatives are set out in section four. Lender C is 0.05% cheaper on "
            "the headline rate and has no offset account, which on your typical $40,000 "
            "balance costs approximately $2,440 a year — more than the rate saves.",
        ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Alternatives considered", "What else we assessed")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Lender A — recommended", "Lender B", "Lender C"],
        attributes=[
            ("Rate", ["6.14%", "6.22%", "6.09%"]),
            ("Interest only permitted", ["Yes, no loading", "Yes, +0.15%", "Yes, no loading"]),
            ("Offset account", ["Yes", "Yes", "No"]),
            ("Standalone security", ["Yes", "Yes", "No — requires cross-collateral"]),
            ("Split permitted", ["Up to 6", "Up to 4", "No"]),
            ("Annual fee", ["$395", "$0", "$0"]),
            ("Meets your requirements", ["All five", "Four of five", "Two of five"]),
            ("Why not recommended", ["—", "IO loading of 0.15%",
                                     "No offset; requires cross-collateralisation"]),
        ],
        caption="Alternatives assessed", winner_index=0)
    page_break(doc)

    C.section_opener(doc, theme, "05", "Costs & fees", "Everything payable")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Fee", "Amount", "When", "Payable to"],
        f.rows("costs", [
            ["Application fee", "$0", "Waived under the package", "Lender"],
            ["Valuation fee", "$0", "Waived under the package", "Lender"],
            ["Settlement fee", "$350", "At settlement", "Lender"],
            ["Annual package fee", "$395", "Annually from settlement", "Lender"],
            ["Rate lock fee (optional)", "$750", "At application if elected", "Lender"],
            ["Discharge fee", "$350", "If refinanced or repaid", "Lender"],
            ["Broker fee", "$0", "—", "—"],
        ], ["{{fee}}", "{{amount}}", "{{when}}", "{{payable}}"], count=6),
        widths=[54, 26, 56, 34], numeric_cols={1},
        total_row=["Payable at settlement", "$350", "", ""],
        caption="Costs and fees",
        note="Government charges (mortgage registration and transfer duty) are payable "
             "separately and are not included above.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Disclosures", "What you must be told")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Disclosures",
        text=f("disclosures.intro",
               "We are required to disclose the following, and you should read it before "
               "acting on this recommendation."),
        items=f.items("disclosures.items", [
            "We will receive an upfront commission from the lender of approximately "
            "0.65% of the loan amount, and a trail commission of approximately 0.18% "
            "per annum on the outstanding balance.",
            "Commission rates differ between lenders on our panel. The recommended "
            "lender is not the highest-paying lender on the panel.",
            "We access a panel of 14 lenders. We are not able to recommend products "
            "outside that panel and other lenders may offer more suitable products.",
            "We hold Australian Credit Licence {{org.acl}} and are authorised through "
            "{{org.aggregator}}.",
            "We have no ownership relationship with any lender on our panel.",
        ], count=5))
    page_break(doc)

    C.section_opener(doc, theme, "07", "Risks & things to consider", "Before you accept")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Risks & things to consider", risks=f.tuples("risks", [
        ("The interest-only period ends after five years", "High",
         "Repayments will increase by approximately $1,340 a month when the loan reverts "
         "to principal and interest over the remaining 25-year term. Plan for this now, "
         "not in year five."),
        ("Break costs apply to the fixed portion", "Medium",
         "Repaying or refinancing the fixed $194,400 before the three-year term ends may "
         "incur a break cost that cannot be quantified in advance."),
        ("Rates may rise", "Medium",
         "The variable portion is unhedged. At +2% your repayment increases by "
         "approximately $756 a month. We have stress-tested your position at +2% and it "
         "remains serviceable."),
        ("Approval is not guaranteed", "Medium",
         "This is a recommendation, not an approval. The lender will form its own view "
         "on a full application and may decline or vary the terms."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Next steps", "From acceptance to settlement")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("nextSteps", [
        ("Accept", "Sign the acknowledgement below and return it."),
        ("Documents", "Provide payslips, tax returns and the contract of sale."),
        ("Submit", "We lodge the application; assessment typically takes 5–8 days."),
        ("Approve", "Formal approval issued; you review and sign the loan documents."),
        ("Settle", "Settlement booked with your conveyancer."),
    ], ("{{step.name}}", "{{step.detail}}"), count=5))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "09", "Acknowledgement", "Your confirmation")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="What you are acknowledging",
        text=f("acknowledgement.text",
               "By signing below you confirm that you have read this recommendation, "
               "that the objectives and requirements recorded in section one are "
               "accurate, that you have read the disclosures in section six, and that "
               "you understand this is a recommendation and not an approval."))
    C.gap(doc, theme, 0.7)
    C.signature_block(doc, theme, [
        ("Applicant 1", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Applicant 2", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Refinance Assessment — Financial Analytical
# ==========================================================================

def refinance_assessment(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Switching analysis",
        title=f("report.title", "Refinance Assessment"),
        subtitle=f("report.subtitle",
                   "Whether refinancing is worth doing, what it costs to switch, and "
                   "after how many months it pays for itself."),
        chips=["BREAK-EVEN", "AS AT 31/07/26"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Verdict", "The answer first")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Verdict",
        recommendation=f("report.verdict",
                         "Refinance. The switch saves $4,128 a year and pays back its "
                         "$2,340 cost in seven months."),
        rationale=f.text("report.verdictRationale", [
            "Your current rate of 6.84% is 0.70% above the best available on your "
            "profile. On a balance of $589,400 that is $4,128 a year, against a total "
            "switching cost of $2,340. Even allowing for a further 0.15% of rate creep "
            "at the new lender over two years, the switch is clearly worthwhile.",
        ]),
        actions=f.items("report.verdictActions", [
            "Confirm you are comfortable losing the redraw history on the current loan.",
            "Provide two recent payslips and the last twelve months of loan statements.",
            "We lodge the application; expect settlement in four to six weeks.",
        ]),
        confidence=f("report.confidence", "High"))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Headline numbers", "What changes")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("MONTHLY SAVING", f("refinance.monthly", "$344"), "First year"),
        ("ANNUAL SAVING", f("refinance.annual", "$4,128"), "At current balance"),
        ("SWITCHING COST", f("refinance.cost", "$2,340"), "All fees"),
        ("BREAK-EVEN", f("refinance.breakEven", "7 months"), "Cost recovered"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "03", "Current position", "What you have now")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Detail"],
        f.rows("refinance.current", [
            ["Lender", "Current lender"],
            ["Product", "Standard variable, investment"],
            ["Balance", "$589,400"],
            ["Rate", "6.84%"],
            ["Comparison rate", "6.91%"],
            ["Repayment type", "Principal and interest"],
            ["Remaining term", "26 years 4 months"],
            ["Monthly repayment", "$3,946"],
            ["Annual fees", "$395"],
            ["Offset balance", "$41,200"],
            ["Fixed portion", "None"],
        ], ["{{item}}", "{{detail}}"], count=8),
        widths=[70, 108], caption="Current facility")
    page_break(doc)

    C.section_opener(doc, theme, "04", "Proposed position", "What replaces it")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Proposed", "Current", "Change"],
        f.rows("refinance.proposed", [
            ["Lender", "Lender A", "Current lender", "—"],
            ["Rate", "6.14%", "6.84%", "−0.70%"],
            ["Comparison rate", "6.41%", "6.91%", "−0.50%"],
            ["Balance", "$589,400", "$589,400", "—"],
            ["Remaining term", "26 years 4 months", "26 years 4 months", "Retained"],
            ["Monthly repayment", "$3,602", "$3,946", "−$344"],
            ["Annual fees", "$395", "$395", "—"],
            ["Offset account", "Yes, 100%", "Yes, 100%", "Retained"],
            ["Interest over remaining term", "$549,180", "$657,940", "−$108,760"],
        ], ["{{item}}", "{{proposed}}", "{{current}}", "{{change}}"], count=7),
        widths=[56, 44, 44, 34], emphasis_rows={1, 5, 8},
        caption="Proposed facility",
        note="Term is deliberately retained rather than reset to 30 years. Resetting "
             "would lower the repayment further but would add approximately $71,000 of "
             "interest over the life of the loan.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "05", "Switching costs", "What it costs to move")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Cost", "Amount", "Payable to", "Note"],
        f.rows("refinance.costs", [
            ["Discharge fee", "$350", "Current lender", "Fixed"],
            ["Mortgage discharge registration", "$174", "Land registry", "State fee"],
            ["Mortgage registration", "$174", "Land registry", "State fee"],
            ["Settlement fee", "$350", "New lender", "Fixed"],
            ["Valuation fee", "$0", "New lender", "Waived under the package"],
            ["Application fee", "$0", "New lender", "Waived under the package"],
            ["Break cost", "$0", "Current lender", "No fixed portion"],
            ["Legal / settlement agent", "$1,292", "Settlement agent", "Estimate"],
        ], ["{{cost}}", "{{amount}}", "{{payable}}", "{{note}}"], count=6),
        widths=[62, 26, 46, 44], numeric_cols={1},
        total_row=["Total switching cost", "$2,340", "", ""],
        caption="Switching costs")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Break-even", "When the switch pays for itself")
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="Cumulative saving against switching cost",
                rows=f.tuples("refinance.breakEvenSeries", [
                    ("Month 3", 1032, "$1,032"),
                    ("Month 6", 2064, "$2,064"),
                    ("Month 7", 2408, "$2,408 — break-even"),
                    ("Month 12", 4128, "$4,128"),
                    ("Month 24", 8256, "$8,256"),
                ], ("{{point.label}}", 1, "{{point.value}}"), count=5),
                note="Break-even is the month in which cumulative saving first exceeds "
                     "the $2,340 switching cost. Savings after that point are net.")
    page_break(doc)

    C.section_opener(doc, theme, "07", "Considerations", "What you give up")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Considerations", risks=f.tuples("considerations", [
        ("Redraw history and available redraw are not transferred", "Medium",
         "$18,400 of available redraw on the current loan will be lost. If you may need "
         "it, draw it into the offset before discharge."),
        ("A new credit enquiry is recorded", "Low",
         "One enquiry has a minimal effect on your file. Avoid applying for other credit "
         "in the same period."),
        ("The new rate is not guaranteed until settlement", "Medium",
         "The rate may move before settlement. A rate lock is available for $750; on a "
         "$344 monthly saving it is worth taking only if settlement is more than eight "
         "weeks away."),
        ("Introductory pricing may revert", "Medium",
         "Confirm whether the 6.14% is an ongoing rate or a discount with an expiry. We "
         "have confirmed it is ongoing for the life of the package."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Next steps", "What we need from you")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("nextSteps", [
        "Confirm you accept the loss of the $18,400 redraw balance.",
        "Provide two recent payslips for each applicant.",
        "Provide the last twelve months of statements for the current loan.",
        "Confirm whether you want the $750 rate lock.",
        "Nominate a settlement agent, or ask us to appoint one.",
    ], count=5), title="Before we lodge", columns=1)
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Equity Release Strategy — Modern Technology
# ==========================================================================

def equity_release_strategy(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Usable equity & deployment",
        title=f("report.title", "Equity Release Strategy"),
        subtitle=f("report.subtitle",
                   "How much equity you can access across your assets, how to access it, "
                   "what it costs, and what it can fund."),
        chips=["4 ASSETS", "AT 80% AND 90% LVR"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Available equity", "The headline position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("TOTAL EQUITY", f("equity.total", "$2,065,000"), "Value less debt"),
        ("USABLE AT 80%", f("equity.usable80", "$1,082,600"), "No LMI"),
        ("USABLE AT 90%", f("equity.usable90", "$1,573,800"), "LMI payable"),
        ("COST TO ACCESS", f("equity.cost", "$4,980"), "At 80%, all fees"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Summary", "What the equity can fund")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="Summary",
        headline=f("report.headline",
                   "$1,082,600 is accessible at 80% without LMI — enough for two further "
                   "acquisitions at your current price point, funded entirely from "
                   "existing assets."),
        paragraphs=f.text("report.summary", [
            "Three of your four assets hold usable equity at 80% LVR. The fourth, 21 Test "
            "Road, is above 100% LVR and contributes nothing; it is excluded from every "
            "figure in this report.",
            "Accessing equity at 80% costs $4,980 in valuation, application and legal "
            "fees across three facilities. Pushing to 90% releases a further $491,200 but "
            "attracts approximately $18,400 of lenders mortgage insurance, which is not "
            "recoverable and is rarely worth paying for investment purposes.",
            "The recommended structure is three standalone equity release facilities "
            "rather than one consolidated facility, so each stays tied to its own "
            "security and no cross-collateralisation is created.",
        ]))
    page_break(doc)

    C.section_opener(doc, theme, "03", "Equity by asset", "Where it sits")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Asset", "Value", "Debt", "Equity", "LVR", "Usable at 80%", "Usable at 90%"],
        f.rows("assets", [
            ["4 Example St", "$1,284,000", "$412,000", "$872,000", "32.1%", "$615,200",
             "$743,600"],
            ["12 Sample Ave", "$1,196,000", "$389,000", "$807,000", "32.5%", "$567,800",
             "$687,400"],
            ["9 Demo Close", "$1,318,000", "$864,000", "$454,000", "65.6%", "$190,400",
             "$322,200"],
            ["21 Test Rd", "$1,114,000", "$1,182,000", "-$68,000", "106.1%", "$0", "$0"],
        ], ["{{address}}", "{{value}}", "{{debt}}", "{{equity}}", "{{lvr}}",
            "{{usable80}}", "{{usable90}}"], count=4),
        widths=[40, 34, 32, 32, 22, 32, 32],
        numeric_cols={1, 2, 3, 4, 5, 6},
        total_row=["Portfolio", "$4,912,000", "$2,847,000", "$2,065,000", "58.0%",
                   "$1,373,400", "$1,753,200"],
        caption="Equity position by asset",
        note="Usable equity is the amount that can be drawn without exceeding the stated "
             "LVR on that security. Portfolio totals exclude the negative position on "
             "21 Test Road; the practical figure at 80% is $1,082,600 after allowing for "
             "single-lender exposure limits.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Release options", "Four ways to structure it")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["3 standalone", "Single top-up", "Cross-collateralised",
                        "New lender"],
        attributes=[
            ("Structure", ["One facility per security", "Increase one existing loan",
                           "One facility over three securities", "Refinance all to one lender"]),
            ("Amount released", ["$1,082,600", "$615,200", "$1,373,400", "$1,082,600"]),
            ("Cost", ["$4,980", "$1,660", "$3,320", "$8,940"]),
            ("Cross-collateralisation", ["None", "None", "Yes — all three", "None"]),
            ("Time to access", ["4–6 weeks", "2–3 weeks", "4–6 weeks", "6–8 weeks"]),
            ("Sell an asset later", ["Simple", "Simple", "Requires full revaluation",
                                     "Simple"]),
            ("Recommended", ["Yes", "If speed matters", "No", "No"]),
        ],
        caption="Release options", winner_index=0)
    page_break(doc)

    C.section_opener(doc, theme, "05", "Cost of access", "Every fee")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Cost", "Per facility", "Facilities", "Total", "Note"],
        f.rows("costs", [
            ["Valuation fee", "$550", "3", "$1,650", "Full valuation required above $500k"],
            ["Application / top-up fee", "$300", "3", "$900", "Waived on one package"],
            ["Legal and settlement", "$610", "3", "$1,830", "Estimate"],
            ["Title search and registration", "$200", "3", "$600", "State fees"],
            ["Lenders mortgage insurance", "$0", "—", "$0", "Not payable at 80% LVR"],
        ], ["{{cost}}", "{{per}}", "{{count}}", "{{total}}", "{{note}}"], count=5),
        widths=[52, 28, 22, 28, 48], numeric_cols={1, 2, 3},
        total_row=["Total cost of access", "", "", "$4,980", ""],
        caption="Cost to access at 80% LVR",
        note="At 90% LVR add approximately $18,400 of lenders mortgage insurance. LMI is "
             "not refundable and is not tax deductible in the year paid; it is amortised "
             "over five years or the loan term, whichever is shorter.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Deployment plan", "What the funds are for")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("deployment", [
        ("Release", "Establish three facilities totalling $1,082,600."),
        ("Hold", "Funds sit in offset against the released facilities — no interest cost "
                 "until drawn."),
        ("Deploy 1", "First acquisition: deposit and costs of approximately $212,000."),
        ("Deploy 2", "Second acquisition within 12 months: approximately $224,000."),
        ("Reserve", "Retain $120,000 as a serviceability and contingency buffer."),
    ], ("{{step.name}}", "{{step.detail}}"), count=5))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Interest cost while undeployed",
        text="Released funds held in an offset account against their own facility cost "
             "nothing until drawn. That is why we recommend releasing before you find a "
             "property rather than after — it removes finance from the critical path "
             "without carrying an interest cost.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "07", "Risks", "What to watch")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Risks", risks=f.tuples("risks", [
        ("Valuations come in below the assumed figures", "High",
         "Every figure here depends on the assumed values. Order upfront valuations "
         "before committing to any purchase timeline."),
        ("Cross-collateralisation if the lender insists", "High",
         "Two lenders on the panel will only release equity across a combined security "
         "pool. Decline those options; the flexibility cost is not worth the marginal "
         "rate saving."),
        ("Serviceability limits the release before LVR does", "Medium",
         "At $1,082,600 of additional debt your assessed surplus falls to $410 a month. "
         "The binding constraint is servicing, not equity."),
        ("Portfolio LVR rises to 69.1%", "Medium",
         "Inside your stated 70% limit but with little headroom. A 5% fall in values "
         "would breach it."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Next steps", "To release")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("nextSteps", [
        "Confirm you want three standalone facilities rather than one consolidated one.",
        "Authorise upfront valuations on the three qualifying securities.",
        "Provide the last two years of tax returns and current payslips.",
        "Confirm the intended purpose of the funds for each facility.",
        "Confirm you accept the portfolio LVR moving to 69.1%.",
    ], count=5), title="Before we lodge", columns=1)
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Serviceability Assessment — Financial Analytical (internal working paper)
# ==========================================================================

def serviceability_assessment(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Internal working paper — not for client circulation",
        title=f("report.title", "Serviceability Assessment"),
        subtitle=f("assessment.identity",
                   "Lender A calculator v4.2 — line-by-line servicing calculation "
                   "supporting the submission."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client", f("client.name", "{{client.name}}")),
        ("File reference", f("client.reference", "{{client.reference}}")),
        ("Lender", f("assessment.lender", "{{assessment.lender}}")),
        ("Calculator version", f("assessment.calculatorVersion", "{{assessment.calculatorVersion}}")),
        ("Prepared by", f("author.name", "{{author.name}}")),
        ("Assessment date", f("assessment.date", "{{assessment.date}}")),
    ])
    C.gap(doc, theme, 0.7)

    C.section_opener(doc, theme, "01", "Outcome", "Surplus and maximum loan")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("MONTHLY SURPLUS", f("outcome.surplus", "$1,842"), "After assessed commitments"),
        ("NET SURPLUS RATIO", f("outcome.nsr", "1.14"), "Minimum 1.00"),
        ("MAXIMUM LOAN", f("outcome.maxLoan", "$1,284,000"), "At the assessment rate"),
        ("ASSESSMENT RATE", f("outcome.rate", "8.95%"), "6.14% + 2.81% buffer"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Income", "Every line, with shading applied")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Line", "Applicant", "Income type", "Gross p.a.", "Shading",
                     "Assessed p.a.", "Assessed p.m."],
        f.rows("income", [
            ["2.01", "Applicant 1", "PAYG base salary", "$142,000", "100%", "$142,000",
             "$11,833"],
            ["2.02", "Applicant 1", "Bonus, 2-year average", "$18,000", "80%", "$14,400",
             "$1,200"],
            ["2.03", "Applicant 2", "PAYG base salary", "$98,000", "100%", "$98,000",
             "$8,167"],
            ["2.04", "Joint", "Rent — 4 Example St", "$41,600", "90%", "$37,440", "$3,120"],
            ["2.05", "Joint", "Rent — 12 Sample Ave", "$38,480", "90%", "$34,632", "$2,886"],
            ["2.06", "Joint", "Rent — proposed security", "$39,780", "90%", "$35,802",
             "$2,984"],
        ], ["{{line}}", "{{applicant}}", "{{type}}", "{{gross}}", "{{shading}}",
            "{{assessed}}", "{{monthly}}"], count=6),
        widths=[18, 32, 44, 30, 20, 30, 26], numeric_cols={3, 4, 5, 6},
        total_row=["", "", "Total assessed income", "$377,860", "", "$362,274", "$30,190"],
        caption="Income",
        note="Lender A shades residential rental income to 90% and bonus income to 80% "
             "on a two-year average. Line references are cited in the calculation at "
             "section five.")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Commitments", "With assessment treatment")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Line", "Commitment", "Lender", "Limit / balance", "Actual p.m.",
                     "Treatment", "Assessed p.m."],
        f.rows("commitments", [
            ["3.01", "Home loan — 4 Example St", "Lender A", "$412,000", "$2,310",
             "At assessment rate, P&I", "$3,140"],
            ["3.02", "Home loan — 12 Sample Ave", "Lender B", "$389,000", "$2,180",
             "At assessment rate + 0.25%", "$2,965"],
            ["3.03", "Credit card", "Lender A", "$18,000", "$0", "3.8% of limit", "$684"],
            ["3.04", "Credit card", "Lender C", "$10,000", "$0", "3.8% of limit", "$380"],
            ["3.05", "Car loan", "Lender D", "$24,400", "$610", "Actual repayment", "$610"],
            ["3.06", "Proposed loan", "Lender A", "$648,000", "—",
             "At assessment rate, P&I over 30 yrs", "$5,172"],
        ], ["{{line}}", "{{commitment}}", "{{lender}}", "{{limit}}", "{{actual}}",
            "{{treatment}}", "{{assessed}}"], count=6),
        widths=[18, 44, 24, 28, 24, 46, 26], numeric_cols={3, 4, 6},
        total_row=["", "", "", "", "", "Total assessed commitments", "$12,951"],
        caption="Commitments")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Living expenses", "Declared against benchmark")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Line", "Basis", "Amount p.m.", "Applied", "Note"],
        f.rows("expenses", [
            ["4.01", "Declared by applicants", "$5,840", "No", "Below benchmark"],
            ["4.02", "HEM benchmark — 2 adults, 2 dependants", "$6,120", "Yes",
             "Higher of the two is applied"],
            ["4.03", "Investment property outgoings", "$1,340", "Yes",
             "Not included in HEM"],
        ], ["{{line}}", "{{basis}}", "{{amount}}", "{{applied}}", "{{note}}"], count=3),
        widths=[18, 68, 28, 22, 42], numeric_cols={2},
        total_row=["", "Total applied living expenses", "$7,460", "", ""],
        caption="Living expenses")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Calculation", "Line by line to the outcome")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Line", "Description", "Reference", "Amount p.m."],
        f.rows("calculation", [
            ["5.01", "Total assessed income", "2.01–2.06", "$30,190"],
            ["5.02", "Less income tax and Medicare", "Derived", "-$7,938"],
            ["5.03", "Net assessed income", "5.01 − 5.02", "$22,252"],
            ["5.04", "Less assessed commitments", "3.01–3.06", "-$12,951"],
            ["5.05", "Less applied living expenses", "4.01–4.03", "-$7,460"],
            ["5.06", "Monthly surplus", "5.03 − 5.04 − 5.05", "$1,841"],
            ["5.07", "Net surplus ratio", "5.03 ÷ (5.04 + 5.05)", "1.14"],
        ], ["{{line}}", "{{description}}", "{{reference}}", "{{amount}}"], count=7),
        widths=[18, 84, 42, 34], numeric_cols={3}, emphasis_rows={5, 6},
        total_row=["", "Outcome", "NSR minimum 1.00", "PASS"],
        caption="Servicing calculation",
        note="Every figure above is traceable to a numbered line in sections two to "
             "four. A reviewer should be able to re-perform this calculation without "
             "reference to the lender's calculator.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Policy notes", "How each item was treated")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Policy item", "Treatment applied", "Status"],
        rows=f.tuples("policy", [
            (["6.01", "Bonus income", "Accepted at 80% on a two-year average", "Pass"],
             "pass"),
            (["6.02", "Rental shading", "90% — Lender A standard", "Pass"], "pass"),
            (["6.03", "Existing debt with other lenders", "Loaded 0.25% above assessment "
              "rate", "Pass"], "pass"),
            (["6.04", "Credit card limits", "3.8% of limit regardless of balance",
              "Review"], "review"),
            (["6.05", "Single-lender exposure", "$1,060,000 against a $1.5m limit",
              "Pass"], "pass"),
            (["6.06", "Interest-only period", "Assessed P&I over the residual term",
              "Pass"], "pass"),
        ], (["{{ref}}", "{{item}}", "{{treatment}}", "Pending"], "pending"), count=6),
        widths=[18, 52, 82, 26], caption="Policy treatment",
        note="6.04 is flagged for review: reducing the combined $28,000 of card limits "
             "to $10,000 would add approximately $684 a month of surplus and $96,000 of "
             "capacity.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "07", "Reviewer sign-off", "Prepared and checked")
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Prepared by", f("author.name", "{{author.name}}"), "Complete"),
        ("Checked by", f("reviewer.name", "{{reviewer.name}}"), "Pending"),
    ], ("{{role}}", "{{name}}", "Pending"), count=2))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="Circulation",
        text="This is an internal working paper prepared to support a credit submission. "
             "It is not a client-facing document, is not credit assistance, and must not "
             "be provided to the applicants or to any third party without compliance "
             "approval.")


# ==========================================================================
# Construction Finance Report — Financial Analytical
# ==========================================================================

def construction_finance_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Build funding structure",
        title=f("report.title", "Construction Finance Report"),
        subtitle=f("project.identity",
                   "Lot 148, Riverbend Estate — how the build is funded, what it costs "
                   "while it is building, and the position at completion."),
        chips=["STAGED", "IDC MODELLED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Funding summary", "The headline structure")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("LAND FACILITY", f("funding.land", "$267,280"), "80% of $334,100"),
        ("BUILD FACILITY", f("funding.build", "$360,320"), "80% of $450,400"),
        ("TOTAL FACILITY", f("funding.total", "$627,600"), "80% of on-completion value"),
        ("INTEREST DURING BUILD", f("funding.idc", "$14,860"), "44 weeks, capitalised"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Structure", "The facilities")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Facility", "Purpose", "Limit", "Rate", "Type", "Term", "Repayment"],
        f.rows("facilities", [
            ["Land", "Settle the land contract", "$267,280", "6.34%", "Variable",
             "30 years", "Interest only during build"],
            ["Construction", "Fund progress claims", "$360,320", "6.54%", "Variable",
             "30 years", "Interest only on drawn balance"],
        ], ["{{facility}}", "{{purpose}}", "{{limit}}", "{{rate}}", "{{type}}",
            "{{term}}", "{{repayment}}"], count=2),
        widths=[26, 46, 28, 20, 24, 22, 46], numeric_cols={2, 3},
        total_row=["Total", "", "$627,600", "6.45%", "", "", ""],
        caption="Facility structure",
        note="Interest is charged only on the drawn balance of the construction facility, "
             "so the effective cost during the build is far below the full limit.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "03", "Drawdown schedule", "Staged against build progress")
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("drawdowns", [
        ("Week 0", "Land settlement — $267,280",
         "Land facility fully drawn · cumulative $267,280"),
        ("Week 4", "Deposit — $22,520",
         "5% of build contract · cumulative $289,800"),
        ("Week 10", "Base stage — $67,560",
         "15% on slab · cumulative $357,360"),
        ("Week 20", "Frame stage — $90,080",
         "20% on frame · cumulative $447,440"),
        ("Week 32", "Lock-up — $112,600",
         "25% at lock-up · cumulative $560,040"),
        ("Week 40", "Fixing — $90,080",
         "20% at fixing · cumulative $650,120"),
        ("Week 44", "Completion — $67,560",
         "15% on practical completion · cumulative $717,680"),
    ], ("{{stage.when}}", "{{stage.name}}", "{{stage.detail}}"), count=6),
        caption="Progress drawdown schedule")
    page_break(doc)

    C.section_opener(doc, theme, "04", "Interest during construction", "What it costs to build")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Stage", "Weeks", "Drawn balance", "Rate", "Interest", "Cumulative"],
        f.rows("idc", [
            ["Land only", "0–4", "$267,280", "6.34%", "$1,304", "$1,304"],
            ["Deposit drawn", "4–10", "$289,800", "6.42%", "$2,146", "$3,450"],
            ["Base stage", "10–20", "$357,360", "6.45%", "$4,433", "$7,883"],
            ["Frame stage", "20–32", "$447,440", "6.47%", "$6,680", "$14,563"],
            ["Lock-up", "32–40", "$560,040", "6.49%", "$5,592", "$20,155"],
            ["Fixing to completion", "40–44", "$650,120", "6.50%", "$3,251", "$23,406"],
        ], ["{{stage}}", "{{weeks}}", "{{balance}}", "{{rate}}", "{{interest}}",
            "{{cumulative}}"], count=6),
        widths=[46, 22, 34, 22, 28, 30], numeric_cols={2, 3, 4, 5},
        total_row=["Total interest during construction", "44", "", "", "$23,406", ""],
        caption="Interest during construction",
        note="Interest is capitalised into the facility rather than paid monthly, so no "
             "cash contribution is required during the build. The capitalised amount "
             "increases the balance at completion.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "05", "Completion position", "Where you land")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Amount", "Note"],
        f.rows("completion", [
            ["Land price", "$334,100", "Settled at week 0"],
            ["Build contract", "$450,400", "Including upgrades"],
            ["Interest during construction", "$23,406", "Capitalised"],
            ["Total cost", "$807,906", "Excluding acquisition costs"],
            ["On-completion valuation", "$743,000", "Estimate — see the package assessment"],
            ["Debt at completion", "$651,006", "Facility plus capitalised interest"],
            ["LVR at completion", "87.6%", "Against the on-completion valuation"],
            ["Cash contributed", "$156,900", "Deposit and acquisition costs"],
        ], ["{{item}}", "{{amount}}", "{{note}}"], count=6),
        widths=[64, 34, 80], numeric_cols={1}, emphasis_rows={6},
        total_row=["Equity at completion", "$91,994", "Value less debt"],
        caption="Position at practical completion",
        note="An LVR of 87.6% against the on-completion valuation exceeds the 80% assumed "
             "when the facility was structured. This is the direct consequence of the "
             "package being priced above comparable completed stock, and it will require "
             "either LMI or an additional cash contribution at completion.")
    page_break(doc)

    C.section_opener(doc, theme, "06", "Conditions precedent", "Before each drawdown")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("conditions", [
        "Executed fixed-price building contract, signed by both parties.",
        "Builder's public liability and construction works insurance, current.",
        "Home warranty insurance certificate.",
        "Council-approved plans and the construction certificate.",
        "Lot registration confirmed and title issued.",
        "Progress claim certified by the lender's valuer before each drawdown.",
        "Final occupation certificate before the completion drawdown.",
    ], count=7), title="Conditions precedent", with_owner=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "07", "Risks", "What could go wrong")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Risks", risks=f.tuples("risks", [
        ("LVR at completion exceeds 80%", "High",
         "At 87.6% the lender will require LMI of approximately $19,400 or a further "
         "$59,000 cash contribution. Resolve this before signing the build contract, not "
         "at completion."),
        ("Build overruns the 44-week programme", "Medium",
         "Each additional month adds approximately $3,500 of capitalised interest and "
         "$2,250 of rent forgone. Liquidated damages of $180 a week recover only part."),
        ("Cost overrun on provisional sums", "Medium",
         "$23,800 of provisional sums and prime cost items are not fixed. Any overrun is "
         "a cash contribution, not a further drawdown, unless the facility is increased."),
        ("Registration delay pushes out the fixed-price period", "High",
         "The build price is fixed for 180 days. If registration slips beyond that the "
         "builder may reprice, and the facility was sized on the current price."),
        ("Builder insolvency", "Low",
         "Home warranty insurance covers completion but not delay. Confirm the builder's "
         "financial standing before the first drawdown."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=5))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Next steps", "From approval to first drawdown")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("nextSteps", [
        ("Resolve LVR", "Address the completion-LVR shortfall before signing the build "
                        "contract."),
        ("Approve", "Formal approval issued on both facilities."),
        ("Settle land", "Land facility drawn; title transferred."),
        ("Satisfy CPs", "Provide the conditions precedent listed in section six."),
        ("First claim", "Deposit drawdown released to the builder."),
    ], ("{{step.name}}", "{{step.detail}}"), count=5))
    C.disclaimer_page(doc, theme)


# ==========================================================================
# SMSF Finance Assessment — Compliance Structured
# ==========================================================================

def smsf_finance_assessment(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Limited-recourse borrowing arrangement",
        title=f("report.title", "SMSF Finance Assessment"),
        subtitle=f("fund.identity",
                   "Example Family Superannuation Fund — fund, trustee, asset and lender "
                   "requirements assessed before the arrangement is entered into."),
        chips=["LRBA", "ASSESSED", "REFERRAL REQUIRED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Scope & limitations", "Read this first")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="Scope & limitations",
        text=f("scope.text",
               "This assessment considers whether a limited-recourse borrowing "
               "arrangement is viable and whether it satisfies the lender's and the "
               "fund's structural requirements. It is not financial product advice, "
               "superannuation advice, tax advice or legal advice, and it does not "
               "consider whether the acquisition is appropriate for the fund's investment "
               "strategy."),
        items=f.items("scope.items", [
            "Reviewed: fund deed, trustee structure, member balances, lender criteria.",
            "Not reviewed: the fund's investment strategy or its appropriateness.",
            "Not reviewed: the tax consequences for the fund or its members.",
            "The trustees must obtain independent licensed advice before proceeding.",
        ], count=4))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Assessment outcome", "Viable, conditional or not")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Assessment outcome",
        recommendation=f("assessment.outcome",
                         "Conditionally viable. The arrangement satisfies the lender's "
                         "criteria subject to four outstanding structural items and "
                         "independent licensed advice."),
        rationale=f.text("assessment.rationale", [
            "The fund's balance, contribution history and the proposed asset all meet the "
            "lender's criteria comfortably. Liquidity after acquisition is adequate at "
            "14.2 months of expenses and repayments, above the lender's 12-month "
            "minimum.",
            "Four structural items are outstanding: the bare trust is not yet "
            "established, the holding trustee is not yet incorporated, the fund deed has "
            "not been reviewed for LRBA capacity, and the investment strategy has not "
            "been updated to contemplate a geared property acquisition.",
        ]),
        actions=f.items("assessment.conditions", [
            "Establish the bare trust and incorporate the holding trustee before exchange.",
            "Obtain a deed review confirming LRBA capacity.",
            "Update the investment strategy before the arrangement is entered into.",
            "Obtain independent licensed financial advice for the members.",
        ]),
        confidence=f("assessment.confidence", "Conditional"))
    page_break(doc)

    C.section_opener(doc, theme, "03", "Fund details", "The fund and its trustees")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Fund particulars", columns=2, fields=[
        ("Fund name", f("fund.name", "Example Family Superannuation Fund")),
        ("ABN", f("fund.abn", "42 123 456 789")),
        ("Established", f("fund.established", "March 2014")),
        ("Trustee structure", f("fund.trusteeType", "Corporate trustee")),
        ("Trustee entity", f("fund.trustee", "Example Super Pty Ltd (ACN 601 234 567)")),
        ("Members", f("fund.members", "2 — both directors of the trustee")),
        ("Total balance", f("fund.balance", "$1,284,600")),
        ("Member 1 balance", f("fund.member1", "$742,800")),
        ("Member 2 balance", f("fund.member2", "$541,800")),
        ("Contributions p.a.", f("fund.contributions", "$54,000 concessional")),
        ("Current liquid assets", f("fund.liquid", "$318,400")),
        ("Compliance status", f("fund.compliance", "Complying; last audit clear")),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Structure requirements", "What must exist")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Requirement", "Position", "Evidence", "Status"],
        rows=f.tuples("structure.controls", [
            (["4.1", "Corporate trustee for the fund", "In place since 2014",
              "ASIC extract", "Pass"], "pass"),
            (["4.2", "Fund deed permits borrowing under an LRBA", "Not yet confirmed",
              "Deed review requested", "Pending"], "pending"),
            (["4.3", "Bare trust established", "Not established",
              "To be prepared by the fund's solicitor", "Fail"], "fail"),
            (["4.4", "Holding trustee incorporated", "Not incorporated",
              "To be incorporated before exchange", "Fail"], "fail"),
            (["4.5", "Holding trustee is not the fund trustee", "Confirmed in the plan",
              "Structure diagram", "Pass"], "pass"),
            (["4.6", "Single acquirable asset", "One title, one dwelling",
              "Title search", "Pass"], "pass"),
            (["4.7", "Investment strategy contemplates geared property", "Not updated",
              "Strategy dated 2023", "Fail"], "fail"),
            (["4.8", "No related-party acquisition", "Arm's length vendor",
              "Contract of sale", "Pass"], "pass"),
        ], (["{{ref}}", "{{requirement}}", "{{position}}", "{{evidence}}", "Pending"],
            "pending"), count=6),
        widths=[16, 56, 44, 44, 26], caption="Structural requirements")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Contribution & liquidity", "Can the fund carry it")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Annual", "Monthly", "Note"],
        f.rows("liquidity", [
            ["Concessional contributions", "$54,000", "$4,500", "Both members, at cap"],
            ["Rental income — proposed asset", "$34,320", "$2,860", "Net of vacancy"],
            ["Investment income — existing assets", "$28,400", "$2,367", "Dividends and interest"],
            ["Loan repayments", "-$46,800", "-$3,900", "P&I over 20 years"],
            ["Property outgoings", "-$8,900", "-$742", "Rates, insurance, management"],
            ["Fund administration and audit", "-$4,200", "-$350", "Actual"],
            ["Insurance premiums", "-$6,400", "-$533", "Member policies"],
        ], ["{{item}}", "{{annual}}", "{{monthly}}", "{{note}}"], count=6),
        widths=[64, 30, 28, 56], numeric_cols={1, 2},
        total_row=["Net position", "$50,420", "$4,202", ""],
        caption="Contribution and liquidity",
        note="Liquidity buffer after acquisition is $318,400 against annual outgoings and "
             "repayments of $66,300 — 4.8 years of cover, well above the lender's "
             "12-month minimum.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "06", "Lender requirements", "Each one, with evidence")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Requirement", "Threshold", "Position", "Status"],
        rows=f.tuples("lender.requirements", [
            (["6.1", "Minimum fund balance", "$200,000", "$1,284,600", "Pass"], "pass"),
            (["6.2", "Maximum LVR", "70%", "62.5%", "Pass"], "pass"),
            (["6.3", "Liquidity after settlement", "12 months", "4.8 years", "Pass"],
             "pass"),
            (["6.4", "Minimum loan", "$150,000", "$480,000", "Pass"], "pass"),
            (["6.5", "Contribution history", "2 years", "11 years", "Pass"], "pass"),
            (["6.6", "Personal guarantees from members", "Required", "Both members agree",
              "Pass"], "pass"),
            (["6.7", "Bare trust documentation", "Before formal approval",
              "Not established", "Fail"], "fail"),
            (["6.8", "Independent legal advice certificate", "Required at settlement",
              "Not obtained", "Pending"], "pending"),
        ], (["{{ref}}", "{{requirement}}", "{{threshold}}", "{{position}}", "Pending"],
            "pending"), count=6),
        widths=[16, 60, 34, 44, 26], caption="Lender criteria")
    page_break(doc)

    C.section_opener(doc, theme, "07", "Servicing", "Fund-level calculation")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Line", "Description", "Amount p.a."],
        f.rows("servicing", [
            ["7.01", "Assessed rental income (80% shading)", "$27,456"],
            ["7.02", "Concessional contributions (100%)", "$54,000"],
            ["7.03", "Investment income (100%)", "$28,400"],
            ["7.04", "Total assessed income", "$109,856"],
            ["7.05", "Loan repayment at assessment rate of 9.15%", "-$58,320"],
            ["7.06", "Property outgoings", "-$8,900"],
            ["7.07", "Fund running costs", "-$10,600"],
            ["7.08", "Surplus", "$32,036"],
            ["7.09", "Net surplus ratio", "1.41"],
        ], ["{{line}}", "{{description}}", "{{amount}}"], count=8),
        widths=[20, 106, 52], numeric_cols={2}, emphasis_rows={7, 8},
        caption="Fund servicing",
        note="The lender shades rental income to 80% and assesses repayments at a 9.15% "
             "rate over 20 years. Contributions are accepted at 100% given an eleven-year "
             "history at or near the cap.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Risks", "What the trustees must weigh")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Risks", risks=f.tuples("risks", [
        ("Single-asset concentration", "High",
         "The proposed asset would represent 51% of fund assets. Trustees must satisfy "
         "themselves this is consistent with the diversification requirements of their "
         "investment strategy."),
        ("Member event — death, disability or departure", "High",
         "A member benefit payment could force a sale of an illiquid asset. Review "
         "insurance cover inside the fund before proceeding."),
        ("Contribution caps change or contributions stop", "Medium",
         "Servicing relies on $54,000 of contributions. Model the position with "
         "contributions at zero; surplus falls to a deficit of $21,964."),
        ("Refinancing an LRBA is constrained", "Medium",
         "Few lenders offer LRBA refinance. Assume the arrangement is held to term."),
        ("Structural non-compliance", "High",
         "An incorrectly established bare trust can jeopardise the fund's complying "
         "status. Use a solicitor experienced in LRBAs, not a template."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=5))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "09", "Outstanding items", "Before proceeding")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("outstanding", [
        "Obtain a deed review confirming the fund may borrow under an LRBA.",
        "Establish the bare trust through a solicitor experienced in LRBAs.",
        "Incorporate the holding trustee company.",
        "Update the fund's investment strategy to contemplate geared property.",
        "Obtain independent licensed financial advice for both members.",
        "Obtain the independent legal advice certificate required at settlement.",
    ], count=6), title="Outstanding", with_owner=True)
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Professional referrals",
        text="This assessment does not substitute for advice the trustees are required "
             "to obtain. Independent licensed financial advice, legal advice on the bare "
             "trust, and accounting advice on the tax consequences are each required "
             "before the arrangement is entered into.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "10", "Approvals", "Prepared and reviewed")
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Prepared by", f("author.name", "{{author.name}}"), "Complete"),
        ("Reviewed by", f("reviewer.name", "{{reviewer.name}}"), "Pending"),
        ("Trustee acknowledgement", f("fund.trustee", "{{fund.trustee}}"), "Pending"),
    ], ("{{role}}", "{{name}}", "Pending"), count=3))
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Finance Approval Summary — Minimal Professional
# ==========================================================================

def finance_approval_summary(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Approval confirmation",
        title=f("report.title", "Finance Approval Summary"),
        subtitle=f("approval.identity",
                   "Conditional approval issued — the amount, the conditions, the dates "
                   "and what happens next."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client", f("client.name", "{{client.name}}")),
        ("File reference", f("client.reference", "{{client.reference}}")),
        ("Lender", f("approval.lender", "{{approval.lender}}")),
        ("Approval date", f("approval.date", "{{approval.date}}")),
    ])
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "1", "Approval", "What has been approved")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("AMOUNT", f("approval.amount", "$648,000"), "Approved"),
        ("RATE", f("approval.rate", "6.14%"), "Variable, investment"),
        ("PRODUCT", f("approval.product", "Investment IO"), "5 years interest only"),
        ("EXPIRES", f("approval.expiry", "29/10/2026"), "90 days from issue"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "2", "Details", "The terms")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Approval detail", columns=2, fields=[
        ("Applicants", f("approval.applicants", "J. Nguyen and S. Nguyen")),
        ("Security", f("approval.security", "12 Example Street, Northbridge NSW 2063")),
        ("Purpose", f("approval.purpose", "Investment property purchase")),
        ("Loan amount", f("approval.amount", "$648,000")),
        ("Purchase price", f("approval.price", "$810,000")),
        ("LVR", f("approval.lvr", "80.0%")),
        ("Term", f("approval.term", "30 years")),
        ("Repayment type", f("approval.repayment", "Interest only, 5 years")),
        ("Monthly repayment", f("approval.monthly", "$3,316")),
        ("Offset account", f("approval.offset", "Included")),
        ("Annual package fee", f("approval.fee", "$395")),
        ("Approval type", f("approval.type", "Conditional")),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "3", "Conditions", "What must be satisfied")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("conditions", [
        "Satisfactory valuation of the security property.",
        "Executed contract of sale, signed by all parties.",
        "Evidence of the deposit paid.",
        "Confirmation of building insurance with the lender noted as an interested party.",
        "Certified identity documents for both applicants.",
    ], count=5), title="Outstanding conditions", with_owner=True)
    page_break(doc)

    C.section_opener(doc, theme, "4", "Key dates", "What is due when")
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("dates", [
        ("31/07/2026", "Approval issued", "Conditional approval; 90-day validity"),
        ("14/08/2026", "Finance date", "Conditions must be satisfied by this date"),
        ("21/08/2026", "Loan documents issued", "Allow five business days to sign"),
        ("18/09/2026", "Settlement", "Per the contract of sale"),
        ("29/10/2026", "Approval expires", "Re-application required after this date"),
    ], ("{{date}}", "{{event}}", "{{detail}}"), count=5), caption="Key dates")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "5", "Next steps", "From here to settlement")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("nextSteps", [
        ("Satisfy", "Provide the outstanding conditions listed in section three."),
        ("Value", "The lender orders and receives the valuation."),
        ("Unconditional", "Formal unconditional approval issued."),
        ("Document", "Loan documents issued; sign and return within five days."),
        ("Settle", "Settlement booked with your conveyancer."),
    ], ("{{step.name}}", "{{step.detail}}"), count=5))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="This is a conditional approval",
        text=f("approval.caveat",
               "A conditional approval is not a guarantee of finance. It may be withdrawn "
               "or varied if the valuation is unsatisfactory, if any condition is not "
               "met, or if your circumstances change before settlement. Do not waive a "
               "finance condition in your contract of sale on the strength of this "
               "document without speaking to us first."))
    C.disclaimer_page(doc, theme)
