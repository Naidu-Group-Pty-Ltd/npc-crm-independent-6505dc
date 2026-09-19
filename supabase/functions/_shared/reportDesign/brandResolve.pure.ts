/**
 * Resolve a print-ready palette from the design-system defaults, a design
 * preset and a tenant's white-label brand.
 *
 * The layering is strict and the order matters:
 *
 *   0. NPC print defaults (`tokens.pure.ts`, derived from `src/styles/tokens.css`)
 *   1. the preset — **neutral family only** (paper, ink, rule)
 *   2. the tenant's Category A brand colour, with its on-paper and on-field
 *      variants *re-derived* rather than stored
 *   3. Category B semantics, applied last from a frozen constant
 *
 * Step 3 is last on purpose. `PRINT_SEMANTIC` is frozen and there is no
 * parameter through which a caller can reach it, so "a tenant cannot make risk
 * green" is enforced by the shape of this function rather than by review.
 *
 * Pure: no imports beyond sibling `.pure` modules, no I/O.
 */
import { contrastRatio, ensureContrast, relativeLuminanceFromHex } from './color.pure.ts';
import {
  CONTRAST_FLOOR,
  PRINT_BRAND,
  PRINT_INK,
  PRINT_SEMANTIC,
  PRINT_SURFACE,
} from './tokens.pure.ts';
import { INK_LEGALITY, type ResolvedReportPalette } from './roles.pure.ts';

/** Mirrors `PdfDesignPreset` in src/components/reports/premiumPdfDesign.ts. */
export type ReportPreset = 'signature' | 'editorial_navy' | 'minimal_ink' | 'high_contrast';

/**
 * The paper and ink of a document — everything a preset supplies.
 *
 * Named and exported because it is now something a caller can *bring*, not only
 * something a preset name selects. A brand design system imported from a Claude
 * Design project carries its own seven values, derived from that project's
 * token file (`brandDesign/import.pure.ts`), and they arrive here.
 */
export type ReportNeutrals = Pick<
  ResolvedReportPalette,
  'paper' | 'paperAlt' | 'paperBright' | 'field' | 'rule' | 'bodyInk' | 'mutedInk'
>;

/** The seven roles, in one place, so a reader cannot miss one. */
export const NEUTRAL_ROLES = [
  'paper', 'paperAlt', 'paperBright', 'field', 'rule', 'bodyInk', 'mutedInk',
] as const satisfies readonly (keyof ReportNeutrals)[];

/**
 * Neutral families per preset. A preset changes the *paper and ink*, never the
 * brand and never the semantics — so switching preset cannot break a tenant's
 * identity or the meaning of a colour.
 *
 * ## These four are thinner than their names suggest
 *
 * Worth saying plainly, because the names imply more than the values deliver:
 * all four are permutations of the same three `PRINT_SURFACE` constants.
 * `editorial_navy` contains no navy — it is `paperBright` where `signature` has
 * `paper`. That is why an imported design system needs to bring its *own*
 * values rather than being matched to the nearest of these: two genuinely
 * different brands would otherwise land on near-identical documents.
 */
const PRESET_NEUTRALS: Record<ReportPreset, ReportNeutrals> = {
  /** The house look: warm ivory stock, graphite ink, obsidian cover. */
  signature: {
    paper: PRINT_SURFACE.paper,
    paperAlt: PRINT_SURFACE.paperAlt,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_SURFACE.rule,
    bodyInk: PRINT_INK.body,
    mutedInk: PRINT_INK.muted,
  },
  /** Cooler stock throughout — for dense, technical documents. */
  editorial_navy: {
    paper: PRINT_SURFACE.paperBright,
    paperAlt: PRINT_SURFACE.paperAlt,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_SURFACE.rule,
    bodyInk: PRINT_INK.body,
    mutedInk: PRINT_INK.muted,
  },
  /** Maximum restraint: the brightest stock, no warm panel. */
  minimal_ink: {
    paper: PRINT_SURFACE.paperBright,
    paperAlt: PRINT_SURFACE.paper,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_SURFACE.rule,
    bodyInk: PRINT_INK.body,
    mutedInk: PRINT_INK.muted,
  },
  /**
   * Accessibility-first: body ink is pushed to the darkest ground available so
   * the document stays legible when photocopied or faxed, which advisory
   * documents genuinely still are.
   */
  high_contrast: {
    paper: PRINT_SURFACE.paperBright,
    paperAlt: PRINT_SURFACE.paperAlt,
    paperBright: PRINT_SURFACE.paperBright,
    field: PRINT_SURFACE.field,
    rule: PRINT_INK.muted,
    bodyInk: PRINT_SURFACE.field,
    mutedInk: PRINT_INK.body,
  },
};

