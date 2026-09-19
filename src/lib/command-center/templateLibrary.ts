// GENERATED FILE — do not edit by hand.
// Source: scripts/aurixa-templates/catalogue.py + theme.py
// Regenerate: python3 scripts/aurixa-templates/export_registry.py
//
// The Command Center template library registry. This is the same record set the
// design briefs are generated from, so the grid, the filters, the recommender
// and the specification cannot disagree with each other.

export type TemplateCategory = "property" | "finance" | "forms" | "compliance" | "business";
export type DesignFamilyKey = "executive-corporate" | "modern-technology" | "premium-advisory" | "property-visual" | "financial-analytical" | "minimal-professional" | "luxury-presentation" | "compliance-structured";
export type LengthBand = "brief" | "standard" | "extended" | "variable";
export type Intensity = "none" | "low" | "medium" | "high";
export type Formality = "operational" | "professional" | "formal" | "presentation";
export type PlanTier = "launch" | "growth" | "scale" | "enterprise";
export type AudienceMode = "client-facing" | "internal" | "regulator" | "partner";

export interface TemplateSection {
  title: string;
  component: string;
  purpose: string;
  optional: boolean;
  repeats: boolean;
  binding: string;
}

export interface WhiteLabelPoint {
  area: string;
  binding: string;
  appearsIn: string;
}

/** The long-form half of a template record: sections, bindings, white-label
 *  points and the full design brief. Deliberately NOT bundled — it is ~40× the
 *  size of the index and is only needed once a user opens a template's detail
 *  drawer. Fetched from `/templates/command-center/template-library.json`, and
 *  the same payload seeds `command_center_templates` in the database. */
export interface TemplateDetail {
  id: string;
  sections: TemplateSection[];
  bindings: string[];
  whiteLabelPoints: WhiteLabelPoint[];
  imageRequirements: string;
  chartRequirements: string;
  exports: string;
  accessibility: string;
  print: string;
  preview: string;
  thumbnail: string;
  visualStyle: string;
  colourConfig: string;
  coverStructure: string;
  headerFooter: string;
}

export const TEMPLATE_DETAIL_URL = "/templates/command-center/template-library.json";

let detailCache: Record<string, TemplateDetail> | null = null;

