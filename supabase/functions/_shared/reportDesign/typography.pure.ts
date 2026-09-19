/**
 * Print typography.
 *
 * ## The constraint that governs everything here
 *
 * **Only faces installed in the WeasyPrint container render.** The application
 * ships no webfonts at all — `src/branding/brand-fonts.ts` is a list of system
 * stacks — so nothing can be inherited from the UI, and a face named here but
 * absent from the image silently falls back to the engine default. That failure
 * is invisible in code review and obvious in a client's hands.
 *
 * ## What this module learned the hard way
 *
 * The previous version of this file named **Cormorant Garamond** and
 * **Fraunces** in its stacks and listed them as installed, on the strength of
 * the Dockerfile's `apt-get install fonts-cormorant-garamond fonts-fraunces`.
 * Neither package exists in Debian — bookworm or trixie — and neither does
 * `fonts-playfair-display` or `fonts-ibm-plex`. `apt-get install -y` exits
 * non-zero on an unknown package, so that `RUN` layer fails and **the image
 * could not be built at all**. The contract was never checked, so nothing said
 * so.
 *
 * `fonts-ibm-plex` survived the first attempt at this fix because it is a
 * Debian *source* package name: packages.debian.org serves a page for it, so a
 * website check reads it as available. Only the binary index disagrees. Verify
 * against `dists/<release>/main/binary-amd64/Packages.gz`.
 *
 * It is checked now. `CONTAINER_FONT_PACKAGES` and `CONTAINER_FONT_FILES` are
 * the two ways a face can reach the image, `CONTAINER_INSTALLED_FAMILIES` is
 * their union, and `reportTypography.spec.ts` reads
 * `weasyprint-service/Dockerfile` and fails if any of the three disagree with
 * it — or if a stack names a family none of them provide.
 */

/**
 * Debian packages the image installs, and the families each provides.
 *
 * Every one is verified present in **both** bookworm and trixie against the
 * binary index — `dists/<release>/main/binary-amd64/Packages.gz` — not against
 * packages.debian.org, which also serves pages for source package names and is
 * how `fonts-ibm-plex` got into this list in the first place.
 *
 * Adding a row here without adding the package to the Dockerfile fails the
 * spec, and vice versa.
 */
export const CONTAINER_FONT_PACKAGES: Record<string, readonly string[]> = {
  'fonts-inter': ['Inter'],
  'fonts-roboto': ['Roboto'],
  'fonts-lato': ['Lato'],
  'fonts-dejavu': ['DejaVu Sans', 'DejaVu Serif'],
  'fonts-liberation': ['Liberation Sans', 'Liberation Serif'],
  'fonts-noto': ['Noto Sans', 'Noto Serif'],
  // Not a text face — CJK coverage so a non-Latin client name renders as
  // characters rather than tofu.
  'fonts-noto-cjk': [],
};

/** One `COPY`-ed font file: which family it provides, at which weight. */
export interface ContainerFontFile {
  family: string;
  /** CSS `font-weight` this file answers. */
  weight: number;
  italic?: boolean;
}

/**
 * TTFs the image `COPY`s into `/usr/local/share/fonts/` and `fc-cache`s.
 *
 * None of these families is packaged by Debian, so they travel with the
 * service. They live in `weasyprint-service/fonts/` rather than `public/fonts/`
 * because Docker cannot `COPY` from outside its build context, and the
 * documented build context is the service directory.
 *
 * All are SIL OFL 1.1; a `*-OFL.txt` ships beside each family, which the licence
 * requires for redistribution inside an image. Hashes and sources are in
 * `weasyprint-service/fonts/PROVENANCE.md`.
 *
 * ## Why the weight matters, and is declared
 *
 * A weight the stylesheet asks for and the image does not have is not a missing
 * font — it is a **synthesised** one. The engine smears the nearest face to fake
 * it, which on a high-contrast didone at 34pt reads as a printing fault rather
 * than as bold.
 *
 * The first version of this shipped Playfair Medium alone while the stylesheet
 * asked for 400, 600 and 700, so *every* chapter title and pull quote in the
 * container would have been a synthetic bold of the wrong weight. It is not
 * visible locally, where a distribution package fills the gaps.
 * `reportTypography.spec.ts` now reads the real stylesheet and fails on any
 * (family, weight) pair this table cannot answer exactly.
 */
