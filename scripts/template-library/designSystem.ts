/**
 * NPC Services Design System — the report-template layer.
 *
 * ## Why this file exists
 *
 * The catalogue carries a `style` axis — corporate, editorial, minimal, luxury,
 * technical — and until now it was metadata with no visual consequence. Every
 * one of the forty templates rendered in Helvetica at 17pt/9.5pt on white paper
 * with a coloured rule, so a user who filtered the library to "editorial" got
 * back documents indistinguishable from "technical". The taxonomy lied.
 *
 * This module makes `style` structural. Each value becomes a **voice**: a
 * complete, opinionated set of paper, ink, display face, rule weight and
 * rhythm. Two templates with different styles now look different at a glance,
 * across the room, at thumbnail size.
 *
 * ## Where the colours come from
 *
 * Nothing here is invented. Every value is the hex form of a token already in
 * the NPC Services Design System (`tokens/colors.css`, expressed there as HSL
 * triplets for the web app). The report layer needs hex because a template's
 * `tokens.colors` map is consumed by print renderers — WeasyPrint, jsPDF and
 * the library's SVG thumbnail — none of which resolve the app's CSS variables.
 *
 * Keeping the two in lockstep is the point: a report and the dashboard that
 * generated it are recognisably the same product. When `tokens/colors.css`
 * moves, `BRAND` moves with it.
 *
 * ## The signature
 *
 * The design system names the brand's own signature explicitly: the wide
 * uppercase eyebrow (`--tracking-eyebrow: 0.18em`). It was previously used on
 * report covers only. Every voice here carries it onto every section heading,
 * so a reader eleven pages into a dossier always knows which section they are
 * in — structure that encodes something true about the document rather than
 * decorating it.
 *
 * ## Contract
 *
 * These hexes are TOKEN DEFINITIONS — the values `token:primary` and friends
 * resolve to before an organisation overrides them. They are the one place in
 * the system a literal colour is correct. Blocks must keep referencing colours
 * symbolically (`token:*`), which is what keeps `isBrandSafe()` true and lets
 * the white-label pipeline re-skin a template completely.
 */
/* eslint-disable no-restricted-syntax --
 * Token DEFINITIONS. See the contract note above.
 */
import { googleFontsCssUrl } from '../../src/lib/reportTemplate/fontCatalog';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Brand constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The NPC palette in hex.
 *
 * Each entry names the `tokens/colors.css` custom property it is derived from,
 * so the two can be diffed by eye when either moves.
 */
import {
  PRINT_SMALL_TYPE_CONTRAST,
  toPrintContrast,
} from '../../supabase/functions/_shared/templateColourways.pure';

export const BRAND = {
  /** `--foreground` 34 20% 16% — body text. Warm graphite, never pure black. */
  ink: '#312A21',
  /** `--aurixa-obsidian` 34 20% 12% — cover fields and dark panels. */
  obsidian: '#251F18',
  /** `--background` 42 54% 96% — warm ivory. The house paper stock. */
  ivory: '#FAF7EF',
  /** `--card` 42 82% 99% — porcelain. Cooler, brighter paper. */
  porcelain: '#FFFDFA',
  /** `--secondary` 40 54% 93% — sand. Panel fill under the editorial voice. */
  sand: '#F7F0E4',
  /** `--muted` 39 44% 91% — champagne. The default tile and table stripe. */
  champagne: '#F2EBDE',
  /** `--border` 36 30% 81% — soft beige. Hairlines and table borders. */
  beige: '#DDD1C0',
  /** `--muted-foreground` 33 14% 38% — stone. Labels, captions, footers. */
  stone: '#6E6253',
  /** `--brand` 43 74% 49% — the NPC gold. Category A: tenants may override. */
  gold: '#D9A521',
  /** `--brand-700` 43 74% 38% — deep gold, for type that must pass contrast. */
  goldDeep: '#A98019',
  /** `--brand-100` 43 74% 90% — pale gold panel fill. */
  goldPale: '#F8EED3',
  /** `--brand-950` 43 74% 17% — bronze. The compliance accent. */
  bronze: '#4B390B',
  /** `--primary` (light) 262 66% 46% — amethyst. Leads the market voice. */
  amethyst: '#6128C3',
  /** `--accent` 268 58% 54% — orchid. Client-facing forms. */
  orchid: '#8546CE',
  /** `--info` 200 98% 39% — the comparison accent. */
  info: '#0284C5',
  /** `--success` at 32% L — a print-weight green. The screen value (45% L) is
   *  too bright to sit under 9pt type on paper. */
  evergreen: '#188C42',
  /** `--destructive` at 42% L — print-weight red for negative figures. */
  crimson: '#C51111',
  /** Paper white. Used only by the minimal voice, which wants no warmth. */
  white: '#FFFFFF',
  /** A cool near-white for the technical voice's panels. */
  slate: '#EEF1F4',
} as const;

