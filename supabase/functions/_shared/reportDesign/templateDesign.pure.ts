/**
 * A chosen template, as the design of a report's own standard document.
 *
 * ## The rule this serves
 *
 * The owner, 26 Sep 2026: a template changes how a document looks and nothing
 * else. On that day none of the nine non-Investment report types carried the
 * same information through a template as through its standard document
 * (`docs/reports/TEMPLATE_PARITY.md`), because a master's page sequence is a
 * second statement of what the report says, and two statements drift.
 *
 * So for those report types the master's pages are never drawn. The report's
 * own composer draws every page, and the chosen template supplies only what a
 * template is: the typefaces, the colourway, the cover's ground, and how tables
 * and section headings are ruled. The information is identical by
 * construction, and `templateDesignParity.spec.ts` proves it on every report
 * type and every design: the `<body>` a design produces is byte for byte the
 * `<body>` the standard document produces, apart from the colours and faces
 * painted inside its charts.
 *
 * ## Two ways to name a design
 *
 * - **A catalogue design** — one of the fifty (`pb-01` … `de-05`) in one of its
 *   family's ten colourways. Resolved entirely from code: the variant from
 *   `templateDesignCatalogue.generated.pure.ts` and the colours from the same
 *   `colourwayColors` every master's tokens are baked with. Nothing is read
 *   from a database, so a design means the same thing on every deployment.
 * - **A template row** — any `report_templates` row, read by the caller. Its own
 *   `schema.tokens` decide the colours and faces, so a template somebody edited
 *   in the Template Builder prints as edited; its library lineage, where it has
 *   one, supplies the rest.
 *
 * ## What is refused, and why a refusal is never a failure
 *
 * Every colour arrives from a JSON column somebody can edit, and every face is
 * a name that will be written into a stylesheet. So a colour must be `#RRGGBB`,
 * a face must be one the print container actually has (after the same
 * substitutions every master's fonts get), and the resolved palette must pass
 * the same contrast audit every document does. What cannot be honoured is left
 * at the standard document's value and named in `notes`; a design with no
 * usable palette is refused whole. The caller then draws the standard document
 * and says why, because a document in the house design is always better than
 * no document.
 *
 * Pure: sibling `.pure` imports and one generated data module, no I/O.
 */
import {
  CATALOGUE_VARIANT_DESIGNS,
  type CatalogueVariantDesign,
} from './templateDesignCatalogue.generated.pure.ts';
import {
  colourwayColors,
  colourwaysForFamily,
  contrastRatio,
  defaultColourwayFor,
  findColourway,
  type ApprovedColourway,
} from '../templateColourways.pure.ts';
import { auditPaletteContrast, resolveReportPalette } from './brandResolve.pure.ts';
import { CONTRAST_FLOOR } from './tokens.pure.ts';
import {
  CONTAINER_INSTALLED_FAMILIES,
  isFileShippedFamily,
  PRINT_STACK,
  shippedWeights,
} from './typography.pure.ts';
import { substitutePrintFamily } from './printFontPolicy.pure.ts';
import type { ResolvedReportPalette } from './roles.pure.ts';
import type { ReportDesignOptions } from './options.pure.ts';

export type { CatalogueVariantDesign };

// ── Shapes ──────────────────────────────────────────────────────────────────

/** The five type roles the report stylesheet sets. Same keys as `PRINT_STACK`. */
export type ReportTypography = { readonly [K in keyof typeof PRINT_STACK]: string };

/**
 * How much smaller than the house size each display role is set, so that a
 * line of it takes the measure the house face's line takes. Never above 1.
 * See `FACE_ADVANCE_EM`.
 */
export interface ReportTypeFit {
  /** Chapter titles, subheads, KPI and stat figures, pull quotes. */
  readonly display: number;
  /** The italic voice: chapter standfirsts, ledes, the running title. */
  readonly accent: number;
  /** The cover title and the closing page's name. */
  readonly cover: number;
}

/** A standard document: every role at the house size. */
export const UNIT_TYPE_FIT: ReportTypeFit = Object.freeze({ display: 1, accent: 1, cover: 1 });