export const CONTAINER_FONT_FILES: Record<string, ContainerFontFile> = {
  // Cover titles and the closing lockup, and nowhere else.
  //
  // Regular and SemiBold, where this was Bold alone. Cinzel is an inscriptional
  // roman cut after Trajan-column capitals, and those are light: the cover title
  // is set Regular and the closing wordmark SemiBold, which is what the face was
  // drawn for. It had been Bold in both places because Bold was the only weight
  // in the image — a typographic decision made by an omission in a Dockerfile.
  //
  // Bold is gone rather than kept "in case": the rule below is that a file
  // nothing requests does not ship, and inventing a use for 77KB to keep it
  // would be the same mistake in the other direction. Both new files came out
  // of public/fonts/Cinzel_Playfair_Display.zip, the archive the Bold came from,
  // where they had been sitting unused all along.
  'Cinzel-Regular.ttf': { family: 'Cinzel', weight: 400 },
  'Cinzel-SemiBold.ttf': { family: 'Cinzel', weight: 600 },

  // Display and accent. The italic is a separate file and a separate decision:
  // without a real italic the engine synthesises a slant from the upright.
  'PlayfairDisplay-Regular.ttf': { family: 'Playfair Display', weight: 400 },
  'PlayfairDisplay-Italic.ttf': { family: 'Playfair Display', weight: 400, italic: true },
  'PlayfairDisplay-SemiBold.ttf': { family: 'Playfair Display', weight: 600 },
  'PlayfairDisplay-Bold.ttf': { family: 'Playfair Display', weight: 700 },

  // Eyebrows, running heads, page numbers, table column heads.
  'IBMPlexMono-Regular.ttf': { family: 'IBM Plex Mono', weight: 400 },
  'IBMPlexMono-Medium.ttf': { family: 'IBM Plex Mono', weight: 500 },
  'IBMPlexMono-Bold.ttf': { family: 'IBM Plex Mono', weight: 700 },
};

/** Families that arrive as files rather than packages — the ones with declared weights. */
export function isFileShippedFamily(family: string): boolean {
  return Object.values(CONTAINER_FONT_FILES).some((f) => f.family === family);
}

/** Weights a file-shipped family can answer without synthesis. */
export function shippedWeights(family: string, italic = false): number[] {
  return Object.values(CONTAINER_FONT_FILES)
    .filter((f) => f.family === family && Boolean(f.italic) === italic)
    .map((f) => f.weight)
    .sort((a, b) => a - b);
}

/** Every family the container provides, from either route. De-duplicated. */
export const CONTAINER_INSTALLED_FAMILIES: readonly string[] = [
  ...new Set([
    ...Object.values(CONTAINER_FONT_PACKAGES).flat(),
    ...Object.values(CONTAINER_FONT_FILES).map((f) => f.family),
  ]),
].sort();

export type InstalledFamily = typeof CONTAINER_INSTALLED_FAMILIES[number];

/**
 * The roles a report sets type in.
 *
 * Every stack ends in a generic so a missing face degrades to the right *shape*
 * rather than to the engine's serif default — which is how a sans-set technical
 * report silently prints in Times.
 */
export const PRINT_STACK = {
  /**
   * Cover titles and the closing lockup. `--font-display` in the design system.
   *
   * Cinzel is the brand's cover face and ships Bold only, which is why it is
   * confined to the two places set large and short. At body sizes an all-caps
   * roman like this is unreadable.
   */
  cover: "'Cinzel', 'Playfair Display', Georgia, serif",
  /**
   * Display — chapter titles, section heads, pull quotes. `--font-serif`.
   */
  display: "'Playfair Display', Georgia, serif",
  /** Body copy and tables. */
  body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  /**
   * Figures, eyebrows, running heads, page numbers.
   *
   * A ledger column is only readable if the digits stack, and that needs
   * tabular figures — see `NUMERIC_FEATURES`.
   */
  mono: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
  /**
   * Editorial italic accents — standfirsts, deks, captions with voice.
   *
   * The same family as `display`, set in italic, rather than a second serif.
   * The previous stack led with Cormorant Garamond, which is not installable on
   * Debian and was therefore silently falling back to the engine's default
   * serif — visible in the first real render as an accent line that was not
   * italic at all. One editorial serif used upright and italic is a system;
   * two serifs where the second never loads is a bug.
   */
  accent: "'Playfair Display', Georgia, serif",
} as const;

/**
 * Applied to every figure in a table, KPI or ledger.
 *
 * `tabular-nums` is the one that matters: proportional digits make a
 * ten-year projection unreadable down the column. `lining-nums` stops an
 * old-style face dropping digits below the baseline in a financial context.
 */
export const NUMERIC_FEATURES = 'font-variant-numeric: tabular-nums lining-nums;';