/** Load the detail payload once per session. */
export async function loadTemplateDetail(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, TemplateDetail>> {
  if (detailCache) return detailCache;
  const response = await fetchImpl(TEMPLATE_DETAIL_URL);
  if (!response.ok) {
    throw new Error(`Template detail unavailable (${response.status})`);
  }
  const payload = (await response.json()) as {
    version: number;
    templates: Record<string, TemplateDetail>;
  };
  detailCache = payload.templates;
  return detailCache;
}

export interface TemplateRecord {
  id: string;
  name: string;
  summary: string;
  category: TemplateCategory;
  categoryLabel: string;
  family: DesignFamilyKey;
  familyName: string;
  familyTagline: string;
  audience: string;
  audienceMode: AudienceMode;
  useCase: string;
  length: LengthBand;
  lengthLabel: string;
  pages: string;
  dataIntensity: Intensity;
  imageIntensity: Intensity;
  formality: Formality;
  tier: PlanTier;
  priority: "P1" | "P2" | "P3";
  maxWhiteLabelLevel: 1 | 2 | 3 | 4;
  reportTypes: string[];
  industries: string[];
  sectionCount: number;
  optionalSectionCount: number;
  components: string[];
  useWhen: string[];
  useOther: { situation: string; alternativeId: string | null }[];
  implemented: boolean;
}

export interface TemplateLibrary {
  categories: { key: TemplateCategory; label: string }[];
  lengthBands: { key: LengthBand; label: string }[];
  families: {
    key: DesignFamilyKey;
    name: string;
    tagline: string;
    displayFont: string;
    bodyFont: string;
    coverStyle: string;
    tableStyle: string;
    density: number;
    suitableFor: string[];
  }[];
  brandLevels: { level: number; key: string; name: string; description: string }[];
  shelves: { title: string; why: string; templateIds: string[] }[];
  templates: TemplateRecord[];
}

export const TEMPLATE_LIBRARY = {
  "categories": [
    {
      "key": "property",
      "label": "Property & Buyer's Agency"
    },
    {
      "key": "finance",
      "label": "Finance & Lending"
    },
    {
      "key": "forms",
      "label": "Client Forms & Onboarding"
    },
    {
      "key": "compliance",
      "label": "Compliance & Governance"
    },
    {
      "key": "business",
      "label": "Business & Advisory"
    }
  ],
  "lengthBands": [
    {
      "key": "brief",
      "label": "1–3 pages — a single decision, summary or form"
    },
    {
      "key": "standard",
      "label": "4–10 pages — a complete report with analysis and a recommendation"
    },
    {
      "key": "extended",
      "label": "11–25 pages — multi-section analysis with appendices"
    },
    {
      "key": "variable",
      "label": "Length follows the record count — grows with rows, properties or controls"
    }
  ],
  "families": [
    {
      "key": "executive-corporate",
      "name": "Executive Corporate",
      "tagline": "Boardroom-ready. Formal, decisive, built around the executive summary.",
      "displayFont": "Cambria",
      "bodyFont": "Calibri",
      "coverStyle": "band",
      "tableStyle": "banded",
      "density": 1.0,
      "suitableFor": [
        "Board reports",
        "Executive business reports",
        "Strategic recommendations",
        "Quarterly reviews"
      ]
    },
    {
      "key": "modern-technology",
      "name": "Modern Technology",
      "tagline": "SaaS-inspired. Card-led, data-forward, contemporary and digital-first.",
      "displayFont": "Calibri",
      "bodyFont": "Calibri",
      "coverStyle": "panel",
      "tableStyle": "hairline",
      "density": 1.05,
      "suitableFor": [
        "Finance strategy",
        "Portfolio reviews",
        "Project status",
        "Implementation plans"
      ]
    },
    {
      "key": "premium-advisory",
      "name": "Premium Advisory",
      "tagline": "Consulting register. Generous spacing, elegant dividers, considered recommendations.",
      "displayFont": "Georgia",
      "bodyFont": "Calibri",
      "coverStyle": "split",
      "tableStyle": "ruled",
      "density": 1.18,
      "suitableFor": [
        "Acquisition recommendations",
        "Client proposals",
        "Advisory reports",
        "Partnership proposals"
      ]
    },
    {
      "key": "property-visual",
      "name": "Property Visual",
      "tagline": "Image-led. Property photography, maps, location data and side-by-side comparison.",
      "displayFont": "Calibri",
      "bodyFont": "Calibri",
      "coverStyle": "fullbleed",
      "tableStyle": "banded",
      "density": 0.95,
      "suitableFor": [
        "Property investment reports",
        "Suburb analysis",
        "Property comparisons",
        "Off-market opportunities"
      ]
    },
    {
      "key": "financial-analytical",
      "name": "Financial Analytical",
      "tagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "displayFont": "Calibri",
      "bodyFont": "Calibri",
      "coverStyle": "band",
      "tableStyle": "ledger",
      "density": 0.88,
      "suitableFor": [
        "Borrowing capacity",
        "Cash-flow projections",
        "Loan comparisons",
        "Serviceability assessments"
      ]
    },
    {
      "key": "minimal-professional",
      "name": "Minimal Professional",
      "tagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "displayFont": "Arial",
      "bodyFont": "Arial",
      "coverStyle": "minimal",
      "tableStyle": "hairline",
      "density": 0.92,
      "suitableFor": [
        "Client forms",
        "Checklists",
        "Internal summaries",
        "High-volume generation"
      ]
    },
    {
      "key": "luxury-presentation",
      "name": "Luxury Presentation",
      "tagline": "Editorial and unhurried. Oversized display type, deep whitespace, prestige framing.",
      "displayFont": "Georgia",
      "bodyFont": "Calibri",
      "coverStyle": "editorial",
      "tableStyle": "ruled",
      "density": 1.32,
      "suitableFor": [
        "Prestige property presentations",
        "Investment opportunities",
        "Executive proposals",
        "High-value client packs"
      ]
    },
    {
      "key": "compliance-structured",
      "name": "Compliance Structured",
      "tagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "displayFont": "Calibri",
      "bodyFont": "Calibri",
      "coverStyle": "band",
      "tableStyle": "boxed",
      "density": 0.9,
      "suitableFor": [
        "AML and KYC",
        "Audit reports",
        "Risk assessments",
        "File reviews",
        "Verification summaries"
      ]
    }
  ],
  "brandLevels": [
    {
      "level": 1,
      "key": "aurixa",
      "name": "Aurixa Branded",
      "description": "Aurixa Systems is the author and the visible brand. Used for platform-issued documents, sales collateral and Aurixa's own client work."
    },
    {
      "level": 2,
      "key": "co-branded",
      "name": "Co-Branded",
      "description": "Partner logo leads on the cover; Aurixa appears as a secondary lockup on the cover, the back cover and the footer. Used during partner onboarding and for jointly delivered engagements."
    },
    {
      "level": 3,
      "key": "partner",
      "name": "Partner Branded",
      "description": "Partner is the primary and only cover brand. Aurixa is reduced to a discreet 'Powered by Aurixa' line in the footer and back cover. The default for most paying organisations."
    },
    {
      "level": 4,
      "key": "white-label",
      "name": "Fully White-Labelled",
      "description": "No visible Aurixa mark anywhere in the document body, headers, footers or metadata. Reserved for tiers where it is contractually permitted."
    }
  ],
  "shelves": [
    {
      "title": "Best for executive reports",
      "why": "Formal, decision-led, built around a summary a director reads in ninety seconds.",
      "templateIds": [
        "executive-business-report",
        "board-report",
        "quarterly-business-review"
      ]
    },
    {
      "title": "Best for property-heavy reports",
      "why": "Image-led layouts with map, gallery and comparison components.",
      "templateIds": [
        "property-investment-report",
        "property-comparison-report",
        "suburb-analysis-report",
        "off-market-opportunity-report",
        "house-and-land-assessment",
        "commercial-property-assessment"
      ]
    },
    {
      "title": "Best for financial modelling",
      "why": "Ledger tables, scenario columns and assumption panels.",
      "templateIds": [
        "borrowing-capacity-report",
        "cash-flow-net-position-report",
        "loan-comparison-report",
        "development-feasibility-report",
        "serviceability-assessment"
      ]
    },
    {
      "title": "Best for short client summaries",
      "why": "One to three pages, one decision, no appendices.",
      "templateIds": [
        "finance-approval-summary",
        "property-acquisition-recommendation",
        "loan-comparison-report",
        "property-brief-form"
      ]
    },
    {
      "title": "Best for long-form reports",
      "why": "Multi-section analysis with appendices and a document map.",
      "templateIds": [
        "property-due-diligence-report",
        "portfolio-review-report",
        "development-feasibility-report",
        "compliance-review-report"
      ]
    },
    {
      "title": "Best for compliance documentation",
      "why": "Numbered controls, evidence columns and approval trails.",
      "templateIds": [
        "aml-kyc-assessment",
        "client-verification-summary",
        "compliance-review-report",
        "audit-report",
        "file-review-summary"
      ]
    },
    {
      "title": "Best for digital forms",
      "why": "Field-affordance inputs, tab-through completion, minimal ink.",
      "templateIds": [
        "client-fact-find-form",
        "client-onboarding-form",
        "risk-profile-questionnaire",
        "document-collection-checklist",
        "client-authority-form",
        "investor-goals-questionnaire"
      ]
    },
    {
      "title": "Best for premium client presentations",
      "why": "Editorial covers, generous whitespace, prestige framing.",
      "templateIds": [
        "off-market-opportunity-report",
        "client-proposal",
        "partnership-proposal",
        "property-acquisition-recommendation"
      ]
    }
  ],
  "templates": [
    {
      "id": "property-investment-report",
      "name": "Property Investment Report",
      "summary": "Full investment case for a single property: the asset, the numbers, the risks and a clear buy / do-not-buy recommendation.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "property-visual",
      "familyName": "Property Visual",
      "familyTagline": "Image-led. Property photography, maps, location data and side-by-side comparison.",
      "audience": "Investor clients and their advisers",
      "audienceMode": "client-facing",
      "useCase": "Present a researched investment case for one property and record a recommendation the client can act on.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "8–14 pages",
      "dataIntensity": "high",
      "imageIntensity": "high",
      "formality": "professional",
      "tier": "growth",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Property investment",
        "Investment analysis",
        "Acquisition case"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 16,
      "optionalSectionCount": 3,
      "components": [
        "cover",
        "executive_summary",
        "metric_panel",
        "info_card",
        "image_gallery",
        "map_frame",
        "data_table",
        "chart_frame",
        "risk_box",
        "recommendation_box",
        "adviser_profile",
        "disclaimer_page",
        "back_cover"
      ],
      "useWhen": [
        "You have researched one property and need to present the whole case.",
        "The client needs a document they can take to a lender or partner.",
        "Photography and location context materially support the argument."
      ],
      "useOther": [
        {
          "situation": "You are comparing two or more properties",
          "alternativeId": "property-comparison-report"
        },
        {
          "situation": "The client only needs the numbers",
          "alternativeId": "cash-flow-net-position-report"
        },
        {
          "situation": "You are assessing risk and defects before exchange",
          "alternativeId": "property-due-diligence-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "property-due-diligence-report",
      "name": "Property Due-Diligence Report",
      "summary": "Structured pre-exchange investigation: title, planning, building, environmental and contractual findings against a numbered checklist.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "Buyer's agents, conveyancers, investor clients",
      "audienceMode": "client-facing",
      "useCase": "Evidence that every due-diligence item was investigated, with findings and outstanding items recorded against each.",
      "length": "extended",
      "lengthLabel": "11–25 pages — multi-section analysis with appendices",
      "pages": "10–20 pages",
      "dataIntensity": "medium",
      "imageIntensity": "low",
      "formality": "formal",
      "tier": "growth",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Due diligence",
        "Pre-purchase investigation",
        "Contract review"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 16,
      "optionalSectionCount": 3,
      "components": [
        "cover",
        "table_of_contents",
        "highlight_box",
        "executive_summary",
        "status_table",
        "data_table",
        "checklist",
        "risk_box",
        "recommendation_box",
        "approval_block",
        "appendix_opener",
        "disclaimer_page"
      ],
      "useWhen": [
        "You are investigating a property before exchange.",
        "You need an auditable record that each item was checked.",
        "A third party (lender, solicitor, co-investor) will review your work."
      ],
      "useOther": [
        {
          "situation": "You are making the investment case",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "You need a short checklist to work from, not a report",
          "alternativeId": "document-collection-checklist"
        }
      ],
      "implemented": true
    },
    {
      "id": "property-acquisition-recommendation",
      "name": "Property Acquisition Recommendation",
      "summary": "A short, decisive advisory document: the recommendation, the reasoning behind it, the strategy for securing the asset, and what happens next.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "premium-advisory",
      "familyName": "Premium Advisory",
      "familyTagline": "Consulting register. Generous spacing, elegant dividers, considered recommendations.",
      "audience": "Retained buyer's agency clients",
      "audienceMode": "client-facing",
      "useCase": "Recommend a specific acquisition and the negotiation strategy to secure it.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–6 pages",
      "dataIntensity": "medium",
      "imageIntensity": "low",
      "formality": "presentation",
      "tier": "growth",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Acquisition recommendation",
        "Buy recommendation",
        "Advisory memo"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 10,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "recommendation_box",
        "executive_summary",
        "comparison_table",
        "metric_panel",
        "process_flow",
        "risk_box",
        "checklist",
        "signature_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "You are recommending one specific property to a retained client.",
        "The client needs to make a decision quickly.",
        "Full analysis already exists and this is the decision document."
      ],
      "useOther": [
        {
          "situation": "The client needs the full research",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "You are recommending a lender or loan",
          "alternativeId": "lending-recommendation-report"
        },
        {
          "situation": "You are pitching for the engagement itself",
          "alternativeId": "client-proposal"
        }
      ],
      "implemented": true
    },
    {
      "id": "property-comparison-report",
      "name": "Property Comparison Report",
      "summary": "Two to five properties assessed side by side against a common set of attributes, with a ranked outcome.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "property-visual",
      "familyName": "Property Visual",
      "familyTagline": "Image-led. Property photography, maps, location data and side-by-side comparison.",
      "audience": "Investor and owner-occupier clients",
      "audienceMode": "client-facing",
      "useCase": "Help a client choose between shortlisted properties on consistent criteria.",
      "length": "variable",
      "lengthLabel": "Length follows the record count — grows with rows, properties or controls",
      "pages": "6–12 pages, growing with the number of properties",
      "dataIntensity": "high",
      "imageIntensity": "high",
      "formality": "professional",
      "tier": "growth",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Property comparison",
        "Shortlist review",
        "Options analysis"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 9,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "highlight_box",
        "comparison_table",
        "bar_chart",
        "info_card",
        "data_table",
        "map_frame",
        "recommendation_box",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client is choosing between two and five shortlisted properties.",
        "You need consistent criteria applied to every option.",
        "The decision is a choice, not a yes/no."
      ],
      "useOther": [
        {
          "situation": "There is only one property",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "You are comparing loans rather than properties",
          "alternativeId": "loan-comparison-report"
        },
        {
          "situation": "The client has already chosen",
          "alternativeId": "property-acquisition-recommendation"
        }
      ],
      "implemented": true
    },
    {
      "id": "suburb-analysis-report",
      "name": "Suburb Analysis Report",
      "summary": "Location-level research: demographics, supply, demand, price and rent history, infrastructure and outlook for one suburb.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "property-visual",
      "familyName": "Property Visual",
      "familyTagline": "Image-led. Property photography, maps, location data and side-by-side comparison.",
      "audience": "Investor clients, internal research teams",
      "audienceMode": "client-facing",
      "useCase": "Establish whether a location supports the client's investment strategy.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "6–12 pages",
      "dataIntensity": "high",
      "imageIntensity": "medium",
      "formality": "professional",
      "tier": "growth",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Suburb analysis",
        "Location research",
        "Area report"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 13,
      "optionalSectionCount": 3,
      "components": [
        "cover",
        "metric_panel",
        "executive_summary",
        "chart_frame",
        "data_table",
        "timeline",
        "map_frame",
        "comparison_table",
        "risk_box",
        "recommendation_box",
        "appendix_opener",
        "disclaimer_page"
      ],
      "useWhen": [
        "Research is about a location rather than a specific property.",
        "A client is deciding where, not what, to buy.",
        "You need to evidence a location thesis."
      ],
      "useOther": [
        {
          "situation": "The subject is one property",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "You need broad multi-region market commentary",
          "alternativeId": "market-area-research-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "market-area-research-report",
      "name": "Market & Area Research Report",
      "summary": "Wider market commentary across several regions or asset classes, built for periodic publication rather than a single client decision.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "modern-technology",
      "familyName": "Modern Technology",
      "familyTagline": "SaaS-inspired. Card-led, data-forward, contemporary and digital-first.",
      "audience": "Client base, subscribers, internal strategy",
      "audienceMode": "client-facing",
      "useCase": "Publish a recurring market view that positions the organisation as a credible research voice.",
      "length": "extended",
      "lengthLabel": "11–25 pages — multi-section analysis with appendices",
      "pages": "10–20 pages",
      "dataIntensity": "high",
      "imageIntensity": "medium",
      "formality": "professional",
      "tier": "growth",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Market research",
        "Market update",
        "Regional analysis"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 11,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "table_of_contents",
        "highlight_box",
        "executive_summary",
        "metric_panel",
        "info_card",
        "chart_frame",
        "data_table",
        "appendix_opener",
        "disclaimer_page",
        "back_cover"
      ],
      "useWhen": [
        "You publish market commentary on a schedule.",
        "The document covers several regions or asset classes.",
        "The audience is your client base rather than one client."
      ],
      "useOther": [
        {
          "situation": "The subject is one suburb",
          "alternativeId": "suburb-analysis-report"
        },
        {
          "situation": "The audience is one client making one decision",
          "alternativeId": "property-investment-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "off-market-opportunity-report",
      "name": "Off-Market Opportunity Report",
      "summary": "An editorial presentation of a single off-market or pre-market opportunity for a high-value client, built to persuade as much as to inform.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "luxury-presentation",
      "familyName": "Luxury Presentation",
      "familyTagline": "Editorial and unhurried. Oversized display type, deep whitespace, prestige framing.",
      "audience": "High-net-worth clients, prestige buyers, private investors",
      "audienceMode": "client-facing",
      "useCase": "Present a confidential opportunity in a form that matches the value of the asset and the expectations of the client.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "4–8 pages",
      "dataIntensity": "low",
      "imageIntensity": "high",
      "formality": "presentation",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Off-market opportunity",
        "Prestige property",
        "Private opportunity"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 9,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "executive_summary",
        "image_gallery",
        "metric_panel",
        "map_frame",
        "process_flow",
        "highlight_box",
        "adviser_profile",
        "back_cover"
      ],
      "useWhen": [
        "The asset and the client justify a presentation-grade document.",
        "Persuasion matters as much as analysis.",
        "Photography is strong and available at high resolution."
      ],
      "useOther": [
        {
          "situation": "The client needs the investment numbers",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "Photography is weak or unavailable",
          "alternativeId": "property-acquisition-recommendation"
        },
        {
          "situation": "The document is a commercial pitch",
          "alternativeId": "client-proposal"
        }
      ],
      "implemented": true
    },
    {
      "id": "house-and-land-assessment",
      "name": "House & Land Package Assessment",
      "summary": "Assessment of a house-and-land or turnkey package: the land, the build contract, inclusions, staged payments and the completed-value position.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "property-visual",
      "familyName": "Property Visual",
      "familyTagline": "Image-led. Property photography, maps, location data and side-by-side comparison.",
      "audience": "Investor clients, first-home buyers",
      "audienceMode": "client-facing",
      "useCase": "Test whether a package is priced and structured acceptably before contract.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "6–12 pages",
      "dataIntensity": "high",
      "imageIntensity": "medium",
      "formality": "professional",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "House and land",
        "Turnkey package",
        "New build assessment"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 11,
      "optionalSectionCount": 0,
      "components": [
        "cover",
        "executive_summary",
        "metric_panel",
        "info_card",
        "data_table",
        "timeline",
        "comparison_table",
        "risk_box",
        "recommendation_box",
        "disclaimer_page"
      ],
      "useWhen": [
        "The purchase is a house-and-land or turnkey package.",
        "The build contract materially affects the investment case.",
        "Staged payments and registration timing need to be explained."
      ],
      "useOther": [
        {
          "situation": "The property is established stock",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "The project is a multi-dwelling development",
          "alternativeId": "development-feasibility-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "commercial-property-assessment",
      "name": "Commercial Property Assessment",
      "summary": "Assessment of a commercial or industrial asset: tenancy, lease covenants, WALE, outgoings, capitalisation and the investment position.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "executive-corporate",
      "familyName": "Executive Corporate",
      "familyTagline": "Boardroom-ready. Formal, decisive, built around the executive summary.",
      "audience": "Commercial investors, SMSF trustees, corporate buyers",
      "audienceMode": "client-facing",
      "useCase": "Assess a commercial asset on income durability rather than comparable sales.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "8–16 pages",
      "dataIntensity": "high",
      "imageIntensity": "medium",
      "formality": "formal",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Commercial property",
        "Industrial assessment",
        "Income asset"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 13,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "table_of_contents",
        "executive_summary",
        "metric_panel",
        "info_card",
        "data_table",
        "chart_frame",
        "risk_box",
        "recommendation_box",
        "appendix_opener",
        "disclaimer_page"
      ],
      "useWhen": [
        "The asset is commercial, industrial or mixed-use.",
        "Income durability drives value more than comparable sales.",
        "Lease covenants and WALE need to be presented."
      ],
      "useOther": [
        {
          "situation": "The asset is residential",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "The project is a development",
          "alternativeId": "development-feasibility-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "development-feasibility-report",
      "name": "Development Feasibility Report",
      "summary": "Residual land value and profitability modelling for a development: costs, revenue, funding, programme and sensitivity.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "financial-analytical",
      "familyName": "Financial Analytical",
      "familyTagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "audience": "Developers, investors, funders",
      "audienceMode": "client-facing",
      "useCase": "Test whether a development proposal produces an acceptable return under stated assumptions, and how sensitive that return is.",
      "length": "extended",
      "lengthLabel": "11–25 pages — multi-section analysis with appendices",
      "pages": "12–24 pages",
      "dataIntensity": "high",
      "imageIntensity": "low",
      "formality": "formal",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Development feasibility",
        "Residual land value",
        "Project appraisal"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 15,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "table_of_contents",
        "executive_summary",
        "metric_panel",
        "info_card",
        "data_table",
        "chart_frame",
        "timeline",
        "comparison_table",
        "risk_box",
        "recommendation_box",
        "appendix_opener",
        "disclaimer_page"
      ],
      "useWhen": [
        "A development scheme needs to be tested financially.",
        "A funder or partner will interrogate the assumptions.",
        "Sensitivity matters as much as the base case."
      ],
      "useOther": [
        {
          "situation": "The purchase is a completed asset",
          "alternativeId": "commercial-property-assessment"
        },
        {
          "situation": "The scheme is a single house-and-land package",
          "alternativeId": "house-and-land-assessment"
        }
      ],
      "implemented": true
    },
    {
      "id": "portfolio-review-report",
      "name": "Portfolio Review Report",
      "summary": "Periodic review of a client's whole property portfolio: performance, equity, debt, cash flow and recommended actions per asset.",
      "category": "property",
      "categoryLabel": "Property & Buyer's Agency",
      "family": "premium-advisory",
      "familyName": "Premium Advisory",
      "familyTagline": "Consulting register. Generous spacing, elegant dividers, considered recommendations.",
      "audience": "Portfolio clients and their advisers",
      "audienceMode": "client-facing",
      "useCase": "Review portfolio performance and agree the next set of actions.",
      "length": "variable",
      "lengthLabel": "Length follows the record count — grows with rows, properties or controls",
      "pages": "8–20 pages, growing with the number of assets",
      "dataIntensity": "high",
      "imageIntensity": "low",
      "formality": "formal",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Portfolio review",
        "Annual review",
        "Asset review"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 13,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "table_of_contents",
        "metric_panel",
        "executive_summary",
        "chart_frame",
        "data_table",
        "info_card",
        "risk_box",
        "checklist",
        "signature_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client holds more than one property and needs a consolidated view.",
        "You conduct scheduled portfolio reviews.",
        "Recommendations span several assets."
      ],
      "useOther": [
        {
          "situation": "There is one asset",
          "alternativeId": "property-investment-report"
        },
        {
          "situation": "The focus is debt structure rather than assets",
          "alternativeId": "finance-strategy-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "borrowing-capacity-report",
      "name": "Borrowing Capacity Report",
      "summary": "Assessed borrowing capacity across lenders, with the inputs, the assessment-rate treatment and the sensitivity that produced it.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "financial-analytical",
      "familyName": "Financial Analytical",
      "familyTagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "audience": "Clients, brokers, buyer's agents",
      "audienceMode": "client-facing",
      "useCase": "Tell a client what they can borrow, from whom, and what would change it.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "5–10 pages",
      "dataIntensity": "high",
      "imageIntensity": "none",
      "formality": "professional",
      "tier": "scale",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Borrowing capacity",
        "Serviceability",
        "Pre-approval position"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 11,
      "optionalSectionCount": 0,
      "components": [
        "cover",
        "metric_panel",
        "executive_summary",
        "data_table",
        "info_card",
        "bar_chart",
        "comparison_table",
        "checklist",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client needs to know their borrowing position.",
        "You are comparing capacity across a lender panel.",
        "Sensitivity to rate rises must be shown."
      ],
      "useOther": [
        {
          "situation": "The client needs a full finance strategy",
          "alternativeId": "finance-strategy-report"
        },
        {
          "situation": "The question is which loan, not how much",
          "alternativeId": "loan-comparison-report"
        },
        {
          "situation": "You are documenting an approval already obtained",
          "alternativeId": "finance-approval-summary"
        }
      ],
      "implemented": true
    },
    {
      "id": "finance-strategy-report",
      "name": "Finance Strategy Report",
      "summary": "The client's whole debt strategy: current structure, target structure, sequencing, and the funding runway for planned acquisitions.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "modern-technology",
      "familyName": "Modern Technology",
      "familyTagline": "SaaS-inspired. Card-led, data-forward, contemporary and digital-first.",
      "audience": "Investor clients, brokers, buyer's agents",
      "audienceMode": "client-facing",
      "useCase": "Set out how a client's lending should be structured to reach their goals.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "8–14 pages",
      "dataIntensity": "high",
      "imageIntensity": "low",
      "formality": "professional",
      "tier": "scale",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Finance strategy",
        "Debt structure",
        "Funding plan"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 13,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "executive_summary",
        "metric_panel",
        "data_table",
        "info_card",
        "comparison_table",
        "process_flow",
        "chart_frame",
        "risk_box",
        "checklist",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client's lending needs restructuring, not just a new loan.",
        "Several moves must happen in a specific order.",
        "The client is building a portfolio over years, not months."
      ],
      "useOther": [
        {
          "situation": "The question is capacity",
          "alternativeId": "borrowing-capacity-report"
        },
        {
          "situation": "The question is which product",
          "alternativeId": "loan-comparison-report"
        },
        {
          "situation": "The client only wants to release equity",
          "alternativeId": "equity-release-strategy"
        }
      ],
      "implemented": true
    },
    {
      "id": "loan-comparison-report",
      "name": "Loan Comparison Report",
      "summary": "Side-by-side comparison of shortlisted loan products on rate, fees, features, true cost over the intended hold period, and policy fit.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "financial-analytical",
      "familyName": "Financial Analytical",
      "familyTagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "audience": "Clients, brokers",
      "audienceMode": "client-facing",
      "useCase": "Evidence why a recommended product was selected over the alternatives.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–7 pages",
      "dataIntensity": "high",
      "imageIntensity": "none",
      "formality": "professional",
      "tier": "growth",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Loan comparison",
        "Product comparison",
        "Lender shortlist"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 8,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "highlight_box",
        "comparison_table",
        "bar_chart",
        "status_table",
        "recommendation_box",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client is choosing between shortlisted loan products.",
        "You must evidence why one product was recommended.",
        "Comparison-rate and true-cost differences matter."
      ],
      "useOther": [
        {
          "situation": "The question is how much, not which",
          "alternativeId": "borrowing-capacity-report"
        },
        {
          "situation": "The whole debt structure is under review",
          "alternativeId": "finance-strategy-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "lending-recommendation-report",
      "name": "Lending Recommendation Report",
      "summary": "A formal recommendation of a lender, product and structure, with the reasoning, alternatives considered and the disclosures that must accompany it.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "premium-advisory",
      "familyName": "Premium Advisory",
      "familyTagline": "Consulting register. Generous spacing, elegant dividers, considered recommendations.",
      "audience": "Clients, credit assessors, compliance reviewers",
      "audienceMode": "client-facing",
      "useCase": "Document a credit recommendation to the standard a compliance review expects.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "5–10 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Lending recommendation",
        "Credit recommendation",
        "Preliminary assessment"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 12,
      "optionalSectionCount": 0,
      "components": [
        "cover",
        "recommendation_box",
        "info_card",
        "data_table",
        "executive_summary",
        "comparison_table",
        "highlight_box",
        "risk_box",
        "process_flow",
        "signature_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "You are formally recommending a credit product.",
        "The document will be reviewed by a licensee or aggregator.",
        "Disclosure obligations attach to the recommendation."
      ],
      "useOther": [
        {
          "situation": "You are only comparing products",
          "alternativeId": "loan-comparison-report"
        },
        {
          "situation": "You are documenting an approval",
          "alternativeId": "finance-approval-summary"
        }
      ],
      "implemented": true
    },
    {
      "id": "refinance-assessment",
      "name": "Refinance Assessment",
      "summary": "Whether refinancing is worthwhile: current position, proposed position, switching costs, break-even point and net benefit over the hold period.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "financial-analytical",
      "familyName": "Financial Analytical",
      "familyTagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "audience": "Clients, brokers",
      "audienceMode": "client-facing",
      "useCase": "Quantify whether a refinance is worth doing, and after how long it pays back.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–6 pages",
      "dataIntensity": "high",
      "imageIntensity": "none",
      "formality": "professional",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Refinance",
        "Loan review",
        "Switching analysis"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 10,
      "optionalSectionCount": 0,
      "components": [
        "cover",
        "recommendation_box",
        "metric_panel",
        "data_table",
        "bar_chart",
        "risk_box",
        "checklist",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client is considering moving lenders.",
        "The break-even period is the deciding factor.",
        "Switching costs need to be made explicit."
      ],
      "useOther": [
        {
          "situation": "The client wants to release equity",
          "alternativeId": "equity-release-strategy"
        },
        {
          "situation": "The whole structure is under review",
          "alternativeId": "finance-strategy-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "equity-release-strategy",
      "name": "Equity Release Strategy",
      "summary": "How much usable equity exists, how it can be accessed, what it costs and what it can fund.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "modern-technology",
      "familyName": "Modern Technology",
      "familyTagline": "SaaS-inspired. Card-led, data-forward, contemporary and digital-first.",
      "audience": "Investor clients",
      "audienceMode": "client-facing",
      "useCase": "Show a client the equity available across their assets and how to deploy it.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "4–8 pages",
      "dataIntensity": "high",
      "imageIntensity": "none",
      "formality": "professional",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Equity release",
        "Usable equity",
        "Deployment plan"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 10,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "metric_panel",
        "executive_summary",
        "data_table",
        "comparison_table",
        "process_flow",
        "risk_box",
        "checklist",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client wants to know what equity they can access.",
        "Equity is spread across several assets.",
        "The cost and risk of access need to be explicit."
      ],
      "useOther": [
        {
          "situation": "The question is total capacity",
          "alternativeId": "borrowing-capacity-report"
        },
        {
          "situation": "The whole structure is being redesigned",
          "alternativeId": "finance-strategy-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "cash-flow-net-position-report",
      "name": "Cash-Flow & Net Position Report",
      "summary": "Projected cash flow and net position over one to ten years, with the assumptions, the year-by-year detail and the sensitivity.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "financial-analytical",
      "familyName": "Financial Analytical",
      "familyTagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "audience": "Investor clients, accountants",
      "audienceMode": "client-facing",
      "useCase": "Show what an asset or portfolio costs or returns, year by year, after tax.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "5–12 pages",
      "dataIntensity": "high",
      "imageIntensity": "none",
      "formality": "professional",
      "tier": "growth",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Cash flow",
        "Net position",
        "Holding cost"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 9,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "metric_panel",
        "info_card",
        "data_table",
        "chart_frame",
        "bar_chart",
        "comparison_table",
        "disclaimer_page"
      ],
      "useWhen": [
        "A client needs to see holding cost or return over time.",
        "Tax and depreciation materially change the picture.",
        "Sensitivity to rates or vacancy must be shown."
      ],
      "useOther": [
        {
          "situation": "The question is capacity",
          "alternativeId": "borrowing-capacity-report"
        },
        {
          "situation": "The subject is a whole portfolio",
          "alternativeId": "portfolio-review-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "serviceability-assessment",
      "name": "Serviceability Assessment",
      "summary": "Internal working document showing the serviceability calculation for one lender, line by line, so a credit decision can be checked.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "financial-analytical",
      "familyName": "Financial Analytical",
      "familyTagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "audience": "Brokers, credit support, compliance",
      "audienceMode": "internal",
      "useCase": "Record and check the serviceability calculation behind a submission.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "2–5 pages",
      "dataIntensity": "high",
      "imageIntensity": "none",
      "formality": "operational",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 3,
      "reportTypes": [
        "Serviceability",
        "Servicing calculation",
        "Credit working"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 8,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "metric_panel",
        "data_table",
        "status_table",
        "approval_block"
      ],
      "useWhen": [
        "You need a checkable record of a servicing calculation.",
        "A reviewer or auditor will re-perform the arithmetic.",
        "The document stays inside the business."
      ],
      "useOther": [
        {
          "situation": "The client is the reader",
          "alternativeId": "borrowing-capacity-report"
        },
        {
          "situation": "You are recommending a product",
          "alternativeId": "lending-recommendation-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "construction-finance-report",
      "name": "Construction Finance Report",
      "summary": "Funding structure for a construction or renovation project: facility structure, drawdown schedule, interest during construction and completion position.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "financial-analytical",
      "familyName": "Financial Analytical",
      "familyTagline": "Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
      "audience": "Clients, builders, lenders",
      "audienceMode": "client-facing",
      "useCase": "Explain how a build will be funded and what it costs while it is building.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "5–10 pages",
      "dataIntensity": "high",
      "imageIntensity": "low",
      "formality": "professional",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Construction finance",
        "Progress payments",
        "Build funding"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 10,
      "optionalSectionCount": 0,
      "components": [
        "cover",
        "metric_panel",
        "data_table",
        "timeline",
        "checklist",
        "risk_box",
        "process_flow",
        "disclaimer_page"
      ],
      "useWhen": [
        "Funding is staged against build progress.",
        "Interest during construction materially affects the project.",
        "Conditions precedent must be tracked per drawdown."
      ],
      "useOther": [
        {
          "situation": "The purchase is a completed turnkey package",
          "alternativeId": "house-and-land-assessment"
        },
        {
          "situation": "The project is a multi-unit development",
          "alternativeId": "development-feasibility-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "smsf-finance-assessment",
      "name": "SMSF Finance Assessment",
      "summary": "Assessment of a limited-recourse borrowing arrangement for a self-managed super fund, against fund, trustee, asset and lender requirements.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "SMSF trustees, accountants, advisers",
      "audienceMode": "client-facing",
      "useCase": "Establish whether an SMSF borrowing arrangement is viable and compliant before it is entered into.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "6–12 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "SMSF",
        "LRBA",
        "Superannuation lending"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 13,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "highlight_box",
        "recommendation_box",
        "info_card",
        "status_table",
        "data_table",
        "risk_box",
        "checklist",
        "approval_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "A fund is considering a limited-recourse borrowing arrangement.",
        "Structure and lender requirements must be evidenced.",
        "Several professionals will review the same document."
      ],
      "useOther": [
        {
          "situation": "The borrower is an individual or trust",
          "alternativeId": "borrowing-capacity-report"
        },
        {
          "situation": "The subject is the asset rather than the structure",
          "alternativeId": "commercial-property-assessment"
        }
      ],
      "implemented": true
    },
    {
      "id": "finance-approval-summary",
      "name": "Finance Approval Summary",
      "summary": "A one-to-two page confirmation of an approval: what was approved, on what conditions, by when, and what happens next.",
      "category": "finance",
      "categoryLabel": "Finance & Lending",
      "family": "minimal-professional",
      "familyName": "Minimal Professional",
      "familyTagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "audience": "Clients, buyer's agents, solicitors",
      "audienceMode": "client-facing",
      "useCase": "Confirm an approval in a form that can be forwarded to a third party.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "1–3 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "operational",
      "tier": "growth",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Approval summary",
        "Conditional approval",
        "Finance confirmation"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 7,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "metric_panel",
        "info_card",
        "checklist",
        "timeline",
        "process_flow",
        "disclaimer_page"
      ],
      "useWhen": [
        "An approval has been issued and needs confirming in writing.",
        "A third party needs a forwardable summary.",
        "Speed matters more than presentation."
      ],
      "useOther": [
        {
          "situation": "You are recommending a product",
          "alternativeId": "lending-recommendation-report"
        },
        {
          "situation": "The client needs the full position",
          "alternativeId": "finance-strategy-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "client-fact-find-form",
      "name": "Client Fact-Find Form",
      "summary": "The primary intake form: personal details, employment, income, assets, liabilities and expenses, designed for completion on screen or on paper.",
      "category": "forms",
      "categoryLabel": "Client Forms & Onboarding",
      "family": "minimal-professional",
      "familyName": "Minimal Professional",
      "familyTagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "audience": "Clients, with adviser support",
      "audienceMode": "client-facing",
      "useCase": "Collect a complete financial position from a new client.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "6–10 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "operational",
      "tier": "launch",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Fact find",
        "Client intake",
        "Financial position"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 12,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "highlight_box",
        "definition_grid",
        "data_table",
        "signature_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "Onboarding a new client who needs a full financial picture.",
        "The client will complete the form themselves.",
        "The data feeds borrowing capacity or a finance application."
      ],
      "useOther": [
        {
          "situation": "You only need the property brief",
          "alternativeId": "property-brief-form"
        },
        {
          "situation": "You only need identity verification",
          "alternativeId": "client-verification-summary"
        },
        {
          "situation": "The client is already onboarded and only the brief has changed",
          "alternativeId": "property-brief-form"
        }
      ],
      "implemented": true
    },
    {
      "id": "client-onboarding-form",
      "name": "Client Onboarding Form",
      "summary": "Engagement-level onboarding: parties, scope of service, fees, authorities, communication preferences and consents.",
      "category": "forms",
      "categoryLabel": "Client Forms & Onboarding",
      "family": "minimal-professional",
      "familyName": "Minimal Professional",
      "familyTagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "audience": "New clients",
      "audienceMode": "client-facing",
      "useCase": "Formalise the start of an engagement and capture the consents it depends on.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–6 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "professional",
      "tier": "launch",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Onboarding",
        "Engagement",
        "Client setup"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 11,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "definition_grid",
        "info_card",
        "data_table",
        "checklist",
        "process_flow",
        "signature_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "A new engagement is starting.",
        "Scope, fees and authorities need to be agreed in writing.",
        "Consents must be captured separately and evidenced."
      ],
      "useOther": [
        {
          "situation": "You need the client's financial position",
          "alternativeId": "client-fact-find-form"
        },
        {
          "situation": "You are pitching, not onboarding",
          "alternativeId": "client-proposal"
        }
      ],
      "implemented": true
    },
    {
      "id": "investor-goals-questionnaire",
      "name": "Investor Goals Questionnaire",
      "summary": "Structured discovery of a client's objectives, time horizon, target returns and constraints, in a form that produces comparable answers across clients.",
      "category": "forms",
      "categoryLabel": "Client Forms & Onboarding",
      "family": "modern-technology",
      "familyName": "Modern Technology",
      "familyTagline": "SaaS-inspired. Card-led, data-forward, contemporary and digital-first.",
      "audience": "Investor clients",
      "audienceMode": "client-facing",
      "useCase": "Capture investment objectives in a structured, comparable way.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–6 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "professional",
      "tier": "launch",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Goals",
        "Discovery",
        "Objectives"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 11,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "highlight_box",
        "definition_grid",
        "status_table",
        "executive_summary",
        "signature_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "You need structured, comparable objectives from a client.",
        "The answers will drive a strategy or a property brief.",
        "Discovery happens before any recommendation."
      ],
      "useOther": [
        {
          "situation": "You need regulated risk profiling",
          "alternativeId": "risk-profile-questionnaire"
        },
        {
          "situation": "You need the financial position",
          "alternativeId": "client-fact-find-form"
        },
        {
          "situation": "You need property specifics",
          "alternativeId": "property-brief-form"
        }
      ],
      "implemented": true
    },
    {
      "id": "property-brief-form",
      "name": "Property Brief Form",
      "summary": "The search mandate: what the client is looking for, where, at what price, with what must-haves and deal-breakers.",
      "category": "forms",
      "categoryLabel": "Client Forms & Onboarding",
      "family": "minimal-professional",
      "familyName": "Minimal Professional",
      "familyTagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "audience": "Buyer's agency clients",
      "audienceMode": "client-facing",
      "useCase": "Agree and record the search mandate before a search begins.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "2–4 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "operational",
      "tier": "launch",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Property brief",
        "Search mandate",
        "Buying brief"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 8,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "definition_grid",
        "comparison_table",
        "data_table",
        "highlight_box",
        "signature_block"
      ],
      "useWhen": [
        "A search is about to begin and the mandate must be agreed.",
        "The brief will be used to score shortlisted properties.",
        "Both parties need a record of what was agreed."
      ],
      "useOther": [
        {
          "situation": "You need the client's objectives and risk appetite",
          "alternativeId": "investor-goals-questionnaire"
        },
        {
          "situation": "You are presenting search results",
          "alternativeId": "property-comparison-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "risk-profile-questionnaire",
      "name": "Risk Profile Questionnaire",
      "summary": "Scored risk-tolerance assessment with a recorded outcome, the client's acknowledgement, and any override with its reason.",
      "category": "forms",
      "categoryLabel": "Client Forms & Onboarding",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "Clients, compliance reviewers",
      "audienceMode": "client-facing",
      "useCase": "Establish and evidence a client's risk profile to a reviewable standard.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–6 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "growth",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Risk profile",
        "Risk tolerance",
        "Suitability"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 10,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "highlight_box",
        "status_table",
        "metric_panel",
        "info_card",
        "signature_block",
        "approval_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "A risk profile must be established and evidenced.",
        "A compliance reviewer will check the scoring.",
        "An override must be documented with its reason."
      ],
      "useOther": [
        {
          "situation": "You want informal discovery",
          "alternativeId": "investor-goals-questionnaire"
        },
        {
          "situation": "You are assessing transaction risk, not client risk",
          "alternativeId": "risk-assessment"
        }
      ],
      "implemented": true
    },
    {
      "id": "document-collection-checklist",
      "name": "Document Collection Checklist",
      "summary": "What the client must provide, who owns each item, when it is due, and its current status.",
      "category": "forms",
      "categoryLabel": "Client Forms & Onboarding",
      "family": "minimal-professional",
      "familyName": "Minimal Professional",
      "familyTagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "audience": "Clients and internal support staff",
      "audienceMode": "client-facing",
      "useCase": "Chase and track the documents an application or engagement depends on.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "1–3 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "operational",
      "tier": "launch",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Document checklist",
        "Outstanding items",
        "Requirements list"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 5,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "metric_panel",
        "status_table",
        "highlight_box"
      ],
      "useWhen": [
        "You are chasing documents from a client.",
        "Ownership and due dates need to be explicit.",
        "The list changes often and is reissued."
      ],
      "useOther": [
        {
          "situation": "The items are compliance controls",
          "alternativeId": "aml-kyc-assessment"
        },
        {
          "situation": "The list is a due-diligence investigation",
          "alternativeId": "property-due-diligence-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "client-authority-form",
      "name": "Client Authority Form",
      "summary": "Written authority for the organisation to act, request information, or deal with a named third party on the client's behalf.",
      "category": "forms",
      "categoryLabel": "Client Forms & Onboarding",
      "family": "minimal-professional",
      "familyName": "Minimal Professional",
      "familyTagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "audience": "Clients, third parties receiving the authority",
      "audienceMode": "client-facing",
      "useCase": "Obtain and evidence a specific, scoped authority to act.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "2–3 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "launch",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Authority",
        "Consent to act",
        "Third-party authority"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 7,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "definition_grid",
        "checklist",
        "highlight_box",
        "signature_block",
        "disclaimer_page"
      ],
      "useWhen": [
        "You need written authority to act or to obtain information.",
        "The authority must be scoped and time-limited.",
        "A third party will rely on the document."
      ],
      "useOther": [
        {
          "situation": "You are onboarding the client",
          "alternativeId": "client-onboarding-form"
        },
        {
          "situation": "You need consent to collect personal information",
          "alternativeId": "client-fact-find-form"
        }
      ],
      "implemented": true
    },
    {
      "id": "aml-kyc-assessment",
      "name": "AML & KYC Assessment",
      "summary": "Customer due-diligence record: identity, beneficial ownership, PEP and sanctions screening, source of funds, risk rating and the decision.",
      "category": "compliance",
      "categoryLabel": "Compliance & Governance",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "Compliance officers, auditors, regulators",
      "audienceMode": "regulator",
      "useCase": "Evidence that customer due diligence was performed and a risk-based decision was made and approved.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "5–12 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "launch",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "AML",
        "KYC",
        "Customer due diligence",
        "Onboarding compliance"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 15,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "recommendation_box",
        "info_card",
        "status_table",
        "data_table",
        "metric_panel",
        "checklist",
        "approval_block",
        "appendix_opener",
        "disclaimer_page"
      ],
      "useWhen": [
        "Onboarding a customer under AML/CTF obligations.",
        "A risk-based decision must be evidenced and approved.",
        "An auditor or regulator may later review the file."
      ],
      "useOther": [
        {
          "situation": "You only need to confirm identity was verified",
          "alternativeId": "client-verification-summary"
        },
        {
          "situation": "You are reviewing the compliance programme itself",
          "alternativeId": "compliance-review-report"
        },
        {
          "situation": "You are assessing transaction risk",
          "alternativeId": "risk-assessment"
        }
      ],
      "implemented": true
    },
    {
      "id": "client-verification-summary",
      "name": "Client Verification Summary",
      "summary": "A one-to-three page confirmation that identity verification was completed, by what method, on what date, with what result.",
      "category": "compliance",
      "categoryLabel": "Compliance & Governance",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "Internal staff, third parties requiring evidence of verification",
      "audienceMode": "internal",
      "useCase": "Provide a short, shareable record that verification occurred.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "1–3 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "launch",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Verification",
        "Identity confirmation",
        "KYC summary"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 7,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "metric_panel",
        "info_card",
        "status_table",
        "highlight_box",
        "approval_block"
      ],
      "useWhen": [
        "Someone needs proof that verification was completed.",
        "The full due-diligence file is too much to share.",
        "The record will be attached to another file."
      ],
      "useOther": [
        {
          "situation": "You need the full due-diligence record",
          "alternativeId": "aml-kyc-assessment"
        },
        {
          "situation": "You are reviewing a file for completeness",
          "alternativeId": "file-review-summary"
        }
      ],
      "implemented": true
    },
    {
      "id": "compliance-review-report",
      "name": "Compliance Review Report",
      "summary": "Periodic review of the organisation's compliance with its own obligations: scope, testing, findings, ratings and a remediation plan.",
      "category": "compliance",
      "categoryLabel": "Compliance & Governance",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "Boards, licensees, compliance committees, external reviewers",
      "audienceMode": "internal",
      "useCase": "Report the outcome of a compliance review and the actions arising.",
      "length": "extended",
      "lengthLabel": "11–25 pages — multi-section analysis with appendices",
      "pages": "9–22 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Compliance review",
        "Monitoring report",
        "Assurance review"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 11,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "table_of_contents",
        "executive_summary",
        "info_card",
        "metric_panel",
        "status_table",
        "checklist",
        "approval_block",
        "appendix_opener"
      ],
      "useWhen": [
        "A scheduled compliance review has been completed.",
        "Findings must be rated, owned and tracked to closure.",
        "A committee or licensee will receive the report."
      ],
      "useOther": [
        {
          "situation": "The subject is one customer file",
          "alternativeId": "file-review-summary"
        },
        {
          "situation": "The subject is one incident",
          "alternativeId": "risk-assessment"
        },
        {
          "situation": "The review is a formal audit",
          "alternativeId": "audit-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "risk-assessment",
      "name": "Risk Assessment",
      "summary": "Structured assessment of a specific risk, transaction or arrangement: inherent risk, controls, residual risk and the decision.",
      "category": "compliance",
      "categoryLabel": "Compliance & Governance",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "Compliance, management, risk committees",
      "audienceMode": "internal",
      "useCase": "Assess and document a specific risk before a decision is taken.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–8 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "growth",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Risk assessment",
        "Risk register",
        "Control assessment"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 9,
      "optionalSectionCount": 1,
      "components": [
        "cover",
        "recommendation_box",
        "info_card",
        "status_table",
        "metric_panel",
        "checklist",
        "approval_block"
      ],
      "useWhen": [
        "A specific risk or arrangement needs formal assessment.",
        "Controls and residual risk must be documented.",
        "A decision-maker needs the assessment on file."
      ],
      "useOther": [
        {
          "situation": "The subject is a client's risk tolerance",
          "alternativeId": "risk-profile-questionnaire"
        },
        {
          "situation": "The subject is a periodic programme review",
          "alternativeId": "compliance-review-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "audit-report",
      "name": "Audit Report",
      "summary": "Formal audit output: objective, scope, criteria, methodology, findings with evidence, opinion and management response.",
      "category": "compliance",
      "categoryLabel": "Compliance & Governance",
      "family": "compliance-structured",
      "familyName": "Compliance Structured",
      "familyTagline": "Auditable by construction. Numbered controls, status columns, evidence trails.",
      "audience": "Boards, audit committees, external auditors",
      "audienceMode": "regulator",
      "useCase": "Report the result of a formal audit to the standard an audit committee expects.",
      "length": "extended",
      "lengthLabel": "11–25 pages — multi-section analysis with appendices",
      "pages": "9–25 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Audit",
        "Internal audit",
        "Assurance"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 12,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "table_of_contents",
        "recommendation_box",
        "info_card",
        "metric_panel",
        "status_table",
        "approval_block",
        "appendix_opener"
      ],
      "useWhen": [
        "A formal audit has been completed.",
        "An audit committee or external party will receive it.",
        "Management responses must be recorded against each finding."
      ],
      "useOther": [
        {
          "situation": "The review is internal monitoring",
          "alternativeId": "compliance-review-report"
        },
        {
          "situation": "The subject is one customer file",
          "alternativeId": "file-review-summary"
        }
      ],
      "implemented": true
    },
    {
      "id": "file-review-summary",
      "name": "File Review Summary",
      "summary": "Quality-assurance review of a single client file against a standard checklist, with a pass/remediate outcome.",
      "category": "compliance",
      "categoryLabel": "Compliance & Governance",
      "family": "minimal-professional",
      "familyName": "Minimal Professional",
      "familyTagline": "Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
      "audience": "Compliance staff, team leaders",
      "audienceMode": "internal",
      "useCase": "Record a file quality review and any remediation required.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "2–4 pages",
      "dataIntensity": "low",
      "imageIntensity": "none",
      "formality": "operational",
      "tier": "growth",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "File review",
        "Quality assurance",
        "File check"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 6,
      "optionalSectionCount": 2,
      "components": [
        "cover",
        "metric_panel",
        "status_table",
        "checklist",
        "approval_block"
      ],
      "useWhen": [
        "You are reviewing a single file for quality or compliance.",
        "The outcome is pass, or pass with remediation.",
        "Reviews are performed in volume."
      ],
      "useOther": [
        {
          "situation": "You are reviewing the programme, not a file",
          "alternativeId": "compliance-review-report"
        },
        {
          "situation": "The review is a formal audit",
          "alternativeId": "audit-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "executive-business-report",
      "name": "Executive Business Report",
      "summary": "A formal business report for a leadership audience: position, performance, analysis, options and a recommendation.",
      "category": "business",
      "categoryLabel": "Business & Advisory",
      "family": "executive-corporate",
      "familyName": "Executive Corporate",
      "familyTagline": "Boardroom-ready. Formal, decisive, built around the executive summary.",
      "audience": "Directors, executives, business owners",
      "audienceMode": "internal",
      "useCase": "Present a business position and a recommended course of action to leadership.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "8–16 pages",
      "dataIntensity": "high",
      "imageIntensity": "low",
      "formality": "formal",
      "tier": "scale",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Executive report",
        "Business report",
        "Management report"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 14,
      "optionalSectionCount": 3,
      "components": [
        "cover",
        "table_of_contents",
        "executive_summary",
        "metric_panel",
        "data_table",
        "chart_frame",
        "highlight_box",
        "comparison_table",
        "recommendation_box",
        "risk_box",
        "timeline",
        "checklist",
        "appendix_opener"
      ],
      "useWhen": [
        "Leadership must make a decision from a written report.",
        "Options need to be compared and one recommended.",
        "The document will be tabled and minuted."
      ],
      "useOther": [
        {
          "situation": "The audience is a board with a fixed agenda",
          "alternativeId": "board-report"
        },
        {
          "situation": "You are proposing work to a client",
          "alternativeId": "client-proposal"
        },
        {
          "situation": "The report is a periodic status update",
          "alternativeId": "quarterly-business-review"
        }
      ],
      "implemented": true
    },
    {
      "id": "client-proposal",
      "name": "Client Proposal",
      "summary": "A commercial proposal: the client's situation, the proposed approach, the team, the fees, and why this organisation.",
      "category": "business",
      "categoryLabel": "Business & Advisory",
      "family": "luxury-presentation",
      "familyName": "Luxury Presentation",
      "familyTagline": "Editorial and unhurried. Oversized display type, deep whitespace, prestige framing.",
      "audience": "Prospective clients",
      "audienceMode": "client-facing",
      "useCase": "Win an engagement.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "6–14 pages",
      "dataIntensity": "low",
      "imageIntensity": "medium",
      "formality": "presentation",
      "tier": "growth",
      "priority": "P1",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Proposal",
        "Pitch",
        "Engagement proposal"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 14,
      "optionalSectionCount": 3,
      "components": [
        "cover",
        "executive_summary",
        "recommendation_box",
        "process_flow",
        "checklist",
        "adviser_profile",
        "timeline",
        "data_table",
        "highlight_box",
        "info_card",
        "signature_block",
        "disclaimer_page",
        "back_cover"
      ],
      "useWhen": [
        "You are pitching for an engagement.",
        "Presentation quality affects the outcome.",
        "The proposal will be read by a decision-maker, not an analyst."
      ],
      "useOther": [
        {
          "situation": "The engagement is already won",
          "alternativeId": "client-onboarding-form"
        },
        {
          "situation": "The proposal is to another business, not a client",
          "alternativeId": "partnership-proposal"
        },
        {
          "situation": "The audience wants analysis, not persuasion",
          "alternativeId": "executive-business-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "board-report",
      "name": "Board Report",
      "summary": "A paper prepared for a board meeting: purpose, background, discussion, recommendation and the resolution sought.",
      "category": "business",
      "categoryLabel": "Business & Advisory",
      "family": "executive-corporate",
      "familyName": "Executive Corporate",
      "familyTagline": "Boardroom-ready. Formal, decisive, built around the executive summary.",
      "audience": "Directors and company secretaries",
      "audienceMode": "internal",
      "useCase": "Table a matter for board consideration and record the resolution sought.",
      "length": "brief",
      "lengthLabel": "1–3 pages — a single decision, summary or form",
      "pages": "3–8 pages",
      "dataIntensity": "medium",
      "imageIntensity": "none",
      "formality": "formal",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 3,
      "reportTypes": [
        "Board paper",
        "Board report",
        "Governance paper"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 10,
      "optionalSectionCount": 3,
      "components": [
        "cover",
        "highlight_box",
        "recommendation_box",
        "data_table",
        "risk_box",
        "comparison_table",
        "appendix_opener"
      ],
      "useWhen": [
        "A matter is being tabled for board decision.",
        "A resolution needs to be proposed in specific words.",
        "The paper will be included in a board pack."
      ],
      "useOther": [
        {
          "situation": "The audience is management, not the board",
          "alternativeId": "executive-business-report"
        },
        {
          "situation": "The paper is a periodic performance update",
          "alternativeId": "quarterly-business-review"
        }
      ],
      "implemented": true
    },
    {
      "id": "quarterly-business-review",
      "name": "Quarterly Business Review",
      "summary": "Periodic performance review: results against targets, pipeline, client outcomes, issues and the plan for the coming period.",
      "category": "business",
      "categoryLabel": "Business & Advisory",
      "family": "modern-technology",
      "familyName": "Modern Technology",
      "familyTagline": "SaaS-inspired. Card-led, data-forward, contemporary and digital-first.",
      "audience": "Leadership, partners, key clients",
      "audienceMode": "internal",
      "useCase": "Review a period's performance and agree priorities for the next one.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "6–14 pages",
      "dataIntensity": "high",
      "imageIntensity": "low",
      "formality": "professional",
      "tier": "scale",
      "priority": "P2",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "QBR",
        "Performance review",
        "Periodic review"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 10,
      "optionalSectionCount": 3,
      "components": [
        "cover",
        "metric_panel",
        "executive_summary",
        "data_table",
        "chart_frame",
        "bar_chart",
        "info_card",
        "risk_box",
        "checklist",
        "appendix_opener"
      ],
      "useWhen": [
        "A period has closed and performance needs reviewing.",
        "The same measures are reported every period.",
        "Priorities for the next period must be agreed."
      ],
      "useOther": [
        {
          "situation": "A single decision is needed",
          "alternativeId": "executive-business-report"
        },
        {
          "situation": "The audience is a board",
          "alternativeId": "board-report"
        }
      ],
      "implemented": true
    },
    {
      "id": "partnership-proposal",
      "name": "Partnership Proposal",
      "summary": "A proposal to another business: the opportunity, the proposed structure, the commercial terms, and the activation plan.",
      "category": "business",
      "categoryLabel": "Business & Advisory",
      "family": "luxury-presentation",
      "familyName": "Luxury Presentation",
      "familyTagline": "Editorial and unhurried. Oversized display type, deep whitespace, prestige framing.",
      "audience": "Prospective referral, finance and channel partners",
      "audienceMode": "partner",
      "useCase": "Propose and win a commercial partnership.",
      "length": "standard",
      "lengthLabel": "4–10 pages — a complete report with analysis and a recommendation",
      "pages": "6–12 pages",
      "dataIntensity": "low",
      "imageIntensity": "medium",
      "formality": "presentation",
      "tier": "scale",
      "priority": "P3",
      "maxWhiteLabelLevel": 4,
      "reportTypes": [
        "Partnership",
        "Channel proposal",
        "Referral partnership"
      ],
      "industries": [
        "property",
        "finance"
      ],
      "sectionCount": 11,
      "optionalSectionCount": 0,
      "components": [
        "cover",
        "executive_summary",
        "recommendation_box",
        "comparison_table",
        "process_flow",
        "data_table",
        "highlight_box",
        "timeline",
        "checklist",
        "disclaimer_page",
        "back_cover"
      ],
      "useWhen": [
        "You are proposing a commercial partnership.",
        "Both organisations appear on the document.",
        "Terms and boundaries need to be set out before legal drafting."
      ],
      "useOther": [
        {
          "situation": "You are proposing services to a client",
          "alternativeId": "client-proposal"
        },
        {
          "situation": "You are documenting an agreed partnership in legal terms",
          "alternativeId": null
        }
      ],
      "implemented": true
    }
  ]
} as const satisfies TemplateLibrary;

export const TEMPLATES: readonly TemplateRecord[] = TEMPLATE_LIBRARY.templates;

const TIER_RANK: Record<PlanTier, number> = {
  launch: 0,
  growth: 1,
  scale: 2,
  enterprise: 3,
};

/** Templates a plan may use. Plan entitlement is separate from user permission —
 *  both must pass before a template is selectable. */
export function templatesForPlan(plan: PlanTier): TemplateRecord[] {
  const rank = TIER_RANK[plan] ?? 0;
  return TEMPLATES.filter((t) => TIER_RANK[t.tier] <= rank);
}

export function templateById(id: string): TemplateRecord | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export interface RecommendationInput {
  reportType?: string;
  category?: TemplateCategory;
  plan?: PlanTier;
  audienceMode?: AudienceMode;
  contentVolume?: LengthBand;
  propertyCount?: number;
  chartCount?: number;
  tableCount?: number;
  formality?: Formality;
  approvedIds?: readonly string[];
  recentIds?: readonly string[];
  limit?: number;
}

export interface Recommendation {
  template: TemplateRecord;
  score: number;
  reasons: string[];
}

/** Mirrors `recommend()` in scripts/aurixa-templates/registry.py. The two are
 *  kept in step by `scripts/aurixa-templates/verify_library.py`, which runs the
 *  same fixtures through both and compares the ordering. */
export function recommendTemplates(input: RecommendationInput): Recommendation[] {
  const {
    reportType, category, plan = "scale", audienceMode, contentVolume,
    propertyCount = 0, chartCount = 0, tableCount = 0, formality,
    approvedIds = [], recentIds = [], limit = 5,
  } = input;
  const planRank = TIER_RANK[plan] ?? 2;
  const out: Recommendation[] = [];

  for (const template of TEMPLATES) {
    if (TIER_RANK[template.tier] > planRank) continue;
    let score = 0;
    const reasons: string[] = [];

    if (approvedIds.length) {
      if (approvedIds.includes(template.id)) {
        score += 40;
        reasons.push("Approved by your organisation");
      } else {
        score -= 25;
      }
    }
    if (category && template.category === category) {
      score += 25;
      reasons.push(`Built for ${template.categoryLabel}`);
    }
    if (reportType) {
      const needle = reportType.toLowerCase();
      if (template.reportTypes.some((rt) => rt.toLowerCase().includes(needle))) {
        score += 35;
        reasons.push(`Designed for ${reportType}`);
      } else if (
        template.name.toLowerCase().includes(needle) ||
        template.summary.toLowerCase().includes(needle)
      ) {
        score += 18;
        reasons.push("Name and purpose match your request");
      }
    }
    if (audienceMode && template.audienceMode === audienceMode) {
      score += 15;
      reasons.push(`Written for a ${audienceMode} audience`);
    }
    if (contentVolume && template.length === contentVolume) {
      score += 15;
      reasons.push(`Sized for ${template.lengthLabel.split("—")[0].trim()}`);
    }
    if (propertyCount >= 2) {
      if (template.id.includes("comparison") || /compar/i.test(template.name)) {
        score += 30;
        reasons.push(`Handles ${propertyCount} properties side by side`);
      } else if (template.imageIntensity === "medium" || template.imageIntensity === "high") {
        score += 8;
      }
    }
    if (propertyCount >= 1 && template.imageIntensity === "none") score -= 10;
    if (chartCount >= 3) {
      if (template.dataIntensity === "high") {
        score += 20;
        reasons.push("Optimised for chart-heavy content");
      } else if (template.dataIntensity === "none") {
        score -= 20;
      }
    }
    if (tableCount >= 4 && (template.dataIntensity === "medium" || template.dataIntensity === "high")) {
      score += 12;
    }
    if (formality && template.formality === formality) {
      score += 12;
      reasons.push(`${formality[0].toUpperCase()}${formality.slice(1)} register`);
    }
    if (recentIds.includes(template.id)) {
      score += 10;
      reasons.push("You used this recently");
    }
    if (template.priority === "P1") score += 5;
    if (!template.implemented) score -= 3;

    if (score > 0) out.push({ template, score, reasons });
  }

  out.sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name));
  return out.slice(0, limit);
}