/**
 * Everything a design changes that `ReportDesignOptions` has no axis for.
 *
 * Read by the stylesheet (`templateDesignCss.pure.ts`) and by the charts, and by
 * nothing else — none of it reaches the markup, which is what keeps the body of
 * the document the standard document's body.
 */
export interface TemplateDesignLayer {
  typography: ReportTypography;
  /** Each display role's size against the house's, so a line keeps its measure. */
  fit: ReportTypeFit;
  /**
   * Whether the display face has a true italic in the print container. Where it
   * has none, the one rule that sets the display face in italic — the pull
   * quote — takes the italic voice instead, because a slant the engine
   * synthesises from an upright reads as a printing fault.
   */
  displayItalic: boolean;
  /** `field` fills the cover; `band` grounds its head only; `paper` grounds none of it. */
  coverGround: 'field' | 'band' | 'paper';
  /** A hairline frame inset from the cover's edge. */
  coverFrame: boolean;
  /**
   * The cover title's size against the standard cover's: the design's own
   * scale, clamped, then fitted to the cover face (`fit.cover` is already in it).
   */
  coverTitleScale: number;
  /** A rule down the binding edge of every body page. */
  rail: boolean;
  /** How a section heading is set, or null to keep the standard treatment. */
  sectionKind: CatalogueVariantDesign['sectionKind'] | null;
  /** How a data table is ruled, or null to keep the standard treatment. */
  table: CatalogueVariantDesign['table'] | null;
  /** Corner radius for raised surfaces, in points. */
  radius: number;
}

/** How a design was named. Travels from the chooser to the route. */
export type TemplateDesignReference =
  | { kind: 'catalogue'; code: string; colourway: string | null }
  | { kind: 'template'; templateId: string };

export interface ReportTemplateDesign {
  reference: TemplateDesignReference;
  /** What a person calls it: "Private Banking — Chancery · Oxblood". */
  label: string;
  /** The catalogue code, where the design is (or descends from) a catalogue design. */
  code: string | null;
  /** The colourway id, or null for the family default or a template's own colours. */
  colourwayId: string | null;
  /** The print palette, carrying the layer for the stylesheet and the charts. */
  palette: ResolvedReportPalette;
  /** The design's choices on the axes `ReportDesignOptions` already has. */
  options: Partial<ReportDesignOptions>;
  layer: TemplateDesignLayer;
  /** What could not be honoured, for the log. Never shown to a client. */
  notes: string[];
}

export type TemplateDesignResult =
  | { ok: true; design: ReportTemplateDesign }
  | { ok: false; reason: TemplateDesignRefusal; detail: string };

/**
 * Why a design was not applied. Each is a different sentence to the person who
 * chose it, so they are kept apart rather than collapsed into "failed".
 */
export type TemplateDesignRefusal =
  /** The reference names no design in the catalogue. */
  | 'unknown_design'
  /** The template row has no colours this stylesheet can print. */
  | 'palette_incomplete'
  /** The colours are there and cannot be printed legibly. */
  | 'palette_illegible'
  /** The template row is not the caller's to use: gone, not offered for this report, or not theirs to see. */
  | 'template_unavailable'
  /**
   * The template row could not be read just now: a database or network fault.
   * The choice itself stands, so the person is told to try again rather than
   * to choose another.
   */
  | 'template_unreadable';

// ── What a route says about the design it was asked for ─────────────────────

/**
 * What a render response says about the design it was asked for.
 *
 * A refused design is drawn as the standard document, and the response says
 * which design was asked for and why it was not used, in words the person who
 * chose it can act on. A choice that was not honoured must never look like one
 * that was.
 */
export interface DesignEcho {
  /** The design the document was drawn in, or null when none was applied. */
  applied: {
    label: string;
    /** The catalogue code, where the design is (or descends from) one. */
    code: string | null;
    /** The colourway, or null for the family default or a template's own colours. */
    colourway: string | null;
  } | null;
  /** Why the design asked for was not applied, or null when it was. */
  refusal: TemplateDesignRefusal | null;
  /** The sentence for the person who chose it, or null when it was applied. */
  message: string | null;
}