export interface ResolveReportPaletteInput {
  /** Design preset. Defaults to `signature`. */
  preset?: ReportPreset;
  /**
   * The tenant's brand colour as `#RRGGBB`. Comes from the report's brand
   * snapshot, which normalises `whitelabel_settings` (HSL triplet *or* hex) to
   * hex once, at snapshot time.
   *
   * Omit for the NPC brand.
   */
  brandHex?: string | null;
  /**
   * Paper and ink brought by the caller, replacing the preset's.
   *
   * The one way a document gets grounds this module did not author. It exists
   * for design systems imported from a Claude Design project, whose token file
   * carries a real ivory, porcelain, obsidian and hairline that no permutation
   * of `PRESET_NEUTRALS` can express.
   *
   * Nothing else changes. The accent correction below still runs — now against
   * the *imported* grounds, which is precisely what makes an import safe: a
   * brand colour legible on NPC ivory and illegible on somebody else's stock is
   * corrected for the stock it will actually print on. Category B is still
   * spread last from a frozen constant and is still unreachable from here.
   *
   * Omit — as every one of the nine render routes does — and the preset's
   * neutrals are used, byte for byte as before.
   */
  neutrals?: ReportNeutrals | null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Read a neutral set from a jsonb column, or refuse it entirely.
 *
 * **All seven or none.** A half-read set is the failure worth designing
 * against: a row whose `field` survived and whose `paper` did not would print a
 * document on NPC ivory with somebody else's obsidian cover, which looks like a
 * deliberate choice and is a parse error. Returning `null` sends the caller
 * back to the preset, which is a document that is merely not what was imported.
 */
export function readReportNeutrals(raw: unknown): ReportNeutrals | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out = {} as Record<keyof ReportNeutrals, string>;
  for (const role of NEUTRAL_ROLES) {
    const value = r[role];
    if (typeof value !== 'string' || !HEX.test(value)) return null;
    out[role] = value.toUpperCase();
  }
  return out;
}

/**
 * Build the palette.
 *
 * Category B is spread in last and is not reachable from any input — see the
 * module comment.
 */
