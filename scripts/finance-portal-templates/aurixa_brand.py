"""Aurixa brand kit for the Finance Portal document templates.

Single source of truth for the colours, typography and copy defaults used by
every generated template. The values mirror the design tokens in
``src/styles/tokens.css`` so the printed collateral and the dashboard read as
one system.

Token mapping (tokens.css -> hex used in Office documents):

    --aurixa-obsidian   34 20% 12%   -> #251F18   OBSIDIAN
    --foreground        34 20% 16%   -> #312A21   INK
    --muted-foreground  33 14% 38%   -> #6E6253   INK_SOFT
    --brand             43 74% 49%   -> #D9A520   GOLD
    --brand-700         43 74% 38%   -> #A98019   GOLD_DEEP
    --brand-900         43 74% 28%   -> #7C5E13   GOLD_DARK
    --brand-100         43 74% 90%   -> #F8EED3   GOLD_TINT
    --brand-light       43 80% 94%   -> #FCF5E3   GOLD_PALE
    --primary           262 66% 46%  -> #6128C3   VIOLET
    --dashboard-primary-soft 262 42% 91% -> #E5DEF2 VIOLET_SOFT
    --info              200 98% 39%  -> #0284C5   AZURE
    --card              42 82% 99%   -> #FFFDFA   PAPER
    --background        42 54% 96%   -> #FAF7EF   SAND
    --muted             39 44% 91%   -> #F2EBDE   SAND_DEEP
    --border            36 30% 81%   -> #DDD1C0   LINE
    --border-strong     37 32% 72%   -> #CEBDA1   LINE_STRONG
    --success           142 71% 45%  -> #21C45D   SUCCESS
    --destructive       0 84% 60%    -> #EF4343   ALERT

Office documents cannot resolve CSS custom properties, so the hex values are
frozen here. If the dashboard tokens change, re-derive them with
``hsl_to_hex()`` below and regenerate the templates.
"""

from __future__ import annotations

import colorsys
from dataclasses import dataclass, field, replace


# --------------------------------------------------------------------------
# Colour
# --------------------------------------------------------------------------

def hsl_to_hex(h: float, s: float, lightness: float) -> str:
    """Convert an ``H S% L%`` design token to an uppercase Office hex string."""
    r, g, b = colorsys.hls_to_rgb(h / 360.0, lightness / 100.0, s / 100.0)
    return "%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


@dataclass(frozen=True)
class Palette:
    """Aurixa document palette. Hex strings, no leading ``#``."""

    # Ink / structure
    obsidian: str = "251F18"
    obsidian_soft: str = "3A322A"
    ink: str = "312A21"
    ink_soft: str = "6E6253"
    ink_faint: str = "9A8D7C"

    # Brand gold (Category A — follows the white-label brand colour)
    gold: str = "D9A520"
    gold_deep: str = "A98019"
    gold_dark: str = "7C5E13"
    gold_mid: str = "ECCE83"
    gold_tint: str = "F8EED3"
    gold_pale: str = "FCF5E3"

    # Aurora accents
    violet: str = "6128C3"
    violet_soft: str = "E5DEF2"
    azure: str = "0284C5"
    azure_soft: str = "EBF8FF"

    # Surfaces
    paper: str = "FFFFFF"
    paper_warm: str = "FFFDFA"
    sand: str = "FAF7EF"
    sand_deep: str = "F2EBDE"
    field: str = "FFFBEE"

    # Rules
    line: str = "DDD1C0"
    line_strong: str = "CEBDA1"

    # Category B — semantic colours. Fixed by design; never white-labelled.
    success: str = "21C45D"
    success_soft: str = "E9FBF0"
    warning: str = "D9A520"
    alert: str = "C2410C"
    alert_soft: str = "FEF0F0"


PALETTE = Palette()


# --------------------------------------------------------------------------
# Typography
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Typography:
    """Font stack for generated Office documents.

    Both faces ship with Microsoft Office on Windows and macOS and have sane
    substitutes in LibreOffice and Google Docs, so pagination stays stable on
    any machine that opens the template. ``display`` carries the luxury-serif
    character of the Aurixa report covers; ``body`` keeps dense legal copy and
    form fields legible at small sizes.
    """

    display: str = "Georgia"
    body: str = "Calibri"
    mono: str = "Consolas"

    # Point sizes
    cover_eyebrow: float = 8.0
    cover_title: float = 27.0
    cover_subtitle: float = 10.5
    cover_meta: float = 8.0

    section_number: float = 15.0
    section_title: float = 12.5
    section_kicker: float = 8.0

    clause_heading: float = 10.5
    body_text: float = 9.5
    body_small: float = 8.5
    label: float = 7.5
    micro: float = 7.0


TYPE = Typography()