/** The standard front-of-report disclaimer. Legal copy — do not reword. */
export const STANDARD_DISCLAIMER =
  'This report has been prepared for the named recipient only and is general in nature. '
  + 'It does not take into account any person\'s objectives, financial situation or needs, '
  + 'and it is not financial product, credit, tax or legal advice. Figures are estimates '
  + 'based on information available at the date of preparation and are not a guarantee of '
  + 'future performance. Obtain your own professional advice before acting on it.';

// ─────────────────────────────────────────────────────────────────────────────
// 2. Accents — what the document is about
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The chromatic families, one per subject area.
 *
 * Voice sets the typography and the paper; accent sets the colour. Splitting
 * them this way is what lets forty documents stay coherent without becoming
 * forty copies of each other: a suburb market study and an AML verification
 * record share a typographic system but are never mistaken for one another on
 * a shelf.
 *
 * Every value is a Category A or Category B token from the design system. No
 * accent is invented for the sake of variety.
 */
export const ACCENTS = {
  /** Investment analysis — the house colour. */
  gold: { primary: BRAND.gold, onPrimary: BRAND.obsidian, wash: BRAND.goldPale },
  /** Suburb, postcode and statewide market work. */
  amethyst: { primary: BRAND.amethyst, onPrimary: '#FFFFFF', wash: '#F1EAFB' },
  /** Side-by-side comparison. */
  info: { primary: BRAND.info, onPrimary: '#FFFFFF', wash: '#E7F3FA' },
  /** Cash flow and projection. */
  evergreen: { primary: BRAND.evergreen, onPrimary: '#FFFFFF', wash: '#E8F5ED' },
  /** Client-facing forms and fact finds. */
  orchid: { primary: BRAND.orchid, onPrimary: '#FFFFFF', wash: '#F4EDFC' },
  /** Compliance, audit and governance. */
  bronze: { primary: BRAND.bronze, onPrimary: '#FFFFFF', wash: '#F0EADC' },
} as const;

export type AccentName = keyof typeof ACCENTS;

/**
 * The accent a category gets when a template does not choose one.
 *
 * Derived from the catalogue's own `TemplateLibraryCategory` union, so adding a
 * category without deciding its colour is a type error rather than a silent
 * fallback to gold.
 */