/** The sentence for each refusal. Each sends the person somewhere different. */
export const DESIGN_REFUSAL_TEXT: Readonly<Record<TemplateDesignRefusal, string>> = Object.freeze({
  unknown_design: 'The design you chose is not in the catalogue any more, so the standard design was used. '
    + 'Choose another in the template chooser.',
  palette_incomplete: 'The template you chose has no colours this document can print, so the standard design '
    + 'was used. Open it in the Template Builder and set its colours.',
  palette_illegible: 'The colours of the template you chose would not print legibly, so the standard design '
    + 'was used. Open it in the Template Builder and raise the contrast of its text colours.',
  template_unavailable: 'The template you chose is no longer available to you for this report, so the '
    + 'standard design was used. Choose another in the template chooser.',
  template_unreadable: 'The template you chose could not be read just now, so the standard design was used. '
    + 'Try again in a moment: your choice is still set in the template chooser.',
});

/** The echo for a design that was applied. */
export function appliedEcho(design: ReportTemplateDesign): DesignEcho {
  return {
    applied: { label: design.label, code: design.code, colourway: design.colourwayId },
    refusal: null,
    message: null,
  };
}

/** The echo for a design that was asked for and not applied. */
export function refusedEcho(reason: TemplateDesignRefusal): DesignEcho {
  return { applied: null, refusal: reason, message: DESIGN_REFUSAL_TEXT[reason] };
}

// ── The palette travels with the layer ──────────────────────────────────────

/**
 * Where the layer rides.
 *
 * On the palette, because every surface that paints a colour also sets type:
 * the stylesheet and ~25 chart call sites across nine formats already receive
 * the palette, so a layer carried on it reaches all of them without a second
 * parameter threaded through each. A symbol, so it is invisible to
 * `Object.entries`, to `JSON.stringify` and to everything that iterates a
 * palette's colours, and copied by a spread, so a renderer that extends the
 * palette keeps it.
 */
const DESIGN_LAYER = Symbol.for('npc.reportDesign.templateDesignLayer');

type CarryingPalette = ResolvedReportPalette & { [DESIGN_LAYER]?: TemplateDesignLayer };

export function withDesignLayer(
  palette: ResolvedReportPalette,
  layer: TemplateDesignLayer,
): ResolvedReportPalette {
  return { ...palette, [DESIGN_LAYER]: layer } as CarryingPalette;
}

/** The layer a palette carries, or null for every standard document. */
export function designLayerOf(palette: ResolvedReportPalette | null | undefined): TemplateDesignLayer | null {
  if (!palette || typeof palette !== 'object') return null;
  return (palette as CarryingPalette)[DESIGN_LAYER] ?? null;
}

// ── Catalogue ───────────────────────────────────────────────────────────────

const BY_CODE = new Map(CATALOGUE_VARIANT_DESIGNS.map((v) => [v.code, v]));

/** Every catalogue design, in catalogue order. */
export function catalogueDesigns(): readonly CatalogueVariantDesign[] {
  return CATALOGUE_VARIANT_DESIGNS;
}

export function catalogueDesign(code: string | null | undefined): CatalogueVariantDesign | null {
  return BY_CODE.get(String(code ?? '').trim().toLowerCase()) ?? null;
}

/** A family's colourways, default first. */
export function catalogueColourways(familyKey: string): readonly ApprovedColourway[] {
  return colourwaysForFamily(familyKey);
}

// ── Typography ──────────────────────────────────────────────────────────────

type Generic = 'serif' | 'sans-serif' | 'monospace';

/** The generic each installed family falls back to. Unlisted → sans-serif. */
const INSTALLED_GENERIC: Readonly<Record<string, Generic>> = {
  'Cinzel': 'serif',
  'Playfair Display': 'serif',
  'Noto Serif': 'serif',
  'DejaVu Serif': 'serif',
  'Liberation Serif': 'serif',
  'IBM Plex Mono': 'monospace',
};

/**
 * What follows the leading face, per generic.
 *
 * The house stacks' own tails, so a design whose faces are the house faces
 * produces the house stacks byte for byte — which is what makes the reference
 * design (Chancery) print exactly as the standard document does.
 */
