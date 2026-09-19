"""Template registry types, defaults and queries.

This module is the contract. The same records that a designer reads as a build
brief are the records the Command Center reads to populate the library grid, to
drive filters and search, to decide which templates a plan may use, and to
recommend a template from the shape of a user's content.

One source of truth, three consumers:

    catalogue.py  ──┬──▶  docs/command-center/template-inventory.md      (Stage 2)
                    ├──▶  docs/command-center/template-specifications.md (Stage 4)
                    └──▶  src/lib/command-center/templateLibrary.ts      (platform)

Keeping the spec executable is the point. A specification that lives only in a
document drifts from the thing it specifies within one release; a specification
that the product imports cannot.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from theme import FAMILIES, DesignFamily  # noqa: E402


# ==========================================================================
# Vocabularies
# ==========================================================================

CATEGORIES: dict[str, str] = {
    "property": "Property & Buyer's Agency",
    "finance": "Finance & Lending",
    "forms": "Client Forms & Onboarding",
    "compliance": "Compliance & Governance",
    "business": "Business & Advisory",
}

#: Length bands. The band, not the page count, is what the library filters on —
#: a page count is an output of the injected content, not a property of the
#: template, and promising "8 pages" for a template whose content varies is a
#: promise the generator cannot keep.
LENGTH_BANDS: dict[str, str] = {
    "brief": "1–3 pages — a single decision, summary or form",
    "standard": "4–10 pages — a complete report with analysis and a recommendation",
    "extended": "11–25 pages — multi-section analysis with appendices",
    "variable": "Length follows the record count — grows with rows, properties or controls",
}

INTENSITY = ("none", "low", "medium", "high")
FORMALITY = ("operational", "professional", "formal", "presentation")
TIERS = ("launch", "growth", "scale", "enterprise")
PRIORITIES = ("P1", "P2", "P3")

#: Who the finished document is for. Drives the default confidentiality label,
#: whether an adviser profile and back cover are included, and which templates
#: the recommender surfaces for a client-facing request.
AUDIENCE_MODES = ("client-facing", "internal", "regulator", "partner")


# ==========================================================================
# Shared defaults
# ==========================================================================

#: The white-label surface every template exposes. Templates add to this list;
#: none may remove from it, so an organisation configures its brand once and it
#: applies library-wide.
BASE_WHITE_LABEL_POINTS: list[tuple[str, str, str]] = [
    ("Organisation name", "{{org.name}}", "Cover, running header, contact page, back cover"),
    ("Organisation logo", "logo slot", "Cover panel, contact page, back cover"),
    ("Legal entity name", "{{org.legalName}}", "Back cover, disclaimer page"),
    ("ABN / registration", "{{org.abn}}", "Back cover, disclaimer page"),
    ("Primary brand colour", "brand.primary", "Cover panel, section bars, table headers"),
    ("Secondary brand colour", "brand.secondary", "Support fills, secondary bands"),
    ("Accent colour", "brand.accent", "Section numbers, rules, chips, metric figures"),
    ("Tagline", "{{org.tagline}}", "Cover, contact page"),
    ("Website", "{{org.website}}", "Contact page, back cover"),
    ("Email", "{{org.email}}", "Contact page, back cover"),
    ("Phone", "{{org.phone}}", "Contact page, back cover"),
    ("Office address", "{{org.address}}", "Contact page, back cover"),
    ("Social links", "{{org.socials}}", "Contact page"),
    ("Adviser name / title", "{{author.name}} · {{author.title}}", "Cover, adviser profile, sign-off"),
    ("Adviser credentials", "{{author.credentials}}", "Adviser profile"),
    ("Cover imagery", "cover image slot", "Cover page (image-capable families only)"),
    ("Report recipient", "{{recipient.name}}", "Cover, document control"),
    ("Client name", "{{client.name}}", "Cover, document control, throughout"),
    ("Client reference", "{{client.reference}}", "Document control, footer"),
    ("Date of issue", "{{document.issueDate}}", "Cover, document control, footer"),
    ("Version number", "{{document.version}}", "Document control, footer"),
    ("Confidentiality classification", "{{document.confidentiality}}", "Footer, cover meta"),
    ("Disclaimer text", "{{legal.disclaimer}}", "Disclaimer page, footer"),
    ("Privacy notice", "{{legal.privacyNotice}}", "Disclaimer page"),
    ("Terms and conditions", "{{legal.terms}}", "Disclaimer page"),
    ("Partner logos", "partner logo slot", "Cover (co-branded level only)"),
    ("Powered-by-Aurixa attribution", "brand.level", "Footer and back cover; removed at level 4"),
]

#: Bindings every template resolves. Template-specific bindings extend this.
BASE_BINDINGS: list[str] = [
    "org.* — name, legalName, abn, tagline, website, email, phone, address, socials",
    "author.* — name, title, credentials, email, phone, photoUrl",
    "client.* — name, reference, entity, contact",
    "recipient.* — name, title, organisation",
    "document.* — reference, issueDate, version, confidentiality, title",
    "legal.* — disclaimer, privacyNotice, terms",
    "brand.* — primary, secondary, accent, level, logoUrl, coverImageUrl",
]

DEFAULT_EXPORTS = (
    "DOCX (editable, styles intact, header/footer live page fields), "
    "PDF/A-2b via the print pipeline (tagged, bookmarks from section openers), "
    "HTML preview for the in-app viewer"
)

DEFAULT_ACCESSIBILITY = (
    "Body copy at 9.5pt minimum and never below 7pt for micro-labels. All text/background "
    "pairs meet WCAG AA at their rendered size. Status is never carried by colour alone — "
    "every status chip pairs a glyph and a word with its fill. Every image and chart frame "
    "carries a required alt-text binding; generation fails validation if alt text is empty. "
    "Section openers emit PDF bookmarks so a screen reader can navigate by heading. Tables "
    "declare a repeating header row so assistive technology can associate cells with headers."
)

DEFAULT_PRINT = (
    "A4 portrait, 16mm side margins, 24mm head, 20mm foot. Fully legible in grayscale: "
    "family fills differ in lightness, not hue alone. No content in the last 12mm of the "
    "page. Table header rows repeat across page breaks; no row splits across a page; no "
    "heading is stranded from its content. Duplex-safe — no design element depends on a "
    "recto/verso position."
)

DEFAULT_PREVIEW = (
    "Web preview renders page-by-page at 1:1 with a page-thumbnail rail. Below 768px the "
    "viewer switches to a continuous single-column scroll with pinch-zoom; tables become "
    "horizontally scrollable within their own container rather than shrinking the page. "
    "The first page is the library thumbnail source."
)


# ==========================================================================
# Records
# ==========================================================================

@dataclass(frozen=True)
class Section:
    """One section of a template.

    ``component`` names the component from ``components.py`` that renders it,
    which is what makes a spec buildable without interpretation — a developer
    does not have to guess what "key findings panel" means.
    """

    title: str
    component: str
    purpose: str
    optional: bool = False
    repeats: bool = False       # grows with the record count (properties, controls…)
    binding: str = ""
    #: Whether the section renders a visible heading carrying ``title``. Some
    #: sections are content blocks inside another section's opener — a gallery,
    #: a metric row, a signature panel — and carry no heading of their own.
    #: ``verify_library.py`` asserts the title appears in the built document
    #: only for headed sections.
    headed: bool = True


@dataclass(frozen=True)
class TemplateSpec:
    """A complete template brief. Fields not set here resolve from the design
    family, so a family-wide design change updates 36 briefs at once."""

    # --- identity
    id: str
    name: str
    category: str
    family: str
    summary: str

    # --- library metadata (drives the grid, filters and recommender)
    audience: str
    audience_mode: str
    use_case: str
    length: str
    pages: str
    data_intensity: str
    image_intensity: str
    formality: str
    tier: str
    priority: str
    max_white_label_level: int = 4
    report_types: tuple[str, ...] = ()
    industries: tuple[str, ...] = ("property", "finance")

    # --- design brief
    visual_style: str = ""
    colour_config: str = ""
    cover_structure: str = ""

    sections: tuple[Section, ...] = ()
    components: tuple[str, ...] = ()
    bindings: tuple[str, ...] = ()
    white_label_extras: tuple[tuple[str, str, str], ...] = ()

    image_requirements: str = "None. The template carries no image slots."
    chart_requirements: str = ""
    export_notes: str = ""
    accessibility_notes: str = ""
    print_notes: str = ""
    preview_notes: str = ""
    thumbnail: str = ""

    use_when: tuple[str, ...] = ()
    use_other: tuple[tuple[str, str], ...] = ()   # (situation, better template id)

    built: bool = False          # a generator exists in builders/

    # ---- resolution ------------------------------------------------------
    @property
    def design_family(self) -> DesignFamily:
        return FAMILIES[self.family]

    @property
    def category_label(self) -> str:
        return CATEGORIES[self.category]

    @property
    def required_sections(self) -> list[Section]:
        return [s for s in self.sections if not s.optional]

    @property
    def optional_sections(self) -> list[Section]:
        return [s for s in self.sections if s.optional]

    def resolved_visual_style(self) -> str:
        fam = self.design_family
        base = (f"{fam.name} — {fam.tagline} "
                f"Display {fam.display_font}, body {fam.body_font}"
                + (f", numerals {fam.numeric_font}" if fam.numeric_font != fam.body_font else "")
                + f". {fam.table_style.title()} tables, {fam.card_style} cards, "
                f"{fam.section_style} section openers, density {fam.density:g}×.")
        return f"{base} {self.visual_style}".strip()

    def resolved_cover(self) -> str:
        fam = self.design_family
        base = {
            "band": "Deep navy band panel with a gold-rule top edge; logo slot, eyebrow, "
                    "organisation name, title, accent rule, subtitle, status chips.",
            "panel": "Full-width navy panel with no top rule; logo slot, eyebrow, title, "
                     "subtitle and chip row, set in a single card block.",
            "fullbleed": "Full-bleed cover image band above a navy panel carrying the logo "
                         "slot, eyebrow, title and subtitle.",
            "split": "40/60 vertical split — navy sidebar with logo, tagline and the "
                     "prepared-for/prepared-by/issued stack; white field carrying eyebrow, "
                     "title, accent rule and subtitle.",
            "editorial": "Tall centred cover image, centred logo slot, wide-tracked eyebrow, "
                         "oversized centred display title, accent rule, centred subtitle.",
            "minimal": "Ruled masthead with organisation name and logo, then eyebrow, title "
                       "and subtitle in a left-aligned stack. No fills.",
        }[fam.cover_style]
        control = (" Every cover closes with the issue-control grid: prepared for, client "
                   "reference, prepared by, date of issue, document reference, version.")
        return f"{base}{control} {self.cover_structure}".strip()

    def resolved_header_footer(self) -> str:
        fam = self.design_family
        header = {
            "rule": "Running header: organisation name left, document title right, accent "
                    "rule beneath. Suppressed on page 1.",
            "band": "Running header on a soft-neutral band with an accent underline; "
                    "organisation left, document title right. Suppressed on page 1.",
            "minimal": "Running header with a hairline rule only. Suppressed on page 1.",
            "none": "No running header.",
        }[fam.header_style]
        footer = {
            "rule": "Footer with a hairline top rule: confidentiality and document reference "
                    "left; attribution, version and 'Page N of M' right.",
            "band": "Footer on a soft-neutral band with an accent top rule; same content.",
            "minimal": "Footer with no rule; same content, reduced contrast.",
        }[fam.footer_style]
        return f"{header} {footer} The footer is written to both the first-page and default " \
               f"footers, so the cover still carries document control."

    def resolved_colour(self) -> str:
        fam = self.design_family
        base = (f"Primary {fam.primary_key}, accent {fam.accent_key}, support "
                f"{fam.support_key}. Semantic colours (success / warning / alert / info) are "
                f"fixed and excluded from white-label override.")
        return f"{base} {self.colour_config}".strip()

    def resolved_white_label_points(self) -> list[tuple[str, str, str]]:
        return BASE_WHITE_LABEL_POINTS + list(self.white_label_extras)

    def resolved_bindings(self) -> list[str]:
        return BASE_BINDINGS + list(self.bindings)

    def resolved_exports(self) -> str:
        return f"{DEFAULT_EXPORTS}. {self.export_notes}".strip().rstrip(".") + "."

    def resolved_accessibility(self) -> str:
        return f"{DEFAULT_ACCESSIBILITY} {self.accessibility_notes}".strip()

    def resolved_print(self) -> str:
        return f"{DEFAULT_PRINT} {self.print_notes}".strip()

    def resolved_preview(self) -> str:
        return f"{DEFAULT_PREVIEW} {self.preview_notes}".strip()

    def resolved_thumbnail(self) -> str:
        return self.thumbnail or (
            "Cover page rendered at 3:4, cropped to the top 70% so the title and brand panel "
            "dominate, with a category chip and length badge overlaid on the card."
        )


# ==========================================================================
# Queries
# ==========================================================================

def by_id(catalogue: list[TemplateSpec], template_id: str) -> TemplateSpec:
    for spec in catalogue:
        if spec.id == template_id:
            return spec
    raise KeyError(f"No template with id {template_id!r}")


def validate(catalogue: list[TemplateSpec]) -> list[str]:
    """Structural checks. Run in CI so the registry cannot rot."""
    problems: list[str] = []
    seen: set[str] = set()
    for spec in catalogue:
        if spec.id in seen:
            problems.append(f"{spec.id}: duplicate id")
        seen.add(spec.id)
        if spec.category not in CATEGORIES:
            problems.append(f"{spec.id}: unknown category {spec.category!r}")
        if spec.family not in FAMILIES:
            problems.append(f"{spec.id}: unknown design family {spec.family!r}")
        if spec.length not in LENGTH_BANDS:
            problems.append(f"{spec.id}: unknown length band {spec.length!r}")
        if spec.tier not in TIERS:
            problems.append(f"{spec.id}: unknown tier {spec.tier!r}")
        if spec.priority not in PRIORITIES:
            problems.append(f"{spec.id}: unknown priority {spec.priority!r}")
        if spec.data_intensity not in INTENSITY:
            problems.append(f"{spec.id}: unknown data intensity {spec.data_intensity!r}")
        if spec.image_intensity not in INTENSITY:
            problems.append(f"{spec.id}: unknown image intensity {spec.image_intensity!r}")
        if spec.formality not in FORMALITY:
            problems.append(f"{spec.id}: unknown formality {spec.formality!r}")
        if spec.audience_mode not in AUDIENCE_MODES:
            problems.append(f"{spec.id}: unknown audience mode {spec.audience_mode!r}")
        if not spec.required_sections:
            problems.append(f"{spec.id}: no required sections")
        if not spec.use_when:
            problems.append(f"{spec.id}: no 'use when' guidance")
        if not spec.use_other:
            problems.append(f"{spec.id}: no 'use something else when' guidance")
        for _, alternative in spec.use_other:
            if alternative and alternative not in {s.id for s in catalogue}:
                problems.append(f"{spec.id}: 'use other' points at unknown id {alternative!r}")
        if spec.image_intensity in ("medium", "high") and not spec.image_requirements:
            problems.append(f"{spec.id}: image-heavy but no image requirements")
        if spec.data_intensity == "high" and not spec.chart_requirements:
            problems.append(f"{spec.id}: data-heavy but no chart/table requirements")
    return problems


#: Ordering used by the recommender when several templates match equally.
_TIER_RANK = {"launch": 0, "growth": 1, "scale": 2, "enterprise": 3}


def recommend(
    catalogue: list[TemplateSpec],
    *,
    report_type: str | None = None,
    category: str | None = None,
    plan: str = "scale",
    audience_mode: str | None = None,
    content_volume: str | None = None,     # brief | standard | extended
    property_count: int = 0,
    chart_count: int = 0,
    table_count: int = 0,
    formality: str | None = None,
    approved_ids: tuple[str, ...] = (),
    recent_ids: tuple[str, ...] = (),
    limit: int = 5,
) -> list[tuple[TemplateSpec, int, list[str]]]:
    """Score templates against the shape of the user's content.

    Returns ``(spec, score, reasons)`` so the UI can show *why* a template was
    suggested. A recommendation a user cannot interrogate is a recommendation
    they will not trust, and the fallback — scrolling 36 cards — is worse.
    """
    plan_rank = _TIER_RANK.get(plan, 2)
    results: list[tuple[TemplateSpec, int, list[str]]] = []

    for spec in catalogue:
        if _TIER_RANK[spec.tier] > plan_rank:
            continue
        score, reasons = 0, []

        if approved_ids:
            if spec.id in approved_ids:
                score += 40
                reasons.append("Approved by your organisation")
            else:
                score -= 25

        if category and spec.category == category:
            score += 25
            reasons.append(f"Built for {spec.category_label}")
        if report_type:
            needle = report_type.lower()
            if any(needle in rt.lower() for rt in spec.report_types):
                score += 35
                reasons.append(f"Designed for {report_type}")
            elif needle in spec.name.lower() or needle in spec.summary.lower():
                score += 18
                reasons.append("Name and purpose match your request")
        if audience_mode and spec.audience_mode == audience_mode:
            score += 15
            reasons.append(f"Written for a {audience_mode} audience")
        if content_volume and spec.length == content_volume:
            score += 15
            reasons.append(f"Sized for {LENGTH_BANDS[spec.length].split('—')[0].strip()}")

        if property_count >= 2:
            if "comparison" in spec.id or "compar" in spec.name.lower():
                score += 30
                reasons.append(f"Handles {property_count} properties side by side")
            elif spec.image_intensity in ("medium", "high"):
                score += 8
        if property_count >= 1 and spec.image_intensity == "none":
            score -= 10

        if chart_count >= 3:
            if spec.data_intensity == "high":
                score += 20
                reasons.append("Optimised for chart-heavy content")
            elif spec.data_intensity == "none":
                score -= 20
        if table_count >= 4 and spec.data_intensity in ("medium", "high"):
            score += 12

        if formality and spec.formality == formality:
            score += 12
            reasons.append(f"{formality.title()} register")

        if spec.id in recent_ids:
            score += 10
            reasons.append("You used this recently")
        if spec.priority == "P1":
            score += 5
        if not spec.built:
            score -= 3

        if score > 0:
            results.append((spec, score, reasons))

    results.sort(key=lambda item: (-item[1], item[0].name))
    return results[:limit]


#: Editorial shelves shown above the grid. Curated rather than computed —
#: "best for X" is a claim the design team should own, not an emergent property
#: of a scoring function.
SHELVES: list[tuple[str, str, tuple[str, ...]]] = [
    ("Best for executive reports",
     "Formal, decision-led, built around a summary a director reads in ninety seconds.",
     ("executive-business-report", "board-report", "quarterly-business-review")),
    ("Best for property-heavy reports",
     "Image-led layouts with map, gallery and comparison components.",
     ("property-investment-report", "property-comparison-report", "suburb-analysis-report",
      "off-market-opportunity-report", "house-and-land-assessment",
      "commercial-property-assessment")),
    ("Best for financial modelling",
     "Ledger tables, scenario columns and assumption panels.",
     ("borrowing-capacity-report", "cash-flow-net-position-report", "loan-comparison-report",
      "development-feasibility-report", "serviceability-assessment")),
    ("Best for short client summaries",
     "One to three pages, one decision, no appendices.",
     ("finance-approval-summary", "property-acquisition-recommendation",
      "loan-comparison-report", "property-brief-form")),
    ("Best for long-form reports",
     "Multi-section analysis with appendices and a document map.",
     ("property-due-diligence-report", "portfolio-review-report",
      "development-feasibility-report", "compliance-review-report")),
    ("Best for compliance documentation",
     "Numbered controls, evidence columns and approval trails.",
     ("aml-kyc-assessment", "client-verification-summary", "compliance-review-report",
      "audit-report", "file-review-summary")),
    ("Best for digital forms",
     "Field-affordance inputs, tab-through completion, minimal ink.",
     ("client-fact-find-form", "client-onboarding-form", "risk-profile-questionnaire",
      "document-collection-checklist", "client-authority-form",
      "investor-goals-questionnaire")),
    ("Best for premium client presentations",
     "Editorial covers, generous whitespace, prestige framing.",
     ("off-market-opportunity-report", "client-proposal", "partnership-proposal",
      "property-acquisition-recommendation")),
]