export function resolveReportPalette(
  input: ResolveReportPaletteInput = {},
): ResolvedReportPalette {
  const preset = input.preset && input.preset in PRESET_NEUTRALS ? input.preset : 'signature';
  // Brought neutrals win over the preset's, and are read rather than trusted —
  // this value reaches here from a jsonb column. An unreadable set falls back
  // to the preset whole; see `readReportNeutrals`.
  const neutrals = (input.neutrals ? readReportNeutrals(input.neutrals) : null)
    ?? PRESET_NEUTRALS[preset];

  const tenantBrand = typeof input.brandHex === 'string' && HEX.test(input.brandHex)
    ? input.brandHex.toUpperCase()
    : null;

  // Category A. The `on*` variants are always re-derived: storing them is how a
  // tenant ends up with a legible colour on one ground and an illegible one on
  // the other.
  //
  // An ink legal on all three paper grounds has to clear the floor on all
  // three. Deriving against `paper` alone was a real bug: under the
  // `minimal_ink` preset `paper` is porcelain but `paperAlt` is champagne, and a
  // mid-grey tenant brand cleared the first and failed the second.
  //
  // The obvious fix — "correct against the darkest ground" — is right only
  // while the ink is darker than the paper, which was guaranteed while the
  // grounds were ours and stopped being guaranteed when a caller could bring
  // its own. On a dark stock the ground that gives dark type the least contrast
  // is the *lightest* one, and correcting against the darkest moves the colour
  // the wrong way.
  //
  // So: find whichever ground this particular ink reads worst against, correct
  // for that, and check again — because correcting can change which ground is
  // now the worst. It converges in a pass or two and is a no-op for every ink
  // that already clears its floor, which is why the four presets come out
  // byte-identical.
  const paperGrounds = [neutrals.paper, neutrals.paperAlt, neutrals.paperBright];
  const legibleOnPaper = (hex: string, floor: number): string => {
    let out = hex;
    for (let pass = 0; pass < 4; pass += 1) {
      const worst = paperGrounds.reduce((w, ground) =>
        contrastRatio(out, ground) < contrastRatio(out, w) ? ground : w);
      if (contrastRatio(out, worst) >= floor) return out;
      const next = ensureContrast(out, worst, floor);
      if (next === out) return out;
      out = next;
    }
    return out;
  };

  const accentFill = tenantBrand ?? PRINT_BRAND.base;
  const accentOnPaper = legibleOnPaper(
    tenantBrand ?? PRINT_BRAND.onPaper,
    CONTRAST_FLOOR.micro,
  );
  const accentOnField = tenantBrand
    ? ensureContrast(tenantBrand, neutrals.field, CONTRAST_FLOOR.display)
    : PRINT_BRAND.onField;

  // Category B, corrected for the stock it will print on — hue untouched.
  //
  // This used to be a bare spread of `PRINT_SEMANTIC`, and that was right while
  // the grounds were four permutations of three constants we chose. It stopped
  // being right the moment a caller could bring its own paper.
  //
  // The four semantics are tuned to clear 4.5:1 on NPC's darkest stock and they
  // clear it by about a percent — `negative` is 4.58:1 on `#F2EBDE`. So a
  // design system whose panel is *slightly* darker than ours pushes all four
  // under the floor, and the audit refuses the import. It would be refusing it
  // for our calibration rather than for anything the imported system did, and
  // the document that could not be printed would be one where the only problem
  // is that red is a shade too light.
  //
  // `ensureContrast` walks lightness only, preserving hue and saturation, which
  // is the same instrument Category A has always used and for the same stated
  // reason: *storing* a colour derived against one ground is how you get one
  // that is legible on that ground and illegible on another. "A tenant cannot
  // make risk green" is preserved and in fact strengthened — the hue comes from
  // a frozen constant and there is still no input that reaches it. Only the
  // lightness moves, and only far enough to be readable.
  //
  // For all four presets this is a no-op, and `printContrast.spec.ts` asserts
  // that by comparing the result against `PRINT_SEMANTIC` byte for byte.
  const semantic = Object.fromEntries(
    Object.entries(PRINT_SEMANTIC).map(([role, hex]) =>
      [role, legibleOnPaper(hex, CONTRAST_FLOOR.body)]),
  ) as typeof PRINT_SEMANTIC;

  return {
    ...neutrals,
    onFieldInk: PRINT_INK.onField,
    accentFill,
    accentOnPaper,
    accentOnField,
    // Category B — last, hue frozen, unreachable from `input`.
    ...semantic,
  };
}

/**
 * Every way the resolved palette fails its own contract.
 *
 * Returns an empty array for a legal palette. Used by `printContrast.spec.ts`
 * and available at runtime so a render can refuse to ship an illegible
 * document rather than printing one.
 */
export function auditPaletteContrast(
  palette: ResolvedReportPalette,
): Array<{ role: string; ground: string; ratio: number; floor: number }> {
  const problems: Array<{ role: string; ground: string; ratio: number; floor: number }> = [];
  for (const [role, rule] of Object.entries(INK_LEGALITY)) {
    const fg = palette[role as keyof ResolvedReportPalette];
    const floor = CONTRAST_FLOOR[rule.floor];
    for (const ground of rule.grounds) {
      const bg = palette[ground as keyof ResolvedReportPalette];
      const ratio = contrastRatio(fg, bg);
      if (ratio < floor) problems.push({ role, ground, ratio, floor });
    }
  }
  return problems;
}