export const CATEGORY_ACCENT: Record<string, AccentName> = {
  investment: 'gold',
  suburb: 'amethyst',
  postcode: 'amethyst',
  statewide: 'amethyst',
  comparison: 'info',
  cash_flow: 'evergreen',
  client_form: 'orchid',
  compliance: 'bronze',
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Voices — how the document speaks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A voice is everything about a template's look that is not its accent colour.
 *
 * `display` and `body` are resolved to loadable `@font-face` declarations by
 * `voiceFontFaces()`, so a template that names Fraunces actually renders in
 * Fraunces rather than falling back to the engine default.
 */
export interface Voice {
  /** Matches `TemplateLibraryStyle`. */
  id: 'corporate' | 'editorial' | 'minimal' | 'luxury' | 'technical';
  /** The studio name. Used in docs and the design-system pane, not in output. */
  label: string;
  /** One line on what this voice is for. */
  intent: string;

  /** Heading / display face. */
  display: string;
  /** Body face. */
  body: string;
  /** Figure face where a voice sets numbers apart. */
  mono?: string;
  /**
   * Generic family the display face falls back to.
   *
   * Not cosmetic. `tokens.fonts.heading` compiles to `font-family:` with no
   * generic appended, so a webfont that fails to load — a blocked `@import`, an
   * offline render, a slow CDN — falls through to the engine default, which is
   * a serif. A sans voice would silently print in Times. Naming the generic
   * makes the failure mode the right shape.
   */
  displayGeneric: 'serif' | 'sans-serif';
  /** Generic family the body face falls back to. */
  bodyGeneric: 'serif' | 'sans-serif';

  /** Page stock. */
  surface: string;
  /** Cover field and any full-bleed dark panel. */
  field: string;
  /** Tile fill and table stripe. Overridden by the accent wash where stated. */
  panel: string;
  /** Hairlines, table borders, footer rules. */
  line: string;

  /** Section-heading size in points. */
  headingSize: number;
  /** Body copy size in points. */
  bodySize: number;
  /** Cover title size in points. */
  coverSize: number;
  /** Eyebrow size in points. */
  eyebrowSize: number;

  /** Section-rule weight in points. */
  ruleWeight: number;
  /** Section-rule style. */
  ruleStyle: 'solid' | 'double';
  /**
   * Rule width as a fraction of the content column. A short stub reads as a
   * deliberate mark; a full rule reads as a division. Voices differ on which
   * they want.
   */
  ruleSpan: number;
  /** Whether the section rule takes the accent or the hairline colour. */
  ruleColor: 'accent' | 'line';

  /** Corner radius scale, in points. Print wants far less than screen. */
  radii: { sm: number; md: number };
  /** Baseline gutter. Editorial buys its air here. */
  gutter: number;
  /** Extra leading between flowed blocks, in points. */
  rhythm: number;
  /** Whether the panel fill follows the accent wash instead of the voice's. */
  panelFollowsAccent: boolean;
}

/**
 * The five voices.
 *
 * Each one is anchored to a real document from the property-advisory world
 * rather than to a generic adjective, which is what keeps them from collapsing
 * back into the same page with a different colour.
 */
export const VOICES: Record<Voice['id'], Voice> = {
  /**
   * Chancery — the letter of advice and the signed valuation.
   *
   * Playfair Display is one of the two faces the product already ships (see the
   * design system's `assets/fonts/`), so the cover of a report matches the
   * certificate the same client was issued last month. Near-zero radii: this
   * document is meant to read as an instrument, not a card.
   */
  corporate: {
    id: 'corporate',
    label: 'Chancery',
    intent: 'Board-ready and signed. The document that gets filed.',
    display: 'Playfair Display',
    body: 'Inter',
    displayGeneric: 'serif',
    bodyGeneric: 'sans-serif',
    surface: BRAND.porcelain,
    field: BRAND.obsidian,
    panel: BRAND.champagne,
    line: BRAND.beige,
    headingSize: 18,
    bodySize: 9.5,
    coverSize: 40,
    eyebrowSize: 8,
    ruleWeight: 1.5,
    ruleStyle: 'solid',
    ruleSpan: 1,
    ruleColor: 'accent',
    radii: { sm: 2, md: 3 },
    gutter: 16,
    rhythm: 0,
    panelFollowsAccent: false,
  },

  /**
   * Broadsheet — the market feature.
   *
   * Fraunces is a variable optical-size serif with a slightly wonky, warm cut;
   * it carries a long read the way Playfair cannot. This voice buys air rather
   * than ornament: bigger headings, more gutter, and a hairline rule in beige
   * instead of a coloured one. The accent survives only in the type.
   */
  editorial: {
    id: 'editorial',
    label: 'Broadsheet',
    intent: 'Market narrative that earns a long read.',
    display: 'Fraunces',
    body: 'Inter',
    displayGeneric: 'serif',
    bodyGeneric: 'sans-serif',
    surface: BRAND.ivory,
    field: BRAND.obsidian,
    panel: BRAND.sand,
    line: BRAND.beige,
    headingSize: 21,
    bodySize: 9.75,
    coverSize: 44,
    eyebrowSize: 8,
    ruleWeight: 0.6,
    ruleStyle: 'solid',
    ruleSpan: 1,
    ruleColor: 'line',
    radii: { sm: 0, md: 0 },
    gutter: 22,
    rhythm: 6,
    panelFollowsAccent: false,
  },

  /**
   * Slip — the one-page snapshot.
   *
   * One face, no serif, pure white stock, and the smallest type in the system.
   * The single bold mark on the page is a short accent stub under each heading.
   * Restraint here is precision, not absence: a snapshot that reads as spare is
   * doing its job.
   */
  minimal: {
    id: 'minimal',
    label: 'Slip',
    intent: 'One page, read in ninety seconds, nothing spare.',
    display: 'Inter',
    body: 'Inter',
    displayGeneric: 'sans-serif',
    bodyGeneric: 'sans-serif',
    surface: BRAND.white,
    field: BRAND.ink,
    panel: '#F5F3EF',
    line: '#E4E0D8',
    headingSize: 15.5,
    bodySize: 9.5,
    coverSize: 34,
    eyebrowSize: 7.5,
    ruleWeight: 2.5,
    ruleStyle: 'solid',
    ruleSpan: 0.11,
    ruleColor: 'accent',
    radii: { sm: 4, md: 5 },
    gutter: 14,
    rhythm: 0,
    panelFollowsAccent: false,
  },

  /**
   * Marque — the private-client and off-market brief.
   *
   * Cinzel is the product's other shipped face: engraved Roman capitals, drawn
   * from inscriptional lettering. It is wrong for body copy and exactly right
   * for the one line on a cover that has to feel like it was commissioned. The
   * panel follows the accent wash so premium documents read tonally rather than
   * in blocks of neutral grey.
   */
  luxury: {
    id: 'luxury',
    label: 'Marque',
    intent: 'Private client. Commissioned, not generated.',
    display: 'Cinzel',
    body: 'Inter',
    displayGeneric: 'serif',
    bodyGeneric: 'sans-serif',
    surface: BRAND.ivory,
    field: BRAND.obsidian,
    panel: BRAND.goldPale,
    line: BRAND.beige,
    headingSize: 17,
    bodySize: 9.5,
    coverSize: 34,
    eyebrowSize: 8,
    ruleWeight: 0.75,
    ruleStyle: 'double',
    ruleSpan: 1,
    ruleColor: 'accent',
    radii: { sm: 0, md: 0 },
    gutter: 20,
    rhythm: 4,
    panelFollowsAccent: true,
  },

  /**
   * Cadastre — the feasibility model and the comparison matrix.
   *
   * Public Sans is the US federal design system's face: drawn for forms and
   * tables, legible at 9pt, with no personality to get in the way of a number.
   * IBM Plex Mono sets the figures, which is the one place in this system where
   * a monospace face earns its keep — a ten-year projection is only readable if
   * the columns line up.
   */
  technical: {
    id: 'technical',
    label: 'Cadastre',
    intent: 'Dense data. The columns have to line up.',
    display: 'Public Sans',
    body: 'Public Sans',
    mono: 'IBM Plex Mono',
    displayGeneric: 'sans-serif',
    bodyGeneric: 'sans-serif',
    surface: BRAND.porcelain,
    field: BRAND.obsidian,
    panel: BRAND.slate,
    line: '#D5DCE3',
    headingSize: 16,
    bodySize: 9,
    coverSize: 36,
    eyebrowSize: 7.5,
    ruleWeight: 1,
    ruleStyle: 'solid',
    ruleSpan: 1,
    ruleColor: 'line',
    radii: { sm: 2, md: 2 },
    gutter: 14,
    rhythm: 0,
    panelFollowsAccent: false,
  },
};

export type VoiceId = Voice['id'];

// ─────────────────────────────────────────────────────────────────────────────
// 4. Compiling a voice + accent into template tokens
// ─────────────────────────────────────────────────────────────────────────────

/** The colour roles every block in the catalogue references symbolically. */
export interface VoiceColors extends Record<string, string> {
  /** The accent. Headings, rules, table headers, KPI values. */
  primary: string;
  /** Cover field. Also the fallback dark surface. */
  bg: string;
  /** Page stock. */
  surface: string;
  /** Tile fill and table stripe. */
  panel: string;
  /** Type on the cover field. */
  text: string;
  /** Body type on paper. */
  ink: string;
  /** Labels, captions, footers. */
  muted: string;
  /**
   * `muted` at the contrast small type needs — footers, page numbers, KPI
   * labels, captions. REPORT_RULES §2 puts the floor at 7:1 below 14pt, and
   * `BRAND.stone` (#6E6253) on ivory measures 5.55:1. Derived rather than
   * substituted, so the approved brand value keeps its own meaning.
   */
  mutedInk: string;
  /** `muted` where it sets on the cover field rather than on paper. */
  mutedOnField: string;
  /**
   * `primary` at the contrast small type needs — the eyebrow, which the voices
   * set between 7 and 8pt. The brand file already carries `goldDeep`
   * "for type that must pass contrast"; this is the same idea generalised to
   * whichever accent the template is built in.
   */
  accentInk: string;
  /** `primary` where it sets on the cover field rather than on paper. */
  accentOnField: string;
  /** Type on an accent fill. */
  onPrimary: string;
  /** Hairlines. Added by this design system; blocks reference `token:line`. */
  line: string;
  /** Affirmative semantic fill — strengths, pass, on-track. Fixed by design
   *  (Category B): it must not follow a tenant's brand colour. */
  positive: string;
  /** Cautionary semantic fill — watch points, review required. Deep gold
   *  rather than a screen orange, which fought every palette it landed in. */
  caution: string;
  /** Negative figures in a financial table. `--destructive` at 42% L: the
   *  screen red (60% L) greys out under 7pt type on paper, and in a cash-flow
   *  matrix the sign is the most-read thing on the page. */
  negative: string;
}

/**
 * Font faces for a voice, as loadable Google Fonts stylesheets.
 *
 * `tokensToFontFaceCss()` turns each `cssUrl` into an `@import`, which is what
 * makes the family actually available to WeasyPrint. Without this the template
 * names a font and silently renders in the engine default — the exact failure
 * `ensureCatalogFontFaces()` exists to prevent for imported templates.
 */
export function voiceFontFaces(voice: Voice): Array<{ family: string; cssUrl: string }> {
  const families = [voice.display, voice.body, ...(voice.mono ? [voice.mono] : [])];
  const seen = new Set<string>();
  return families
    .filter((family) => {
      const key = family.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((family) => ({ family, cssUrl: googleFontsCssUrl(family) }));
}

/** Colour roles for a voice under a given accent. */
export function voiceColors(voice: Voice, accent: AccentName): VoiceColors {
  const a = ACCENTS[accent];
  return {
    primary: a.primary,
    bg: voice.field,
    surface: voice.surface,
    panel: voice.panelFollowsAccent ? a.wash : voice.panel,
    text: BRAND.ivory,
    ink: BRAND.ink,
    muted: BRAND.stone,
    mutedInk: toPrintContrast(BRAND.stone, voice.surface, PRINT_SMALL_TYPE_CONTRAST),
    mutedOnField: toPrintContrast(BRAND.stone, voice.field, PRINT_SMALL_TYPE_CONTRAST),
    accentInk: toPrintContrast(a.primary, voice.surface, PRINT_SMALL_TYPE_CONTRAST),
    accentOnField: toPrintContrast(a.primary, voice.field, PRINT_SMALL_TYPE_CONTRAST),
    onPrimary: a.onPrimary,
    line: voice.line,
    positive: BRAND.evergreen,
    caution: BRAND.goldDeep,
    negative: BRAND.crimson,
  };
}

/** The full `tokens` object for a template built in this voice and accent. */
export function voiceTokens(voice: Voice, accent: AccentName) {
  return {
    colors: voiceColors(voice, accent),
    fonts: {
      heading: `${voice.display}, ${voice.displayGeneric}`,
      body: `${voice.body}, ${voice.bodyGeneric}`,
      ...(voice.mono ? { mono: `${voice.mono}, monospace` } : {}),
    },
    spacing: {
      gutter: voice.gutter,
      sectionGap: voice.gutter + 8,
      padding: 24,
    },
    radii: { sm: voice.radii.sm, md: voice.radii.md, lg: voice.radii.md + 2 },
    /**
     * Emitted as `--text-*` custom properties. Not read by the block renderers,
     * which take explicit point sizes, but it documents the voice's scale for
     * anyone editing a copy of the template in the Builder.
     */
    typeScale: {
      eyebrow: voice.eyebrowSize,
      body: voice.bodySize,
      heading: voice.headingSize,
      cover: voice.coverSize,
    },
    fontFaces: voiceFontFaces(voice),
  };
}

/** Look up a voice by its `style` value. */
export function voiceFor(style: VoiceId): Voice {
  return VOICES[style];
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Running heads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The eyebrow that sits above every section heading, by category.
 *
 * This is the *document*, not the section — "Investment analysis" above
 * "Executive summary". It follows the pattern the design system's own
 * `guidelines/type-eyebrow.card.html` sets out, where the eyebrow gives context
 * and the title names the specific thing ("DEAL COMMAND CENTRE" / "Deal
 * Pipeline").
 *
 * Naming the document on every page is what a running head is for: it tells a
 * reader holding one loose page of a ten-page dossier what they are holding.
 * The footer carries the subject and the client, so the two do not overlap.
 */
export const RUNNING_HEAD: Record<string, string> = {
  investment: 'Investment analysis',
  suburb: 'Suburb market study',
  postcode: 'Postcode analysis',
  statewide: 'Statewide market review',
  comparison: 'Comparative analysis',
  cash_flow: 'Cash flow analysis',
  client_form: 'Client record',
  compliance: 'Compliance record',
};

export function runningHeadFor(category: string): string {
  const head = RUNNING_HEAD[category];
  // Throwing rather than returning '' is deliberate. An unknown category used
  // to mean "no eyebrow", which is indistinguishable from a template that
  // wanted none — and that is exactly how a mis-wired category once silently
  // removed the running head from the flagship report.
  if (!head) throw new Error(`No running head for category "${category}"`);
  return head;
}
