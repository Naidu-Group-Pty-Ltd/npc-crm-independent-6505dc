"""Builders for the client-form, compliance and business templates."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import components as C  # noqa: E402
from content import Fill  # noqa: E402
from oxml import page_break  # noqa: E402
from theme import Theme  # noqa: E402

BLANK = ""


# ==========================================================================
# Client Fact-Find Form — Minimal Professional
# ==========================================================================

def client_fact_find_form(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Client intake",
        title=f("form.title", "Client Fact-Find"),
        subtitle=f("form.subtitle",
                   "Your personal, employment and financial position. Complete every "
                   "section that applies — leave the rest blank."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client reference", f("client.reference", "{{client.reference}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Adviser", f("author.name", "{{author.name}}")),
        ("Form version", f("document.version", "{{document.version}}")),
    ])
    C.gap(doc, theme, 0.7)
    C.highlight_box(
        doc, theme, tone="info", title="Before you start",
        text="Shaded fields are for you to complete. You can type directly into this "
             "document and use Tab to move between fields, or print it and complete it by "
             "hand. Nothing in this form commits you to anything.",
        items=[
            "Have your last two payslips and most recent tax return to hand.",
            "You will need balances and limits for every loan and credit card.",
            "If a section does not apply to you, leave it blank rather than writing N/A.",
        ])
    page_break(doc)

    C.section_opener(doc, theme, "1", "Applicant details", "Both applicants where relevant")
    C.gap(doc, theme)
    for index, label in enumerate(("Applicant 1", "Applicant 2")):
        C.subsection(doc, theme, label, before=0 if index == 0 else 10)
        C.definition_grid(doc, theme, [
            ("Title", BLANK), ("First name", BLANK), ("Middle name", BLANK),
            ("Surname", BLANK), ("Date of birth", BLANK), ("Gender", BLANK),
            ("Marital status", BLANK), ("Residency status", BLANK),
            ("Number of dependants", BLANK), ("Ages of dependants", BLANK),
            ("Mobile", BLANK), ("Email", BLANK),
        ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Address history", "Three years where available")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Current address", BLANK), ("Living situation", BLANK),
        ("Date moved in", BLANK), ("Monthly rent or board", BLANK),
        ("Previous address", BLANK), ("Previous living situation", BLANK),
        ("Previous date moved in", BLANK), ("Reason for moving", BLANK),
    ], columns=2, input_style=True)
    page_break(doc)

    C.section_opener(doc, theme, "3", "Employment & income", "Gross annual amounts")
    C.gap(doc, theme)
    for index, label in enumerate(("Applicant 1", "Applicant 2")):
        C.subsection(doc, theme, label, before=0 if index == 0 else 10)
        C.definition_grid(doc, theme, [
            ("Employment type", BLANK), ("Employer or business", BLANK),
            ("Role or position", BLANK), ("Employer address", BLANK),
            ("Start date", BLANK), ("Base salary (annual)", BLANK),
            ("Bonus (annual)", BLANK), ("Commission (annual)", BLANK),
            ("Overtime (annual)", BLANK), ("Other taxable income", BLANK),
        ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "4", "Assets", "Everything you own")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Asset type", "Description or address", "Owner", "Value", "Income",
         "Lender", "Loan balance", "Repayment"],
        [[BLANK] * 8 for _ in range(10)],
        widths=[30, 46, 20, 24, 22, 24, 26, 24], numeric_cols={3, 4, 6, 7},
        total_row=["Total", "", "", BLANK, BLANK, "", BLANK, BLANK],
        caption="Assets and any loans secured against them",
        note="Record a loan on the same row as the asset it is secured against, so it is "
             "not counted twice.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "5", "Liabilities", "Debts not secured above")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Liability type", "Lender", "Account", "Owner", "Limit", "Balance", "Repayment"],
        [[BLANK] * 7 for _ in range(8)],
        widths=[32, 28, 32, 20, 24, 24, 26], numeric_cols={4, 5, 6},
        total_row=["Total", "", "", "", BLANK, BLANK, BLANK])
    page_break(doc)

    C.section_opener(doc, theme, "6", "Living expenses", "Average monthly amounts")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Category", "Monthly", "Category", "Monthly"],
        [["Groceries", BLANK, "Insurance", BLANK],
         ["Utilities", BLANK, "Medical & health", BLANK],
         ["Council rates & water", BLANK, "Personal care & clothing", BLANK],
         ["Childcare & education", BLANK, "Recreation & dining", BLANK],
         ["Transport & fuel", BLANK, "Communications & streaming", BLANK],
         ["Rent or board", BLANK, "Other regular expenses", BLANK]],
        widths=[54, 30, 54, 30], numeric_cols={1, 3},
        total_row=["Total monthly living expenses", BLANK, "", ""])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "7", "Declaration", "What you are confirming")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Declaration",
        text=f("form.declaration",
               "I confirm that the information I have provided is true and complete to "
               "the best of my knowledge, that I have not omitted anything that would "
               "affect an assessment of my financial position, and that I will notify my "
               "adviser promptly if my circumstances change materially before any "
               "application is submitted."))
    C.gap(doc, theme, 0.7)
    C.signature_block(doc, theme, [
        ("Applicant 1", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Applicant 2", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Consent to collect",
         "By signing this form you consent to the collection, use and storage of the "
         "personal and financial information it contains for the purpose of assessing "
         "your position and, where you separately authorise it, arranging services on "
         "your behalf."),
    ])


# ==========================================================================
# AML & KYC Assessment — Compliance Structured
# ==========================================================================

def aml_kyc_assessment(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Customer due diligence — restricted",
        title=f("report.title", "AML & KYC Assessment"),
        subtitle=f("report.subtitle",
                   "Identity, beneficial ownership, screening, source of funds, risk "
                   "rating and the onboarding decision."),
        chips=["RESTRICTED", "RETAINED", "AUDITABLE"])
    page_break(doc)

    C.recommendation_box(
        doc, theme, title="Assessment outcome",
        recommendation=f("assessment.outcome",
                         "Accept with enhanced controls. Customer risk rating: MEDIUM."),
        rationale=f.text("assessment.rationale", [
            "Identity and beneficial ownership are fully verified against primary "
            "documents. Screening returned no sanctions or adverse media matches. One "
            "beneficial owner is a domestic politically exposed person, which triggers "
            "enhanced due diligence and senior approval under the programme.",
        ]),
        actions=f.items("assessment.conditions", [
            "Senior compliance approval obtained before onboarding (recorded below).",
            "Source of wealth evidence obtained and retained.",
            "Review frequency set to 12 months rather than 36.",
        ]),
        confidence=f("assessment.rating", "Medium risk"))
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Customer", columns=2, fields=[
        ("Legal name", f("customer.legalName", "Example Holdings Pty Ltd")),
        ("Customer type", f("customer.type", "Australian proprietary company")),
        ("ACN", f("customer.acn", "600 123 456")),
        ("ABN", f("customer.abn", "12 600 123 456")),
        ("Registered address", f("customer.address", "Level 4, 100 Sample Street, Sydney NSW 2000")),
        ("Principal activity", f("customer.activity", "Property investment")),
        ("Relationship type", f("customer.relationship", "Investor client")),
        ("Case reference", f("case.reference", "AML-2026-0418")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "1", "Identity verification", "Primary documents")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Subject", "Document", "Number", "Expiry", "Method", "Status"],
        rows=f.tuples("identity.documents", [
            (["1.1", "J. Nguyen", "Australian passport", "PA1234567", "04/2031",
              "Electronic + visual", "Pass"], "pass"),
            (["1.2", "J. Nguyen", "Driver licence (NSW)", "12345678", "09/2029",
              "Electronic", "Pass"], "pass"),
            (["1.3", "S. Nguyen", "Australian passport", "PB7654321", "11/2028",
              "Electronic + visual", "Pass"], "pass"),
            (["1.4", "Example Holdings", "ASIC company extract", "600123456", "n/a",
              "Registry search", "Pass"], "pass"),
        ], (["{{ref}}", "{{subject}}", "{{document}}", "{{number}}", "{{expiry}}",
             "{{method}}", "Pending"], "pending"), count=4),
        widths=[16, 32, 44, 30, 22, 40, 26],
        caption="Documents verified")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Beneficial ownership", "25% threshold")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Beneficial owner", "Interest", "Basis", "Verified", "Status"],
        rows=f.tuples("beneficialOwners", [
            (["2.1", "J. Nguyen", "60%", "Direct shareholding", "1.1, 1.2", "Pass"], "pass"),
            (["2.2", "S. Nguyen", "40%", "Direct shareholding", "1.3", "Pass"], "pass"),
            (["2.3", "J. Nguyen", "Control", "Sole director", "1.4", "Pass"], "pass"),
        ], (["{{ref}}", "{{name}}", "{{interest}}", "{{basis}}", "{{evidence}}", "Pending"],
            "pending"), count=3),
        widths=[16, 46, 24, 46, 28, 26],
        caption="Owners and controllers at or above 25%")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "3", "Screening", "PEP, sanctions, adverse media")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Subject", "Check", "Provider", "Date", "Result", "Status"],
        rows=f.tuples("screening", [
            (["3.1", "J. Nguyen", "Sanctions", "Screening provider", "29/07/2026",
              "No match", "Clear"], "clear"),
            (["3.2", "J. Nguyen", "PEP", "Screening provider", "29/07/2026",
              "Domestic PEP — local council", "Review"], "review"),
            (["3.3", "J. Nguyen", "Adverse media", "Screening provider", "29/07/2026",
              "No match", "Clear"], "clear"),
            (["3.4", "S. Nguyen", "Sanctions / PEP / media", "Screening provider",
              "29/07/2026", "No match", "Clear"], "clear"),
        ], (["{{ref}}", "{{subject}}", "{{check}}", "{{provider}}", "{{date}}",
             "{{result}}", "Pending"], "pending"), count=4),
        widths=[16, 32, 32, 34, 30, 48, 26],
        caption="Screening performed")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Element", "Declared", "Evidence obtained", "Assessment"],
        f.rows("sourceOfFunds", [
            ["Source of funds", "Sale of prior investment property, Mar 2026",
             "Settlement statement, bank statement", "Consistent and corroborated"],
            ["Source of wealth", "Salaried employment and property investment since 2009",
             "Two years tax returns, ASIC extract", "Consistent with profile"],
        ], ["{{element}}", "{{declared}}", "{{evidence}}", "{{assessment}}"], count=2),
        widths=[32, 56, 50, 42], caption="Source of funds and wealth")
    page_break(doc)

    C.section_opener(doc, theme, "4", "Risk rating", "Rating and its basis")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("CUSTOMER", f("riskRating.customer", "MEDIUM"), "PEP association"),
        ("PRODUCT", f("riskRating.product", "LOW"), "Standard advisory"),
        ("CHANNEL", f("riskRating.channel", "LOW"), "Face to face"),
        ("OVERALL", f("riskRating.overall", "MEDIUM"), "Highest applies"),
    ])
    C.gap(doc, theme, 0.7)
    C.status_table(
        doc, theme, headers=["Ref", "Risk factor", "Assessment", "Weighting", "Rating"],
        rows=f.tuples("riskFactors", [
            (["4.1", "Customer type — proprietary company", "Standard structure, two owners",
              "Standard", "Low"], "low"),
            (["4.2", "Politically exposed person", "Domestic PEP, local government",
              "Elevated", "Medium"], "medium"),
            (["4.3", "Geography", "Australian resident, Australian assets", "Standard",
              "Low"], "low"),
            (["4.4", "Product and channel", "Advisory service, face to face", "Standard",
              "Low"], "low"),
            (["4.5", "Transaction pattern", "Consistent with declared profile", "Standard",
              "Low"], "low"),
        ], (["{{ref}}", "{{factor}}", "{{assessment}}", "{{weighting}}", "Medium"],
            "medium"), count=5),
        widths=[16, 56, 60, 28, 26], caption="Risk factors")
    C.gap(doc, theme, 0.7)
    C.status_table(
        doc, theme, headers=["Ref", "Enhanced measure", "Applied", "Evidence", "Status"],
        rows=f.tuples("edd", [
            (["5.1", "Senior management approval before onboarding", "Yes",
              "Approval recorded below", "Complete"], "complete"),
            (["5.2", "Source of wealth established and evidenced", "Yes",
              "Tax returns, ASIC extract", "Complete"], "complete"),
            (["5.3", "Enhanced ongoing monitoring — 12-month review", "Yes",
              "Review scheduled 29/07/2027", "Complete"], "complete"),
        ], (["{{ref}}", "{{measure}}", "{{applied}}", "{{evidence}}", "Pending"],
            "pending"), count=3),
        widths=[16, 66, 22, 56, 26],
        caption="Enhanced due diligence (applied because the rating is medium or above)")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Ongoing monitoring", columns=2, fields=[
        ("Review frequency", f("monitoring.frequency", "12 months (enhanced)")),
        ("Next review", f("monitoring.nextReview", "29/07/2027")),
        ("Trigger events", f("monitoring.triggers",
                             "Change of ownership, adverse media, unusual transaction")),
        ("Monitoring owner", f("monitoring.owner", "Compliance officer")),
    ])
    page_break(doc)

    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Assessor", f("approvals.assessor", "A. Nguyen, Client Services"), "Complete"),
        ("Compliance officer", f("approvals.compliance", "R. Patel, Compliance"), "Complete"),
        ("Senior management (PEP)", f("approvals.senior", "M. Osei, Director"), "Complete"),
    ], ("{{role}}", "{{name}}", "Pending"), count=3))
    C.appendix_opener(doc, theme, "A", "Evidence index",
                      "Every document held for this assessment, with its storage reference "
                      "and retention date.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Ref", "Document", "Obtained", "Storage reference", "Retain until"],
        f.rows("appendix.evidence", [
            ["1.1", "Australian passport — J. Nguyen", "29/07/2026", "DOC-88412", "29/07/2033"],
            ["1.3", "Australian passport — S. Nguyen", "29/07/2026", "DOC-88413", "29/07/2033"],
            ["1.4", "ASIC company extract", "29/07/2026", "DOC-88414", "29/07/2033"],
            ["3.1", "Screening report", "29/07/2026", "DOC-88415", "29/07/2033"],
            ["4.2", "Source of wealth pack", "30/07/2026", "DOC-88416", "29/07/2033"],
        ], ["{{ref}}", "{{document}}", "{{obtained}}", "{{storageRef}}", "{{retainUntil}}"],
            count=5),
        widths=[16, 68, 28, 40, 30])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Retention",
         "This assessment and its supporting evidence are retained for seven years from "
         "the end of the customer relationship, in accordance with the organisation's "
         "AML/CTF programme."),
        ("Tipping off",
         "This document may contain information the disclosure of which to the customer "
         "or a third party could constitute an offence. Do not disclose the contents "
         "outside the authorised recipients without compliance approval."),
    ])


# ==========================================================================
# Executive Business Report — Executive Corporate
# ==========================================================================

def executive_business_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="For decision",
        title=f("report.title", "Executive Business Report"),
        subtitle=f("report.subtitle",
                   "Performance for the period, the options considered and the "
                   "recommended course of action."),
        chips=["FOR DECISION", "CONFIDENTIAL"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Executive summary"), ("02", "Performance"), ("03", "Key findings"),
        ("04", "Options considered"), ("05", "Recommendation"),
        ("06", "Risks"), ("07", "Decisions required"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "For readers of one page only")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "Revenue is 8% ahead of plan on 12% fewer engagements — the mix has "
                   "shifted and the operating model has not."),
        paragraphs=f.text("report.executiveSummary", [
            "The period closed at $4.28m against a plan of $3.96m, a favourable variance "
            "of 8.1%. That result was produced by 214 engagements against a plan of 243, "
            "so average engagement value rose from $16,300 to $20,000.",
            "The shift is concentrated in two service lines. Advisory and compliance work "
            "grew 34% and 41% respectively, while transactional work fell 19%. The "
            "operating model, resourcing plan and pricing structure were all built for "
            "the previous mix.",
            "Three options are set out in section four. The recommendation is to "
            "re-weight delivery capacity toward advisory and compliance over two "
            "quarters, funded from the transactional team's existing headcount rather "
            "than net new hiring.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Revenue ahead of plan; engagement volume behind it.",
            "Average engagement value up 23% — this is a mix shift, not a pricing win.",
            "Advisory and compliance capacity is the binding constraint by Q3.",
            "Recommended option requires no net new headcount.",
        ]))
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("REVENUE", f("performance.revenue", "$4.28m"), "▲ 8.1% vs plan"),
        ("ENGAGEMENTS", f("performance.engagements", "214"), "▼ 11.9% vs plan"),
        ("AVERAGE VALUE", f("performance.averageValue", "$20,000"), "▲ 22.7%"),
        ("UTILISATION", f("performance.utilisation", "81%"), "▲ 6 pts"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "02", "Performance", "Against plan and prior period")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Measure", "Plan", "Actual", "Variance", "Prior period", "Movement"],
        f.rows("performance.detail", [
            ["Revenue", "$3,960,000", "$4,280,000", "+8.1%", "$3,742,000", "+14.4%"],
            ["Engagements", "243", "214", "−11.9%", "229", "−6.6%"],
            ["Average engagement value", "$16,300", "$20,000", "+22.7%", "$16,340", "+22.4%"],
            ["Advisory revenue", "$1,180,000", "$1,581,000", "+34.0%", "$1,180,000", "+34.0%"],
            ["Compliance revenue", "$742,000", "$1,046,000", "+41.0%", "$742,000", "+41.0%"],
            ["Transactional revenue", "$2,038,000", "$1,653,000", "−18.9%", "$1,820,000", "−9.2%"],
            ["Utilisation", "75%", "81%", "+6 pts", "76%", "+5 pts"],
        ], ["{{measure}}", "{{plan}}", "{{actual}}", "{{variance}}", "{{prior}}",
            "{{movement}}"], count=6),
        widths=[52, 30, 30, 26, 30, 28], numeric_cols={1, 2, 3, 4, 5},
        emphasis_rows={3, 4, 5}, caption="Results against plan")
    C.gap(doc, theme, 0.7)
    C.chart_frame(doc, theme, title="Revenue by service line, four periods",
                  kind="stacked column chart", binding="{{performance.series}}",
                  height_mm=56, caption="Mix shift is visible from period two",
                  source="Finance system", alt_text="Advisory and compliance grow while "
                                                    "transactional revenue declines")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Key findings", "What the numbers show")
    C.gap(doc, theme)
    for title, text in f.tuples("findings", [
        ("Finding 1 — The mix shift is structural, not seasonal",
         "Advisory and compliance growth has been positive in each of the last four "
         "periods, and the transactional decline tracks a market-wide fall in volumes "
         "rather than a loss of share. Share in transactional work is unchanged at 4.1%."),
        ("Finding 2 — Delivery capacity is the binding constraint",
         "Advisory utilisation reached 94% in the final month of the period, against a "
         "sustainable ceiling of 85%. Four engagements were declined for capacity reasons. "
         "On current trajectory the constraint binds in Q3."),
        ("Finding 3 — Pricing has not moved",
         "The rise in average engagement value is entirely mix. Like-for-like advisory "
         "pricing is unchanged for seven quarters against 11% cumulative cost inflation."),
    ], ("{{finding.title}}", "{{finding.text}}"), count=3):
        C.highlight_box(doc, theme, tone="info", title=title, text=text)
        C.gap(doc, theme, 0.5)
    page_break(doc)

    C.section_opener(doc, theme, "04", "Options considered", "Three, assessed equally")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["A — Hold", "B — Re-weight", "C — Expand"],
        attributes=[
            ("Description", ["Change nothing this year",
                             "Move capacity from transactional to advisory",
                             "Hire into advisory and compliance"]),
            ("Net new headcount", ["0", "0", "6"]),
            ("Cost in period", ["$0", "$84,000", "$690,000"]),
            ("Revenue impact, 12 months", ["−$310,000", "+$540,000", "+$980,000"]),
            ("Time to effect", ["—", "2 quarters", "3 quarters"]),
            ("Key risk", ["Declines engagements at capacity",
                          "Retraining lag in Q1",
                          "Fixed cost added ahead of demand"]),
            ("Reversibility", ["n/a", "High", "Low"]),
        ],
        caption="Options assessed", winner_index=1)
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Adopt Option B — re-weight delivery capacity toward advisory and "
                         "compliance over two quarters, funded from existing transactional "
                         "headcount."),
        rationale=f.text("report.rationale", [
            "Option B captures most of the available upside at a twelfth of the cost of "
            "Option C, requires no net new headcount, and is reversible within a quarter "
            "if the mix shift proves temporary. Option A forgoes $310,000 and continues to "
            "decline work we are capable of delivering.",
        ]),
        actions=f.items("report.nextSteps", [
            "Approve the $84,000 retraining and accreditation budget.",
            "Approve the transfer of four delivery staff from transactional to advisory.",
            "Approve a like-for-like pricing review for advisory, reporting in Q2.",
        ]),
        confidence=f("report.confidence", "High"))
    page_break(doc)

    C.section_opener(doc, theme, "05", "Risks", "And how they are managed")
    C.gap(doc, theme)
    C.risk_box(doc, theme, risks=f.tuples("risks", [
        ("Retraining lag reduces delivery capacity in Q1",
         "Medium", "Stagger the transfer across two cohorts so no more than two staff are "
                   "out of production at once."),
        ("Transactional volumes recover and capacity is in the wrong place",
         "Medium", "Option B is reversible within a quarter; monitor transactional "
                   "enquiry volume monthly and set a re-weight trigger at +15%."),
        ("Advisory demand is concentrated in two clients",
         "High", "Both clients represent 31% of advisory revenue. Business development "
                 "target of four new advisory clients by Q3 is added to the plan."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("implementation", [
        ("Q1 W1–4", "Approve budget and transfers", "Board approval, staff consultation"),
        ("Q1 W5–12", "Cohort 1 retraining", "Two staff, accreditation complete"),
        ("Q2 W1–8", "Cohort 2 retraining", "Two staff, accreditation complete"),
        ("Q2 W9", "Pricing review reported", "Like-for-like advisory pricing"),
        ("Q3 W1", "Capacity re-weighted", "Advisory utilisation target 85%"),
    ], ("{{when}}", "{{what}}", "{{detail}}"), count=4), caption="Implementation")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("decisions", [
        "Approve Option B as the recommended course of action.",
        "Approve the $84,000 retraining and accreditation budget.",
        "Approve the transfer of four delivery staff.",
        "Note the advisory client concentration risk and the mitigation target.",
    ]), title="Decisions required", columns=1)


# ==========================================================================
# Client Onboarding Form — Minimal Professional
# ==========================================================================

def client_onboarding_form(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Engagement",
        title=f("form.title", "Client Onboarding"),
        subtitle=f("form.subtitle",
                   "The scope of our engagement, what it costs, what you authorise us to "
                   "do, and the consents we need."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Engagement reference", f("engagement.reference", "{{engagement.reference}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Adviser", f("author.name", "{{author.name}}")),
        ("Start date", f("engagement.startDate", "{{engagement.startDate}}")),
    ])
    C.gap(doc, theme, 0.7)
    C.prose(doc, theme, f.text("engagement.welcome", [
        "Thank you for engaging us. This form records what we have agreed: the work we "
        "will do, the work we will not do, what it costs, and what you are authorising. "
        "Please read it, complete the fields, and sign at the end. Ask us about anything "
        "that is unclear before you sign — that is a better use of your time than "
        "discovering it later.",
    ]))
    page_break(doc)

    C.section_opener(doc, theme, "1", "Your details", "Who we are acting for")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Client name(s)", BLANK), ("Preferred name", BLANK),
        ("Entity name (if applicable)", BLANK), ("ABN / ACN", BLANK),
        ("Postal address", BLANK), ("Email", BLANK),
        ("Mobile", BLANK), ("Best contact time", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Engagement scope", "What is and is not included")
    C.gap(doc, theme)
    C.responsibility_columns(
        doc, theme,
        ("Included in this engagement", f.items("engagement.included", [
            "Property strategy and brief development.",
            "Search, shortlisting and inspection across the agreed area.",
            "Comparable sales research and price assessment.",
            "Due diligence coordination and reporting.",
            "Negotiation and offer management to exchange.",
            "Settlement coordination with your conveyancer.",
        ], count=5)),
        ("Not included", f.items("engagement.excluded", [
            "Credit assistance, loan advice or lender recommendations.",
            "Legal advice on the contract of sale.",
            "Structural engineering, survey or valuation services.",
            "Tax or financial product advice.",
            "Property management after settlement.",
        ], count=5)),
        tones=("success", "alert"))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Where you will need another professional",
        text=f("engagement.referrals",
               "We will tell you when something falls outside our scope and, where you "
               "ask us to, introduce you to a suitably qualified professional. Any "
               "referral benefit we receive will be disclosed to you before the "
               "introduction is made."))
    page_break(doc)

    C.section_opener(doc, theme, "3", "Fees", "What this costs and when")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Fee", "Basis", "Amount", "When payable"],
        f.rows("fees", [
            ["Engagement fee", "Fixed", BLANK, "On signing this form"],
            ["Success fee", "Percentage of purchase price", BLANK, "On exchange"],
            ["Disbursements", "At cost", BLANK, "As incurred, with receipts"],
        ], ["{{fee}}", "{{basis}}", "{{amount}}", "{{when}}"], count=3),
        widths=[46, 52, 34, 46], caption="Fee schedule",
        note="All amounts are inclusive of GST unless stated otherwise. We will not "
             "incur a disbursement above $250 without your prior approval.")
    C.gap(doc, theme, 0.7)
    C.definition_grid(doc, theme, [
        ("Refund position", f("fees.refund",
                              "Engagement fee is non-refundable after 14 days")),
        ("Payment method", BLANK),
        ("Invoice email", BLANK),
        ("Purchase-order reference", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "4", "Authorities", "What you authorise us to do")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("authorities", [
        "Make enquiries of selling agents on my behalf.",
        "Inspect properties on my behalf and report to me.",
        "Request contracts of sale and supporting documents.",
        "Negotiate on my behalf within limits I set in writing.",
        "Submit offers on my behalf within limits I set in writing.",
        "Liaise with my conveyancer, broker and other advisers.",
    ], count=6), title="I authorise you to", columns=1)
    C.gap(doc, theme, 0.6)
    C.highlight_box(
        doc, theme, tone="warning", title="Limits on authority",
        text=f("authorities.limits",
               "We will not sign anything on your behalf, will not exceed a price limit "
               "you have not confirmed in writing, and will not commit you to any "
               "contract. Every offer requires your written authority for that specific "
               "property at that specific price."))
    page_break(doc)

    C.section_opener(doc, theme, "5", "Communication preferences", "How and how often")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Preferred channel", BLANK), ("Update frequency", BLANK),
        ("Secondary contact name", BLANK), ("Secondary contact details", BLANK),
        ("May we contact your broker?", BLANK), ("May we contact your conveyancer?", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "6", "Consents", "Each one separately")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("consents", [
        "I consent to the collection and use of my personal information as described in "
        "the privacy notice at the end of this form.",
        "I consent to my information being shared with the third parties I have "
        "authorised above, for the purposes of this engagement only.",
        "I consent to receiving service-related communications by email and SMS.",
        "I consent to receiving marketing communications. (Optional — you may decline "
        "this and still engage us.)",
    ], count=4), title="Consents", columns=1)
    C.gap(doc, theme, 0.6)
    C.highlight_box(
        doc, theme, tone="info", title="These are separate on purpose",
        text="Each consent above is a separate decision and each is separately "
             "revocable. Declining the marketing consent has no effect on the engagement "
             "or on the service you receive.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "7", "What happens next", "The first three steps")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("engagement.nextSteps", [
        ("Brief", "We meet to develop your property brief and agree the search mandate."),
        ("Search", "We begin searching and report on shortlisted properties."),
        ("Act", "We inspect, assess, negotiate and manage the acquisition to settlement."),
    ], ("{{step.name}}", "{{step.detail}}"), count=3))
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Client", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("For the organisation", [f"Name: {f('author.name', '{{author.name}}')}",
                                  "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Terms of engagement",
         "This engagement continues until the agreed work is complete or either party "
         "ends it by written notice. Fees accrued before the end date remain payable. "
         "Nothing in this form limits any right you have under the Australian Consumer "
         "Law."),
    ])


# ==========================================================================
# Client Verification Summary — Compliance Structured
# ==========================================================================

def client_verification_summary(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Verification record — internal",
        title=f("report.title", "Client Verification Summary"),
        subtitle=f("report.subtitle",
                   "Confirmation that identity verification was completed, by what "
                   "method, on what date, with what result."),
        chips=["INTERNAL", "RETAINED"],
        prepared_for=False)
    C.gap(doc, theme, 0.7)
    C.definition_grid(doc, theme, [
        ("Customer", f("customer.legalName", "{{customer.legalName}}")),
        ("Case reference", f("case.reference", "{{case.reference}}")),
        ("Verified on", f("verification.date", "{{verification.date}}")),
        ("Verified by", f("verification.verifier", "{{verification.verifier}}")),
    ])
    C.gap(doc, theme, 0.8)

    C.metric_panel(doc, theme, [
        ("STATUS", f("verification.status", "VERIFIED"), "All checks complete"),
        ("METHOD", f("verification.method", "Electronic + visual"), "Primary documents"),
        ("COMPLETED", f("verification.date", "29/07/2026"), "Assessment date"),
        ("RE-VERIFY BY", f("verification.expiry", "29/07/2029"), "Or on trigger event"),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "1", "Customer", "Verified particulars")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Verified identity", columns=2, fields=[
        ("Full legal name", f("customer.legalName", "Jordan Lee Nguyen")),
        ("Date of birth", f("customer.dob", "12/04/1988")),
        ("Residential address", f("customer.address",
                                  "12 Example Street, Northbridge NSW 2063")),
        ("Customer type", f("customer.type", "Individual")),
        ("Relationship", f("customer.relationship", "Investor client")),
        ("Onboarded", f("customer.onboardedAt", "29/07/2026")),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Documents verified", "Primary evidence")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Document", "Number", "Issuer", "Expiry", "Method", "Status"],
        rows=f.tuples("identity.documents", [
            (["2.1", "Australian passport", "PA1234567", "DFAT", "04/2031",
              "Electronic + visual", "Pass"], "pass"),
            (["2.2", "Driver licence (NSW)", "12345678", "TfNSW", "09/2029",
              "Electronic", "Pass"], "pass"),
            (["2.3", "Medicare card", "2345 67890 1", "Services Australia", "08/2028",
              "Visual", "Pass"], "pass"),
        ], (["{{ref}}", "{{document}}", "{{number}}", "{{issuer}}", "{{expiry}}",
             "{{method}}", "Pending"], "pending"), count=3),
        widths=[16, 44, 32, 38, 24, 40, 26], caption="Documents sighted and verified")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "3", "Screening", "PEP, sanctions and adverse media")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Check", "Provider", "Date", "Result", "Status"],
        rows=f.tuples("screening", [
            (["3.1", "Sanctions", "Screening provider", "29/07/2026", "No match",
              "Clear"], "clear"),
            (["3.2", "PEP", "Screening provider", "29/07/2026", "No match", "Clear"], "clear"),
            (["3.3", "Adverse media", "Screening provider", "29/07/2026", "No match",
              "Clear"], "clear"),
        ], (["{{ref}}", "{{check}}", "{{provider}}", "{{date}}", "{{result}}", "Pending"],
            "pending"), count=3),
        widths=[16, 42, 44, 28, 50, 26], caption="Screening result")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Verifier declaration",
        text=f("verification.declaration",
               "I confirm that I sighted the documents listed above in the manner "
               "recorded, that the person presenting them appeared to be the person to "
               "whom they relate, that the screening checks were performed on the dates "
               "shown, and that copies of all documents and screening reports have been "
               "retained in the customer file."))
    C.gap(doc, theme, 0.7)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Verifier", f("verification.verifier", "A. Nguyen, Client Services"), "Complete"),
        ("Reviewer", f("verification.reviewer", "R. Patel, Compliance"), "Complete"),
    ], ("{{role}}", "{{name}}", "Pending"), count=2))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="Circulation",
        text="This summary is an internal record. It may be provided to a third party "
             "only where the organisation's policy permits and the customer has "
             "consented. The full due-diligence file is not to be circulated.")


# ==========================================================================
# Client Proposal — Luxury Presentation
# ==========================================================================

def client_proposal(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Proposal",
        title=f("proposal.title", "A Proposal to Acquire"),
        subtitle=f("proposal.subtitle",
                   f"Prepared for {theme.brand.client_name} — our understanding of your "
                   "position, what we propose to do, and what it will cost."),
        image_caption=f("proposal.coverCaption", ""),
        prepared_for=False)
    C.gap(doc, theme, 0.8)
    C.definition_grid(doc, theme, [
        ("Prepared for", f("client.name", "{{client.name}}")),
        ("Prepared by", f("author.name", "{{author.name}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Valid until", f("proposal.validity", "{{proposal.validity}}")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "Your situation", "")
    C.gap(doc, theme)
    C.prose(doc, theme, f.text("proposal.situation", [
        "You are looking to add a third investment property to a portfolio you have "
        "built over eleven years, and you have told us the last acquisition took "
        "fourteen months and did not, in the end, meet the brief you set for it.",
        "The constraint is not capital and it is not appetite. It is time, and access. "
        "You have neither the hours to inspect forty properties nor the standing "
        "relationships that surface the ones that never reach a portal.",
        "That is a specific problem, and it is the one we are proposing to solve.",
    ]), size=theme.type_scale.body + 0.5)
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="What we propose",
        recommendation=f("proposal.approach",
                         "A six-month retained search across three target corridors, "
                         "with a written brief agreed up front and a weekly report, "
                         "concluding at unconditional exchange."),
        rationale=f.text("proposal.approachRationale", [
            "Retained rather than success-only, because a success-only mandate rewards "
            "transacting rather than transacting well, and you have already had one "
            "acquisition that met the deadline and missed the brief.",
        ]),
        confidence="")
    page_break(doc)

    C.section_opener(doc, theme, "", "Scope of work", "")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("scope.phases", [
        ("Brief", "Two sessions to agree the mandate, the scoring criteria and the "
                  "walk-away conditions, in writing."),
        ("Search", "Weekly search across three corridors, on and off market, with a "
                   "written shortlist report every Friday."),
        ("Assess", "Full investment analysis and due-diligence coordination on every "
                   "property that reaches the shortlist."),
        ("Negotiate", "Offer strategy, negotiation and management to exchange."),
        ("Settle", "Coordination with your conveyancer and broker to settlement, and a "
                   "post-purchase plan."),
    ], ("{{phase.name}}", "{{phase.detail}}"), count=5))
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("deliverables", [
        "A written property brief, agreed and signed.",
        "A weekly shortlist report for the duration of the search.",
        "A full investment report on every shortlisted property.",
        "A due-diligence report before any offer is made.",
        "A written negotiation strategy for each offer.",
        "A post-purchase plan within 14 days of settlement.",
    ], count=6), title="What you receive", columns=1)
    page_break(doc)

    C.section_opener(doc, theme, "", "Your team", "")
    C.gap(doc, theme)
    C.adviser_profile(doc, theme,
                      bio=f("team.0.bio",
                            "Leads the engagement. Eighteen years in buyer advocacy "
                            "across the lower north shore, with a particular focus on "
                            "established stock and off-market acquisition."),
                      credentials=f.items("team.0.credentials", [
                          "Licensed real estate agent (NSW)",
                          "Member, Real Estate Buyers Agents Association",
                          "310 acquisitions completed",
                      ], count=3))
    C.gap(doc, theme, 0.6)
    C.adviser_profile(doc, theme,
                      bio=f("team.1.bio",
                            "Runs research and due diligence. Prepares the analysis "
                            "behind every shortlist and coordinates the investigation "
                            "on every property that reaches an offer."),
                      credentials=f.items("team.1.credentials", [
                          "Certified Practising Valuer",
                          "Nine years in property research",
                      ], count=2))
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("timeline", [
        ("Week 1", "Engagement and brief", "Two sessions; written brief agreed"),
        ("Weeks 2–24", "Search and shortlist", "Weekly reporting"),
        ("On shortlist", "Analysis and due diligence", "Per property"),
        ("On agreement", "Negotiate and exchange", "Offer strategy agreed in writing"),
        ("Post exchange", "Settlement and plan", "To settlement plus 14 days"),
    ], ("{{when}}", "{{what}}", "{{detail}}"), count=5), caption="Indicative timeline")
    page_break(doc)

    C.section_opener(doc, theme, "", "Investment", "")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Basis", "Amount", "When payable"],
        f.rows("fees", [
            ["Retainer", "Fixed, six months", "$8,800", "On engagement"],
            ["Success fee", "1.65% of purchase price", "Est. $14,270", "On exchange"],
            ["Disbursements", "At cost, pre-approved above $250", "Est. $1,400",
             "As incurred"],
        ], ["{{item}}", "{{basis}}", "{{amount}}", "{{when}}"], count=3),
        widths=[44, 62, 34, 38], numeric_cols={2},
        total_row=["Estimated total", "On an $865,000 acquisition", "$24,470", ""],
        caption="Fees",
        note="All amounts include GST. The retainer is credited against the success fee, "
             "so the total does not change if we find the property in week three.")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Why us",
        text=f("proposal.whyUs", ""),
        items=f.items("proposal.evidence", [
            "310 acquisitions completed; 41% sourced off market.",
            "Median time from brief to exchange, last 24 months: 11 weeks.",
            "Average purchase price against our own pre-offer assessment: 2.1% below.",
            "Client references available on request, including three in your corridor.",
        ], count=4))
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Case study", columns=1, fields=[
        ("Brief", f("caseStudy.brief",
                    "Investment house, 500m²+, within 12km, yield above 4.2%")),
        ("Constraint", f("caseStudy.constraint",
                         "Client had searched for nine months without success")),
        ("What we did", f("caseStudy.action",
                          "Narrowed to two corridors; sourced off market in week seven")),
        ("Outcome", f("caseStudy.outcome",
                      "Exchanged 3.4% below the vendor's guide; 4.7% gross yield")),
    ])
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("nextSteps", [
        ("Accept", "Sign below and return, or tell us what you would like changed."),
        ("Brief", "We book the two briefing sessions within five business days."),
        ("Begin", "The search starts the week the brief is signed."),
    ], ("{{step.name}}", "{{step.detail}}"), count=3))
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Accepted by the client", ["Full name:", "Signature:",
                                    "Date:  ____ / ____ / ______"]),
        ("For the organisation", [f"Name: {f('author.name', '{{author.name}}')}",
                                  "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Validity",
         "This proposal is valid for 30 days from the date on the cover. Fees quoted are "
         "estimates where they depend on a purchase price that is not yet known; the "
         "basis of calculation is fixed and is stated in the fee table."),
    ])
    C.back_cover(doc, theme)


# ==========================================================================
# Investor Goals Questionnaire — Modern Technology
# ==========================================================================

def investor_goals_questionnaire(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Discovery",
        title=f("form.title", "Investor Goals Questionnaire"),
        subtitle=f("form.subtitle",
                   "What you are trying to achieve, over what period, with what "
                   "constraints — recorded in a form we can compare against every "
                   "property we assess."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client", f("client.name", "{{client.name}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Adviser", f("author.name", "{{author.name}}")),
        ("Reference", f("client.reference", "{{client.reference}}")),
    ])
    C.gap(doc, theme, 0.7)
    C.section_opener(doc, theme, "", "How this is used", "Why we ask")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="How this is used",
        text="Your answers become the scoring criteria for every property we assess. A "
             "property that scores well against this form is one that matches what you "
             "told us; a property that scores poorly is one we will not bring to you "
             "without explaining why.",
        items=[
            "There are no right answers and nothing here commits you to anything.",
            "Where a question does not apply, leave it blank rather than guessing.",
            "We will restate what we heard in the summary at the end.",
        ])
    page_break(doc)

    C.section_opener(doc, theme, "1", "Your objectives", "What you are trying to achieve")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Primary objective", BLANK), ("Secondary objective", BLANK),
        ("Why now", BLANK), ("What success looks like", BLANK),
        ("Number of properties intended", BLANK), ("Prior investment experience", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "2", "Time horizon & targets", "Over what period")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Intended hold period", BLANK), ("Target total return p.a.", BLANK),
        ("Income required now", BLANK), ("Income required in future", BLANK),
        ("Date you would like to have bought by", BLANK), ("Exit trigger", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "3", "Capacity & constraints", "What limits the decision")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Deposit available", BLANK), ("Source of deposit", BLANK),
        ("Maximum purchase price", BLANK), ("Maximum weekly holding cost", BLANK),
        ("Borrowing capacity (if known)", BLANK), ("Finance pre-approval in place", BLANK),
        ("Other calls on capital in the next 3 years", BLANK), ("Income stability", BLANK),
    ], columns=2, input_style=True)
    page_break(doc)

    C.section_opener(doc, theme, "4", "Risk appetite", "Where you sit on each dimension")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Statement", "Strongly disagree → strongly agree", "Response"],
        rows=f.tuples("risk.responses", [
            (["4.1", "I am comfortable holding a property that costs me money each week "
              "if I expect capital growth", "1   2   3   4   5", ""], "info"),
            (["4.2", "I would rather a lower return that is predictable than a higher "
              "return that is not", "1   2   3   4   5", ""], "info"),
            (["4.3", "I am comfortable borrowing to the maximum a lender will approve",
              "1   2   3   4   5", ""], "info"),
            (["4.4", "A 20% fall in the value of my property would cause me to sell",
              "1   2   3   4   5", ""], "info"),
            (["4.5", "I am comfortable with an older property that needs work",
              "1   2   3   4   5", ""], "info"),
            (["4.6", "I want to be involved in the decisions rather than delegate them",
              "1   2   3   4   5", ""], "info"),
        ], (["{{ref}}", "{{statement}}", "1   2   3   4   5", ""], "info"), count=6),
        widths=[16, 82, 50, 30], caption="Risk appetite",
        note="Circle or mark one number per row. There is no score attached to this "
             "table; it is used to frame the conversation, not to classify you.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "5", "Property preferences", "What you want to own")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Property type", BLANK), ("Minimum land size", BLANK),
        ("Minimum bedrooms", BLANK), ("Condition — willing to renovate?", BLANK),
        ("Target locations", BLANK), ("Locations you would not consider", BLANK),
        ("New or established", BLANK), ("Tenanted or vacant at settlement", BLANK),
        ("Level of involvement you want", BLANK), ("Anything else that matters to you", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "6", "Exclusions", "What you will not consider")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Property types excluded", BLANK), ("Structures excluded", BLANK),
        ("Locations excluded", BLANK), ("Reason", BLANK),
    ], columns=2, input_style=True)
    page_break(doc)

    C.section_opener(doc, theme, "7", "Summary", "What we heard")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="Adviser summary",
        headline=f("summary.headline", BLANK or " "),
        paragraphs=f.text("summary.text", [
            "To be completed by the adviser after the discovery session, and confirmed "
            "with the client before any search or recommendation begins.",
        ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "8", "Signatures", "Confirming the record")
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Client", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Adviser", [f"Name: {f('author.name', '{{author.name}}')}", "Signature:",
                     "Date:  ____ / ____ / ______"]),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "9", "Privacy", "How we handle your information")
    C.gap(doc, theme)
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Property Brief Form — Minimal Professional
# ==========================================================================

def property_brief_form(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Search mandate",
        title=f("form.title", "Property Brief"),
        subtitle=f("form.subtitle",
                   "The mandate we will search to: what, where, at what price, with what "
                   "must-haves and deal-breakers."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client", f("client.name", "{{client.name}}")),
        ("Brief reference", f("brief.reference", "{{brief.reference}}")),
        ("Agent", f("author.name", "{{author.name}}")),
        ("Date agreed", f("document.issueDate", "{{document.issueDate}}")),
    ])
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "1", "Purchase parameters", "The commercial envelope")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Purpose", BLANK), ("Budget — minimum", BLANK),
        ("Budget — maximum", BLANK), ("Absolute ceiling", BLANK),
        ("Deposit available", BLANK), ("Finance status", BLANK),
        ("Target purchase date", BLANK), ("Settlement preference", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "2", "Location", "Where we will search")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Primary target areas", BLANK), ("Secondary acceptable areas", BLANK),
        ("Excluded areas", BLANK), ("Maximum distance to CBD", BLANK),
        ("Maximum distance to transport", BLANK), ("School catchment requirement", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "3", "Property requirements", "What we are looking for")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Property type", BLANK), ("Minimum bedrooms", BLANK),
        ("Minimum bathrooms", BLANK), ("Car spaces required", BLANK),
        ("Minimum land size", BLANK), ("Minimum building size", BLANK),
        ("Acceptable condition", BLANK), ("Renovation budget, if any", BLANK),
        ("Minimum gross yield", BLANK), ("Tenancy preference", BLANK),
    ], columns=2, input_style=True)
    page_break(doc)

    C.section_opener(doc, theme, "4", "Must have / must not have", "The deal-breakers")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme, subject_labels=["Must have", "Must not have"],
        attributes=[(f"{index + 1}", [BLANK, BLANK]) for index in range(8)],
        caption="Complete both columns")
    C.gap(doc, theme, 0.7)
    C.highlight_box(
        doc, theme, tone="warning", title="How we treat this table",
        text="A property that fails a 'must not have' will not be presented to you at "
             "all. A property that fails a 'must have' will only be presented with an "
             "explanation of why we think it is worth an exception. Be deliberate about "
             "what goes in each column — the more that is listed, the fewer properties "
             "will qualify.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "5", "Scoring weights", "How competing options are ranked")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Criterion", "Weight %", "Why it matters to you"],
        [["Land size", BLANK, BLANK], ["Yield", BLANK, BLANK],
         ["Location and amenity", BLANK, BLANK], ["Condition", BLANK, BLANK],
         ["Growth evidence", BLANK, BLANK], ["Tenancy position", BLANK, BLANK],
         ["Price against assessment", BLANK, BLANK]],
        widths=[54, 26, 98], numeric_cols={1},
        total_row=["Total — must equal 100%", BLANK, ""],
        caption="Weighting",
        note="Weights are used in the comparison report to rank shortlisted properties. "
             "If you would rather we did not score, leave this blank and we will present "
             "options unranked.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "6", "Agreed brief", "The mandate in one paragraph")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="brand" if False else "info", title="Agreed brief",
        text=f("brief.statement",
               "To be written by the agent and confirmed by the client. One paragraph "
               "that a third party could read and understand exactly what is being "
               "looked for."))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "7", "Signatures", "Both parties agree the brief")
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Client", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Agent", [f"Name: {f('author.name', '{{author.name}}')}", "Signature:",
                   "Date:  ____ / ____ / ______"]),
    ])


# ==========================================================================
# Risk Profile Questionnaire — Compliance Structured
# ==========================================================================

def risk_profile_questionnaire(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Scored assessment",
        title=f("form.title", "Risk Profile Questionnaire"),
        subtitle=f("form.subtitle",
                   "A scored assessment of your tolerance for investment risk, the "
                   "resulting profile, and your acknowledgement of it."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client", f("client.name", "{{client.name}}")),
        ("Reference", f("client.reference", "{{client.reference}}")),
        ("Assessed by", f("author.name", "{{author.name}}")),
        ("Assessment date", f("document.issueDate", "{{document.issueDate}}")),
    ])
    C.gap(doc, theme, 0.7)

    C.section_opener(doc, theme, "1", "How this works", "Method and scoring")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="How this works",
        text="Each question carries a score from 1 to 5. The total determines your risk "
             "profile band. The result is a starting point for a conversation, not a "
             "classification — if it does not reflect how you see yourself, say so and "
             "we will record an override with the reason.",
        items=[
            "Answer every question; an unanswered question scores zero.",
            "Answer as you actually are, not as you think you should be.",
            "Bands: 7–14 Conservative · 15–21 Moderate · 22–28 Balanced · "
            "29–35 Growth.",
        ])
    page_break(doc)

    C.section_opener(doc, theme, "2", "Questions", "Seven questions, scored 1 to 5")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Question", "Response (1–5)", "Score"],
        rows=f.tuples("questions", [
            (["2.1", "How would you describe your investment experience?",
              "1 None → 5 Extensive", ""], "info"),
            (["2.2", "If your investment fell 20% in a year, what would you do?",
              "1 Sell all → 5 Buy more", ""], "info"),
            (["2.3", "How important is it that the value never falls?",
              "1 Critical → 5 Unimportant", ""], "info"),
            (["2.4", "Over what period are you investing?",
              "1 Under 3 yrs → 5 Over 15 yrs", ""], "info"),
            (["2.5", "How much of your total wealth is this investment?",
              "1 Nearly all → 5 A small part", ""], "info"),
            (["2.6", "How would you fund an unexpected shortfall?",
              "1 Could not → 5 Easily from income", ""], "info"),
            (["2.7", "Which matters more — capital growth or income now?",
              "1 Income only → 5 Growth only", ""], "info"),
        ], (["{{ref}}", "{{question}}", "{{scale}}", ""], "info"), count=7),
        widths=[16, 88, 46, 28], caption="Questionnaire",
        note="Enter one score per row in the final column. Bands are stated in section "
             "one and applied in section three.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "3", "Score & profile", "The outcome")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("TOTAL SCORE", f("profile.score", "___ / 35"), "Sum of section two"),
        ("BAND", f("profile.band", "___"), "Per section one"),
        ("PROFILE", f("profile.name", "___"), "Assessed"),
        ("ASSESSED", f("document.issueDate", "___ / ___ / ______"), "Date"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "4", "Profile description", "What the profile means")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Profile description", columns=1, fields=[
        ("Conservative (7–14)", "You prioritise capital preservation over return. "
                                "Geared property investment is unlikely to suit you."),
        ("Moderate (15–21)", "You accept limited variability for a modest return "
                             "improvement. Low-gearing, income-focused strategies suit."),
        ("Balanced (22–28)", "You accept meaningful variability for a meaningful return "
                             "improvement. Standard gearing and a mixed growth/income "
                             "strategy suit."),
        ("Growth (29–35)", "You accept substantial variability, including periods of "
                           "negative return, in pursuit of long-term growth. Higher "
                           "gearing and growth-weighted strategies suit."),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "5", "Client acknowledgement", "Your confirmation")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Client acknowledgement",
        text=f("acknowledgement.text",
               "I confirm that I answered these questions honestly, that the resulting "
               "profile reflects my tolerance for investment risk as I understand it "
               "today, and that I will tell my adviser if my circumstances or my attitude "
               "to risk change materially."))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "6", "Override", "Where the score does not fit")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Override", columns=1, fields=[
        ("Assessed profile", f("profile.name", "___")),
        ("Profile applied instead", BLANK),
        ("Reason for the override", BLANK),
        ("Client agrees to the override", BLANK),
        ("Approved by", BLANK),
    ], footnote="An override is permitted but must be documented with a reason. A "
                "profile applied without a recorded reason will fail file review.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "7", "Signatures", "Client and adviser")
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Client", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Adviser", [f"Name: {f('author.name', '{{author.name}}')}", "Signature:",
                     "Date:  ____ / ____ / ______"]),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "8", "Approvals", "Reviewer sign-off")
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Assessed by", f("author.name", "{{author.name}}"), "Complete"),
        ("Reviewed by", f("reviewer.name", "{{reviewer.name}}"), "Pending"),
    ], ("{{role}}", "{{name}}", "Pending"), count=2))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "9", "Privacy", "How we handle your information")
    C.gap(doc, theme)
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Document Collection Checklist — Minimal Professional
# ==========================================================================

def document_collection_checklist(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Outstanding items",
        title=f("form.title", "Document Collection Checklist"),
        subtitle=f("form.subtitle",
                   "What we still need from you, who owns each item, and when it is due."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client", f("client.name", "{{client.name}}")),
        ("Matter", f("matter.reference", "{{matter.reference}}")),
        ("Prepared by", f("author.name", "{{author.name}}")),
        ("As at", f("document.issueDate", "{{document.issueDate}}")),
    ])
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "1", "Summary", "Where the file stands")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("REQUIRED", f("documents.required", "18"), "Total items"),
        ("RECEIVED", f("documents.received", "11"), "Verified"),
        ("OUTSTANDING", f("documents.outstanding", "7"), "Still needed"),
        ("OVERDUE", f("documents.overdue", "2"), "Past the due date"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "2", "Outstanding items", "What we still need")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Item", "Why it is needed", "Owner", "Due", "Status"],
        rows=f.tuples("documents", [
            (["2.1", "Payslips — last two, Applicant 1", "Income verification", "Client",
              "02/08/2026", "Overdue"], "fail"),
            (["2.2", "Payslips — last two, Applicant 2", "Income verification", "Client",
              "02/08/2026", "Overdue"], "fail"),
            (["2.3", "Tax return — FY2025, Applicant 1", "Bonus income evidence",
              "Client", "08/08/2026", "Pending"], "pending"),
            (["2.4", "Notice of assessment — FY2025", "Income verification", "Client",
              "08/08/2026", "Pending"], "pending"),
            (["2.5", "Rental statement — 4 Example St", "Rental income evidence",
              "Managing agent", "08/08/2026", "Pending"], "pending"),
            (["2.6", "Council rates notice — 12 Sample Ave", "Outgoings verification",
              "Client", "12/08/2026", "Pending"], "pending"),
            (["2.7", "Contract of sale, signed", "Security verification", "Conveyancer",
              "12/08/2026", "Pending"], "pending"),
        ], (["{{ref}}", "{{item}}", "{{reason}}", "{{owner}}", "{{due}}", "Pending"],
            "pending"), count=7),
        widths=[16, 60, 46, 30, 28, 26], caption="Outstanding",
        note="Items marked overdue are holding up the application. We cannot progress "
             "to formal approval until every item in this table is received.")
    page_break(doc)

    C.section_opener(doc, theme, "3", "Received items", "What we already hold")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Item", "Received", "Verified by", "Status"],
        rows=f.tuples("documents.received", [
            (["3.1", "Driver licence — Applicant 1", "24/07/2026", "AN", "Complete"],
             "complete"),
            (["3.2", "Driver licence — Applicant 2", "24/07/2026", "AN", "Complete"],
             "complete"),
            (["3.3", "Passport — Applicant 1", "24/07/2026", "AN", "Complete"], "complete"),
            (["3.4", "Loan statements — 4 Example St", "26/07/2026", "AN", "Complete"],
             "complete"),
            (["3.5", "Loan statements — 12 Sample Ave", "26/07/2026", "AN", "Complete"],
             "complete"),
            (["3.6", "Credit card statements", "26/07/2026", "AN", "Complete"], "complete"),
        ], (["{{ref}}", "{{item}}", "{{received}}", "{{verifier}}", "Complete"],
            "complete"), count=6),
        widths=[16, 76, 32, 32, 30], caption="Received and verified")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "4", "How to send documents", "Securely")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="How to send documents",
        text=f("upload.instructions",
               "Please upload documents through the secure client portal. Do not email "
               "identity documents, bank statements or anything containing your tax file "
               "number — email is not a secure channel and we cannot accept "
               "responsibility for information sent that way."),
        items=f.items("upload.steps", [
            "Sign in to the client portal using the link we sent you.",
            "Open the matter and select 'Upload documents'.",
            "Upload as PDF or clear photographs; all four corners must be visible.",
            "If you cannot access the portal, call us and we will arrange an alternative.",
        ], count=4))


# ==========================================================================
# Client Authority Form — Minimal Professional
# ==========================================================================

def client_authority_form(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Authority to act",
        title=f("form.title", "Client Authority"),
        subtitle=f("form.subtitle",
                   "Written authority for us to act, request information, or deal with a "
                   "named third party on your behalf."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Authority reference", f("authority.reference", "{{authority.reference}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
    ])
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "1", "Parties", "Who is authorising whom")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Client name(s)", BLANK), ("Client address", BLANK),
        ("Client date of birth", BLANK), ("Client reference", BLANK),
        ("Organisation authorised", f("org.name", "{{org.name}}")),
        ("Named individual (if limited)", BLANK),
        ("Third party this authority is directed to", BLANK),
        ("Third party account or reference", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "2", "Scope of authority", "Each act, separately")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("authority.acts", [
        "Request and receive information about my accounts or holdings.",
        "Request and receive copies of statements and correspondence.",
        "Discuss my circumstances with the named third party.",
        "Request a payout figure or discharge authority.",
        "Lodge documents on my behalf.",
        "Receive documents on my behalf.",
    ], count=6), title="I authorise the organisation to", columns=1)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "3", "Limitations", "What this does not permit")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Limitations",
        text=f("authority.limitations",
               "This authority does not permit the organisation to sign any document on "
               "my behalf, to enter into any contract, to move or withdraw any money, to "
               "change any account details, or to bind me in any way. It is an authority "
               "to obtain and exchange information only, unless a specific act is ticked "
               "in section two."))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "4", "Duration", "When it starts and ends")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Start date", BLANK), ("End date", BLANK),
        ("Or ends on", BLANK), ("How to revoke", f("authority.revoke",
                                                   "Written notice to the organisation")),
    ], columns=2, input_style=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "5", "Signatures", "Client authorisation")
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Client 1", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Client 2", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.gap(doc, theme, 0.7)
    C.signature_block(doc, theme, [
        ("Witness (if required)", ["Full name:", "Signature:",
                                   "Date:  ____ / ____ / ______"]),
        ("Received by the organisation", ["Name:", "Signature:",
                                          "Date:  ____ / ____ / ______"]),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "6", "Privacy", "How we handle your information")
    C.gap(doc, theme)
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Compliance Review Report — Compliance Structured
# ==========================================================================

def compliance_review_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Internal monitoring — restricted",
        title=f("report.title", "Compliance Review Report"),
        subtitle=f("review.identity",
                   "H1 FY2026 monitoring review — scope, testing, findings, ratings and "
                   "the remediation plan arising."),
        chips=["RESTRICTED", "H1 FY2026"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Executive summary"), ("02", "Review scope & method"),
        ("03", "Ratings summary"), ("04", "Findings register"),
        ("05", "Finding detail"), ("06", "Remediation plan"),
        ("07", "Previous findings"), ("08", "Approvals"), ("A", "Testing evidence"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "Overall rating and headlines")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "Overall rating: Satisfactory with findings. Two high-severity "
                   "findings, both in disclosure record-keeping rather than in advice "
                   "quality."),
        paragraphs=f.text("report.summary", [
            "Eleven obligations were tested across 62 sampled files. Nine returned no "
            "exceptions. Two returned findings rated high, four rated medium and three "
            "rated low.",
            "The two high-severity findings share a root cause: the disclosure record is "
            "generated at recommendation but is not consistently saved back to the file "
            "when the recommendation is amended. This is a workflow defect, not an advice "
            "defect — in every sampled case the disclosure was made to the client; it was "
            "the record of it that was missing.",
            "Prior-period findings are 7 of 9 closed. The two remaining are both due "
            "before 30 September and are on track.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Overall rating: Satisfactory with findings.",
            "Two high-severity findings, both record-keeping rather than advice quality.",
            "Root cause of both is a single workflow defect in the disclosure step.",
            "Prior-period closure rate 7 of 9; both remaining are on track.",
        ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Review scope & method", "What was tested and how")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Scope and method", columns=2, fields=[
        ("Review period", f("review.period", "1 January – 30 June 2026")),
        ("Obligations tested", f("review.obligations", "11")),
        ("Population", f("review.population", "418 files")),
        ("Sample size", f("review.sample", "62 files (14.8%)")),
        ("Sampling method", f("review.method", "Risk-weighted, stratified by adviser")),
        ("Testing approach", f("review.approach", "Document review and re-performance")),
        ("Reviewer", f("review.reviewer", "R. Patel, Compliance")),
        ("Fieldwork completed", f("review.completed", "22 July 2026")),
    ], footnote="Sample size was set to give 95% confidence of detecting a 5% exception "
                "rate. It is not sufficient to quantify an exception rate below 3%.")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Ratings summary", "Findings by severity")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("HIGH", f("findings.high", "2"), "Remediate within 30 days"),
        ("MEDIUM", f("findings.medium", "4"), "Remediate within 90 days"),
        ("LOW", f("findings.low", "3"), "Remediate within 180 days"),
        ("CLOSED", f("findings.closed", "0"), "This period"),
    ])
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="Exception rate by obligation tested",
                rows=f.tuples("findings.byObligation", [
                    ("Disclosure record", 21.0, "21.0% — 13 of 62"),
                    ("Fact-find completeness", 8.1, "8.1% — 5 of 62"),
                    ("Risk profile currency", 6.5, "6.5% — 4 of 62"),
                    ("Best-interest evidence", 3.2, "3.2% — 2 of 62"),
                    ("Fee disclosure", 1.6, "1.6% — 1 of 62"),
                ], ("{{obligation}}", 10, "{{rate}}"), count=5), maximum=25,
                note="Seven further obligations returned a 0% exception rate and are not "
                     "shown.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Findings register", "Every finding, rated and owned")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Obligation", "Finding", "Owner", "Due", "Severity"],
        rows=f.tuples("findings", [
            (["4.1", "Disclosure record-keeping",
              "Disclosure record not saved to file where the recommendation was amended "
              "(13 of 62)", "Head of Advice", "30/08/2026", "High"], "high"),
            (["4.2", "Disclosure record-keeping",
              "Commission disclosure absent from 4 files where a referral fee was paid",
              "Head of Advice", "30/08/2026", "High"], "high"),
            (["4.3", "Fact-find completeness",
              "Living expenses not evidenced against HEM in 5 of 62", "Team Leader",
              "30/10/2026", "Medium"], "medium"),
            (["4.4", "Risk profile currency",
              "Risk profile older than 24 months in 4 of 62", "Team Leader",
              "30/10/2026", "Medium"], "medium"),
            (["4.5", "Best-interest evidence",
              "Alternatives-considered section incomplete in 2 of 62", "Head of Advice",
              "30/10/2026", "Medium"], "medium"),
            (["4.6", "Complaints register",
              "Two complaints recorded outside the 3-day logging window", "Compliance",
              "30/10/2026", "Medium"], "medium"),
            (["4.7", "Fee disclosure", "Fee schedule not attached in 1 of 62",
              "Team Leader", "31/01/2027", "Low"], "low"),
            (["4.8", "Training records",
              "Two advisers 1 CPD hour short at period end", "Head of Advice",
              "31/01/2027", "Low"], "low"),
            (["4.9", "Register maintenance",
              "Conflicts register not reviewed in Q2", "Compliance", "31/01/2027",
              "Low"], "low"),
        ], (["{{ref}}", "{{obligation}}", "{{finding}}", "{{owner}}", "{{due}}",
             "Medium"], "medium"), count=6),
        widths=[16, 46, 76, 34, 26, 26], caption="Findings register")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Finding detail", "The two high-severity findings")
    C.gap(doc, theme)
    for index, (ref, fields) in enumerate(f.tuples("findings.high", [
        ("4.1 — Disclosure record not saved where the recommendation was amended", [
            ("Obligation", "Records of disclosures made to clients must be retained."),
            ("Condition", "In 13 of 62 sampled files the recommendation was amended "
                          "after issue and the disclosure record was not regenerated or "
                          "saved."),
            ("Cause", "The disclosure record is generated at the recommendation step and "
                      "is not re-triggered when the recommendation is edited."),
            ("Effect", "The file does not evidence that disclosure was made, even though "
                       "in every case reviewed it was."),
            ("Recommendation", "Re-trigger disclosure generation on any amendment, and "
                               "block issue where no current disclosure record exists."),
        ]),
        ("4.2 — Commission disclosure absent where a referral fee was paid", [
            ("Obligation", "Material benefits must be disclosed to the client."),
            ("Condition", "4 files recorded a referral fee received with no corresponding "
                          "disclosure record."),
            ("Cause", "Referral fees are recorded in the finance module; the disclosure "
                      "template is generated from the advice module. The two do not "
                      "exchange data."),
            ("Effect", "No evidence of disclosure on files where a benefit was received."),
            ("Recommendation", "Surface referral-fee records in the advice module and "
                               "make disclosure mandatory where one exists."),
        ]),
    ], ("{{finding.ref}}", [("Obligation", "{{finding.obligation}}")]), count=2)):
        C.info_card(doc, theme, title=ref, fields=list(fields), columns=1)
        if index == 0:
            C.gap(doc, theme, 0.6)
    page_break(doc)

    C.section_opener(doc, theme, "06", "Remediation plan", "Actions, owners and dates")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("remediation", [
        "Re-trigger disclosure generation on any amendment to a recommendation.",
        "Block issue of a recommendation with no current disclosure record.",
        "Surface referral-fee records in the advice module.",
        "Back-fill disclosure records on the 17 affected files.",
        "Add HEM evidence to the fact-find completeness check.",
        "Introduce a 24-month risk-profile expiry prompt.",
        "Review the conflicts register quarterly and record the review.",
    ], count=7), title="Remediation", with_owner=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "07", "Previous findings", "Prior-period closure")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Prior finding", "Due", "Position", "Status"],
        rows=f.tuples("priorFindings", [
            (["P1", "Fact-find not signed in 3 files", "31/03/2026",
              "Control added; no exceptions this period", "Complete"], "complete"),
            (["P2", "Adviser CPD shortfall", "31/03/2026", "All advisers now compliant",
              "Complete"], "complete"),
            (["P3", "Complaints not logged within 3 days", "30/06/2026",
              "Recurred — see 4.6", "Fail"], "fail"),
            (["P4", "Conflicts register not maintained", "30/09/2026",
              "Quarterly review scheduled", "Pending"], "pending"),
        ], (["{{ref}}", "{{finding}}", "{{due}}", "{{position}}", "Pending"], "pending"),
            count=4),
        widths=[16, 66, 28, 60, 26], caption="Prior-period findings",
        note="P3 has recurred and is escalated as finding 4.6 with a new owner.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Approvals", "Review sign-off")
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Reviewer", f("review.reviewer", "R. Patel, Compliance"), "Complete"),
        ("Responsible manager", f("review.manager", "M. Osei, Head of Advice"), "Pending"),
        ("Compliance committee", f("review.committee", "Committee, 12 August 2026"),
         "Pending"),
    ], ("{{role}}", "{{name}}", "Pending"), count=3))
    C.appendix_opener(doc, theme, "A", "Testing evidence",
                      "Sample composition and results by obligation.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Obligation", "Population", "Sampled", "Exceptions", "Rate"],
        f.rows("appendix.testing", [
            ["Disclosure record-keeping", "418", "62", "13", "21.0%"],
            ["Fact-find completeness", "418", "62", "5", "8.1%"],
            ["Risk profile currency", "418", "62", "4", "6.5%"],
            ["Best-interest evidence", "418", "62", "2", "3.2%"],
            ["Fee disclosure", "418", "62", "1", "1.6%"],
            ["Complaints logging", "24", "24", "2", "8.3%"],
        ], ["{{obligation}}", "{{population}}", "{{sampled}}", "{{exceptions}}",
            "{{rate}}"], count=6),
        widths=[70, 28, 26, 28, 26], numeric_cols={1, 2, 3, 4})


# ==========================================================================
# Risk Assessment — Compliance Structured
# ==========================================================================

def risk_assessment(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Internal — restricted",
        title=f("report.title", "Risk Assessment"),
        subtitle=f("assessment.subject",
                   "Proposed referral arrangement with a third-party finance partner — "
                   "inherent risk, controls, residual position and the decision."),
        chips=["RESTRICTED", "FOR DECISION"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Decision", "The outcome")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Decision",
        recommendation=f("assessment.decision",
                         "Accept with controls. Proceed with the arrangement subject to "
                         "the four additional controls set out in section six."),
        rationale=f.text("assessment.rationale", [
            "Inherent risk is assessed as high, driven by the disclosure obligation and "
            "the handling of client personal information. Existing controls reduce this "
            "to medium. The four additional controls in section six reduce it to low, at "
            "an implementation cost the arrangement comfortably supports.",
        ]),
        actions=f.items("assessment.conditions", [
            "Implement the four additional controls before the first referral.",
            "Set the review frequency to six months for the first year.",
            "Report the arrangement to the compliance committee at its next meeting.",
        ]),
        confidence=f("assessment.rating", "Residual: Low"))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Context", "What is being assessed")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Context", columns=2, fields=[
        ("Subject", f("context.subject", "Referral arrangement — finance partner")),
        ("Requested by", f("context.requestedBy", "Head of Advice")),
        ("Date requested", f("context.requested", "18/07/2026")),
        ("Assessor", f("author.name", "R. Patel, Compliance")),
        ("Decision required by", f("context.decisionBy", "15/08/2026")),
        ("Estimated volume", f("context.volume", "40–60 referrals per year")),
        ("Commercial value", f("context.value", "Estimated $84,000 per year")),
        ("Related policies", f("context.policies",
                               "Referral policy, privacy policy, conflicts policy")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "03", "Risk register", "Inherent position")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Risk", "Likelihood", "Impact", "Inherent"],
        rows=f.tuples("risks", [
            (["3.1", "Referral benefit not disclosed to the client", "Possible", "Major",
              "High"], "high"),
            (["3.2", "Client personal information shared without consent", "Possible",
              "Major", "High"], "high"),
            (["3.3", "Referral is perceived as advice on credit", "Possible", "Moderate",
              "Medium"], "medium"),
            (["3.4", "Partner conduct damages our reputation", "Unlikely", "Major",
              "Medium"], "medium"),
            (["3.5", "Conflict between referral revenue and client interest", "Possible",
              "Moderate", "Medium"], "medium"),
            (["3.6", "Record-keeping insufficient for a later review", "Likely", "Minor",
              "Medium"], "medium"),
        ], (["{{ref}}", "{{description}}", "{{likelihood}}", "{{impact}}", "Medium"],
            "medium"), count=6),
        widths=[16, 86, 32, 26, 26], caption="Inherent risk register",
        note="Likelihood and impact are stated as words rather than plotted on a heat "
             "map, so the register is legible in grayscale and to assistive technology.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Controls", "What reduces the risk")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Control", "Type", "Owner", "Effectiveness", "Residual"],
        rows=f.tuples("controls", [
            (["4.1", "Disclosure generated automatically on every referral", "Preventive",
              "Head of Advice", "Effective", "Low"], "low"),
            (["4.2", "Written client consent captured before any data is shared",
              "Preventive", "Team Leader", "Effective", "Low"], "low"),
            (["4.3", "Referral form states that we do not advise on credit", "Preventive",
              "Compliance", "Partially effective", "Medium"], "medium"),
            (["4.4", "Partner due diligence performed annually", "Detective",
              "Compliance", "Effective", "Low"], "low"),
            (["4.5", "Conflicts register records the arrangement", "Detective",
              "Compliance", "Effective", "Low"], "low"),
            (["4.6", "Referral records retained in the client file", "Detective",
              "Team Leader", "Not yet implemented", "Medium"], "medium"),
        ], (["{{ref}}", "{{control}}", "{{type}}", "{{owner}}", "{{effectiveness}}",
             "Medium"], "medium"), count=6),
        widths=[16, 70, 26, 34, 40, 26], caption="Controls and residual rating")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "05", "Residual position", "After controls")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("HIGHEST RESIDUAL", f("residual.highest", "MEDIUM"), "Before new controls"),
        ("HIGH", f("residual.high", "0"), "Residual risks"),
        ("MEDIUM", f("residual.medium", "2"), "Residual risks"),
        ("LOW", f("residual.low", "4"), "Residual risks"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "06", "Treatment plan", "The additional controls")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("treatments", [
        "Add a mandatory 'we do not advise on credit' acknowledgement to the referral "
        "form, ticked by the client.",
        "Auto-file the referral record and the consent to the client file on submission.",
        "Add the arrangement to the conflicts register with a six-month review date.",
        "Include referral files in the next compliance monitoring sample.",
    ], count=4), title="Additional controls", with_owner=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "07", "Monitoring", "How this stays under control")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Monitoring", columns=2, fields=[
        ("Review frequency", f("monitoring.frequency", "6 months for the first year")),
        ("First review", f("monitoring.first", "15/02/2027")),
        ("Owner", f("monitoring.owner", "Compliance")),
        ("Escalation trigger", f("monitoring.trigger",
                                 "Any complaint, or any referral without a consent record")),
        ("Reporting", f("monitoring.reporting", "Compliance committee, quarterly")),
        ("Termination trigger", f("monitoring.termination",
                                  "Partner loses authorisation, or two consent failures")),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Approvals", "Assessor and approver")
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Assessed by", f("author.name", "R. Patel, Compliance"), "Complete"),
        ("Approved by", f("approver.name", "M. Osei, Director"), "Pending"),
    ], ("{{role}}", "{{name}}", "Pending"), count=2))


# ==========================================================================
# Audit Report — Compliance Structured
# ==========================================================================

def audit_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Internal audit — for the audit committee",
        title=f("report.title", "Audit Report"),
        subtitle=f("audit.identity",
                   "Client onboarding and customer due diligence — FY2026 internal audit, "
                   "objective, scope, findings, opinion and management response."),
        chips=["INTERNAL AUDIT", "FY2026"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Opinion"), ("02", "Objective & scope"), ("03", "Methodology"),
        ("04", "Summary of findings"), ("05", "Detailed findings"),
        ("06", "Management response"), ("07", "Follow-up of prior findings"),
        ("08", "Approvals"), ("A", "Evidence"), ("B", "Criteria"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Opinion", "The audit opinion")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Opinion",
        recommendation=f("audit.opinion",
                         "Partially effective. The control environment for client "
                         "onboarding and customer due diligence operates as designed in "
                         "most respects, but two controls did not operate effectively "
                         "throughout the period."),
        rationale=f.text("audit.opinionRationale", [
            "The design of the control environment is sound and maps completely to the "
            "obligations in the AML/CTF programme. The exceptions are operational: "
            "beneficial-ownership verification was not evidenced for 6 of 48 sampled "
            "non-individual customers, and enhanced due diligence was not applied to 2 "
            "of 7 customers rated medium or above.",
            "Neither exception resulted in a customer being onboarded who should have "
            "been declined, on the evidence available. Both represent a failure to "
            "evidence, and in the second case a failure to apply, a control the "
            "programme requires.",
        ]),
        actions=f.items("audit.opinionActions", [
            "Management response is recorded at section six and is accepted.",
            "Both high findings are due for remediation by 31 October 2026.",
            "A follow-up audit is recommended in Q3 FY2027.",
        ]),
        confidence=f("audit.rating", "Partially effective"))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "02", "Objective & scope", "What was audited")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Objective and scope", columns=1, fields=[
        ("Objective", f("audit.objective",
                        "To assess whether controls over client onboarding and customer "
                        "due diligence were designed appropriately and operated "
                        "effectively during the period.")),
        ("Scope — included", f("audit.included",
                               "Identity verification, beneficial ownership, screening, "
                               "risk rating, enhanced due diligence, ongoing monitoring, "
                               "record retention.")),
        ("Scope — excluded", f("audit.excluded",
                               "Transaction monitoring, suspicious matter reporting, and "
                               "the AML/CTF programme's design, each audited separately.")),
        ("Period", f("audit.period", "1 July 2025 to 30 June 2026")),
        ("Criteria", f("audit.criteria",
                       "The organisation's AML/CTF programme, its onboarding procedure, "
                       "and applicable legislation. Full criteria at appendix B.")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "03", "Methodology", "How the audit was conducted")
    C.gap(doc, theme)
    C.prose(doc, theme, f.text("audit.methodology", [
        "The audit combined control design assessment with operating-effectiveness "
        "testing. Design was assessed by walkthrough of each control with its owner and "
        "by tracing one transaction end to end. Operating effectiveness was tested by "
        "re-performance on a stratified sample.",
        "The population comprised 612 customers onboarded during the period, of which 94 "
        "were non-individual. The sample of 96 was stratified to over-weight "
        "non-individual customers (48 of 94) and customers rated medium or above (7 of "
        "7), because those populations carry the higher inherent risk and the smaller "
        "counts.",
        "Sample sizes give 95% confidence of detecting a 5% exception rate in the "
        "individual-customer population. They are not sufficient to quantify an "
        "exception rate below 3% in any stratum.",
    ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "04", "Summary of findings", "By severity")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("HIGH", f("findings.high", "2"), "Remediate by 31/10/2026"),
        ("MEDIUM", f("findings.medium", "3"), "Remediate by 31/01/2027"),
        ("LOW", f("findings.low", "2"), "Remediate by 30/04/2027"),
        ("CONTROLS TESTED", f("findings.tested", "14"), "9 effective"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "05", "Detailed findings", "Criteria, condition, cause, effect")
    C.gap(doc, theme)
    for index, (ref, fields) in enumerate(f.tuples("findings", [
        ("Finding 1 — Beneficial ownership not evidenced (High)", [
            ("Criteria", "The programme requires beneficial owners at or above 25% to be "
                         "identified and verified for every non-individual customer."),
            ("Condition", "6 of 48 sampled non-individual customers had no evidence of "
                          "beneficial-ownership verification on file."),
            ("Cause", "The onboarding workflow permits submission without the beneficial "
                      "ownership step being completed, and no downstream control detects "
                      "the omission."),
            ("Effect", "The organisation cannot demonstrate that it identified the "
                       "beneficial owners of those six customers."),
            ("Recommendation", "Make the beneficial-ownership step mandatory in the "
                               "workflow and add an exception report for files where it "
                               "is absent."),
        ]),
        ("Finding 2 — Enhanced due diligence not applied (High)", [
            ("Criteria", "The programme requires enhanced due diligence for every "
                         "customer rated medium or above."),
            ("Condition", "2 of 7 customers rated medium or above had no EDD measures "
                          "recorded."),
            ("Cause", "The risk rating is calculated after the onboarding decision is "
                      "recorded, so the EDD prompt is never raised for customers rated "
                      "at the final step."),
            ("Effect", "Two customers were onboarded without the additional measures the "
                       "programme requires for their rating."),
            ("Recommendation", "Calculate the risk rating before the onboarding decision "
                               "and block the decision until EDD is recorded where the "
                               "rating requires it."),
        ]),
    ], ("{{finding.ref}}", [("Criteria", "{{finding.criteria}}")]), count=2)):
        C.info_card(doc, theme, title=ref, fields=list(fields), columns=1)
        if index == 0:
            C.gap(doc, theme, 0.6)
        else:
            page_break(doc)

    C.section_opener(doc, theme, "06", "Management response", "Per finding")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Finding", "Agreed", "Owner", "Target date", "Status"],
        rows=f.tuples("responses", [
            (["1", "Beneficial ownership not evidenced", "Agreed",
              "Head of Operations", "31/10/2026", "Pending"], "pending"),
            (["2", "Enhanced due diligence not applied", "Agreed", "Compliance",
              "31/10/2026", "Pending"], "pending"),
            (["3", "Screening evidence not date-stamped", "Agreed", "Compliance",
              "31/01/2027", "Pending"], "pending"),
            (["4", "Risk rating rationale not recorded", "Agreed", "Compliance",
              "31/01/2027", "Pending"], "pending"),
            (["5", "Retention schedule not applied to screening reports", "Agreed",
              "Head of Operations", "31/01/2027", "Pending"], "pending"),
            (["6", "Two identity documents expired at verification", "Agreed",
              "Team Leader", "30/04/2027", "Pending"], "pending"),
            (["7", "Onboarding procedure not version controlled", "Agreed in part",
              "Compliance", "30/04/2027", "Review"], "review"),
        ], (["{{ref}}", "{{finding}}", "{{agreed}}", "{{owner}}", "{{target}}",
             "Pending"], "pending"), count=6),
        widths=[16, 76, 30, 40, 30, 26], caption="Management response",
        note="Finding 7 is agreed in part: management accepts the finding but proposes a "
             "different remediation. The audit function accepts the alternative.")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "07", "Follow-up of prior findings", "FY2025 closure")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Prior finding", "Target", "Position", "Status"],
        rows=f.tuples("priorFindings", [
            (["FY25-1", "Identity documents not certified", "31/12/2025",
              "Control implemented; no exceptions this period", "Complete"], "complete"),
            (["FY25-2", "Screening not performed on beneficial owners", "31/12/2025",
              "Control implemented and effective", "Complete"], "complete"),
            (["FY25-3", "Retention period not documented", "30/06/2026",
              "Schedule documented; application incomplete — see finding 5", "Fail"],
             "fail"),
        ], (["{{ref}}", "{{finding}}", "{{target}}", "{{position}}", "Pending"],
            "pending"), count=3),
        widths=[24, 62, 28, 62, 26], caption="Prior-period findings")
    C.gap(doc, theme)
    C.section_opener(doc, theme, "08", "Approvals", "Audit sign-off")
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Auditor", f("audit.auditor", "Internal Audit"), "Complete"),
        ("Reviewed by", f("audit.reviewer", "Head of Internal Audit"), "Complete"),
        ("Accepted by", f("audit.committee", "Audit Committee"), "Pending"),
    ], ("{{role}}", "{{name}}", "Pending"), count=3))
    C.appendix_opener(doc, theme, "A", "Evidence",
                      "Sample composition and testing results by control.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Control", "Population", "Sampled", "Exceptions", "Conclusion"],
        f.rows("appendix.evidence", [
            ["Identity verification", "612", "96", "2", "Effective"],
            ["Beneficial ownership", "94", "48", "6", "Not effective"],
            ["Screening performed", "612", "96", "0", "Effective"],
            ["Screening evidence dated", "612", "96", "9", "Partially effective"],
            ["Risk rating applied", "612", "96", "0", "Effective"],
            ["Risk rating rationale", "612", "96", "11", "Partially effective"],
            ["Enhanced due diligence", "7", "7", "2", "Not effective"],
            ["Record retention", "612", "96", "4", "Partially effective"],
        ], ["{{control}}", "{{population}}", "{{sampled}}", "{{exceptions}}",
            "{{conclusion}}"], count=8),
        widths=[62, 28, 26, 28, 34], numeric_cols={1, 2, 3})
    C.appendix_opener(doc, theme, "B", "Criteria",
                      "The standards and obligations against which the audit was conducted.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Ref", "Criterion", "Source"],
        f.rows("appendix.criteria", [
            ["B.1", "Customer identification procedures", "AML/CTF programme, Part A"],
            ["B.2", "Beneficial ownership identification", "AML/CTF programme, Part A"],
            ["B.3", "Politically exposed person screening", "AML/CTF programme, Part A"],
            ["B.4", "Risk-based approach and customer rating", "AML/CTF programme, Part A"],
            ["B.5", "Enhanced customer due diligence", "AML/CTF programme, Part A"],
            ["B.6", "Record keeping and retention", "AML/CTF programme, Part B"],
        ], ["{{ref}}", "{{criterion}}", "{{source}}"], count=6),
        widths=[20, 88, 70])


# ==========================================================================
# File Review Summary — Minimal Professional
# ==========================================================================

def file_review_summary(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Quality assurance — internal",
        title=f("report.title", "File Review Summary"),
        subtitle=f("review.identity",
                   "A single client file reviewed against the standard checklist, with "
                   "the outcome and any remediation required."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("File reference", f("client.reference", "{{client.reference}}")),
        ("Client", f("client.name", "{{client.name}}")),
        ("Adviser", f("review.adviser", "{{review.adviser}}")),
        ("Reviewer", f("review.reviewer", "{{review.reviewer}}")),
        ("Review date", f("document.issueDate", "{{document.issueDate}}")),
        ("Review type", f("review.type", "Scheduled quality assurance")),
    ])
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "1", "Outcome", "The result")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("RESULT", f("review.result", "PASS WITH ACTIONS"), "Overall"),
        ("CHECKED", f("review.checked", "22"), "Items"),
        ("FAILED", f("review.failed", "3"), "Requiring remediation"),
        ("DUE", f("review.due", "14/08/2026"), "Remediation deadline"),
    ])
    C.gap(doc, theme)
    C.section_opener(doc, theme, "2", "Review checklist", "Every item checked")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Item", "Reviewer comment", "Result"],
        rows=f.tuples("checklist", [
            (["2.01", "Client engagement signed and dated", "Signed 14/06/2026", "Pass"],
             "pass"),
            (["2.02", "Fact-find complete", "All sections completed", "Pass"], "pass"),
            (["2.03", "Fact-find signed by all applicants", "Signed by both", "Pass"],
             "pass"),
            (["2.04", "Living expenses evidenced against HEM",
              "Declared only; no HEM comparison on file", "Fail"], "fail"),
            (["2.05", "Identity verified for all applicants", "Both verified 14/06/2026",
              "Pass"], "pass"),
            (["2.06", "Risk profile current (within 24 months)", "Dated 03/2025", "Pass"],
             "pass"),
            (["2.07", "Objectives recorded in the client's words", "Recorded", "Pass"],
             "pass"),
            (["2.08", "Alternatives considered documented",
              "Two alternatives named; no reason recorded for rejecting them", "Fail"],
             "fail"),
            (["2.09", "Recommendation issued in writing", "Issued 28/06/2026", "Pass"],
             "pass"),
            (["2.10", "Disclosure record on file", "Present and current", "Pass"], "pass"),
            (["2.11", "Fee schedule attached", "Attached", "Pass"], "pass"),
            (["2.12", "File notes contemporaneous",
              "Two notes added 9 days after the meeting", "Review"], "review"),
        ], (["{{ref}}", "{{item}}", "{{comment}}", "Pending"], "pending"), count=8),
        widths=[18, 66, 68, 26], caption="Review checklist")
    page_break(doc)

    C.section_opener(doc, theme, "3", "Remediation", "What must be fixed")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("remediation", [
        "Add the HEM comparison to the fact find and re-verify serviceability (2.04).",
        "Document the reason each alternative was not recommended (2.08).",
        "Add a file note explaining the nine-day delay in recording the meeting (2.12).",
    ], count=3), title="Remediation required", with_owner=True)
    C.gap(doc, theme)
    C.section_opener(doc, theme, "4", "Reviewer comments", "Observations")
    C.gap(doc, theme)
    C.prose(doc, theme, f.text("review.comments", [
        "The file is well organised and the advice itself is sound. The three failures "
        "are all documentation rather than substance: in each case the work appears to "
        "have been done and the record of it is missing or incomplete.",
        "The HEM comparison failure (2.04) is the same finding raised in the last two "
        "compliance monitoring reviews. It is a systemic gap rather than an adviser "
        "issue, and has been referred to compliance separately.",
    ]))
    C.gap(doc, theme)
    C.section_opener(doc, theme, "5", "Approvals", "Reviewer and adviser")
    C.gap(doc, theme)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Reviewed by", f("review.reviewer", "{{review.reviewer}}"), "Complete"),
        ("Adviser acknowledgement", f("review.adviser", "{{review.adviser}}"), "Pending"),
    ], ("{{role}}", "{{name}}", "Pending"), count=2))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="Circulation",
        text="This review is an internal quality-assurance record. It is not provided to "
             "the client and must not be included in any client-facing pack.")


# ==========================================================================
# Board Report — Executive Corporate
# ==========================================================================

def board_report(doc, theme: Theme, f: Fill) -> None:
    # A board paper is filed, photocopied and read in a pack of twenty others.
    # The header block is therefore the first thing on the page and carries
    # every field a company secretary needs to file it — no cover page, no
    # contents, no chart. Design restraint here is the design.
    C.cover(
        doc, theme,
        eyebrow_text=f("paper.classification", "Board paper — commercial in confidence"),
        title=f("paper.title", "Delivery Capacity Re-weighting"),
        subtitle=f("paper.subtitle",
                   "Proposal to move delivery capacity toward advisory and compliance "
                   "work, funded from existing headcount."),
        prepared_for=False)
    C.gap(doc, theme, 0.7)
    C.definition_grid(doc, theme, [
        ("Agenda item", f("paper.agendaItem", "7.2")),
        ("Meeting date", f("paper.meetingDate", "19 August 2026")),
        ("Prepared by", f("author.name", "{{author.name}}")),
        ("Position", f("author.title", "{{author.title}}")),
        ("Paper reference", f("document.reference", "{{document.reference}}")),
        ("Classification", f("paper.classification", "Commercial in confidence")),
        ("Decision or noting", f("paper.decisionType", "For decision")),
        ("Previously considered", f("paper.priorConsideration", "Item 6.4, 20 May 2026")),
    ])
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "1", "Purpose", "")
    C.gap(doc, theme, 0.6)
    C.highlight_box(
        doc, theme, tone="info", title="Purpose of this paper",
        text=f("paper.purpose",
               "To seek the board's approval to re-weight delivery capacity toward "
               "advisory and compliance work over two quarters, funded from the existing "
               "transactional team rather than net new hiring, and to approve the "
               "associated retraining budget of $84,000."))
    page_break(doc)

    C.section_opener(doc, theme, "2", "Recommendation", "")
    C.gap(doc, theme, 0.6)
    C.recommendation_box(
        doc, theme, title="Management recommendation",
        recommendation=f("paper.recommendation",
                         "That the board approve the re-weighting of delivery capacity "
                         "toward advisory and compliance over two quarters, together with "
                         "a retraining and accreditation budget of $84,000, on the basis "
                         "that no net new headcount is required and the change is "
                         "reversible within one quarter."),
        rationale=f.text("paper.rationale", [
            "The revenue mix has moved materially and has done so in each of the last "
            "four periods. Advisory utilisation reached 94% against a sustainable ceiling "
            "of 85% in the final month of the period, and four engagements were declined "
            "for capacity reasons. On the current trajectory the constraint binds in Q3.",
        ]),
        actions=f.items("paper.actionsSought", [
            "Approve the retraining and accreditation budget of $84,000.",
            "Approve the transfer of four delivery staff between service lines.",
            "Note the advisory client concentration risk and the mitigation target.",
        ]),
        confidence="")
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "3", "Background", "What the board has already seen")
    C.gap(doc, theme, 0.6)
    C.prose(doc, theme, f.text("paper.background", [
        "At its meeting of 20 May 2026 the board considered item 6.4, which reported a "
        "shift in revenue mix toward advisory and compliance work and asked management to "
        "return with options once a further period of data was available.",
        "That data is now available. The period closed at $4.28m against a plan of $3.96m, "
        "a favourable variance of 8.1%, produced by 214 engagements against a plan of 243. "
        "Average engagement value rose from $16,300 to $20,000. The result is a mix "
        "effect rather than a pricing effect: like-for-like advisory pricing has been "
        "unchanged for seven quarters.",
        "The operating model, the resourcing plan and the pricing structure were all "
        "designed around the previous mix. This paper addresses the first of those three; "
        "pricing is the subject of a separate review reporting in Q2.",
    ]))
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "4", "Discussion", "Management's analysis")
    C.gap(doc, theme, 0.6)
    C.prose(doc, theme, f.text("paper.discussion", [
        "Three findings bear on the decision. First, the mix shift is structural rather "
        "than seasonal: advisory and compliance growth has been positive in each of the "
        "last four periods, and the transactional decline tracks a market-wide fall in "
        "volumes rather than a loss of share — share in transactional work is unchanged "
        "at 4.1%.",
        "Second, delivery capacity rather than demand is now the binding constraint. "
        "Declined engagements are the clearest evidence: four in the period, all in "
        "advisory, all for capacity rather than fit or price.",
        "Third, the change contemplated is small and reversible. Four staff move between "
        "service lines over two quarters, staggered so that no more than two are out of "
        "production at any time. If transactional enquiry volumes recover, the same four "
        "staff can be returned within a quarter, and management proposes a formal "
        "re-weight trigger at a 15% recovery in transactional enquiry volume.",
    ]))
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Item", "Amount", "Timing", "Budget position", "Note"],
        f.rows("paper.financialImpact", [
            ["Retraining and accreditation", "$84,000", "Q1 – Q2 FY27", "Within budget",
             "One-off cost"],
            ["Net new headcount cost", "$0", "—", "No change",
             "Funded from the existing team"],
            ["Forgone transactional revenue", "$(196,000)", "Q1 – Q2 FY27",
             "Reforecast required", "Two quarters of reduced production"],
            ["Incremental advisory revenue", "$540,000", "From Q3 FY27",
             "Upside to plan", "12 months from Q3"],
            ["Net effect, 12 months", "$260,000", "FY27", "Favourable",
             "Before any pricing change"],
        ], ["{{item}}", "{{amount}}", "{{timing}}", "{{budget}}", "{{note}}"], count=5),
        widths=[46, 26, 28, 32, 46], numeric_cols={1}, emphasis_rows={4},
        caption="Financial impact",
        note="Amounts are management estimates prepared on the same basis as the "
             "quarterly forecast. They are not audited and do not form part of the "
             "statutory accounts.")
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "5", "Options", "Alternatives considered")
    C.gap(doc, theme, 0.6)
    C.comparison_table(
        doc, theme,
        subject_labels=["A — Hold", "B — Re-weight", "C — Expand"],
        attributes=[
            ("Description", ["Change nothing this year",
                             "Move capacity from transactional to advisory",
                             "Hire into advisory and compliance"]),
            ("Net new headcount", ["0", "0", "6"]),
            ("Cost in period", ["$0", "$84,000", "$690,000"]),
            ("Revenue effect, 12 months", ["−$310,000", "+$540,000", "+$980,000"]),
            ("Time to effect", ["—", "2 quarters", "3 quarters"]),
            ("Reversibility", ["n/a", "High — one quarter", "Low — fixed cost added"]),
            ("Principal risk", ["Continues to decline work we can deliver",
                                "Retraining lag reduces Q1 capacity",
                                "Fixed cost committed ahead of demand"]),
        ],
        caption="Options assessed", winner_index=1)
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "6", "Risk & compliance", "")
    C.gap(doc, theme, 0.6)
    C.risk_box(doc, theme, title="Risk implications and management", risks=f.tuples(
        "paper.risks", [
            ("Retraining lag reduces delivery capacity in Q1",
             "Medium", "Transfers staggered across two cohorts; no more than two staff "
                       "out of production at once. Monthly capacity reporting to the "
                       "executive."),
            ("Transactional volumes recover and capacity sits in the wrong place",
             "Medium", "Change is reversible within one quarter. Formal re-weight "
                       "trigger set at a 15% recovery in transactional enquiry volume."),
            ("Advisory revenue is concentrated in two clients",
             "High", "The two clients represent 31% of advisory revenue. A business "
                     "development target of four new advisory clients by Q3 is added to "
                     "the plan and reported monthly."),
            ("Accreditation not obtained within the planned window",
             "Low", "Accreditation dates are confirmed with the provider before the "
                    "budget is committed. No transfer proceeds without a booked place."),
        ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=4))
    C.gap(doc, theme, 0.7)
    C.prose(doc, theme, f.text("paper.compliance", [
        "There are no licensing implications. All four staff proposed for transfer hold "
        "the qualifications required for advisory work; the accreditation being funded is "
        "an internal standard rather than a regulatory requirement. Employment obligations "
        "in respect of role change have been reviewed and consultation requirements under "
        "the applicable agreement will be met before any transfer takes effect.",
    ]))
    C.gap(doc, theme, 0.8)

    C.section_opener(doc, theme, "7", "Resolution", "The wording proposed")
    C.gap(doc, theme, 0.6)
    C.highlight_box(
        doc, theme, tone="success", title="Resolution sought",
        text=f("paper.resolution",
               "That the board resolves to approve the re-weighting of delivery capacity "
               "toward advisory and compliance services as set out in this paper, and "
               "approves expenditure of up to $84,000 on associated retraining and "
               "accreditation, to be funded from the approved operating budget."),
        items=f.items("paper.resolutionNotes", [
            "Moved by: ______________________     Seconded by: ______________________",
            "Carried / Not carried / Carried as amended  (delete as applicable)",
            "Minute reference: ______________________",
        ], count=3))
    C.gap(doc, theme, 0.8)
    C.approval_block(doc, theme, f.tuples("paper.approvals", [
        ("Prepared by — management", "A. Nguyen", "Approved"),
        ("Reviewed by — Chief Executive", "M. Okafor", "Approved"),
        ("Tabled by — Company Secretary", "R. Patel", "Pending"),
        ("Resolved by — the Board", "Minute reference", "Pending"),
    ], ("{{approval.role}}", "{{approval.name}}", "Pending"), count=4))

    C.appendix_opener(doc, theme, "A", "Attachments",
                      "Documents provided with this paper and available in the board "
                      "portal. Attachments are not reproduced in the paper itself.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Ref", "Attachment", "Pages", "Source"],
        f.rows("paper.attachments", [
            ["A1", "Period financial pack, service line detail", "12", "Finance"],
            ["A2", "Advisory utilisation report, 12 months", "4", "Operations"],
            ["A3", "Declined engagement log", "2", "Operations"],
            ["A4", "Accreditation provider quotation", "3", "External"],
            ["A5", "Employment consultation plan", "5", "People & Culture"],
        ], ["{{ref}}", "{{title}}", "{{pages}}", "{{source}}"], count=5),
        widths=[18, 96, 22, 42], numeric_cols={2}, caption="Attachment index")


# ==========================================================================
# Quarterly Business Review — Modern Technology
# ==========================================================================

def quarterly_business_review(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text=f("review.period", "Q2 FY26  ·  April – June 2026"),
        title=f("review.title", "Quarterly Business Review"),
        subtitle=f("review.subtitle",
                   "Results against target, pipeline position, client outcomes and the "
                   "priorities for the coming period."),
        chips=["PERFORMANCE", "INTERNAL"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Period at a glance", "Four headline measures")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("REVENUE", f("headline.revenue", "$4.28m"), "▲ 8.1% vs target"),
        ("NEW CLIENTS", f("headline.newClients", "38"), "▲ 5 vs target"),
        ("SETTLEMENTS", f("headline.settlements", "214"), "▼ 11.9% vs target"),
        ("NPS", f("headline.nps", "+62"), "▲ 4 pts"),
    ])
    C.gap(doc, theme, 0.8)
    C.metric_panel(doc, theme, [
        ("AVG ENGAGEMENT", f("headline.averageValue", "$20,000"), "▲ 22.7%"),
        ("UTILISATION", f("headline.utilisation", "81%"), "▲ 6 pts"),
        ("PIPELINE", f("headline.pipeline", "$6.9m"), "▲ 14% QoQ"),
        ("RETENTION", f("headline.retention", "94%"), "— flat"),
    ])
    C.gap(doc, theme, 0.8)
    C.executive_summary(
        doc, theme, title="Summary",
        headline=f("review.headline",
                   "Revenue ahead of target on lower volume — the mix has shifted toward "
                   "advisory, and capacity is now the constraint."),
        paragraphs=f.text("review.summary", [
            "The quarter closed at $4.28m against a target of $3.96m. Volume was behind "
            "target at 214 settlements against 243, so the favourable revenue variance "
            "was produced entirely by a rise in average engagement value from $16,300 to "
            "$20,000.",
            "Advisory and compliance revenue grew 34% and 41% respectively against the "
            "prior period, while transactional revenue fell 19%. Client satisfaction held: "
            "NPS rose four points to +62 and retention was flat at 94%.",
            "Advisory utilisation reached 94% in June against a sustainable ceiling of "
            "85%, and four engagements were declined for capacity reasons. Capacity, not "
            "demand, is the binding constraint on the next two quarters.",
        ]),
        takeaways=f.items("review.takeaways", [
            "Revenue ahead of target; volume behind it — this is a mix result.",
            "Advisory and compliance are growing; transactional is declining with market.",
            "Capacity binds in Q3 on the current trajectory.",
            "Client measures are stable to improving across the board.",
        ]))
    page_break(doc)

    C.section_opener(doc, theme, "02", "Results against target", "Every measure, one table")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Measure", "Target", "Actual", "Variance", "Prior qtr", "Movement"],
        f.rows("results", [
            ["Revenue", "$3,960,000", "$4,280,000", "+8.1%", "$3,742,000", "+14.4%"],
            ["Settlements", "243", "214", "−11.9%", "229", "−6.6%"],
            ["Average engagement value", "$16,300", "$20,000", "+22.7%", "$16,340", "+22.4%"],
            ["Advisory revenue", "$1,180,000", "$1,581,000", "+34.0%", "$1,180,000", "+34.0%"],
            ["Compliance revenue", "$742,000", "$1,046,000", "+41.0%", "$742,000", "+41.0%"],
            ["Transactional revenue", "$2,038,000", "$1,653,000", "−18.9%", "$2,040,000", "−19.0%"],
            ["New clients", "33", "38", "+15.2%", "31", "+22.6%"],
            ["Client retention", "94%", "94%", "—", "94%", "—"],
            ["Net promoter score", "+58", "+62", "+4 pts", "+58", "+4 pts"],
            ["Delivery utilisation", "75%", "81%", "+6 pts", "76%", "+5 pts"],
        ], ["{{measure}}", "{{target}}", "{{actual}}", "{{variance}}", "{{prior}}",
            "{{movement}}"], count=8),
        widths=[52, 30, 30, 26, 30, 28], numeric_cols={1, 2, 3, 4, 5},
        emphasis_rows={0, 3, 4, 5}, caption="Results against target",
        note="Variance is actual against target. Movement is actual against the prior "
             "quarter on the same basis.")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Trend", "Four quarters, one axis convention")
    C.gap(doc, theme)
    C.chart_frame(
        doc, theme, title="Revenue by service line, last four quarters",
        kind="stacked column chart", binding="{{results.series}}", height_mm=58,
        caption="The same axis convention is used every period so editions compare",
        source="Finance system, quarter close",
        alt_text="Advisory and compliance grow in each of the last four quarters while "
                 "transactional revenue declines")
    C.gap(doc, theme, 0.7)
    C.chart_frame(
        doc, theme, title="Revenue and settlements against target, by month",
        kind="combination column and line chart", binding="{{results.monthly}}",
        height_mm=54, caption="Revenue ahead of target in each month; volume behind it",
        source="Finance system",
        alt_text="Monthly revenue exceeds target while settlement volume falls short")
    page_break(doc)

    C.section_opener(doc, theme, "04", "Pipeline", "Position entering the next quarter")
    C.gap(doc, theme)
    C.bar_chart(doc, theme, rows=f.tuples("pipeline", [
        ("Qualified enquiry", 2.4, "$2.4m"),
        ("Brief agreed", 1.8, "$1.8m"),
        ("Under search", 1.5, "$1.5m"),
        ("Offer stage", 0.8, "$0.8m"),
        ("Exchanged, unsettled", 0.4, "$0.4m"),
    ], ("{{stage.name}}", 1.0, "{{stage.value}}"), count=5),
        caption="Pipeline value by stage, quarter close",
        note="Values are expected fee revenue, unweighted. Weighted pipeline at the "
             "same date is $3.1m.")
    C.gap(doc, theme, 0.8)
    C.data_table(
        doc, theme, ["Stage", "Count", "Value", "Avg age", "Conversion", "Movement"],
        f.rows("pipeline.detail", [
            ["Qualified enquiry", "61", "$2,400,000", "9 days", "34%", "▲ 12"],
            ["Brief agreed", "42", "$1,800,000", "21 days", "71%", "▲ 6"],
            ["Under search", "29", "$1,500,000", "48 days", "84%", "▲ 3"],
            ["Offer stage", "14", "$800,000", "11 days", "62%", "▼ 2"],
            ["Exchanged, unsettled", "8", "$400,000", "26 days", "99%", "— flat"],
        ], ["{{stage}}", "{{count}}", "{{value}}", "{{age}}", "{{conversion}}",
            "{{movement}}"], count=5),
        widths=[40, 20, 32, 24, 34, 28], numeric_cols={1, 2, 3, 4, 5},
        total_row=["Total pipeline", "154", "$6,900,000", "—", "—", "▲ 14%"],
        caption="Pipeline detail by stage")
    page_break(doc)

    C.section_opener(doc, theme, "05", "Client outcomes", "Evidence, not assertion")
    C.gap(doc, theme)
    for title, fields in f.tuples("outcomes", [
        ("Outcome — Off-market acquisition, lower north shore", [
            ("Brief", "Investment house, 500m²+, within 12km, yield above 4.2%"),
            ("Constraint", "Client had searched nine months without success"),
            ("What we did", "Narrowed to two corridors; sourced off market in week seven"),
            ("Result", "Exchanged 3.4% below vendor guide; 4.7% gross yield"),
        ]),
        ("Outcome — Refinance and equity release", [
            ("Brief", "Release equity for a third acquisition without extending the term"),
            ("Constraint", "Existing lender would not lend above 72% on the security"),
            ("What we did", "Restructured across two lenders; split fixed and variable"),
            ("Result", "$310,000 released; repayment $84/month lower than before"),
        ]),
        ("Outcome — First-time investor onboarding", [
            ("Brief", "First investment purchase under $700,000, positive cash flow"),
            ("Constraint", "Serviceability marginal at the client's preferred lender"),
            ("What we did", "Re-modelled with a second lender; adjusted the target yield"),
            ("Result", "Settled at $648,000; cash flow positive from month one"),
        ]),
    ], ("{{outcome.title}}", [("{{outcome.label}}", "{{outcome.value}}")]), count=3):
        C.info_card(doc, theme, title=title, fields=fields, columns=1)
        C.gap(doc, theme, 0.55)
    page_break(doc)

    C.section_opener(doc, theme, "06", "Issues & blockers", "What is impeding performance")
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="Issues and blockers", risks=f.tuples("issues", [
        ("Advisory delivery capacity at 94% utilisation",
         "High", "Four engagements declined in the quarter. Re-weighting proposal goes "
                 "to the board on 19 August; retraining begins the following week."),
        ("Advisory revenue concentrated in two clients (31%)",
         "High", "Business development target of four new advisory clients by Q3, "
                 "reported monthly against a named prospect list."),
        ("Transactional volumes tracking a market-wide decline",
         "Medium", "Share is unchanged at 4.1%, so this is market rather than "
                   "performance. Monitored monthly with a re-weight trigger at +15%."),
        ("Like-for-like pricing unchanged for seven quarters",
         "Medium", "Pricing review commissioned; reports in Q2 with a recommendation "
                   "on advisory rates."),
    ], ("{{issue.description}}", "Medium", "{{issue.action}}"), count=4))
    page_break(doc)

    C.section_opener(doc, theme, "07", "Priorities next period", "Owners and dates")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("priorities", [
        "Secure board approval for delivery capacity re-weighting (19 August).",
        "Begin cohort 1 retraining; two staff, accreditation complete by 30 September.",
        "Deliver the pricing review with a recommendation on advisory rates.",
        "Add four new advisory clients against the named prospect list.",
        "Hold advisory utilisation at or below 88% through the transition.",
    ], count=5), title="Priorities for the coming quarter", columns=1, with_owner=True)
    C.gap(doc, theme, 0.8)
    C.timeline(doc, theme, f.tuples("calendar", [
        ("July", "Pricing review fieldwork", "Benchmarking complete"),
        ("August", "Board decision on re-weighting", "Item 7.2, 19 August"),
        ("September", "Cohort 1 accreditation", "Two staff in production by 1 October"),
        ("October", "Quarter close and next review", "Q3 QBR issued 14 October"),
    ], ("{{when}}", "{{what}}", "{{detail}}"), count=4), caption="Key dates")

    C.appendix_opener(doc, theme, "A", "Detail",
                      "Full measure detail behind the summary tables, on the same basis "
                      "as the finance system quarter close.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Measure", "Apr", "May", "Jun", "Quarter", "Target"],
        f.rows("appendix.monthly", [
            ["Revenue", "$1,384,000", "$1,401,000", "$1,495,000", "$4,280,000", "$3,960,000"],
            ["Settlements", "74", "68", "72", "214", "243"],
            ["New clients", "12", "13", "13", "38", "33"],
            ["Advisory utilisation", "76%", "84%", "94%", "85%", "75%"],
            ["Declined engagements", "0", "1", "3", "4", "0"],
            ["Net promoter score", "+59", "+61", "+62", "+62", "+58"],
        ], ["{{measure}}", "{{m1}}", "{{m2}}", "{{m3}}", "{{quarter}}", "{{target}}"],
            count=6),
        widths=[46, 26, 26, 26, 30, 24], numeric_cols={1, 2, 3, 4, 5},
        caption="Monthly detail",
        note="Advisory utilisation for the quarter is the average of the three months, "
             "not the sum.")


# ==========================================================================
# Partnership Proposal — Luxury Presentation
# ==========================================================================

def partnership_proposal(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Partnership proposal",
        title=f("proposal.title", "A Referral Partnership"),
        subtitle=f("proposal.subtitle",
                   "A proposal to work together on shared clients — what each party "
                   "brings, how the commercial terms work, and how we would start."),
        image_caption=f("proposal.coverCaption",
                        "Cover image, 3:2. Neutral and architectural — not a property "
                        "either party is currently selling."),
        prepared_for=False)
    C.gap(doc, theme, 0.8)
    # Both slots are the same width by construction. An unequal lockup reads as
    # an unequal partnership, and the recipient is the party who notices.
    C.logo_lockup(doc, theme,
                  left_label=theme.brand.logo_placeholder,
                  right_label=theme.brand.partner_logo_placeholder)
    C.gap(doc, theme, 0.7)
    C.definition_grid(doc, theme, [
        ("Proposed to", f("partner.name", "{{partner.name}}")),
        ("Proposed by", f("org.name", "{{org.name}}")),
        ("Contact", f("author.name", "{{author.name}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Valid until", f("proposal.validity", "30 days from the date above")),
        ("Status", f("proposal.status", "Non-binding — for discussion")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "The opportunity", "")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="The opportunity",
        headline=f("proposal.headline",
                   "Both businesses are already serving the same client at different "
                   "moments. Neither is introducing the other."),
        paragraphs=f.text("proposal.opportunity", [
            "Your clients reach you when they are ready to borrow. Ours reach us when "
            "they are ready to buy. In practice these are the same people six weeks "
            "apart, and at the moment each of us hands them to whoever they happen to "
            "find next.",
            "Of the 214 acquisitions we completed in the last twelve months, 186 involved "
            "finance and 71 of those clients told us at intake that they had not yet "
            "spoken to a broker. That is a meaningful volume of warm, qualified "
            "introductions currently going nowhere in particular.",
            "The proposal is narrow on purpose. It is a two-way referral relationship "
            "with written terms, clear service boundaries and a single point of contact "
            "on each side — not a joint venture, not a shared entity, and not an "
            "exclusive arrangement.",
        ]),
        takeaways=f.items("proposal.takeaways", [
            "An estimated 70+ warm introductions each way per year.",
            "Two-way, non-exclusive, terminable on 30 days' notice.",
            "Written service boundaries so neither party advises outside its licence.",
            "First referral inside eight weeks of agreement.",
        ]))
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="Proposed structure",
        recommendation=f("proposal.structure",
                         "A two-way, non-exclusive referral relationship under a written "
                         "agreement, with a nominated relationship owner on each side, "
                         "agreed service boundaries, and a quarterly review of volume, "
                         "conversion and client feedback."),
        rationale=f.text("proposal.structureRationale", [
            "Non-exclusive, because exclusivity is worth less than it costs at this "
            "stage: neither party can currently absorb the whole of the other's volume, "
            "and an exclusive arrangement would leave clients waiting.",
            "Written rather than informal, because the moment a referral relationship "
            "carries a fee it carries disclosure obligations, and both parties are "
            "better served by having those written down before the first introduction "
            "than after the first complaint.",
        ]),
        actions=f.items("proposal.structureActions", [
            "Nominate a relationship owner on each side.",
            "Agree the written referral terms and disclosure wording.",
            "Set the quarterly review date for the first twelve months.",
        ]),
        confidence="")
    page_break(doc)

    C.section_opener(doc, theme, "", "What each party brings", "")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=[f("org.shortName", "Our business"),
                        f("partner.shortName", "Your business")],
        attributes=[
            ("Core service", ["Buyer advocacy and acquisition",
                              "Mortgage and lending advice"]),
            ("Client moment", ["Ready to buy; brief not yet defined",
                               "Ready to borrow; property not yet identified"]),
            ("Annual client volume", ["214 acquisitions", "{{partner.volume}}"]),
            ("What we introduce", ["Clients who need finance structured before they bid",
                                   "Clients who need a property found and negotiated"]),
            ("Estimated introductions p.a.", ["70 – 90", "{{partner.estimate}}"]),
            ("What the client gains", ["Finance in place before the first offer",
                                       "A brief, a shortlist and a negotiator"]),
            ("Licensing", ["Licensed real estate agent",
                           "Australian Credit Licence / credit representative"]),
            ("Relationship owner", ["{{author.name}}", "{{partner.contact.name}}"]),
        ],
        caption="Contribution and benefit, by party")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="What this is not",
        text="Being explicit about the boundaries at proposal stage saves a difficult "
             "conversation later.",
        items=f.items("proposal.notThis", [
            "Not exclusive — either party may work with others.",
            "Not a joint venture; no shared entity, staff or liability is created.",
            "Not a commitment to volume; neither party guarantees a number.",
            "Not a licence to advise outside your own — each party stays in its lane.",
        ], count=4))
    page_break(doc)

    C.section_opener(doc, theme, "", "Client journey", "")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("journey", [
        ("Introduce", "The referring party asks the client's consent, explains the "
                      "relationship and the fee, and records the consent in writing."),
        ("Hand over", "A single-page handover with the client's consent, contact "
                      "details and what they have been told, sent to the named "
                      "relationship owner."),
        ("Contact", "The receiving party contacts the client within one business day "
                    "and confirms receipt to the referring party."),
        ("Advise", "Each party advises only within its own licence. Neither comments "
                   "on the other's recommendation."),
        ("Report back", "The referring party is told the outcome — proceeded, declined "
                        "or lapsed — within five business days of it being known."),
        ("Review", "Volume, conversion and client feedback reviewed quarterly against "
                   "the agreed measures."),
    ], ("{{journey.step}}", "{{journey.detail}}"), count=6),
        caption="How a shared client moves between the parties")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Client consent comes first",
        text="No client detail passes between the parties until the client has been told "
             "who they are being introduced to, that a fee is payable, and how much. "
             "Consent is recorded in writing and is retained by the referring party.")
    page_break(doc)

    C.section_opener(doc, theme, "", "Commercial terms", "")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Basis", "Amount", "Trigger", "Payable"],
        f.rows("terms", [
            ["Finance referral fee", "Percentage of upfront commission", "20%",
             "Loan settles", "Within 14 days of commission receipt"],
            ["Acquisition referral fee", "Percentage of engagement fee", "10%",
             "Client signs a buyer's agency agreement", "Within 14 days of fee receipt"],
            ["Trail share", "Percentage of trail commission", "Nil",
             "—", "Not applicable in year one"],
            ["Marketing contribution", "Shared, by agreement", "50 / 50",
             "Joint activity agreed in writing", "In advance of the activity"],
            ["Disbursements", "At cost, pre-approved above $250", "At cost",
             "As incurred", "Monthly in arrears"],
        ], ["{{term.item}}", "{{term.basis}}", "{{term.amount}}", "{{term.trigger}}",
            "{{term.payable}}"], count=5),
        widths=[38, 44, 24, 38, 34], numeric_cols={2},
        caption="Proposed commercial terms",
        note="All amounts are exclusive of GST. Fees are disclosed to the client before "
             "the introduction is made and are payable only where the client proceeds. "
             "No fee is payable on a referral that does not convert.")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Scenario", "Referrals", "Conversion", "Avg fee", "To you"],
        f.rows("terms.illustration", [
            ["Conservative", "50", "30%", "$2,100", "$31,500"],
            ["Base", "75", "40%", "$2,100", "$63,000"],
            ["Strong", "95", "50%", "$2,300", "$109,250"],
        ], ["{{scenario}}", "{{referrals}}", "{{conversion}}", "{{fee}}", "{{value}}"],
            count=3),
        widths=[38, 32, 30, 32, 46], numeric_cols={1, 2, 3, 4}, emphasis_rows={1},
        caption="Illustrative value, first full year — referrals are per annum",
        note="Illustrative only. Based on our own referral volumes and conversion rates "
             "over the last twelve months; your results will differ.")
    page_break(doc)

    C.section_opener(doc, theme, "", "Governance & boundaries", "")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="How the relationship is governed",
        text=f("proposal.governance",
               "Both parties remain separately licensed, separately insured and "
               "separately responsible for their own advice. Nothing in the proposed "
               "arrangement makes either party an agent, employee or representative of "
               "the other."),
        items=f.items("proposal.governanceItems", [
            "Each party holds and maintains its own licence and professional indemnity "
            "cover, and provides evidence annually.",
            "Neither party advises on a matter outside its own licence, and neither "
            "endorses the other's recommendation to a client.",
            "Referral fees are disclosed to the client in writing before the "
            "introduction, in the form set out in the referral agreement.",
            "Client data passes only with written consent, only for the purpose of the "
            "referral, and is handled under each party's own privacy policy.",
            "Either party may terminate on 30 days' written notice. Fees already "
            "triggered survive termination.",
            "Complaints are handled by the party whose advice is the subject of the "
            "complaint, and the other party is notified within two business days.",
        ], count=6))
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Relationship owner — us", f("author.name", "{{author.name}}")),
        ("Relationship owner — you", f("partner.contact.name", "{{partner.contact.name}}")),
        ("Review cadence", f("proposal.reviewCadence", "Quarterly, first year")),
        ("Notice period", f("proposal.noticePeriod", "30 days, either party")),
        ("Measures reviewed", f("proposal.measures",
                                "Volume, conversion, time to contact, client feedback")),
        ("Agreement form", f("proposal.agreementForm",
                             "Written referral agreement, executed by both parties")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "Activation plan", "")
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("activation", [
        ("Week 1", "Agreement in principle",
         "Terms confirmed or amended; relationship owners nominated"),
        ("Week 2", "Referral agreement executed",
         "Written terms, disclosure wording and consent form signed"),
        ("Week 3", "Team briefing",
         "One session each side: what to refer, when, and what to say"),
        ("Week 4", "Process live",
         "Handover form, consent record and contact SLA in place"),
        ("Week 5 – 8", "First referrals",
         "Both directions; each one reviewed individually"),
        ("Week 12", "First quarterly review",
         "Volume, conversion, time to contact and client feedback"),
    ], ("{{activation.when}}", "{{activation.what}}", "{{activation.detail}}"), count=6),
        caption="From agreement to first referral")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("nextSteps", [
        "Confirm whether the proposed structure works in principle, or tell us what "
        "you would change.",
        "Nominate your relationship owner.",
        "Review the draft referral agreement and disclosure wording.",
        "Confirm your estimated referral volume so the illustration can be re-run.",
        "Book the two team briefing sessions.",
    ], count=5), title="Next steps", columns=1, with_owner=True)
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Response requested by", f("proposal.responseBy", "{{proposal.responseBy}}")),
        ("Contact", f("author.name", "{{author.name}}")),
        ("Direct line", f("author.phone", "{{author.phone}}")),
        ("Email", f("author.email", "{{author.email}}")),
    ])
    C.disclaimer_page(
        doc, theme, title="Terms",
        kicker="Status of this proposal, validity and confidentiality",
        extra_sections=[
        ("Status of this proposal",
         "This document is a proposal for discussion. It is not an offer capable of "
         "acceptance and does not create any binding obligation on either party. Any "
         "arrangement between the parties takes effect only under a written referral "
         "agreement executed by both."),
        ("Validity",
         "The terms set out in this proposal are open for 30 days from the date shown on "
         "the cover. Illustrative figures are based on the proposing party's own "
         "historical volumes and conversion rates and are not a forecast, a projection or "
         "a guarantee of any result."),
        ("Confidentiality",
         "This proposal, including the commercial terms, is provided in confidence for "
         "the named recipient's evaluation. It may be shared within the recipient's "
         "organisation for that purpose and may not be disclosed further without written "
         "consent."),
    ])
    C.back_cover(doc, theme)
