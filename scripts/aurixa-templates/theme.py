"""Aurixa Command Center design system — palette, design families, brand config.

Three layers resolve into the ``Theme`` a template builder consumes:

    Palette          the fixed Aurixa colour set (navy / blue / cyan / neutrals)
        +
    DesignFamily     typography, density, cover architecture, table + chart style
        +
    BrandConfig      organisation identity, white-label level, colour overrides
        =
    Theme            everything a component needs, already resolved

Why three layers rather than one: the design family is a *design* decision the
Aurixa design team owns, the brand config is a *customer* decision the partner
owns, and the palette is the fallback both fall back to. Keeping them separate
is what makes "changing the brand configuration does not damage the formatting"
structurally true rather than a hope — a partner can only supply colour, logo
and copy, never spacing, type scale or layout.

Colour direction note
---------------------
The dashboard's own tokens (``src/styles/tokens.css``) currently run a warm
obsidian/gold "Luxury Property Advisory" theme. The Command Center template
library is specified on a deep-navy / Aurixa-blue / cyan corporate direction,
so this palette is authored independently rather than derived from those
tokens. If the two are to converge, the dashboard tokens are the thing that
should move — the printed library is the more expensive artefact to re-cut.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace


# ==========================================================================
# Palette
# ==========================================================================

@dataclass(frozen=True)
class Palette:
    """Aurixa Command Center palette. RGB hex, no leading ``#``.

    Every value is checked against WCAG AA at the size it is used: ``ink`` and
    ``ink_soft`` on ``paper``/``mist``/``cloud``, ``paper`` on ``navy``/
    ``midnight``/``blue_deep``, and every semantic pair.
    """

    # Structure — deep corporate navy
    midnight: str = "071527"      # cover fields, back cover
    navy: str = "0C2340"          # primary: banners, headers, table heads
    navy_mid: str = "16375C"      # secondary bands, chart gridline emphasis
    navy_soft: str = "24507E"     # tertiary, hover-equivalent in print

    # Accent — Aurixa blue
    blue: str = "1D6FE0"
    blue_deep: str = "1554AE"
    blue_mid: str = "5B96EB"
    blue_tint: str = "DCE8FB"
    blue_pale: str = "F2F7FE"

    # Accent — Aurixa cyan
    cyan: str = "12B0CE"
    cyan_deep: str = "0E8AA3"
    cyan_mid: str = "58CDE3"
    cyan_tint: str = "D5F1F7"
    cyan_pale: str = "EEFAFC"

    # Neutrals — white and soft neutral backgrounds
    paper: str = "FFFFFF"
    mist: str = "F7F9FC"
    cloud: str = "EDF1F7"
    slate: str = "E1E7F0"
    line: str = "DCE3ED"
    line_strong: str = "C2CDDC"

    # Text
    ink: str = "10192A"
    ink_soft: str = "4C5B73"
    ink_faint: str = "8493A8"
    ink_invert: str = "FFFFFF"
    ink_invert_soft: str = "AFC0D6"

    # Field affordance — the one colour that means "type here"
    field: str = "F4F8FE"
    field_line: str = "9DBBEA"

    # Category B — semantic. Fixed by design; never white-labelled, because a
    # partner palette must not be able to change what a warning means.
    success: str = "0F8A5F"
    success_soft: str = "E6F6EF"
    success_line: str = "A9DCC6"
    warning: str = "B26A00"
    warning_soft: str = "FBF1E0"
    warning_line: str = "EBCE9A"
    alert: str = "B3261E"
    alert_soft: str = "FBECEA"
    alert_line: str = "EFBDB8"
    info: str = "1554AE"
    info_soft: str = "EAF1FC"
    info_line: str = "B4CDF3"
    neutral_status: str = "4C5B73"
    neutral_status_soft: str = "EDF1F7"

    # Data series — ten steps, ordered for categorical use. Distinguishable in
    # grayscale by alternating lightness rather than hue alone.
    chart_1: str = "0C2340"
    chart_2: str = "1D6FE0"
    chart_3: str = "12B0CE"
    chart_4: str = "5B96EB"
    chart_5: str = "0E8AA3"
    chart_6: str = "24507E"
    chart_7: str = "58CDE3"
    chart_8: str = "8493A8"
    chart_9: str = "1554AE"
    chart_10: str = "B4CDF3"

    @property
    def series(self) -> list[str]:
        return [self.chart_1, self.chart_2, self.chart_3, self.chart_4, self.chart_5,
                self.chart_6, self.chart_7, self.chart_8, self.chart_9, self.chart_10]


def _resolve_tokens() -> tuple["Palette", "TypeScale"]:
    """Palette and type scale, with `design-tokens.json` applied when present.

    This is the seam an external design system plugs into: the library keeps its
    values in code, and a token file overrides colour and type size for all 40
    templates at once. A malformed or unknown token raises rather than silently
    building the wrong thing — see `design_tokens.py`.
    """
    from design_tokens import apply_tokens, load_tokens
    return apply_tokens(Palette, TypeScale, load_tokens())


PALETTE = Palette()


# ==========================================================================
# Type scale
# ==========================================================================

@dataclass(frozen=True)
class TypeScale:
    """Point sizes. One scale across the whole library so a reader moving
    between two templates never has to re-learn what a heading looks like.

    Design families vary *face*, *weight*, *tracking* and *density* — not the
    scale. Varying the scale as well is what makes a library feel like eight
    unrelated products instead of one system.
    """

    cover_eyebrow: float = 8.0
    cover_title: float = 30.0
    cover_title_sm: float = 24.0
    cover_subtitle: float = 11.0
    cover_meta: float = 8.0

    h1: float = 17.0            # section opener
    h2: float = 12.5            # sub-section
    h3: float = 10.5            # block heading
    h4: float = 9.0             # run-in heading

    body: float = 9.5
    body_sm: float = 8.5
    caption: float = 7.5
    label: float = 7.5
    micro: float = 7.0

    metric_xl: float = 22.0     # KPI figure
    metric_lg: float = 16.0
    table: float = 8.5
    table_head: float = 7.5


TYPE = TypeScale()

# Applied after both dataclasses exist so the token file can override either.
PALETTE, TYPE = _resolve_tokens()


# ==========================================================================
# Page geometry
# ==========================================================================

@dataclass(frozen=True)
class Geometry:
    """Millimetres for page metrics, dxa (1/20 pt) for cell padding."""

    page_width_mm: float = 210.0
    page_height_mm: float = 297.0
    margin_side_mm: float = 16.0
    margin_top_mm: float = 24.0
    margin_bottom_mm: float = 20.0
    header_distance_mm: float = 10.0
    footer_distance_mm: float = 10.0

    cell_pad_y: int = 100
    cell_pad_x: int = 140
    card_pad_y: int = 180
    card_pad_x: int = 210
    tight_pad_y: int = 70
    tight_pad_x: int = 110

    @property
    def content_width_mm(self) -> float:
        return self.page_width_mm - (2 * self.margin_side_mm)

    def col(self, count: int, gutter_mm: float = 4.0) -> float:
        """Width of one column in an evenly divided ``count``-column grid."""
        return (self.content_width_mm - gutter_mm * (count - 1)) / count


GEOMETRY = Geometry()

#: Landscape variant for chart- and table-heavy financial templates.
GEOMETRY_LANDSCAPE = Geometry(
    page_width_mm=297.0, page_height_mm=210.0,
    margin_side_mm=16.0, margin_top_mm=20.0, margin_bottom_mm=17.0,
)


# ==========================================================================
# Design families
# ==========================================================================

@dataclass(frozen=True)
class DesignFamily:
    """A coordinated visual treatment applied across several templates.

    Families differ on the axes a reader actually perceives — cover
    architecture, density, rule weight, fill vs hairline, type pairing — not on
    palette novelty. Eight families sharing one palette and one type scale reads
    as a designed system; eight palettes reads as a clip-art pack.
    """

    key: str
    name: str
    tagline: str

    # Typography
    display_font: str = "Calibri"
    body_font: str = "Calibri"
    numeric_font: str = "Calibri"
    display_tracking: float = 0.0
    label_tracking: float = 1.3
    body_line: float = 1.32

    # Density — multiplies the geometry padding constants
    density: float = 1.0
    section_gap_pt: float = 9.0

    # Cover architecture
    cover_style: str = "band"          # band | fullbleed | split | editorial | minimal | panel
    cover_rule: bool = True
    cover_image_slot: bool = False

    # Section openers
    section_style: str = "bar"         # bar | rule | numbered | tab | plain
    section_number_chip: bool = True

    # Tables
    table_style: str = "banded"        # banded | ruled | hairline | boxed | ledger
    table_head_fill: str = "navy"      # palette attribute name
    table_zebra: bool = True

    # Cards and callouts
    card_style: str = "filled"         # filled | outlined | shadowline | plain
    corner_treatment: str = "square"   # square only — Word cannot round table corners

    # Charts and imagery
    chart_style: str = "solid"         # solid | gradient | outline | ledger
    image_style: str = "full"          # full | framed | inset | none

    # Header / footer
    header_style: str = "rule"         # rule | band | minimal | none
    footer_style: str = "rule"         # rule | band | minimal

    #: Which palette attribute drives the family's primary and accent.
    primary_key: str = "navy"
    accent_key: str = "blue"
    support_key: str = "cyan"

    suitable_for: tuple[str, ...] = ()


FAMILIES: dict[str, DesignFamily] = {
    "executive-corporate": DesignFamily(
        key="executive-corporate",
        name="Executive Corporate",
        tagline="Boardroom-ready. Formal, decisive, built around the executive summary.",
        display_font="Cambria", body_font="Calibri", numeric_font="Calibri",
        display_tracking=0.2, label_tracking=1.5, body_line=1.34,
        density=1.0, section_gap_pt=10.0,
        cover_style="band", cover_rule=True,
        section_style="bar", section_number_chip=True,
        table_style="banded", table_head_fill="navy", table_zebra=True,
        card_style="filled", chart_style="solid", image_style="framed",
        header_style="rule", footer_style="rule",
        primary_key="navy", accent_key="blue", support_key="cyan",
        suitable_for=("Board reports", "Executive business reports",
                      "Strategic recommendations", "Quarterly reviews"),
    ),
    "modern-technology": DesignFamily(
        key="modern-technology",
        name="Modern Technology",
        tagline="SaaS-inspired. Card-led, data-forward, contemporary and digital-first.",
        display_font="Calibri", body_font="Calibri", numeric_font="Calibri",
        display_tracking=-0.3, label_tracking=1.6, body_line=1.36,
        density=1.05, section_gap_pt=9.0,
        cover_style="panel", cover_rule=False,
        section_style="tab", section_number_chip=True,
        table_style="hairline", table_head_fill="blue_deep", table_zebra=True,
        card_style="filled", chart_style="gradient", image_style="inset",
        header_style="minimal", footer_style="minimal",
        primary_key="navy", accent_key="blue", support_key="cyan",
        suitable_for=("Finance strategy", "Portfolio reviews",
                      "Project status", "Implementation plans"),
    ),
    "premium-advisory": DesignFamily(
        key="premium-advisory",
        name="Premium Advisory",
        tagline="Consulting register. Generous spacing, elegant dividers, considered recommendations.",
        display_font="Georgia", body_font="Calibri", numeric_font="Calibri",
        display_tracking=0.1, label_tracking=1.8, body_line=1.42,
        density=1.18, section_gap_pt=12.0,
        cover_style="split", cover_rule=True,
        section_style="numbered", section_number_chip=False,
        table_style="ruled", table_head_fill="navy", table_zebra=False,
        card_style="outlined", chart_style="outline", image_style="framed",
        header_style="rule", footer_style="rule",
        primary_key="navy", accent_key="blue", support_key="cyan",
        suitable_for=("Acquisition recommendations", "Client proposals",
                      "Advisory reports", "Partnership proposals"),
    ),
    "property-visual": DesignFamily(
        key="property-visual",
        name="Property Visual",
        tagline="Image-led. Property photography, maps, location data and side-by-side comparison.",
        display_font="Calibri", body_font="Calibri", numeric_font="Calibri",
        display_tracking=-0.2, label_tracking=1.4, body_line=1.32,
        density=0.95, section_gap_pt=9.0,
        cover_style="fullbleed", cover_rule=False, cover_image_slot=True,
        section_style="bar", section_number_chip=True,
        table_style="banded", table_head_fill="navy", table_zebra=True,
        card_style="filled", chart_style="solid", image_style="full",
        header_style="rule", footer_style="rule",
        primary_key="navy", accent_key="cyan", support_key="blue",
        suitable_for=("Property investment reports", "Suburb analysis",
                      "Property comparisons", "Off-market opportunities"),
    ),
    "financial-analytical": DesignFamily(
        key="financial-analytical",
        name="Financial Analytical",
        tagline="Numbers first. Dense ledgers, scenario columns, assumption panels, tight rules.",
        display_font="Calibri", body_font="Calibri", numeric_font="Consolas",
        display_tracking=-0.2, label_tracking=1.2, body_line=1.28,
        density=0.88, section_gap_pt=8.0,
        cover_style="band", cover_rule=True,
        section_style="rule", section_number_chip=True,
        table_style="ledger", table_head_fill="navy", table_zebra=True,
        card_style="outlined", chart_style="ledger", image_style="none",
        header_style="rule", footer_style="rule",
        primary_key="navy", accent_key="blue", support_key="cyan",
        suitable_for=("Borrowing capacity", "Cash-flow projections",
                      "Loan comparisons", "Serviceability assessments"),
    ),
    "minimal-professional": DesignFamily(
        key="minimal-professional",
        name="Minimal Professional",
        tagline="Understated and fast. Hairlines, no fills, maximum print and grayscale fidelity.",
        display_font="Arial", body_font="Arial", numeric_font="Arial",
        display_tracking=0.0, label_tracking=1.1, body_line=1.30,
        density=0.92, section_gap_pt=8.0,
        cover_style="minimal", cover_rule=True,
        section_style="rule", section_number_chip=False,
        table_style="hairline", table_head_fill="cloud", table_zebra=False,
        card_style="plain", chart_style="outline", image_style="none",
        header_style="minimal", footer_style="minimal",
        primary_key="navy", accent_key="blue", support_key="cyan",
        suitable_for=("Client forms", "Checklists", "Internal summaries",
                      "High-volume generation"),
    ),
    "luxury-presentation": DesignFamily(
        key="luxury-presentation",
        name="Luxury Presentation",
        tagline="Editorial and unhurried. Oversized display type, deep whitespace, prestige framing.",
        display_font="Georgia", body_font="Calibri", numeric_font="Georgia",
        display_tracking=0.6, label_tracking=2.6, body_line=1.48,
        density=1.32, section_gap_pt=15.0,
        cover_style="editorial", cover_rule=True, cover_image_slot=True,
        section_style="numbered", section_number_chip=False,
        table_style="ruled", table_head_fill="midnight", table_zebra=False,
        card_style="outlined", chart_style="outline", image_style="full",
        header_style="minimal", footer_style="minimal",
        primary_key="midnight", accent_key="cyan", support_key="blue",
        suitable_for=("Prestige property presentations", "Investment opportunities",
                      "Executive proposals", "High-value client packs"),
    ),
    "compliance-structured": DesignFamily(
        key="compliance-structured",
        name="Compliance Structured",
        tagline="Auditable by construction. Numbered controls, status columns, evidence trails.",
        display_font="Calibri", body_font="Calibri", numeric_font="Consolas",
        display_tracking=0.0, label_tracking=1.3, body_line=1.30,
        density=0.90, section_gap_pt=8.0,
        cover_style="band", cover_rule=True,
        section_style="numbered", section_number_chip=True,
        table_style="boxed", table_head_fill="navy", table_zebra=False,
        card_style="outlined", chart_style="ledger", image_style="none",
        header_style="band", footer_style="band",
        primary_key="navy", accent_key="blue", support_key="cyan",
        suitable_for=("AML and KYC", "Audit reports", "Risk assessments",
                      "File reviews", "Verification summaries"),
    ),
}


# ==========================================================================
# White-label configuration
# ==========================================================================

MERGE_PREFIX, MERGE_SUFFIX = "{{", "}}"


def token(path: str) -> str:
    """Render a binding token in the platform's existing syntax.

    Matches ``src/lib/reportTemplate/bindingResolver.ts`` — ``{{a.b.c}}`` with
    optional ``| filter`` — so one binding language serves the canvas templates
    and this library, and the same resolver populates both.
    """
    return f"{MERGE_PREFIX}{path}{MERGE_SUFFIX}"


#: Four commercial configurations, in ascending order of partner ownership.
BRAND_LEVELS = {
    1: ("aurixa", "Aurixa Branded",
        "Aurixa Systems is the author and the visible brand. Used for platform-issued "
        "documents, sales collateral and Aurixa's own client work."),
    2: ("co-branded", "Co-Branded",
        "Partner logo leads on the cover; Aurixa appears as a secondary lockup on the "
        "cover, the back cover and the footer. Used during partner onboarding and for "
        "jointly delivered engagements."),
    3: ("partner", "Partner Branded",
        "Partner is the primary and only cover brand. Aurixa is reduced to a discreet "
        "'Powered by Aurixa' line in the footer and back cover. The default for most "
        "paying organisations."),
    4: ("white-label", "Fully White-Labelled",
        "No visible Aurixa mark anywhere in the document body, headers, footers or "
        "metadata. Reserved for tiers where it is contractually permitted."),
}


@dataclass
class BrandConfig:
    """Everything an organisation may configure. Deliberately excludes anything
    structural — no spacing, type scale, margins or layout — so a partner can
    re-skin without being able to break the design.

    Defaults emit binding tokens rather than literals, so an unbranded build is
    a usable master template and a bound build is the same file with values
    resolved.
    """

    # --- identity
    organisation_name: str = token("org.name")
    legal_entity_name: str = token("org.legalName")
    abn: str = token("org.abn")
    tagline: str = token("org.tagline")
    logo_placeholder: str = "[  ORGANISATION LOGO  ]"
    partner_logo_placeholder: str = "[  PARTNER LOGO  ]"
    cover_image_placeholder: str = "[  COVER IMAGE  —  1600 × 900 px minimum  ]"

    # --- contact
    website: str = token("org.website")
    email: str = token("org.email")
    phone: str = token("org.phone")
    address: str = token("org.address")
    socials: str = token("org.socials")

    # --- people
    author_name: str = token("author.name")
    author_title: str = token("author.title")
    author_email: str = token("author.email")
    author_phone: str = token("author.phone")
    author_credentials: str = token("author.credentials")

    # --- document control
    client_name: str = token("client.name")
    client_reference: str = token("client.reference")
    recipient_name: str = token("recipient.name")
    document_reference: str = token("document.reference")
    issue_date: str = token("document.issueDate")
    version: str = token("document.version")
    confidentiality: str = "COMMERCIAL IN CONFIDENCE"

    # --- legal
    disclaimer: str = token("legal.disclaimer")
    privacy_notice: str = token("legal.privacyNotice")
    terms: str = token("legal.terms")

    # --- colour (the only visual levers a partner controls)
    primary: str | None = None      # falls back to the family's primary
    secondary: str | None = None
    accent: str | None = None

    # --- white-label level, 1..4
    level: int = 1

    def branded(self, **overrides) -> "BrandConfig":
        return replace(self, **overrides)

    @property
    def level_key(self) -> str:
        return BRAND_LEVELS[self.level][0]

    @property
    def shows_aurixa_cover(self) -> bool:
        return self.level <= 2

    @property
    def shows_aurixa_footer(self) -> bool:
        return self.level <= 3

    @property
    def powered_by(self) -> str:
        if self.level == 1:
            return "Aurixa Systems"
        if self.level == 2:
            return "Delivered with Aurixa Systems"
        if self.level == 3:
            return "Powered by Aurixa"
        return ""


#: Populated identity used when building the sample previews. Keeping it here
#: rather than in the builders means one change re-brands every sample, and the
#: sample and master builds differ only in content, never in structure.
SAMPLE_BRAND_FIELDS = {
    "client_name": "J. & S. Nguyen",
    "client_reference": "CL-2026-0418",
    "recipient_name": "J. Nguyen",
    "document_reference": "APR-0418-01",
    "issue_date": "31 July 2026",
    "version": "1.0",
    "author_name": "A. Nguyen",
    "author_title": "Senior Adviser",
    "author_credentials": "Licensed agent",
    "author_email": "a.nguyen@example.com.au",
    "author_phone": "(02) 8000 1234",
    "website": "www.example.com.au",
    "email": "hello@example.com.au",
    "phone": "(02) 8000 1234",
    "address": "Level 4, 100 Sample Street, Sydney NSW 2000",
    "socials": "linkedin.com/company/example",
    "abn": "12 600 123 456",
    "legal_entity_name": "Example Advisory Pty Ltd",
    "disclaimer": (
        "This document has been prepared for the named recipient only and is general "
        "in nature. It does not take into account any person's objectives, financial "
        "situation or needs, and it is not financial product, credit, tax or legal "
        "advice. Obtain your own professional advice before acting on it."
    ),
    "privacy_notice": (
        "Personal information collected in connection with this document is handled in "
        "accordance with our privacy policy and applicable privacy law. It is used only "
        "for the purposes described in this document and for related compliance and "
        "record-keeping obligations."
    ),
    "terms": (
        "This document remains our property and is provided in confidence. It may not be "
        "reproduced, forwarded or relied upon by any person other than the named "
        "recipient without our written consent."
    ),
}


AURIXA_BRAND = BrandConfig(
    organisation_name="Aurixa Systems",
    legal_entity_name="Aurixa Systems Pty Ltd",
    tagline="INTELLIGENT PROPERTY & FINANCE INFRASTRUCTURE",
    logo_placeholder="[  AURIXA SYSTEMS  ]",
    level=1,
)


# ==========================================================================
# Resolved theme
# ==========================================================================

@dataclass(frozen=True)
class Theme:
    """What a component actually reads. Every colour question has one answer
    here, so no component ever branches on brand level or family internally."""

    family: DesignFamily
    brand: BrandConfig
    palette: Palette = PALETTE
    type_scale: TypeScale = TYPE
    geometry: Geometry = GEOMETRY

    # ---- resolved colour roles
    @property
    def primary(self) -> str:
        return self.brand.primary or getattr(self.palette, self.family.primary_key)

    @property
    def accent(self) -> str:
        return self.brand.accent or getattr(self.palette, self.family.accent_key)

    @property
    def support(self) -> str:
        return self.brand.secondary or getattr(self.palette, self.family.support_key)

    @property
    def on_primary(self) -> str:
        return self.palette.ink_invert

    @property
    def table_head(self) -> str:
        key = self.family.table_head_fill
        if key in ("navy", "midnight") and self.brand.primary:
            return self.brand.primary
        return getattr(self.palette, key)

    @property
    def on_table_head(self) -> str:
        return self.palette.ink if self.family.table_head_fill == "cloud" else self.palette.ink_invert

    @property
    def accent_tint(self) -> str:
        return self.palette.cyan_tint if self.family.accent_key == "cyan" else self.palette.blue_tint

    @property
    def accent_pale(self) -> str:
        return self.palette.cyan_pale if self.family.accent_key == "cyan" else self.palette.blue_pale

    # ---- resolved spacing
    def pad(self, y: int, x: int) -> tuple[int, int]:
        d = self.family.density
        return int(y * d), int(x * d)

    @property
    def card_pad(self) -> tuple[int, int]:
        return self.pad(self.geometry.card_pad_y, self.geometry.card_pad_x)

    @property
    def cell_pad(self) -> tuple[int, int]:
        return self.pad(self.geometry.cell_pad_y, self.geometry.cell_pad_x)

    @property
    def tight_pad(self) -> tuple[int, int]:
        return self.pad(self.geometry.tight_pad_y, self.geometry.tight_pad_x)

    @property
    def gap(self) -> float:
        return self.family.section_gap_pt

    @property
    def width(self) -> float:
        return self.geometry.content_width_mm

    def col(self, count: int, gutter_mm: float = 4.0) -> float:
        return self.geometry.col(count, gutter_mm)

    @property
    def landscape(self) -> "Theme":
        """The same theme on landscape geometry.

        Wide financial tables get a landscape section rather than a smaller type
        size. Shrinking an eleven-column ledger to fit portrait is how a table
        becomes unreadable while still technically fitting.
        """
        return replace(self, geometry=GEOMETRY_LANDSCAPE)

    # ---- fonts
    @property
    def display(self) -> str:
        return self.family.display_font

    @property
    def body(self) -> str:
        return self.family.body_font

    @property
    def numeric(self) -> str:
        return self.family.numeric_font


def build_theme(family_key: str, brand: BrandConfig | None = None,
                geometry: Geometry | None = None) -> Theme:
    if family_key not in FAMILIES:
        raise KeyError(
            f"Unknown design family {family_key!r}. Known: {', '.join(sorted(FAMILIES))}"
        )
    return Theme(
        family=FAMILIES[family_key],
        brand=brand or BrandConfig(),
        geometry=geometry or GEOMETRY,
    )


# ==========================================================================
# Status vocabulary
# ==========================================================================

#: Compliance and risk statuses render identically in every template, so a
#: reviewer reading twelve documents never has to re-interpret a colour.
STATUS_TONES: dict[str, tuple[str, str, str, str]] = {
    # key: (fill, border, text, glyph)
    "pass":      ("success_soft", "success_line", "success", "✔"),
    "clear":     ("success_soft", "success_line", "success", "✔"),
    "complete":  ("success_soft", "success_line", "success", "✔"),
    "low":       ("success_soft", "success_line", "success", "▲"),
    "review":    ("warning_soft", "warning_line", "warning", "!"),
    "medium":    ("warning_soft", "warning_line", "warning", "▲"),
    "pending":   ("warning_soft", "warning_line", "warning", "◔"),
    "fail":      ("alert_soft", "alert_line", "alert", "✕"),
    "high":      ("alert_soft", "alert_line", "alert", "▲"),
    "escalate":  ("alert_soft", "alert_line", "alert", "✕"),
    "info":      ("info_soft", "info_line", "info", "i"),
    "n/a":       ("neutral_status_soft", "line", "neutral_status", "–"),
}
