#!/usr/bin/env python3
"""Generate the library's derived artefacts from the catalogue.

    python3 scripts/aurixa-templates/export_registry.py

Writes:
    docs/command-center/template-inventory.md        Stage 2 — the full inventory
    docs/command-center/template-specifications.md   Stage 4 — a brief per template
    docs/command-center/design-families.md           Stage 3 — family definitions
    src/lib/command-center/templateLibrary.ts        the platform's registry module

Every one of these is generated. Editing them by hand is a defect — change
``catalogue.py`` or ``theme.py`` and re-run.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from catalogue import CATALOGUE  # noqa: E402
from registry import (  # noqa: E402
    CATEGORIES, LENGTH_BANDS, SHELVES, TemplateSpec, validate,
)
from theme import BRAND_LEVELS, FAMILIES, PALETTE  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "command-center"
TS_OUT = ROOT / "src" / "lib" / "command-center" / "templateLibrary.ts"
JSON_OUT = ROOT / "public" / "templates" / "command-center" / "template-library.json"

GENERATED = ("<!-- GENERATED FILE — do not edit by hand.\n"
             "     Source: scripts/aurixa-templates/catalogue.py + theme.py\n"
             "     Regenerate: python3 scripts/aurixa-templates/export_registry.py -->\n")


def _bullets(items) -> str:
    return "\n".join(f"- {item}" for item in items) if items else "_None._"


def _table(headers: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(headers) + " |",
           "| " + " | ".join("---" for _ in headers) + " |"]
    for row in rows:
        out.append("| " + " | ".join(str(c).replace("|", "\\|") for c in row) + " |")
    return "\n".join(out)


# ==========================================================================
# Stage 2 — inventory
# ==========================================================================

def write_inventory() -> Path:
    lines = [GENERATED, "# Template library inventory\n",
             f"{len(CATALOGUE)} templates across {len(CATEGORIES)} categories and "
             f"{len(FAMILIES)} design families.\n",
             "Column meanings are defined in "
             "[`template-library-strategy.md`](./template-library-strategy.md); the "
             "per-template briefs are in "
             "[`template-specifications.md`](./template-specifications.md).\n"]

    counts = {key: sum(1 for s in CATALOGUE if s.category == key) for key in CATEGORIES}
    fam_counts = {key: sum(1 for s in CATALOGUE if s.family == key) for key in FAMILIES}
    lines += ["## At a glance\n",
              _table(["Category", "Templates"],
                     [[CATEGORIES[k], v] for k, v in counts.items()] +
                     [["**Total**", f"**{len(CATALOGUE)}**"]]), "",
              _table(["Design family", "Templates"],
                     [[FAMILIES[k].name, v] for k, v in fam_counts.items()]), "",
              _table(["Development priority", "Templates", "Meaning"],
                     [["P1", sum(1 for s in CATALOGUE if s.priority == "P1"),
                       "Build first — drives Finance Portal, onboarding, property and compliance workflows"],
                      ["P2", sum(1 for s in CATALOGUE if s.priority == "P2"),
                       "Build second — completes each design family and category"],
                      ["P3", sum(1 for s in CATALOGUE if s.priority == "P3"),
                       "Build third — specialist templates for narrower segments"]]), ""]

    lines += ["## Full inventory\n"]
    for key, label in CATEGORIES.items():
        specs = [s for s in CATALOGUE if s.category == key]
        lines += [f"### {label} ({len(specs)})\n"]
        lines.append(_table(
            ["Template", "Intended use", "Target user", "Design family", "Length",
             "Data", "Images", "White-label", "Tier", "Priority", "Built"],
            [[f"**{s.name}**<br>`{s.id}`", s.use_case, s.audience,
              FAMILIES[s.family].name, LENGTH_BANDS[s.length].split("—")[0].strip(),
              s.data_intensity, s.image_intensity,
              f"L1–L{s.max_white_label_level}", s.tier.title(), s.priority,
              "✅" if s.built else "—"]
             for s in specs]))
        lines.append("")

    lines += ["## Curated shelves\n",
              "Editorial groupings shown above the grid. Curated rather than computed — "
              "\"best for X\" is a claim the design team owns, not an emergent property of a "
              "scoring function.\n"]
    lines.append(_table(["Shelf", "Why", "Templates"],
                        [[name, why, ", ".join(f"`{r}`" for r in refs)]
                         for name, why, refs in SHELVES]))
    lines.append("")

    lines += ["## White-label levels\n",
              _table(["Level", "Name", "Meaning"],
                     [[n, name, desc] for n, (_, name, desc) in BRAND_LEVELS.items()]),
              "",
              "A template's `max_white_label_level` caps how far it can be de-branded. "
              "Board papers and internal serviceability workings cap at level 3 because "
              "they are never issued under a partner's brand to an external audience.\n"]

    DOCS.mkdir(parents=True, exist_ok=True)
    target = DOCS / "template-inventory.md"
    target.write_text("\n".join(lines))
    return target


# ==========================================================================
# Stage 3 — design families
# ==========================================================================

def write_families() -> Path:
    lines = [GENERATED, "# Design families\n",
             "Eight coordinated treatments sharing one palette, one type scale and one "
             "component library. Families differ on the axes a reader actually perceives — "
             "cover architecture, density, rule weight, fill versus hairline, type pairing — "
             "not on palette novelty. Eight palettes would read as a clip-art pack; eight "
             "treatments of one palette read as a designed system.\n",
             "## Shared foundations\n",
             "Every family inherits these. A family may not override them, which is what "
             "keeps the library coherent.\n"]

    lines.append(_table(["Role", "Hex", "Used for"], [
        ["Midnight", f"`#{PALETTE.midnight}`", "Luxury Presentation primary, back cover"],
        ["Navy", f"`#{PALETTE.navy}`", "Primary: cover panels, section bars, table heads"],
        ["Navy mid", f"`#{PALETTE.navy_mid}`", "Secondary bands, chips on dark"],
        ["Aurixa blue", f"`#{PALETTE.blue}`", "Accent: numbers, rules, chips, metric figures"],
        ["Blue deep", f"`#{PALETTE.blue_deep}`", "Modern Technology table heads, info tone"],
        ["Blue tint / pale", f"`#{PALETTE.blue_tint}` / `#{PALETTE.blue_pale}`",
         "Recommendation panels, total rows, highlighted comparison columns"],
        ["Aurixa cyan", f"`#{PALETTE.cyan}`", "Accent for Property Visual and Luxury"],
        ["Cyan tint / pale", f"`#{PALETTE.cyan_tint}` / `#{PALETTE.cyan_pale}`",
         "Accent panels where cyan is the accent"],
        ["Paper / mist / cloud",
         f"`#{PALETTE.paper}` / `#{PALETTE.mist}` / `#{PALETTE.cloud}`",
         "Page, zebra banding, label cells"],
        ["Line / line strong", f"`#{PALETTE.line}` / `#{PALETTE.line_strong}`",
         "Hairlines and frames"],
        ["Ink / soft / faint",
         f"`#{PALETTE.ink}` / `#{PALETTE.ink_soft}` / `#{PALETTE.ink_faint}`",
         "Body, captions, placeholder text"],
        ["Field", f"`#{PALETTE.field}`", "The one colour that means 'type here'"],
        ["Success", f"`#{PALETTE.success}`", "Pass, clear, complete, low risk — **fixed**"],
        ["Warning", f"`#{PALETTE.warning}`", "Review, pending, medium risk — **fixed**"],
        ["Alert", f"`#{PALETTE.alert}`", "Fail, escalate, high risk — **fixed**"],
        ["Info", f"`#{PALETTE.info}`", "Informational callouts — **fixed**"],
    ]))
    lines += ["",
              "Semantic colours are excluded from white-label override in code, not by "
              "convention. A partner palette that could turn a warning green would make the "
              "library actively dangerous in compliance documents.\n",
              "**Type scale** — one scale across all 40 templates, so a reader moving between "
              "two templates never re-learns what a heading looks like. Cover title 30pt, "
              "section opener 17pt, sub-section 12.5pt, block heading 10.5pt, body 9.5pt, "
              "small body 8.5pt, label 7.5pt, micro 7pt, KPI figure 16–22pt. Families vary "
              "face, weight, tracking and density — never the scale.\n",
              "**Geometry** — A4, 16mm side margins, 24mm head, 20mm foot, 178mm content "
              "width. Landscape sections (297×210) are available for wide financial tables.\n"]

    for key, fam in FAMILIES.items():
        specs = [s for s in CATALOGUE if s.family == key]
        lines += [f"## {fam.name}\n", f"_{fam.tagline}_\n",
                  f"**Templates ({len(specs)}):** " +
                  ", ".join(f"`{s.id}`" for s in specs) + "\n"]
        lines.append(_table(["Attribute", "Treatment"], [
            ["Visual identity", fam.tagline],
            ["Typography",
             f"Display **{fam.display_font}**, body **{fam.body_font}**, numerals "
             f"**{fam.numeric_font}**. Display tracking {fam.display_tracking:+g}pt, "
             f"label tracking {fam.label_tracking:g}pt, body line height {fam.body_line:g}."],
            ["Colour",
             f"Primary `{fam.primary_key}`, accent `{fam.accent_key}`, support "
             f"`{fam.support_key}`. Semantic colours fixed."],
            ["Density",
             f"{fam.density:g}× base padding, {fam.section_gap_pt:g}pt between sections."],
            ["Cover", f"`{fam.cover_style}` — " + {
                "band": "navy band panel with an accent top rule",
                "panel": "full-width navy panel, no top rule, chips inline",
                "fullbleed": "cover image band above the navy panel",
                "split": "40/60 navy sidebar and white field",
                "editorial": "tall centred image, centred oversized display title",
                "minimal": "ruled masthead, no fills",
            }[fam.cover_style] +
             (", cover image slot" if fam.cover_image_slot else ", no cover image")],
            ["Section dividers", f"`{fam.section_style}` — " + {
                "bar": "accent number chip beside a filled navy title bar",
                "tab": "accent tab above a soft-neutral title block",
                "numbered": "large accent numeral beside a display title over an accent rule",
                "rule": "inline title with a heavy accent underline",
                "plain": "inline title, no rule",
            }[fam.section_style]],
            ["Tables", f"`{fam.table_style}` — " + {
                "banded": "filled header, zebra body rows, hairline separators",
                "hairline": "filled header, hairline separators only",
                "ruled": "filled header, no zebra, ruled separators",
                "boxed": "fully boxed cells for audit legibility",
                "ledger": "vertical column rules, right-aligned monospaced numerals",
            }[fam.table_style] +
             f". Header fill `{fam.table_head_fill}`, zebra "
             f"{'on' if fam.table_zebra else 'off'}."],
            ["Charts", f"`{fam.chart_style}` — " + {
                "solid": "solid series fills from the ten-step data ramp",
                "gradient": "solid fills with a lighter secondary tint for comparison series",
                "outline": "outlined series with minimal fill, for low-ink families",
                "ledger": "chart is secondary to the table; native bar rows preferred",
            }[fam.chart_style]],
            ["Images", f"`{fam.image_style}` — " + {
                "full": "full-width, edge-to-edge within the content column",
                "framed": "hairline frame with caption beneath",
                "inset": "inset within a card block",
                "none": "no image components; the family carries no photography",
            }[fam.image_style]],
            ["Header / footer",
             f"Header `{fam.header_style}`, footer `{fam.footer_style}`. Header suppressed "
             f"on page 1; footer written to both first-page and default footers."],
            ["Suitable for", "; ".join(fam.suitable_for)],
        ]))
        lines.append("")

    target = DOCS / "design-families.md"
    target.write_text("\n".join(lines))
    return target


# ==========================================================================
# Stage 4 — per-template briefs
# ==========================================================================

def _brief(spec: TemplateSpec) -> list[str]:
    fam = FAMILIES[spec.family]
    out = [f"### {spec.name}\n", f"`{spec.id}`\n", f"{spec.summary}\n"]

    out.append(_table(["", ""], [
        ["**1. Template name**", spec.name],
        ["**2. Category**", spec.category_label],
        ["**3. Intended audience**", spec.audience],
        ["**4. Primary use case**", spec.use_case],
        ["**5. Recommended page range**", f"{spec.pages} ({LENGTH_BANDS[spec.length]})"],
        ["**6. Design family**", fam.name],
        ["**7. Visual style**", spec.resolved_visual_style()],
        ["**8. Colour configuration**", spec.resolved_colour()],
        ["**9. Cover-page structure**", spec.resolved_cover()],
        ["**10. Header & footer**", spec.resolved_header_footer()],
    ]))
    out.append("")

    out.append("**11. Recommended sections**\n")
    out.append(_table(["#", "Section", "Component", "Purpose", "Binding"],
                      [[i + 1, s.title, f"`{s.component}`" + (" ↻" if s.repeats else ""),
                        s.purpose, f"`{s.binding}`" if s.binding else "—"]
                       for i, s in enumerate(spec.required_sections)]))
    out.append("\n↻ marks a repeating section — it grows with the record count.\n")

    optional = spec.optional_sections
    out.append("**12. Optional sections**\n")
    if optional:
        out.append(_table(["Section", "Component", "Purpose", "Include when"],
                          [[s.title, f"`{s.component}`", s.purpose,
                            "The underlying data is present"] for s in optional]))
        out.append("\nOptional sections are removable without damaging document flow: each is "
                   "a complete block preceded by its own spacing, so removing it leaves no "
                   "orphaned heading and no double gap.\n")
    else:
        out.append("_All sections are required for this template._\n")

    out.append("**13. Data & content components**\n")
    out.append(", ".join(f"`{c}`" for c in spec.components) + "\n")

    out.append("**14. Image requirements**\n")
    out.append(spec.image_requirements + "\n")

    out.append("**15. Chart & table requirements**\n")
    out.append((spec.chart_requirements or "No specific chart or table requirements.") + "\n")

    out.append("**16. White-label configuration points**\n")
    out.append(f"All {len(spec.resolved_white_label_points())} library-standard points apply. "
               f"Maximum white-label level: **L{spec.max_white_label_level}** "
               f"({BRAND_LEVELS[spec.max_white_label_level][1]}).\n")
    if spec.white_label_extras:
        out.append("Template-specific additions:\n")
        out.append(_table(["Area", "Binding", "Appears in"],
                          [list(e) for e in spec.white_label_extras]))
        out.append("")

    out.append("**17. Dynamic content fields**\n")
    out.append(_bullets(f"`{b}`" for b in spec.bindings) if spec.bindings
               else "_Library-standard bindings only._")
    out.append("\nPlus the library-standard set: "
               + ", ".join(f"`{b.split(' —')[0]}`" for b in
                           ["org.*", "author.*", "client.*", "recipient.*", "document.*",
                            "legal.*", "brand.*"]) + ".\n")

    out.append("**18. Export requirements**\n")
    out.append(spec.resolved_exports() + "\n")
    out.append("**19. Accessibility considerations**\n")
    out.append(spec.resolved_accessibility() + "\n")
    out.append("**20. Print considerations**\n")
    out.append(spec.resolved_print() + "\n")
    out.append("**21. Mobile / web-preview considerations**\n")
    out.append(spec.resolved_preview() + "\n")
    out.append("**22. Recommended thumbnail presentation**\n")
    out.append(spec.resolved_thumbnail() + "\n")

    out.append("**23. Use this template when**\n")
    out.append(_bullets(spec.use_when) + "\n")
    out.append("**24. Use a different template when**\n")
    out.append(_bullets(
        f"{situation} → " + (f"`{alt}`" if alt else "_outside this library_")
        for situation, alt in spec.use_other) + "\n")

    out.append(f"**Library metadata** — tier `{spec.tier}` · priority `{spec.priority}` · "
               f"data `{spec.data_intensity}` · images `{spec.image_intensity}` · "
               f"formality `{spec.formality}` · audience `{spec.audience_mode}` · "
               f"generator {'implemented' if spec.built else 'not yet implemented'}\n")
    out.append("---\n")
    return out


def write_specifications() -> Path:
    lines = [GENERATED, "# Template specifications\n",
             f"A complete design brief for each of the {len(CATALOGUE)} templates, in the "
             "24-point format. Everything not stated per template resolves from the design "
             "family — see [`design-families.md`](./design-families.md).\n",
             "Each brief is buildable without interpretation: every section names the "
             "component from `scripts/aurixa-templates/components.py` that renders it, and "
             "every dynamic field names the binding path that fills it.\n",
             "## Contents\n"]
    for key, label in CATEGORIES.items():
        specs = [s for s in CATALOGUE if s.category == key]
        lines.append(f"- **{label}** — " +
                     ", ".join(f"[{s.name}](#{s.name.lower().replace(' ', '-').replace('&', '').replace('--', '-')})"
                               for s in specs))
    lines.append("")
    for key, label in CATEGORIES.items():
        lines += [f"## {label}\n"]
        for spec in [s for s in CATALOGUE if s.category == key]:
            lines += _brief(spec)

    target = DOCS / "template-specifications.md"
    target.write_text("\n".join(lines))
    return target


# ==========================================================================
# Platform registry module
# ==========================================================================

def write_typescript() -> Path:
    def spec_json(s: TemplateSpec) -> dict:
        fam = FAMILIES[s.family]
        return {
            "id": s.id, "name": s.name, "summary": s.summary,
            "category": s.category, "categoryLabel": s.category_label,
            "family": s.family, "familyName": fam.name, "familyTagline": fam.tagline,
            "audience": s.audience, "audienceMode": s.audience_mode,
            "useCase": s.use_case,
            "length": s.length, "lengthLabel": LENGTH_BANDS[s.length], "pages": s.pages,
            "dataIntensity": s.data_intensity, "imageIntensity": s.image_intensity,
            "formality": s.formality,
            "tier": s.tier, "priority": s.priority,
            "maxWhiteLabelLevel": s.max_white_label_level,
            "reportTypes": list(s.report_types), "industries": list(s.industries),
            "sectionCount": len(s.sections),
            "optionalSectionCount": len(s.optional_sections),
            "components": list(s.components),
            "useWhen": list(s.use_when),
            "useOther": [{"situation": sit, "alternativeId": alt or None}
                         for sit, alt in s.use_other],
            "implemented": s.built,
        }


    def detail_json(s: TemplateSpec) -> dict:
        """Everything the detail drawer and the section picker need."""
        return {
            "id": s.id,
            "sections": [
                {"title": sec.title, "component": sec.component, "purpose": sec.purpose,
                 "optional": sec.optional, "repeats": sec.repeats, "binding": sec.binding}
                for sec in s.sections
            ],
            "bindings": s.resolved_bindings(),
            "whiteLabelPoints": [
                {"area": a, "binding": b, "appearsIn": w}
                for a, b, w in s.resolved_white_label_points()
            ],
            "imageRequirements": s.image_requirements,
            "chartRequirements": s.chart_requirements,
            "exports": s.resolved_exports(),
            "accessibility": s.resolved_accessibility(),
            "print": s.resolved_print(),
            "preview": s.resolved_preview(),
            "thumbnail": s.resolved_thumbnail(),
            "visualStyle": s.resolved_visual_style(),
            "colourConfig": s.resolved_colour(),
            "coverStructure": s.resolved_cover(),
            "headerFooter": s.resolved_header_footer(),
        }

    payload = {
        "categories": [{"key": k, "label": v} for k, v in CATEGORIES.items()],
        "lengthBands": [{"key": k, "label": v} for k, v in LENGTH_BANDS.items()],
        "families": [
            {"key": k, "name": f.name, "tagline": f.tagline,
             "displayFont": f.display_font, "bodyFont": f.body_font,
             "coverStyle": f.cover_style, "tableStyle": f.table_style,
             "density": f.density, "suitableFor": list(f.suitable_for)}
            for k, f in FAMILIES.items()
        ],
        "brandLevels": [{"level": n, "key": key, "name": name, "description": desc}
                        for n, (key, name, desc) in BRAND_LEVELS.items()],
        "shelves": [{"title": t, "why": w, "templateIds": list(ids)}
                    for t, w, ids in SHELVES],
        "templates": [spec_json(s) for s in CATALOGUE],
    }

    detail = {
        "version": 1,
        "templates": {s.id: detail_json(s) for s in CATALOGUE},
    }
    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    JSON_OUT.write_text(json.dumps(detail, indent=2, ensure_ascii=False))

    body = json.dumps(payload, indent=2, ensure_ascii=False)
    ts = f"""// GENERATED FILE — do not edit by hand.
