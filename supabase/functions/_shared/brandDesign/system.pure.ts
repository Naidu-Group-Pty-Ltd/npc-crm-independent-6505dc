/**
 * A brand design system, as a shape.
 *
 * ## What one is
 *
 * A name, a brand colour, and a full set of `ReportDesignOptions`. That is the
 * whole surface — deliberately, because it is exactly the surface the report
 * design system already reads. A brand design system is therefore not a new
 * rendering path; it is a *saved position* on the one that already exists, so
 * every document in the programme picks it up for free and nothing has to be
 * re-implemented per format.
 *
 * ## The model proposes, the system disposes
 *
 * A design system can be authored by a person filling in the form, or drafted
 * by Claude from a brief ("a boutique buyers' agency, warm and editorial"). In
 * both cases the palette is **derived, never stored**:
 * `resolveReportPalette` re-computes `accentOnPaper` and `accentOnField`
 * against the worst ground each is legal on, and `auditPaletteContrast` then
 * checks every ink role against every ground it may print on.
 *
 * This matters more for a generated system than an authored one. A model asked
 * for "warm sandstone" will happily return `#D8C9A8`, which is a perfectly
 * pleasant colour and 1.6:1 on ivory paper — an eyebrow nobody can read. The
 * generated value is treated as a *request for a hue*, not as a decision about
 * legibility, and the audit is a gate rather than a warning: a system that
 * cannot clear its floors is refused, with the failing roles named.
 *
 * ## Why the palette is not a column
 *
 * Storing the resolved palette would freeze it against the preset it was
 * derived under. Presets change the paper grounds — `minimal_ink` has a
 * champagne `paperAlt` where `signature` has ivory — and a stored
 * `accentOnPaper` derived against one is not legal on the other. That exact bug
 * is recorded in `brandResolve.pure.ts`. So the row stores the *inputs* and the
 * palette is resolved at render time, every time.
 */
import {
  auditPaletteContrast,
  readReportNeutrals,
  type ReportNeutrals,
  type ReportPreset,
  resolveReportPalette,
} from '../reportDesign/brandResolve.pure.ts';
import type { ResolvedReportPalette } from '../reportDesign/roles.pure.ts';
import {
  DEFAULT_REPORT_DESIGN_OPTIONS,
  normalizeReportDesignOptions,
  type ReportDesignOptions,
} from '../reportDesign/options.pure.ts';

/** A design system as it is stored and edited. */
export interface BrandDesignSystem {
  /** Shown in the picker. */
  name: string;
  /** Stable, url-safe, unique per tenant. Derived from the name. */
  slug: string;
  /** One or two sentences on when to reach for it. */
  description: string;
  /** `#RRGGBB`. Null means the house brand. */
  brandHex: string | null;
  options: ReportDesignOptions;
  /**
   * The document's own paper and ink, when it has some.
   *
   * Null for everything authored in the form or drafted from a brief — those
   * take their grounds from `options.preset`, as they always have. Non-null
   * only for a system imported from a design system's token file, which brings
   * a real stock the four presets cannot express.
   *
   * It is deliberately *not* in `BRAND_SYSTEM_JSON_SCHEMA`: a model choosing
   * seven interdependent greys against four contrast floors is a worse
   * proposition than a model choosing one accent hue, and the import path
   * already produces these from values a designer set.
   */
  neutrals: ReportNeutrals | null;
  /**
   * How this system came to exist.
   *
   * Recorded because a generated system and an authored one deserve different
   * scrutiny on review, and because "which of these did the model write?" is
   * otherwise unanswerable once they are all sitting in the same list.
   * `imported` is the third: it came from a design system somebody published,
   * and its paper and ink are that system's rather than ours.
   */
  origin: BrandSystemOrigin;
  /** The brief, when one was given. Kept so a system can be regenerated. */
  brief: string;
  /**
   * The design system it was imported from — `_ds_manifest.json`'s `namespace`.
   *
   * Empty unless `origin` is `imported`. Kept so a re-import can be recognised
   * as an update to the same system rather than a second copy of it.
   */
  sourceNamespace: string;
}

export type BrandSystemOrigin = 'authored' | 'generated' | 'imported';

const ORIGINS: readonly BrandSystemOrigin[] = ['authored', 'generated', 'imported'];

/** What the audit found. Empty `problems` is the only shippable state. */
export interface BrandSystemAudit {
  ok: boolean;
  palette: ResolvedReportPalette;
  problems: Array<{ role: string; ground: string; ratio: number; floor: number }>;
}

export const MAX_NAME_CHARS = 80;
export const MAX_DESCRIPTION_CHARS = 400;
export const MAX_BRIEF_CHARS = 2_000;

const HEX = /^#[0-9A-Fa-f]{6}$/;
const PRESETS: readonly ReportPreset[] = [
  'signature',
  'editorial_navy',
  'minimal_ink',
  'high_contrast',
];

/** `Warm Editorial` → `warm-editorial`. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    || 'design-system';
}

const text = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Read anything into a design system, or say why not.
 *
 * The same reader for a form submission and a model's JSON, which is the point:
 * a value the model invented and a value a person typed reach the palette
 * through identical validation, so there is one place where "what is a legal
 * design system" is decided.
 */