/**
 * Applied to figures in running prose, which is the other half of the rule.
 *
 * `tabular-nums` is right in a table and wrong in a sentence: it sets every
 * digit on the same advance, so `1` carries the width of `0` and a year or a
 * percentage inside a paragraph opens a gap on both sides of the narrow digits.
 * The face's proportional figures are what the text was drawn with.
 *
 * Nothing in this system set them, so body copy took whatever the face
 * defaulted to and inherited `tabular-nums` wherever a numeric rule was an
 * ancestor. This says the intent instead of leaving it to inheritance.
 */
export const PROSE_NUMERIC_FEATURES = 'font-variant-numeric: proportional-nums lining-nums;';

/**
 * Applied to the italic editorial voices — the lede and the pull quote.
 *
 * Old-style figures sit on the x-height with ascenders and descenders, which is
 * what a serif italic is drawn to carry, and they are the reason a date in a
 * standfirst reads as part of the sentence rather than as a number stuck into
 * it. Playfair Display ships them; a face that does not will fall back to
 * lining, which is the current behaviour and no worse.
 *
 * Only these two. Old-style figures in body copy at this size are a
 * nineteenth-century book, not a financial report, and in a table they are
 * unreadable down the column.
 */
export const EDITORIAL_NUMERIC_FEATURES = 'font-variant-numeric: oldstyle-nums proportional-nums;';

/**
 * The brand signature in print: a wide uppercase eyebrow over a tight-tracked
 * title. Carried from `--tracking-eyebrow` / `--tracking-tight`.
 */
export const EYEBROW_STYLE = {
  transform: 'uppercase',
  tracking: '0.18em',
  weight: 700,
} as const;

/** Families named by a stack, in declaration order, de-duplicated. */
export function familiesInStack(stack: string): string[] {
  const out: string[] = [];
  for (const raw of stack.split(',')) {
    const family = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!family) continue;
    if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(family)) continue;
    if (!out.includes(family)) out.push(family);
  }
  return out;
}

/**
 * Families a stack names that the container does not provide.
 *
 * Generic keywords and the ubiquitous metric-compatible aliases
 * (`Helvetica Neue`, `Arial`, `Georgia`, `Consolas`, `SFMono-Regular`) are not
 * reported: they are last-resort fallbacks that resolve to a Liberation or
 * DejaVu metric equivalent, never the intended face, and flagging them would
 * make the check noise.
 */
const METRIC_ALIASES = new Set([
  'Helvetica Neue', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Times',
  'Consolas', 'SFMono-Regular', 'Menlo', 'Monaco', 'Courier New',
]);

export function missingFamilies(stack: string): string[] {
  const installed = new Set<string>(CONTAINER_INSTALLED_FAMILIES);
  return familiesInStack(stack).filter((f) => !installed.has(f) && !METRIC_ALIASES.has(f));
}

/**
 * The first family in a stack that the container actually provides.
 *
 * What the reader will see. Returns `null` when the stack resolves to nothing
 * but its generic — which is the failure this module exists to make loud.
 */
export function effectiveFamily(stack: string): string | null {
  const installed = new Set<string>(CONTAINER_INSTALLED_FAMILIES);
  return familiesInStack(stack).find((f) => installed.has(f)) ?? null;
}

// ── Fitting a cover title ───────────────────────────────────────────────────

/**
 * How hard a cover title has to work to fit.
 *
 * `coverTitle` is 56pt Cinzel Bold against a 165mm measure — about a dozen
 * characters to the line. That is right for *Borrowing Capacity Snapshot* and
 * wrong for a title three times as long, which sets five lines deep and lands
 * in the meta block.
 *
 * CSS cannot measure a string, so the decision is made here, where it can be
 * tested, and arrives at the stylesheet as a class. The thresholds are
 * character counts rather than an em measure because Cinzel sets lowercase as
 * small capitals, so its advance widths are far more even than a normal face's
 * and a count is a good enough proxy.
 */
export type CoverTitleFit = 'full' | 'medium' | 'long' | 'longest';

export const COVER_TITLE_FITS: readonly CoverTitleFit[] = [
  'full', 'medium', 'long', 'longest',
];

/** Multipliers applied to `coverTitle`. One line each, at the measure. */
export const COVER_TITLE_SCALE: Record<CoverTitleFit, number> = {
  full: 1,
  medium: 0.72,
  long: 0.55,
  longest: 0.42,
};

export function coverTitleFit(title: string, subtitle?: string | null): CoverTitleFit {
  // A subtitle sets at 0.66em under the title and costs a line of its own, so a
  // title with one has less room before it starts pushing the meta block down.
  const chars = String(title ?? '').trim().length
    + (subtitle ? Math.round(String(subtitle).trim().length * 0.66) : 0);
  if (chars <= 26) return 'full';
  if (chars <= 46) return 'medium';
  if (chars <= 72) return 'long';
  return 'longest';
}