// Source: scripts/aurixa-templates/catalogue.py + theme.py
// Regenerate: python3 scripts/aurixa-templates/export_registry.py
//
// The Command Center template library registry. This is the same record set the
// design briefs are generated from, so the grid, the filters, the recommender
// and the specification cannot disagree with each other.

export type TemplateCategory = {" | ".join(f'"{k}"' for k in CATEGORIES)};
export type DesignFamilyKey = {" | ".join(f'"{k}"' for k in FAMILIES)};
export type LengthBand = {" | ".join(f'"{k}"' for k in LENGTH_BANDS)};
export type Intensity = "none" | "low" | "medium" | "high";
export type Formality = "operational" | "professional" | "formal" | "presentation";
export type PlanTier = "launch" | "growth" | "scale" | "enterprise";
export type AudienceMode = "client-facing" | "internal" | "regulator" | "partner";

export interface TemplateSection {{
  title: string;
  component: string;
  purpose: string;
  optional: boolean;
  repeats: boolean;
  binding: string;
}}

export interface WhiteLabelPoint {{
  area: string;
  binding: string;
  appearsIn: string;
}}

/** The long-form half of a template record: sections, bindings, white-label
 *  points and the full design brief. Deliberately NOT bundled — it is ~40× the
 *  size of the index and is only needed once a user opens a template's detail
 *  drawer. Fetched from `/templates/command-center/template-library.json`, and
 *  the same payload seeds `command_center_templates` in the database. */