const GENERIC_TAIL: Readonly<Record<Generic, string>> = {
  'serif': 'Georgia, serif',
  'sans-serif': "'Helvetica Neue', Arial, sans-serif",
  'monospace': "'SFMono-Regular', Consolas, monospace",
};

const INSTALLED_BY_LOWER = new Map(CONTAINER_INSTALLED_FAMILIES.map((f) => [f.toLowerCase(), f]));

interface Face { family: string; generic: Generic }

/**
 * An installed face, in the container's own spelling, or null.
 *
 * The container's spelling rather than the input's: a family name ends up
 * inside a stylesheet, so it is taken from an allow-list this module owns and
 * never copied from a JSON column.
 */
function installedFace(name: unknown): Face | null {
  const raw = String(name ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return null;
  const family = INSTALLED_BY_LOWER.get(substitutePrintFamily(raw).toLowerCase());
  if (!family) return null;
  return { family, generic: INSTALLED_GENERIC[family] ?? 'sans-serif' };
}

function stack(face: Face, second?: Face | null): string {
  const lead = `'${face.family}'`;
  const next = second && second.family !== face.family ? `, '${second.family}'` : '';
  return `${lead}${next}, ${GENERIC_TAIL[face.generic]}`;
}

/**
 * The measured average advance of every installed text face, in em per
 * character, for the three cuts a report sets: the upright at 400, the true
 * italic at 400 (`null` where the container ships none), and the face a
 * 600-weight heading resolves to under CSS font matching (600 where the family
 * has it, otherwise the nearest heavier cut).
 *
 * Measured 26 Sep 2026 with the font files fontconfig resolves in the
 * reporting environment (Pillow `getlength` at 1,000 units), over a sample of
 * the standard documents' own chapter titles, standfirsts and body sentences.
 * `Noto Sans` is installed in the print image but was not present to measure,
 * so it is absent here and fits at 1 — the house size, exactly as before this
 * table existed.
 *
 * ## Why a design needs it
 *
 * The standard documents' display sizes were set for Playfair Display, and the
 * catalogue's faces are wider: Inter's italic is 12% wider than Playfair's,
 * IBM Plex Mono 34% wider than Playfair SemiBold. Rendered at the house sizes,
 * a one-line standfirst wrapped to two under 28 of the 50 designs, which pushed
 * the last row of a table onto a page of its own in Portfolio and in Client
 * Details. `designTypography` sets each display role smaller by exactly the
 * width ratio, so a line of it takes the measure the house face's line takes
 * and the page breaks where the standard document's does. It never enlarges:
 * a narrower face keeps the house size.
 */
export const FACE_ADVANCE_EM: Readonly<Record<string, { regular: number; italic: number | null; semibold: number }>> = {
  'Playfair Display': { regular: 0.4405, italic: 0.4216, semibold: 0.4478 },
  'Cinzel': { regular: 0.5433, italic: null, semibold: 0.5511 },
  'Inter': { regular: 0.4697, italic: 0.4729, semibold: 0.4789 },
  'Noto Serif': { regular: 0.4725, italic: 0.4612, semibold: 0.4901 },
  'Lato': { regular: 0.4331, italic: 0.4098, semibold: 0.4358 },
  'Roboto': { regular: 0.4370, italic: 0.4248, semibold: 0.4440 },
  'IBM Plex Mono': { regular: 0.6000, italic: null, semibold: 0.6000 },
  'DejaVu Sans': { regular: 0.5012, italic: 0.5017, semibold: 0.5666 },
  'DejaVu Serif': { regular: 0.5088, italic: 0.5088, semibold: 0.5607 },
  'Liberation Sans': { regular: 0.4385, italic: 0.4386, semibold: 0.4715 },
  'Liberation Serif': { regular: 0.3996, italic: 0.4007, semibold: 0.4240 },
};

/**
 * The house face each fitted role is measured against, and the cut it is set in.
 *
 * The chapter title is 600 and the standfirst an italic, so those are the cuts
 * compared; the cover title is set at 400 in Cinzel.
 */
const HOUSE_FIT_FACES = {
  display: { family: 'Playfair Display', cut: 'semibold' },
  accent: { family: 'Playfair Display', cut: 'italic' },
  cover: { family: 'Cinzel', cut: 'regular' },
} as const;

/**
 * Whether a family has a true italic in the print container.
 *
 * A family the image copies in as files has an italic only where a file says
 * so (`CONTAINER_FONT_FILES`); the Debian packages the image installs all ship
 * one.
 */
export function hasTrueItalic(family: string): boolean {
  return isFileShippedFamily(family) ? shippedWeights(family, true).length > 0 : true;
}

/** The size factor that sets `family` to the house face's measure. Never above 1. */
function fitFor(role: keyof typeof HOUSE_FIT_FACES, family: string | null | undefined): number {
  if (!family) return 1;
  const house = HOUSE_FIT_FACES[role];
  const houseEm = FACE_ADVANCE_EM[house.family]?.[house.cut];
  const measured = FACE_ADVANCE_EM[family];
  const em = measured ? (measured[house.cut] ?? measured.regular) : null;
  if (!houseEm || !em || em <= houseEm) return 1;
  return Number((houseEm / em).toFixed(3));
}

/** The type a design sets: five stacks, their fit, and whether the display face slants. */
export interface DesignTypography {
  typography: ReportTypography;
  fit: ReportTypeFit;
  displayItalic: boolean;
}

/**
 * The five roles, from a design's four faces.
 *
 * - **cover** is the display face. Cinzel is an inscriptional capital with no
 *   lowercase of its own, so where it leads, the heading serif follows it in
 *   the stack exactly as the house stack has it.
 * - **accent** is the italic voice — standfirsts, deks, the running title. It
 *   is the heading face where that is a serif with a true italic, and the body
 *   face otherwise: a sans heading's italic is not the design's voice, a mono
 *   heading has no italic in the container at all, and a slant the engine
 *   synthesises reads as a fault. Where neither face has one, the house voice.
 */
export function designTypography(
  faces: { display?: unknown; heading?: unknown; body?: unknown; mono?: unknown },
  notes: string[],
): DesignTypography {
  const heading = installedFace(faces.heading);
  const display = installedFace(faces.display) ?? heading;
  const body = installedFace(faces.body);
  const mono = installedFace(faces.mono);

  const accent = heading?.generic === 'serif' && hasTrueItalic(heading.family)
    ? heading
    : body && hasTrueItalic(body.family) ? body : null;

  const typography = {
    cover: display ? stack(display, display.family === 'Cinzel' && heading?.generic === 'serif' ? heading : null) : PRINT_STACK.cover,
    display: heading ? stack(heading) : PRINT_STACK.display,
    body: body ? stack(body) : PRINT_STACK.body,
    mono: mono ? stack(mono) : PRINT_STACK.mono,
    accent: accent ? stack(accent) : PRINT_STACK.accent,
  };

  for (const [role, value] of [['display', faces.display], ['heading', faces.heading], ['body', faces.body], ['mono', faces.mono]] as const) {
    if (value !== undefined && value !== null && String(value).trim() && !installedFace(value)) {
      notes.push(`${role} face "${String(value).slice(0, 60)}" is not installed for print; the standard face is used`);
    }
  }

  return {
    typography,
    fit: {
      display: fitFor('display', heading?.family),
      accent: fitFor('accent', accent?.family),
      cover: fitFor('cover', display?.family),
    },
    displayItalic: heading ? hasTrueItalic(heading.family) : true,
  };
}

/** The five stacks alone. */
export function typographyFromFaces(
  faces: { display?: unknown; heading?: unknown; body?: unknown; mono?: unknown },
  notes: string[],
): ReportTypography {
  return designTypography(faces, notes).typography;
}

// ── Palette ─────────────────────────────────────────────────────────────────

const HEX = /^#[0-9A-Fa-f]{6}$/;

function hexOf(colors: Record<string, unknown>, key: string): string | null {
  const value = colors[key];
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/**
 * A print palette from a template's seventeen colour roles.
 *
 * The seven neutrals and the brand go through `resolveReportPalette`, the one
 * function every document's palette comes from, so the accents are corrected
 * for the stock they print on and Category B keeps its frozen hues. Then three
 * of the template's own derivations are preferred wherever they clear the same
 * floors — the type on the field, the accent on paper and the accent on the
 * field — because they are what the template's preview shows, and a design that
 * prints a shade away from the design somebody chose is a different design.
 */
export function paletteFromTemplateColours(
  colors: unknown,
  notes: string[],
): { ok: true; palette: ResolvedReportPalette } | { ok: false; reason: 'palette_incomplete' | 'palette_illegible'; detail: string } {
  const c = (colors && typeof colors === 'object' ? colors : {}) as Record<string, unknown>;
  const surface = hexOf(c, 'surface');
  const field = hexOf(c, 'bg');
  const ink = hexOf(c, 'ink');
  const primary = hexOf(c, 'primary');
  const rule = hexOf(c, 'line');
  const missing = [['surface', surface], ['bg', field], ['ink', ink], ['primary', primary], ['line', rule]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    return { ok: false, reason: 'palette_incomplete', detail: `no printable ${missing.join(', ')}` };
  }

  const base = resolveReportPalette({
    brandHex: primary,
    neutrals: {
      paper: surface!,
      paperAlt: hexOf(c, 'panel') ?? surface!,
      paperBright: surface!,
      field: field!,
      rule: rule!,
      bodyInk: ink!,
      mutedInk: hexOf(c, 'mutedInk') ?? hexOf(c, 'muted') ?? ink!,
    },
  });

  const palette: ResolvedReportPalette = { ...base };
  const papers = [palette.paper, palette.paperAlt, palette.paperBright];

  const text = hexOf(c, 'text');
  if (text && contrastRatio(text, palette.field) >= CONTRAST_FLOOR.body) palette.onFieldInk = text;

  const accentInk = hexOf(c, 'accentInk');
  if (accentInk && papers.every((g) => contrastRatio(accentInk, g) >= CONTRAST_FLOOR.micro)) {
    palette.accentOnPaper = accentInk;
  }

  const accentOnField = hexOf(c, 'accentOnField');
  if (accentOnField && contrastRatio(accentOnField, palette.field) >= CONTRAST_FLOOR.micro) {
    palette.accentOnField = accentOnField;
  }

  const problems = auditPaletteContrast(palette);
  if (problems.length) {
    const worst = problems[0];
    notes.push(`palette fails ${problems.length} contrast check(s)`);
    return {
      ok: false,
      reason: 'palette_illegible',
      detail: `${worst.role} on ${worst.ground} is ${worst.ratio.toFixed(2)}:1 against ${worst.floor}:1`,
    };
  }
  return { ok: true, palette };
}

// ── Options ─────────────────────────────────────────────────────────────────

/**
 * The design's answers on the axes the standard document already has.
 *
 * Density, body size, section numbers and justification are deliberately NOT
 * among them. Each changes where a page breaks or what a line says, and a
 * design may change neither: section numbers are printed words, and the two
 * formats that plan their own pages (Market Intelligence and Report Q&A) are
 * calibrated at the standard measure.
 */
export function optionsForVariant(variant: CatalogueVariantDesign): Partial<ReportDesignOptions> {
  const t = variant.table;
  return {
    // Striped statements band their rows; unstriped and grid tables are ruled
    // top and bottom with hairlines between, and the layer adds the grid.
    tableStyle: t.stripe && !t.doubleRuleTotals ? 'classic' : 'ledger',
    // A band or a bare heading carries no rule of its own; the layer draws the band.
    chapterStyle: variant.sectionKind === 'band' || variant.sectionKind === 'bare' ? 'minimal' : 'classic',
    // The photographic editorial family sets its title low under the picture.
    coverStyle: variant.familyKey === 'luxury_editorial' && variant.cover.ground === 'field' ? 'editorial' : 'title_overlay',
    // Filled cards are the one family that rounds a corner.
    surfaceStyle: variant.radius > 0 ? 'raised' : 'flat',
    showDropCaps: variant.dropCap,
  };
}

/** The house cover title, in points, that `coverTitlePt` is measured against. */
const HOUSE_COVER_TITLE_PT = 41;

function layerForVariant(variant: CatalogueVariantDesign | null, type: DesignTypography): TemplateDesignLayer {
  const { typography, fit, displayItalic } = type;
  if (!variant) {
    return {
      typography, fit, displayItalic,
      coverGround: 'field', coverFrame: false, coverTitleScale: fit.cover,
      rail: false, sectionKind: null, table: null, radius: 0,
    };
  }
  const scale = variant.coverTitlePt / HOUSE_COVER_TITLE_PT;
  return {
    typography,
    fit,
    displayItalic,
    coverGround: variant.cover.ground,
    coverFrame: variant.cover.frame,
    // Clamped both ways: a research note's 14pt masthead is not a cover title
    // on a document built around one, and a Swiss 52pt title on a long address
    // would wrap into the masthead. Then fitted, so a wider cover face does not
    // take a longer line than the standard cover's fit classes were set for.
    coverTitleScale: Number((Math.min(1.2, Math.max(0.62, scale)) * fit.cover).toFixed(3)),
    rail: variant.rail,
    sectionKind: variant.sectionKind,
    table: variant.table,
    radius: variant.radius,
  };
}

// ── Resolution ──────────────────────────────────────────────────────────────

function labelFor(variant: CatalogueVariantDesign, colourway: ApprovedColourway | null, isDefault: boolean): string {
  const base = `${variant.familyName} — ${variant.name}`;
  return colourway && !isDefault ? `${base} · ${colourway.name}` : base;
}

/** A catalogue design in one of its family's colourways. */
export function resolveCatalogueDesign(ref: { code: string; colourway?: string | null }): TemplateDesignResult {
  const variant = catalogueDesign(ref.code);
  if (!variant) {
    return { ok: false, reason: 'unknown_design', detail: `no catalogue design "${String(ref.code).slice(0, 20)}"` };
  }
  const fallback = defaultColourwayFor(variant.familyKey);
  const requested = ref.colourway ? findColourway(variant.familyKey, ref.colourway) : null;
  if (ref.colourway && !requested) {
    return { ok: false, reason: 'unknown_design', detail: `"${String(ref.colourway).slice(0, 40)}" is not a ${variant.familyName} colourway` };
  }
  const colourway = requested ?? fallback;
  if (!colourway) return { ok: false, reason: 'unknown_design', detail: `${variant.familyName} has no colourways` };

  const notes: string[] = [];
  const paletteResult = paletteFromTemplateColours(colourwayColors(colourway), notes);
  if (paletteResult.ok === false) return { ok: false, reason: paletteResult.reason, detail: paletteResult.detail };

  const layer = layerForVariant(variant, designTypography(variant.fonts, notes));
  const isDefault = colourway.id === fallback?.id;
  return {
    ok: true,
    design: {
      reference: { kind: 'catalogue', code: variant.code, colourway: isDefault ? null : colourway.id },
      label: labelFor(variant, colourway, isDefault),
      code: variant.code,
      colourwayId: isDefault ? null : colourway.id,
      palette: withDesignLayer(paletteResult.palette, layer),
      options: optionsForVariant(variant),
      layer,
      notes,
    },
  };
}

/** The parts of a `report_templates` row a design is read from. */
export interface TemplateDesignRow {
  id: string;
  name?: string | null;
  /** `schema.tokens`, untrusted. */
  tokens?: unknown;
  /** `config.libraryLineage`, untrusted. */
  lineage?: unknown;
}

/**
 * A template row's own design.
 *
 * Its tokens decide the colours and the faces — a row edited in the Template
 * Builder prints as edited — and its lineage, where it names a catalogue code,
 * decides the cover ground, the rail and the table and heading treatment. A row
 * with no lineage (hand-built, or a voice template) keeps the standard
 * document's structure and takes its colours and faces alone.
 */
export function designFromTemplateRow(row: TemplateDesignRow): TemplateDesignResult {
  const tokens = (row.tokens && typeof row.tokens === 'object' ? row.tokens : {}) as Record<string, unknown>;
  const lineage = (row.lineage && typeof row.lineage === 'object' ? row.lineage : {}) as Record<string, unknown>;
  const notes: string[] = [];

  const paletteResult = paletteFromTemplateColours(tokens.colors, notes);
  if (paletteResult.ok === false) return { ok: false, reason: paletteResult.reason, detail: paletteResult.detail };

  const variant = catalogueDesign(typeof lineage.templateCode === 'string' ? lineage.templateCode : null);
  const fonts = (tokens.fonts && typeof tokens.fonts === 'object' ? tokens.fonts : {}) as Record<string, unknown>;
  const type = designTypography(
    {
      display: fonts.display ?? variant?.fonts.display,
      heading: fonts.heading ?? variant?.fonts.heading,
      body: fonts.body ?? variant?.fonts.body,
      mono: fonts.mono ?? variant?.fonts.mono,
    },
    notes,
  );
  const layer = layerForVariant(variant, type);
  const colourwayId = typeof lineage.colourway === 'string' && lineage.colourway ? lineage.colourway : null;
  const name = String(row.name ?? '').trim();
  return {
    ok: true,
    design: {
      reference: { kind: 'template', templateId: row.id },
      label: name || (variant ? `${variant.familyName} — ${variant.name}` : 'Chosen template'),
      code: variant?.code ?? null,
      colourwayId,
      palette: withDesignLayer(paletteResult.palette, layer),
      options: variant ? optionsForVariant(variant) : {},
      layer,
      notes,
    },
  };
}

// ── References on the wire ──────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[a-z]{2}-\d{2}$/;
const COLOURWAY = /^[a-z]{2}-[a-z0-9-]{1,60}$/;

/**
 * Read a design reference from a request body or a stored selection.
 *
 * Accepts `{ code, colourway? }` or `{ templateId }` and nothing else. A value
 * that is present and malformed is refused rather than ignored, so a caller
 * that meant to ask for a design is told it did not, instead of silently
 * receiving the standard document. Absent is `null`: no design was asked for.
 *
 * A code that is well formed but not in the catalogue is NOT malformed: it is
 * a design that was retired, or a stored choice that outlived it. It is read
 * as a reference, and resolving it draws the standard document with the
 * `unknown_design` echo, because a design is never worth the document.
 */
export function readTemplateDesignReference(
  raw: unknown,
): { ok: true; reference: TemplateDesignReference | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, reference: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'design must be an object' };
  const r = raw as Record<string, unknown>;
  if (r.templateId !== undefined && r.templateId !== null) {
    const id = String(r.templateId).trim();
    if (!UUID.test(id)) return { ok: false, error: 'design.templateId must be a uuid' };
    return { ok: true, reference: { kind: 'template', templateId: id.toLowerCase() } };
  }
  if (r.code !== undefined && r.code !== null) {
    const code = String(r.code).trim().toLowerCase();
    if (!CODE.test(code)) return { ok: false, error: 'design.code is not a catalogue code' };
    const colourwayRaw = r.colourway === undefined || r.colourway === null || r.colourway === ''
      ? null : String(r.colourway).trim().toLowerCase();
    if (colourwayRaw !== null && !COLOURWAY.test(colourwayRaw)) {
      return { ok: false, error: 'design.colourway is not a colourway id' };
    }
    return { ok: true, reference: { kind: 'catalogue', code, colourway: colourwayRaw } };
  }
  return { ok: false, error: 'design must name a code or a templateId' };
}

// ── Applying a design to a renderer's input ─────────────────────────────────

/**
 * A renderer's options with a design's laid over them.
 *
 * With no design, the options are returned exactly as given — the same value
 * every renderer passed before designs existed, so a standard document is
 * byte for byte what it was. With one, the design's answers win on the axes it
 * has an answer for and everything else is the caller's.
 */
export function withDesignOptions(
  options: Partial<ReportDesignOptions> | null | undefined,
  design: ReportTemplateDesign | null | undefined,
): Partial<ReportDesignOptions> | null {
  if (!design) return options ?? null;
  return { ...(options ?? {}), ...design.options };
}
