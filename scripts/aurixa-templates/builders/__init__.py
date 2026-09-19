"""Template generators, keyed by the template id in ``catalogue.py``.

A catalogue entry with ``built=True`` must have an entry here, and every entry
here must correspond to a catalogue entry. ``verify_library.py`` asserts both
directions, so a generator can never drift away from its published brief.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from finance_templates import (
    borrowing_capacity_report, cash_flow_net_position_report,
    construction_finance_report, equity_release_strategy,
    finance_approval_summary, finance_strategy_report,
    lending_recommendation_report, loan_comparison_report,
    refinance_assessment, serviceability_assessment,
    smsf_finance_assessment
)
from governance_templates import (
    aml_kyc_assessment, audit_report, board_report, client_authority_form,
    client_fact_find_form, client_onboarding_form, client_proposal,
    client_verification_summary, compliance_review_report,
    document_collection_checklist, executive_business_report,
    file_review_summary, investor_goals_questionnaire, partnership_proposal,
    property_brief_form, quarterly_business_review, risk_assessment,
    risk_profile_questionnaire
)
from property_templates import (
    commercial_property_assessment, development_feasibility_report,
    house_and_land_assessment, market_area_research_report,
    off_market_opportunity_report, portfolio_review_report,
    property_acquisition_recommendation, property_comparison_report,
    property_due_diligence_report, property_investment_report,
    suburb_analysis_report
)

#: template id -> (build function, output filename stem)
BUILDERS = {
    "property-investment-report":
        (property_investment_report, "Aurixa_Property_Investment_Report"),
    "property-acquisition-recommendation":
        (property_acquisition_recommendation, "Aurixa_Property_Acquisition_Recommendation"),
    "off-market-opportunity-report":
        (off_market_opportunity_report, "Aurixa_Off_Market_Opportunity_Report"),
    "property-due-diligence-report":
        (property_due_diligence_report, "Aurixa_Property_Due_Diligence_Report"),
    "property-comparison-report":
        (property_comparison_report, "Aurixa_Property_Comparison_Report"),
    "borrowing-capacity-report":
        (borrowing_capacity_report, "Aurixa_Borrowing_Capacity_Report"),
    "finance-strategy-report":
        (finance_strategy_report, "Aurixa_Finance_Strategy_Report"),
    "loan-comparison-report":
        (loan_comparison_report, "Aurixa_Loan_Comparison_Report"),
    "cash-flow-net-position-report":
        (cash_flow_net_position_report, "Aurixa_Cash_Flow_Net_Position_Report"),
    "client-fact-find-form":
        (client_fact_find_form, "Aurixa_Client_Fact_Find_Form"),
    "client-onboarding-form":
        (client_onboarding_form, "Aurixa_Client_Onboarding_Form"),
    "aml-kyc-assessment":
        (aml_kyc_assessment, "Aurixa_AML_KYC_Assessment"),
    "client-verification-summary":
        (client_verification_summary, "Aurixa_Client_Verification_Summary"),
    "executive-business-report":
        (executive_business_report, "Aurixa_Executive_Business_Report"),
    "client-proposal":
        (client_proposal, "Aurixa_Client_Proposal"),
    "suburb-analysis-report":
        (suburb_analysis_report, "Aurixa_Suburb_Analysis_Report"),
    "market-area-research-report":
        (market_area_research_report, "Aurixa_Market_Area_Research_Report"),
    "house-and-land-assessment":
        (house_and_land_assessment, "Aurixa_House_And_Land_Assessment"),
    "commercial-property-assessment":
        (commercial_property_assessment, "Aurixa_Commercial_Property_Assessment"),
    "development-feasibility-report":
        (development_feasibility_report, "Aurixa_Development_Feasibility_Report"),
    "portfolio-review-report":
        (portfolio_review_report, "Aurixa_Portfolio_Review_Report"),
    "lending-recommendation-report":
        (lending_recommendation_report, "Aurixa_Lending_Recommendation_Report"),
    "refinance-assessment":
        (refinance_assessment, "Aurixa_Refinance_Assessment"),
    "equity-release-strategy":
        (equity_release_strategy, "Aurixa_Equity_Release_Strategy"),
    "serviceability-assessment":
        (serviceability_assessment, "Aurixa_Serviceability_Assessment"),
    "construction-finance-report":
        (construction_finance_report, "Aurixa_Construction_Finance_Report"),
    "smsf-finance-assessment":
        (smsf_finance_assessment, "Aurixa_SMSF_Finance_Assessment"),
    "finance-approval-summary":
        (finance_approval_summary, "Aurixa_Finance_Approval_Summary"),
    "investor-goals-questionnaire":
        (investor_goals_questionnaire, "Aurixa_Investor_Goals_Questionnaire"),
    "property-brief-form":
        (property_brief_form, "Aurixa_Property_Brief_Form"),
    "risk-profile-questionnaire":
        (risk_profile_questionnaire, "Aurixa_Risk_Profile_Questionnaire"),
    "document-collection-checklist":
        (document_collection_checklist, "Aurixa_Document_Collection_Checklist"),
    "client-authority-form":
        (client_authority_form, "Aurixa_Client_Authority_Form"),
    "compliance-review-report":
        (compliance_review_report, "Aurixa_Compliance_Review_Report"),
    "risk-assessment":
        (risk_assessment, "Aurixa_Risk_Assessment"),
    "audit-report":
        (audit_report, "Aurixa_Audit_Report"),
    "file-review-summary":
        (file_review_summary, "Aurixa_File_Review_Summary"),
    "board-report":
        (board_report, "Aurixa_Board_Report"),
    "quarterly-business-review":
        (quarterly_business_review, "Aurixa_Quarterly_Business_Review"),
    "partnership-proposal":
        (partnership_proposal, "Aurixa_Partnership_Proposal"),
}

__all__ = ["BUILDERS"]