# --------------------------------------------------------------------------
# Layout
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Layout:
    """Page geometry in millimetres, and table metrics in dxa (1/20 pt)."""

    page_width_mm: float = 210.0
    page_height_mm: float = 297.0
    margin_side_mm: float = 14.0
    margin_top_mm: float = 24.0
    margin_bottom_mm: float = 18.0
    header_distance_mm: float = 9.0
    footer_distance_mm: float = 9.0

    # Cell padding, in dxa
    cell_pad_y: int = 90
    cell_pad_x: int = 130
    card_pad_y: int = 170
    card_pad_x: int = 200

    @property
    def content_width_mm(self) -> float:
        return self.page_width_mm - (2 * self.margin_side_mm)


LAYOUT = Layout()


# --------------------------------------------------------------------------
# White-label profile
# --------------------------------------------------------------------------

MERGE_TOKEN_PREFIX = "<<"
MERGE_TOKEN_SUFFIX = ">>"


def token(name: str) -> str:
    """Render a merge token, e.g. ``token('COMPANY NAME')`` -> ``<<COMPANY NAME>>``."""
    return f"{MERGE_TOKEN_PREFIX}{name}{MERGE_TOKEN_SUFFIX}"


#: Value written into every blank field cell. Kept identical to the token used
#: by the original templates so existing merge tooling keeps working.
INSERT = token("INSERT")


@dataclass
class BrandProfile:
    """Organisation-specific values stamped into a template at build time.

    The default profile is deliberately neutral: it emits merge tokens rather
    than any real organisation's details, so the shipped artefact is a true
    white-label master. Pass a populated profile to pre-brand a partner copy.
    """

    company_name: str = token("COMPANY NAME")
    trading_name: str = token("TRADING NAME")
    tagline: str = "YOUR TRUSTED PROPERTY & FINANCE PARTNER"
    logo_placeholder: str = "[  INSERT PARTNER LOGO  ]"
    website: str = token("WEBSITE")
    email: str = token("EMAIL")
    phone: str = token("PHONE")
    address: str = token("BUSINESS ADDRESS")
    abn: str = token("ABN / ACN")

    version: str = "3.0"
    effective_date: str = token("DATE")
    confidentiality: str = "COMMERCIAL IN CONFIDENCE"

    #: Legal caveat printed on the cover and in the footer of every page.
    disclaimer: str = (
        "Template only — obtain legal, licensing, privacy and aggregator "
        "approval before use."
    )
    footer_disclaimer: str = token("DISCLAIMER")

    #: Brand colours. Override to re-skin the whole document; every generated
    #: block reads these instead of hard-coded hex values.
    primary: str = PALETTE.obsidian
    accent: str = PALETTE.gold
    accent_deep: str = PALETTE.gold_deep
    accent_tint: str = PALETTE.gold_tint
    accent_pale: str = PALETTE.gold_pale

    #: Platform attribution shown in the footer. Set to ``""`` to remove.
    platform_note: str = "Powered by Aurixa Systems"

    def branded(self, **overrides) -> "BrandProfile":
        """Return a copy with ``overrides`` applied."""
        return replace(self, **overrides)


DEFAULT_BRAND = BrandProfile()


# --------------------------------------------------------------------------
# Shared copy
# --------------------------------------------------------------------------

#: Every replaceable area exposed by the templates. Rendered as the
#: "Brand & customisation panel" inside each document and mirrored in
#: docs/finance-portal-templates.md.
BRAND_SLOTS: list[tuple[str, str, str]] = [
    ("Partner logo", "Cover panel + page header",
     "Replace the dashed placeholder with the partner mark. Keep it inside the box so the cover grid stays aligned."),
    ("Organisation name", token("COMPANY NAME"),
     "Legal or trading name shown on the cover, the running header and the sign-off block."),
    ("Trading name", token("TRADING NAME"),
     "Optional. Use where the trading name differs from the legal entity."),
    ("Contact details", f"{token('PHONE')} · {token('EMAIL')} · {token('WEBSITE')}",
     "Appears in the partner email template and the document footer."),
    ("Business address", token("BUSINESS ADDRESS"),
     "Registered or service address used for notices under the agreement."),
    ("Brand colours", "Primary + accent",
     "Swap the obsidian/gold pairing for the partner palette. Section bands, chips and rules all follow it."),
    ("Effective date", token("DATE"),
     "Cover metadata strip and clause 1. Keep both in sync."),
    ("Version", "3.0",
     "Cover metadata strip and page footer. Increment on every approved amendment."),
    ("Disclaimer", token("DISCLAIMER"),
     "Footer legal line. Replace with the partner's own licensing or credit-guide wording, or delete it."),
    ("Governing jurisdiction", token("STATE OR TERRITORY"),
     "Agreement details grid and the governing-law clause."),
]