export interface TemplateDetail {{
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
}}

export const TEMPLATE_DETAIL_URL = "/templates/command-center/template-library.json";

let detailCache: Record<string, TemplateDetail> | null = null;

/** Load the detail payload once per session. */
export async function loadTemplateDetail(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, TemplateDetail>> {{
  if (detailCache) return detailCache;
  const response = await fetchImpl(TEMPLATE_DETAIL_URL);
  if (!response.ok) {{
    throw new Error(`Template detail unavailable (${{response.status}})`);
  }}
  const payload = (await response.json()) as {{
    version: number;
    templates: Record<string, TemplateDetail>;
  }};
  detailCache = payload.templates;
  return detailCache;
}}

export interface TemplateRecord {{
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
  useOther: {{ situation: string; alternativeId: string | null }}[];
  implemented: boolean;
}}

export interface TemplateLibrary {{
  categories: {{ key: TemplateCategory; label: string }}[];
  lengthBands: {{ key: LengthBand; label: string }}[];
  families: {{
    key: DesignFamilyKey;
    name: string;
    tagline: string;
    displayFont: string;
    bodyFont: string;
    coverStyle: string;
    tableStyle: string;
    density: number;
    suitableFor: string[];
  }}[];
  brandLevels: {{ level: number; key: string; name: string; description: string }}[];
  shelves: {{ title: string; why: string; templateIds: string[] }}[];
  templates: TemplateRecord[];
}}

export const TEMPLATE_LIBRARY = {body} as const satisfies TemplateLibrary;

export const TEMPLATES: readonly TemplateRecord[] = TEMPLATE_LIBRARY.templates;

const TIER_RANK: Record<PlanTier, number> = {{
  launch: 0,
  growth: 1,
  scale: 2,
  enterprise: 3,
}};

/** Templates a plan may use. Plan entitlement is separate from user permission —
 *  both must pass before a template is selectable. */
export function templatesForPlan(plan: PlanTier): TemplateRecord[] {{
  const rank = TIER_RANK[plan] ?? 0;
  return TEMPLATES.filter((t) => TIER_RANK[t.tier] <= rank);
}}

export function templateById(id: string): TemplateRecord | undefined {{
  return TEMPLATES.find((t) => t.id === id);
}}

export interface RecommendationInput {{
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
}}

export interface Recommendation {{
  template: TemplateRecord;
  score: number;
  reasons: string[];
}}

/** Mirrors `recommend()` in scripts/aurixa-templates/registry.py. The two are
 *  kept in step by `scripts/aurixa-templates/verify_library.py`, which runs the
 *  same fixtures through both and compares the ordering. */
export function recommendTemplates(input: RecommendationInput): Recommendation[] {{
  const {{
    reportType, category, plan = "scale", audienceMode, contentVolume,
    propertyCount = 0, chartCount = 0, tableCount = 0, formality,
    approvedIds = [], recentIds = [], limit = 5,
  }} = input;
  const planRank = TIER_RANK[plan] ?? 2;
  const out: Recommendation[] = [];

  for (const template of TEMPLATES) {{
    if (TIER_RANK[template.tier] > planRank) continue;
    let score = 0;
    const reasons: string[] = [];

    if (approvedIds.length) {{
      if (approvedIds.includes(template.id)) {{
        score += 40;
        reasons.push("Approved by your organisation");
      }} else {{
        score -= 25;
      }}
    }}
    if (category && template.category === category) {{
      score += 25;
      reasons.push(`Built for ${{template.categoryLabel}}`);
    }}
    if (reportType) {{
      const needle = reportType.toLowerCase();
      if (template.reportTypes.some((rt) => rt.toLowerCase().includes(needle))) {{
        score += 35;
        reasons.push(`Designed for ${{reportType}}`);
      }} else if (
        template.name.toLowerCase().includes(needle) ||
        template.summary.toLowerCase().includes(needle)
      ) {{
        score += 18;
        reasons.push("Name and purpose match your request");
      }}
    }}
    if (audienceMode && template.audienceMode === audienceMode) {{
      score += 15;
      reasons.push(`Written for a ${{audienceMode}} audience`);
    }}
    if (contentVolume && template.length === contentVolume) {{
      score += 15;
      reasons.push(`Sized for ${{template.lengthLabel.split("—")[0].trim()}}`);
    }}
    if (propertyCount >= 2) {{
      if (template.id.includes("comparison") || /compar/i.test(template.name)) {{
        score += 30;
        reasons.push(`Handles ${{propertyCount}} properties side by side`);
      }} else if (template.imageIntensity === "medium" || template.imageIntensity === "high") {{
        score += 8;
      }}
    }}
    if (propertyCount >= 1 && template.imageIntensity === "none") score -= 10;
    if (chartCount >= 3) {{
      if (template.dataIntensity === "high") {{
        score += 20;
        reasons.push("Optimised for chart-heavy content");
      }} else if (template.dataIntensity === "none") {{
        score -= 20;
      }}
    }}
    if (tableCount >= 4 && (template.dataIntensity === "medium" || template.dataIntensity === "high")) {{
      score += 12;
    }}
    if (formality && template.formality === formality) {{
      score += 12;
      reasons.push(`${{formality[0].toUpperCase()}}${{formality.slice(1)}} register`);
    }}
    if (recentIds.includes(template.id)) {{
      score += 10;
      reasons.push("You used this recently");
    }}
    if (template.priority === "P1") score += 5;
    if (!template.implemented) score -= 3;

    if (score > 0) out.push({{ template, score, reasons }});
  }}

  out.sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name));
  return out.slice(0, limit);
}}
"""
    TS_OUT.parent.mkdir(parents=True, exist_ok=True)
    TS_OUT.write_text(ts)
    return TS_OUT


def main() -> int:
    problems = validate(CATALOGUE)
    if problems:
        print(f"Registry validation failed ({len(problems)} problems):")
        for problem in problems:
            print(f"  ✗ {problem}")
        return 1
    for path in (write_inventory(), write_families(), write_specifications(),
                 write_typescript(), JSON_OUT):
        size = path.stat().st_size / 1024
        print(f"  {path.relative_to(ROOT)}  ({size:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