export function readBrandDesignSystem(raw: unknown): { ok: true; system: BrandDesignSystem } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'design system must be an object' };
  const r = raw as Record<string, unknown>;

  const name = text(r.name, MAX_NAME_CHARS);
  if (name.length < 2) return { ok: false, error: 'a design system needs a name' };

  const rawHex = typeof r.brandHex === 'string' ? r.brandHex.trim() : '';
  // A malformed hex is refused rather than silently ignored. Falling back to
  // the house brand would hand somebody a document in the wrong colour and no
  // indication of why.
  if (rawHex && !HEX.test(rawHex)) {
    return { ok: false, error: `brandHex must be #RRGGBB, got "${rawHex.slice(0, 16)}"` };
  }

  const presetRaw = typeof r.preset === 'string' ? r.preset : '';
  const optionsRaw = (r.options && typeof r.options === 'object' ? r.options : {}) as Record<string, unknown>;
  // The preset may arrive at the top level (the model's natural shape) or
  // inside `options` (the form's). Both are accepted; `options` wins.
  const merged = {
    ...DEFAULT_REPORT_DESIGN_OPTIONS,
    ...(PRESETS.includes(presetRaw as ReportPreset) ? { preset: presetRaw as ReportPreset } : {}),
    ...optionsRaw,
  };

  return {
    ok: true,
    system: {
      name,
      slug: text(r.slug, 60) ? slugify(text(r.slug, 60)) : slugify(name),
      description: text(r.description, MAX_DESCRIPTION_CHARS),
      brandHex: rawHex ? rawHex.toUpperCase() : null,
      options: normalizeReportDesignOptions(merged),
      // All seven or none — a half-read neutral set prints somebody else's
      // obsidian cover on our ivory. See `readReportNeutrals`.
      neutrals: readReportNeutrals(r.neutrals),
      origin: ORIGINS.includes(r.origin as BrandSystemOrigin)
        ? r.origin as BrandSystemOrigin
        : 'authored',
      brief: text(r.brief, MAX_BRIEF_CHARS),
      sourceNamespace: text(r.sourceNamespace, 120),
    },
  };
}

/**
 * Resolve the palette and check every ink role against every ground.
 *
 * `resolveReportPalette` already corrects the two accent roles, so a system
 * that fails here is one whose *neutrals* are wrong — which only happens if a
 * preset is added without its grounds being checked. Running the audit anyway
 * costs nothing and is what turns "we derive contrast correctly" from a claim
 * into something the route can refuse on.
 */
export function auditBrandDesignSystem(system: BrandDesignSystem): BrandSystemAudit {
  const palette = resolveReportPalette({
    preset: system.options.preset,
    brandHex: system.brandHex,
    // Imported grounds go through the same audit as everything else. That is
    // the whole reason this parameter exists here rather than in the renderer:
    // a design system whose own stock makes its own body ink illegible is
    // refused at save time, not discovered in a client's PDF.
    neutrals: system.neutrals,
  });
  const problems = auditPaletteContrast(palette);
  return { ok: problems.length === 0, palette, problems };
}

/** A one-line summary of an audit failure, for a toast or a log line. */
export function describeAuditProblems(
  problems: BrandSystemAudit['problems'],
): string {
  if (!problems.length) return '';
  const worst = [...problems].sort((a, b) => a.ratio - b.ratio)[0];
  const others = problems.length - 1;
  return `${worst.role} on ${worst.ground} is ${worst.ratio.toFixed(2)}:1 against a floor of `
    + `${worst.floor.toFixed(1)}:1${others ? `, and ${others} other ${others === 1 ? 'role' : 'roles'} fail too` : ''}`;
}

/**
 * The JSON shape the model is asked for.
 *
 * Kept here rather than in the edge function so the prompt and the reader
 * cannot drift: the function that validates the response and the schema that
 * requests it are the same module. Every field is optional to the *model* —
 * `readBrandDesignSystem` fills defaults — because a model that omits
 * `justifyText` should produce a design system, not an error.
 */
export const BRAND_SYSTEM_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'brandHex', 'options'],
  properties: {
    name: { type: 'string', description: 'Two to four words. No trailing "Design System".' },
    description: { type: 'string', description: 'One sentence on when to reach for it.' },
    brandHex: { type: 'string', description: '#RRGGBB. The accent hue. Contrast is corrected downstream, so choose for character rather than legibility.' },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        preset: { type: 'string', enum: PRESETS },
        density: { type: 'string', enum: ['compact', 'balanced', 'spacious'] },
        chapterStyle: { type: 'string', enum: ['classic', 'opener_band', 'minimal'] },
        tableStyle: { type: 'string', enum: ['classic', 'ledger', 'minimal'] },
        coverStyle: { type: 'string', enum: ['image', 'title_overlay', 'editorial'] },
        bodyScale: { type: 'number', description: '85 to 115.' },
        visualIntensity: { type: 'number', description: '0 to 100.' },
        showDropCaps: { type: 'boolean' },
        showSectionNumbers: { type: 'boolean' },
        justifyText: { type: 'boolean' },
      },
    },
  },
} as const;

/** What the model is told. Pure, so the prompt is diffable and testable. */
export function brandSystemPrompt(brief: string, companyName: string): string {
  return `You are designing a print design system for ${companyName || 'a property advisory firm'}.

The brief:
${brief.slice(0, MAX_BRIEF_CHARS)}

Return one JSON object matching the schema. Notes on the levers, because they
do not mean what their names might suggest elsewhere:

- \`preset\` chooses the neutral grounds, not the accent. \`signature\` is warm
  ivory, \`editorial_navy\` is cooler with a deep field, \`minimal_ink\` is near
  white with a champagne alternate, \`high_contrast\` is the accessible option.
- \`brandHex\` is the accent hue only. Contrast against every ground is
  re-derived downstream and a value that cannot be made legible is rejected, so
  choose for character. Avoid near-white and near-black.
- \`density\` trades page count against breathing room; \`spacious\` on a long
  report adds real pages.
- \`visualIntensity\` drives panel tints and band weight. It never changes type
  colour — an invisible eyebrow is not a style.
- \`showDropCaps\` suits editorial documents and reads as an affectation on a
  financial one.

Choose deliberately and make the description say what the system is *for*.`;
}
