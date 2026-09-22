/**
 * Investment Compass — block helpers driven by a resolved manifest.
 *
 * ## How this differs from `scripts/template-library/blocks.ts`
 *
 * That module compiles the *voice* system: five studio voices keyed to the
 * catalogue's `style` axis, which is what the forty original seeded templates
 * are built in. This one compiles the *family* system from the approved
 * Investment Compass catalogue, where a template's look is a resolved manifest
 * of ~21 keys rather than a voice name.
 *
 * They are deliberately separate modules over one shared renderer. Merging them
 * would mean either bending the manifest keys into voice fields — losing the
 * distinctions the catalogue draws — or rewriting forty working templates to
 * prove a point. The renderer, the schema, the publish gate and the seed
 * pipeline are all shared; only the authoring vocabulary differs.
 *
 * ## The rules that hold
 *
 *  1. **Geometry is computed.** `flow()` stacks from the manifest's own margin,
 *     so a density change moves every block rather than needing 300 `y` values
 *     re-entered. Overflow past the footer is recorded and fails the build.
 *  2. **No literal colours.** Every colour is `token:*`, which is what lets a
 *     colourway repaint the document and keeps `isBrandSafe()` true.
 *  3. **Type comes from the family, not the call site.** A helper never takes a
 *     point size from its caller; it reads the family's measured scale at the
 *     template's density.
 *  4. **Every value a report supplies is a `{{binding}}`.**
 *  5. **Nothing reads a manifest string directly.** Everything goes through
 *     `resolvers.ts`, which throws on a value it has no mapping for. That is
 *     what stops a new family silently rendering as somebody else's layout.
 */
import {
  RULE_WEIGHTS,
  TRACKING,
  marginFor,
  radiusFor,
  scaleFor,
  spacingFor,
  typographyFor,
  type Density,
  type DesignFamily,
  type FamilyTypography,
  type SpacingScale,
  type TemplateManifest,
  type TypeScale,
  type VariantDefinition,
} from './family';
import {
  calloutKind,
  strengthsWatchStyle,
  chartPlan,
  coverPlan,
  hasRail,
  kpiPlan,
  railFooter,
  recommendationKind,
  riskKind,
  sectionHeaderKind,
  tablePlan,
  type CoverPlan,
} from './resolvers';

export const PAGE = { width: 595, height: 842 } as const;

/** Height of the footer band. */
export const FOOTER_HEIGHT = 22;

/**
 * Space reserved at the foot of a content page.
 *
 * Deliberately larger than the footer's ink so a block that ends exactly at the
 * limit still has air beneath it.
 */
export const FOOTER_RESERVE = 30;

/** Width of the lane a vertical navigation rail occupies, including its gutter. */
export const RAIL_LANE = 30;

export interface BlockDef {
  id: string;
  type: string;
  props: Record<string, unknown>;
  overlays: never[];
  name?: string;
  /** Skip the block entirely when this evaluates falsy. */
  conditional?: string;
}

export interface PageDef {
  id: string;
  name: string;
  size: { width: number; height: number };
  background: { color: string };
  blocks: BlockDef[];
  /** Drop the page entirely when this evaluates falsy. */
  conditional?: string;
  /**
   * Fold this page into the contents entry the page before it opened.
   *
   * Set it on a continuation — the second and later sheets of one section — so
   * the list names the section once. `toc` renders a row per rendered page, so
   * without it a forty-page body is forty contents rows. See
   * `PageSchema.tocContinues`.
   */
  tocContinues?: boolean;
}

export interface FlowItem {
  /**
   * The block at this position — or several, all at the same position.
   *
   * More than one is for **mutually exclusive variants**: a ranking table drawn
   * once for two properties, once for three, once for four and once for five,
   * each carrying a `conditional` on the count, all placed at the same `y`. One
   * renders and the rest do not exist.
   *
   * The alternative is a fixed five-row table, and on the seven stored
   * comparisons that hold two properties that prints three empty rows — which
   * reads as a document that failed to finish rather than one that compared two
   * properties. Sizing to the smallest instead would silently drop three.
   *
   * The item's `height` must be the tallest variant's, so whatever follows
   * clears all of them.
   */
  block: (y: number) => BlockDef | BlockDef[];
  height: number;
  /** Extra space after this block. Defaults to the manifest's spacing scale. */
  gap?: number;
  /**
   * Render the block only when this evaluates truthy.
   *
   * The item still occupies its height in the flow. That is deliberate: blocks
   * are absolutely positioned and nothing reflows, so a conditional item that
   * collapsed would have to move every block below it — which it cannot. An
   * absent item leaves space, and the placements are chosen so that space falls
   * at the foot of a page rather than above its heading.
   */
  conditional?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overflow log
// ─────────────────────────────────────────────────────────────────────────────

export interface Overflow {
  template: string;
  page: string;
  bottom: number;
  overBy: number;
}

const overflows: Overflow[] = [];
const UNNAMED = '(unnamed)';

/**
 * Drain the overflow log.
 *
 * The seed builder refuses to write a migration when this is non-empty. Without
 * it, a density or type-scale change pushes content under the footer on some
 * subset of fifty templates and the only symptom is a customer's report with a
 * truncated table.
 */
export function takeCompassOverflows(): Overflow[] {
  return overflows.splice(0, overflows.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// The compass context
// ─────────────────────────────────────────────────────────────────────────────

export interface Compass {
  family: DesignFamily;
  variant: VariantDefinition;
  manifest: TemplateManifest;
  type: FamilyTypography;
  scale: TypeScale;
  spacing: SpacingScale;
  density: Density;
  margin: number;
  /** Usable width inside the margins, less any navigation rail. */
  contentWidth: number;
  /** Left edge of content, past any navigation rail. */
  contentLeft: number;
  contentBottom: number;
  radius: number;
  railed: boolean;
  cover: CoverPlan;
  /** `token:heading` / `token:body` / `token:mono`, per `numeric_typography`. */
  numericFont: string;
}

let counter = 0;
let active: Compass | null = null;

/** Deterministic ids: a regenerated migration must produce identical SQL. */
function id(type: string): string {
  counter += 1;
  return `ic-${type}-${counter.toString(36)}`;
}

export function beginCompassTemplate(
  family: DesignFamily,
  variant: VariantDefinition,
  manifest: TemplateManifest,
): Compass {
  counter = 0;
  const margin = marginFor(manifest);
  const railed = hasRail(manifest.navigation_style);
  const type = typographyFor(family.key);
  const compass: Compass = {
    family,
    variant,
    manifest,
    type,
    scale: scaleFor(family.key, manifest.density as Density),
    spacing: spacingFor(manifest),
    density: manifest.density as Density,
    margin,
    contentLeft: margin + (railed ? RAIL_LANE : 0),
    contentWidth: PAGE.width - margin * 2 - (railed ? RAIL_LANE : 0),
    contentBottom: PAGE.height - margin - FOOTER_RESERVE,
    radius: radiusFor(manifest),
    railed,
    cover: coverPlan(manifest.cover_overlay),
    numericFont: `token:${type.numericFace}`,
  };
  active = compass;
  return compass;
}

function ctx(): Compass {
  if (!active) throw new Error('beginCompassTemplate() must be called before any block helper');
  return active;
}

function block(type: string, props: Record<string, unknown>, name?: string): BlockDef {
  return { id: id(type), type, props, overlays: [], ...(name ? { name } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow
// ─────────────────────────────────────────────────────────────────────────────

/** Stack items down the page from `startY`, honouring the spacing scale. */
/**
 * The height left on the page for one more item, after `items` have flowed.
 *
 * Derived from the same arithmetic `flow` uses — `item.height` plus its gap —
 * rather than guessed. Three composers sized a paged Markdown body as
 * `contentBottom - contentTop() - headingGap - 104`, where `104` stood in for
 * the height of a `sectionHeading` that this module computes exactly and that
 * varies with the family's header style, its heading length and whether it
 * carries a standfirst. On the families where the real heading was taller the
 * body ran past the footer — 48 of the seed builder's 68 refusals were one
 * layer-opening page on eight layers of five Market Intelligence masters.
 *
 * A declared height that is too large does not overflow visibly: it lays one
 * block over the next. So this is derived, never padded.
 */
export function remainingAfter(items: FlowItem[], startY: number): number {
  const c = ctx();
  let y = startY;
  for (const item of items) y += item.height + (item.gap ?? c.spacing.gap);
  return c.contentBottom - y;
}

export function flow(items: FlowItem[], startY?: number): BlockDef[] {
  const c = ctx();
  let y = startY ?? c.margin;
  const out: BlockDef[] = [];
  for (const item of items) {
    const emitted = item.block(y);
    for (const b of Array.isArray(emitted) ? emitted : [emitted]) {
      // An item-level conditional applies to every variant; a variant that
      // carries its own keeps it, because that is how the variants tell
      // themselves apart.
      out.push(item.conditional && !b.conditional ? { ...b, conditional: item.conditional } : b);
    }
    y += item.height + (item.gap ?? c.spacing.gap);
  }
  const last = items[items.length - 1];
  const bottom = last ? y - (last.gap ?? c.spacing.gap) : y;
  if (bottom > c.contentBottom) {
    overflows.push({
      template: c.variant.code,
      page: UNNAMED,
      bottom,
      overBy: Math.round(bottom - c.contentBottom),
    });
  }
  return out;
}

/**
 * Points of height a bound paragraph of `chars` characters needs.
 *
 * ## Why a height has to be measured rather than assumed
 *
 * Every height in this file is a promise: `flow()` stacks the next block at
 * `y + height`, and the renderer positions absolutely, so a block whose text
 * sets taller than its declared height does not push the page down — it lays
 * over whatever comes next. The overflow guard cannot see that, because the
 * page's own bottom is never crossed. Two blocks can be printed on top of each
 * other and every arithmetic check passes.
 *
 * That is exactly what the Portfolio masters did on their first render: 463
 * overlapping pairs across 50 templates, because a definition list reserved one
 * line per item while the analysis writes 131-456 characters into each. The
 * lengths are not guessable from the field names — `financialHealth.lvrRisk` is
 * 3-6 characters ("Low") and `financialHealth.analysis` is 458-1620.
 *
 * So a format that binds model-authored prose passes the character count it
 * measured against production, and gets a height that fits it.
 *
 * The ratio is the average advance width of the body faces this catalogue
 * uses, as a fraction of the type size — 0.5 is the conventional figure for a
 * serif or humanist sans at text sizes, and reading it slightly wide is the
 * safe direction here.
 */
export function textHeight(chars: number, opts?: {
  size?: number;
  width?: number;
  lineHeight?: number;
  extra?: number;
}): number {
  const c = ctx();
  const size = opts?.size ?? c.scale.body;
  const width = opts?.width ?? c.contentWidth;
  const lineHeight = opts?.lineHeight ?? 1.6;
  const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
  const lines = Math.max(1, Math.ceil(chars / perLine));
  return Math.round(lines * size * lineHeight) + (opts?.extra ?? 0);
}

/**
 * The advance ratio for DISPLAY type, as a fraction of the type size.
 *
 * `textHeight` uses 0.5, which is the conventional figure for body copy. The
 * heading faces in this catalogue set wider, and `sectionHeading`'s band kind
 * has read them at 0.52 since it was measured. One constant, so the two
 * cannot drift.
 */
const DISPLAY_ADVANCE = 0.52;

/** A verdict heading is a two-line statement. That IS the design. */
export const VERDICT_HEADING_LINES = 2;

/**
 * A display slot never shrinks below this, whatever the arithmetic says.
 *
 * Measured over all ten families at all three densities: the catalogue's
 * smallest section `heading` is 10.25pt (`institutional_research` at compact)
 * and its smallest `verdict` is 11.5pt. A display statement that set below the
 * smallest ordinary heading in its own document would have stopped being the
 * page's statement, and the answer to that is a shorter sentence rather than
 * smaller type — so the floor refuses rather than obliging, and a vocabulary
 * that reaches it fails `verdictHeadingFits.spec.ts` instead of shipping.
 *
 * Nothing in the current vocabulary comes near it: the tightest master fits
 * the longest publishable headline at 17.75pt.
 */
const MIN_DISPLAY_SIZE = 10.25;

/**
 * The largest size at or below `designed` that sets `chars` in `lines` lines.
 *
 * The counterpart to `textHeight`, for the case where the BOX cannot grow.
 * `textHeight` answers "how tall will this set?" and the block takes that
 * height; this answers "how big may this be?" and the block keeps its height.
 *
 * Both are needed because the two situations are genuinely different. A
 * paragraph in a flowing column may run on and the page absorbs it. A display
 * statement on a page whose own slack is 15pt may not: growing it pushes
 * everything below it through the footer, and leaving it to overflow prints it
 * over the block beneath — which is what the verdict heading did.
 *
 * It never enlarges. A heading whose vocabulary fits at the designed size gets
 * the designed size exactly, so the 23 of 50 masters that were already right
 * are byte-identical.
 *
 * Quarter-point steps, matching `family.ts`'s `step()` — finer than any
 * renderer resolves, and coarse enough that the value is stable.
 */
export function fitToLines(
  chars: number,
  designed: number,
  width: number,
  lines: number,
): number {
  if (chars <= 0 || lines <= 0) return designed;
  if (displayLines(chars, designed, width) <= lines) return designed;
  // The closed-form answer, then STEPPED DOWN until `displayLines` — the one
  // implementation the spec also checks against — agrees that it fits.
  //
  // Not belt and braces. At 481pt of measure and 50 characters a line, the
  // arithmetic is exact: `481 / (50 × 0.52) = 18.5`. In binary,
  // `18.5 × 0.52` is 9.620000000000001, `481 / 9.620000000000001` is
  // 49.999999999999993, and `Math.floor` takes it to 49 — so the size the
  // closed form calls a perfect fit is one character short, on five of the
  // fifty masters. Deriving a size and then not checking it is the same
  // mistake as declaring a height and not measuring it.
  let size = Math.floor((width / (Math.ceil(chars / lines) * DISPLAY_ADVANCE)) * 4) / 4;
  while (size > MIN_DISPLAY_SIZE && displayLines(chars, size, width) > lines) {
    size -= 0.25;
  }
  return Math.min(designed, Math.max(MIN_DISPLAY_SIZE, size));
}

/**
 * How many lines `chars` sets in, at `size`, across `width`, in display type.
 *
 * The ONE line-count for display slots: `fitToLines` steps down until this
 * agrees, and `verdictHeadingFits.spec.ts` re-measures every seeded master
 * with it. A second copy of this arithmetic is how a block and its guard come
 * to agree with each other and disagree with the page.
 */
export function displayLines(chars: number, size: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (size * DISPLAY_ADVANCE)));
  return Math.max(1, Math.ceil(chars / perLine));
}


/**
 * Keep a trailing block only on the variants that have room for it.
 *
 * The ten families are the same page size and do not have the same measure: a
 * deeper running head, a taller section opener and a looser spacing scale
 * compound, and the gap between the roomiest variant and the tightest is over
 * 150pt — two blocks' worth. So a block sized to complete one variant's page
 * runs another's past the footer, and a block sized to fit every variant leaves
 * the roomy ones half empty.
 *
 * Neither is the right trade for an *optional* block — one that adds context
 * rather than carrying the argument. This measures what is left after the
 * required items and keeps as many of the optional ones as actually fit. Pass
 * the same `startY` that `flow()` will be given, or the arithmetic is against a
 * different page.
 *
 * Optional items are trailing by construction: they are appended after the
 * required ones. A block that must appear in the middle of a page is not
 * optional, and belongs in `required`.
 *
 * `SLACK` is why the arithmetic is not "does it fit". Every declared height is
 * an estimate of how tall type will set — a KPI band whose label wraps to a
 * second line, a note that runs on — and the estimates are good to within about
 * a line. A *required* block absorbs that: it is on the page either way. An
 * optional one placed with nothing to spare turns a 20pt estimate error into a
 * block printed over the one above it, which is the failure this whole
 * mechanism exists to avoid. So an optional block has to fit comfortably, and
 * a line and a half is what "comfortably" was measured to need.
 */
const SLACK = 36;

export function ifItFits(
  required: FlowItem[],
  optional: FlowItem[],
  startY?: number,
): FlowItem[] {
  const c = ctx();
  let y = startY ?? c.margin;
  for (const item of required) y += item.height + (item.gap ?? c.spacing.gap);

  const kept: FlowItem[] = [];
  for (const item of optional) {
    if (y + item.height + SLACK > c.contentBottom) break;
    kept.push(item);
    y += item.height + (item.gap ?? c.spacing.gap);
  }
  return [...required, ...kept];
}

/**
 * Draw one of several depths of the same block at one position, under
 * mutually exclusive conditionals — the comparison ranking table's pattern,
 * named. A table or a definition list prints every declared row whether or
 * not its bindings resolve, so one depth sized for the deepest report rules
 * off empty rows beneath the median one, and a depth sized for the median
 * silently drops the deep report's tail. With variants, one renders and the
 * others do not exist. The reserved height is the deepest variant's, so
 * whatever follows clears whichever renders.
 */
export function oneOf(...variants: Array<{ when: string; item: FlowItem }>): FlowItem {
  return {
    height: Math.max(...variants.map((v) => v.item.height)),
    block: (y) => variants.map(({ when, item }) => {
      const b = item.block(y);
      const one = Array.isArray(b) ? b[0] : b;
      return { ...one, conditional: when };
    }),
  };
}

export function page(name: string, blocks: BlockDef[], background = 'token:surface'): PageDef {
  for (let i = overflows.length - 1; i >= 0; i -= 1) {
    if (overflows[i].page !== UNNAMED) break;
    overflows[i].page = name;
  }
  return {
    id: id('page'),
    name,
    size: { width: PAGE.width, height: PAGE.height },
    background: { color: background },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page furniture
// ─────────────────────────────────────────────────────────────────────────────

/** Where the running head's rule sits — below two lines of label. */
function runningHeadBottom(): number {
  const c = ctx();
  return c.margin + Math.round(c.scale.runningHead * 1.35 * 2) + 5;
}

/**
 * The running head — the two-part rule across the top of every content page.
 *
 * Left names the document and the asset, right names the part. It is emitted as
 * two text blocks plus a divider rather than one element because the halves
 * align to opposite edges, and no primitive sets a line with a left and a right
 * end.
 *
 * The label takes two thirds of the measure and the rule reserves two lines
 * either way: `{{property.address}}` is one line for "Lot 60448 Cloverton" and
 * three for a strata address with a building name, and a rule struck through
 * the running head is the kind of defect that only shows on a real address.
 */
/**
 * The longest `property_address` in the corpus, measured 2026-08-16 over all
 * 1,187 stored rows: median 19, p90 44, p99 61, **max 84**.
 *
 * Exported, and named ONCE. It was declared here inside `cover()` and again as
 * a bare `const LONGEST_ADDRESS = 84` in
 * `investmentPropertyRows.spec.ts` — two copies of one measurement, which is
 * how the two come to disagree the next time the corpus is re-measured. Both
 * read this now, and so does the geometry harness, which needs an address of
 * this length rather than the binding fixture's 42-character one.
 */
export const LONGEST_ADDRESS = 84;

export function runningHead(documentLabel: string, part: string): BlockDef[] {
  const c = ctx();
  const labelWidth = Math.floor(c.contentWidth * 0.66);
  const y = c.margin;
  return [
    block('text-block', {
      body: documentLabel,
      bodySize: c.scale.runningHead,
      bodyFont: 'token:mono',
      bodyTracking: TRACKING.runningHead,
      bodyLineHeight: 1.35,
      color: 'token:mutedInk',
      x: c.contentLeft, y, width: labelWidth,
    }, 'Running head'),
    block('text-block', {
      body: part,
      bodySize: c.scale.runningHead,
      bodyFont: 'token:mono',
      bodyAlign: 'right',
      color: 'token:mutedInk',
      x: c.contentLeft + labelWidth, y, width: c.contentWidth - labelWidth,
    }, 'Part marker'),
    block('divider', {
      color: 'token:line',
      thickness: c.manifest.border_treatment === 'rule_2px' ? RULE_WEIGHTS.heavy : RULE_WEIGHTS.hairline,
      x: c.contentLeft, y: runningHeadBottom(), width: c.contentWidth,
    }),
  ];
}

/**
 * The vertical navigation rail.
 *
 * `navigation_style: vertical_rail` (and the caption/narrow rails) put
 * orientation on a rule down the binding edge. On those variants the rail
 * REPLACES the running head rather than joining it — drawing both puts the rail
 * marker on top of the running head at the same `y`.
 *
 * The marker sits in the content column beside the rail, not in the 30pt lane:
 * horizontal type does not fit a 30pt measure, and rotating it is not something
 * the block vocabulary can express.
 */
export function navigationRail(part: string, section: string): BlockDef[] {
  const c = ctx();
  const top = c.margin;
  return [
    block('divider', {
      orientation: 'vertical',
      color: 'token:primary',
      thickness: 2,
      x: c.margin, y: top, height: c.contentBottom - top,
    }, 'Navigation rail'),
    block('text-block', {
      eyebrow: part,
      eyebrowSize: c.scale.eyebrow,
      eyebrowFont: 'token:mono',
      eyebrowTracking: TRACKING.eyebrow,
      eyebrowColor: 'token:accentInk',
      body: section,
      bodySize: c.scale.runningHead,
      bodyFont: 'token:mono',
      bodyTracking: TRACKING.runningHead,
      color: 'token:mutedInk',
      x: c.contentLeft, y: top, width: c.contentWidth,
    }, 'Rail marker'),
  ];
}

/**
 * The advance width of the mono face, as a fraction of the type size.
 *
 * A monospaced face has ONE advance by definition, and the catalogue's three
 * (`token:mono` resolves per family) are all in the conventional 0.6em band.
 * The running head's part marker is the only place a bound value is set in
 * mono against a fixed measure, and `runningHeadMarkerLines` is what keeps it
 * inside the two lines the rule reserves.
 */
export const MONO_ADVANCE = 0.6;

/**
 * How many lines the running head's right-hand marker sets in.
 *
 * `runningHead` positions the divider at `runningHeadBottom()`, which reserves
 * exactly two lines. A marker that sets in three strikes the rule.
 */
export function runningHeadMarkerLines(chars: number): number {
  const c = ctx();
  const width = c.contentWidth - Math.floor(c.contentWidth * 0.66);
  const perLine = Math.max(1, Math.floor(width / (c.scale.runningHead * MONO_ADVANCE)));
  return Math.max(1, Math.ceil(chars / perLine));
}

/**
 * The furniture a content page needs, per the manifest.
 *
 * ## `headMarker`, and the twenty-nine pages that said the same thing
 *
 * A railed family draws the part AND the section — the part as an eyebrow, the
 * section beneath it. A running-head family draws the part alone and DISCARDS
 * the section, which is why v15's chapter work reached only the railed half of
 * the catalogue. On 42 Patya Circuit, 29 of 36 pages carried the identical
 * running head `Part 05 · Report`: the body IS one part, correctly, and the
 * chapter that would have told a reader where they were never had anywhere to
 * be drawn.
 *
 * `headMarker` is what a running-head family puts on the right instead, and it
 * is optional so the nine other formats — 450 masters that pass a static
 * section equal to their part label — are byte-identical.
 */
export function furniture(
  documentLabel: string,
  part: string,
  section: string,
  headMarker?: string,
): BlockDef[] {
  return ctx().railed
    ? navigationRail(part, section)
    : runningHead(documentLabel, headMarker ?? part);
}

/** First usable y below the running head or rail marker. */
export function contentTop(): number {
  const c = ctx();
  return runningHeadBottom() + c.spacing.sectionGap;
}

/**
 * The standing footer.
 *
 * Inset to the template's own margin so its rule spans exactly the measure the
 * content above it does — the block's 24pt default is a 33pt discrepancy on a
 * 20mm page, which reads as a mistake on a document whose argument is precision.
 */
export function footer(text: string): BlockDef {
  const c = ctx();
  return block('footer', {
    text,
    // Left, because the page number takes the right end of the same line.
    align: 'left',
    bg: 'token:surface',
    color: 'token:mutedInk',
    ruleColor: 'token:line',
    inset: c.margin,
    fontSize: c.scale.runningHead,
    height: FOOTER_HEIGHT,
  });
}

export function pageNumber(): BlockDef {
  const c = ctx();
  return block('page-number', {
    color: 'token:mutedInk',
    align: 'right',
    inset: c.margin,
    size: c.scale.runningHead,
    // Vertically centred in the footer band, so it reads as the other end of
    // the footer line rather than as a separate element floating above it.
    y: PAGE.height - FOOTER_HEIGHT + (FOOTER_HEIGHT - c.scale.runningHead) / 2 - 1,
  });
}

/** Attach the furniture a content page needs. */
export function withFurniture(p: PageDef, footerText: string): PageDef {
  const c = ctx();
  return {
    ...p,
    blocks: [
      ...p.blocks,
      footer(footerText),
      // `rail_number` / `rail_progress` put the folio on the rail, so the
      // footer carries the reference alone.
      ...(railFooter(c.manifest.footer_style) ? [] : [pageNumber()]),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverOptions {
  wordmarkTop: string;
  wordmarkBottom: string;
  tagline: string;
  /** Top-right marker, e.g. "Investment Compass". */
  marker: string;
  eyebrow: string;
  title: string;
  standfirst: string;
  locations: string;
  /**
   * The four facts across the foot of the cover. `valueChars` is the long-end
   * character count for a value that is prose rather than a figure, so the
   * band can size for the line it will actually draw.
   */
  facts: Array<{ label: string; value: string; valueChars?: number }>;
}

/**
 * The cover.
 *
 * Composed from primitives rather than the `cover` block, on purpose. That
 * block anchors its title at 55% of the page, fixes the eyebrow at 10pt/0.08em
 * and draws a 60×3pt accent bar — a reasonable general cover, and not one of
 * the twenty-nine the catalogue declares.
 *
 * `cover_overlay` resolves to one of three grounds plus three modifiers:
 *
 *   - `field`  — the whole page takes the field colour (Private Banking's
 *     obsidian, Dark Executive's ground, the photographic scrims).
 *   - `band`   — a field band at the head, paper below (letterheads, mastheads,
 *     memo and contract headers, Wealth Management's obsidian band).
 *   - `paper`  — no field at all; the cover works typographically (Swiss
 *     Minimal's flat grid, the frontispieces, the framed drawing sets).
 *
 * plus `frame` (a rule around the page), `rail` (a rule down the binding edge)
 * and `bleed` (the title runs to the full measure and sits lower).
 *
 * ## The geometry is computed upward from the foot
 *
 * The title is `{{property.address}}`, whose length is unknowable at build
 * time. So the title gets a RESERVED area two lines deep and everything below
 * it is placed against the fact band. Laying it out downward from a fixed title
 * top is what put a gold hairline through the second line of a two-line address.
 */
export function cover(opts: CoverOptions): PageDef {
  const c = ctx();
  const plan = c.cover;
  const onField = plan.ground === 'field';

  const inset = plan.frame ? 16 : 0;
  const left = c.margin + inset + (plan.rail ? RAIL_LANE : 0);
  const width = PAGE.width - (c.margin + inset) * 2 - (plan.rail ? RAIL_LANE : 0);

  // On a banded cover the head sits on the field and everything else on paper.
  const headInk = onField || plan.ground === 'band' ? 'token:text' : 'token:ink';
  const bodyInk = onField ? 'token:text' : 'token:ink';
  const mutedInk = onField ? 'token:mutedOnField' : 'token:mutedInk';

  const factsHeight = c.density === 'spacious' ? 92 : c.density === 'compact' ? 68 : 78;
  const factsTop = PAGE.height - c.margin - inset - factsHeight;

  const locationsHeight = 12;
  const locationsTop = factsTop - c.spacing.sectionGap - locationsHeight;

  // Three lines of standfirst: the summary narrative is a sentence or two, and
  // reserving for one line is the same mistake in a different place.
  const standfirstHeight = Math.round(c.scale.coverStandfirst * 1.4 * 3);
  const standfirstTop = locationsTop - 14 - standfirstHeight;

  const ruleY = standfirstTop - 16;

  /**
   * The title is anchored to the rule, not to a reserved two lines.
   *
   * `titleHeight` used to be `coverTitle * 1.12 * 2` — two lines, on every
   * family, for a string whose length nobody controls. `property_address` runs
   * to **84 characters** across the 1,187 stored reports (median 19, p90 44,
   * p99 61), and the measure here is 86% of the cover width. At Private
   * Banking's 41pt that is four lines; at Swiss Minimal's 52pt it is six. The
   * render showed exactly that: "Point NSW 2486," struck through by the gold
   * rule and "AUSTRALIA" printed across the standfirst.
   *
   * Reserving for the longest address is the other half of the same mistake —
   * it would leave the median 19-character address floating a hundred points
   * above its own rule on every cover in the archive. So the block's FOOT is
   * pinned instead (`anchorBottom`) and it grows up into the empty half of the
   * cover, which is where a designer would set it and where there is nothing to
   * collide with: the head sits at `headTop + 46` and even six lines of the
   * largest display size clear it.
   *
   * `titleTop` is kept only as the fallback `y` a renderer without bottom
   * anchoring would use, and it is the same number it always was.
   */
  const titleHeight = Math.round(c.scale.coverTitle * 1.12 * 2) + 8;
  const eyebrowHeight = Math.round(c.scale.coverEyebrow + 12);
  const titleTop = ruleY - 14 - titleHeight - eyebrowHeight;
  const titleFoot = ruleY - 14;

  const blocks: BlockDef[] = [];

  /*
   * The mark, and the clear space the head is moved down to give it.
   *
   * `REPORT_RULES.md` §5: top-left, ~14mm tall, generous clear space. 40pt is
   * 14.1mm. The box is the house monogram's own aspect at that height —
   * 559×447 scaled to 40pt tall is 50pt wide — so the mark sits flush against
   * the same left edge as the wordmark beneath it rather than being centred
   * away from it. `contain` means a tenant lockup of another shape letterboxes
   * inside the box instead of cropping.
   */
  const MARK_H = 40;
  const MARK_W = 50;
  const MARK_CLEAR = 16;
  const headTop = c.margin + inset + MARK_H + MARK_CLEAR;

  // ── Ground ───────────────────────────────────────────────────────────────
  if (plan.ground === 'band') {
    // A field band behind the head only. Emitted as a full-width `hero` so the
    // colour is a block rather than a page background, which is what lets the
    // rest of the page stay on paper.
    blocks.push(block('hero', {
      title: '',
      bg: 'token:bg',
      color: 'token:text',
      height: 176,
      x: 0, y: 0, width: PAGE.width,
    }, 'Cover band'));
  }

  if (plan.frame) {
    // A hairline frame around the whole sheet — the drawing set's border.
    const f = c.margin;
    const w = PAGE.width - f * 2;
    const h = PAGE.height - f * 2;
    blocks.push(
      block('divider', { color: 'token:line', thickness: RULE_WEIGHTS.hairline, x: f, y: f, width: w }, 'Frame'),
      block('divider', { color: 'token:line', thickness: RULE_WEIGHTS.hairline, x: f, y: f + h, width: w }),
      block('divider', { orientation: 'vertical', color: 'token:line', thickness: RULE_WEIGHTS.hairline, x: f, y: f, height: h }),
      block('divider', { orientation: 'vertical', color: 'token:line', thickness: RULE_WEIGHTS.hairline, x: f + w, y: f, height: h }),
    );
  }

  if (plan.rail) {
    blocks.push(block('divider', {
      orientation: 'vertical',
      color: 'token:primary',
      thickness: 2,
      x: c.margin + inset, y: c.margin + inset, height: PAGE.height - (c.margin + inset) * 2,
    }, 'Cover rail'));
  }

  // ── The mark ─────────────────────────────────────────────────────────────
  //
  // Two slots, chosen by the ground the head sits on, because the mark is a
  // gold gradient and is never auto-inverted — inverting it produces a muddy
  // blue. `markMono` is the lockup for an obsidian ground and `mark` the one
  // for ivory paper; a banded cover puts the head on the field, so it takes the
  // mono one too.
  //
  // Conditional, and `placeholder: false`: a tenant who has uploaded no mark
  // gets no mark rather than ours, and an unbound image block with no
  // placeholder renders nothing at all — no frame, no grey rectangle.
  const headOnField = onField || plan.ground === 'band';
  blocks.push({
    ...block('image', {
      src: headOnField ? '{{org.markMono}}' : '{{org.mark}}',
      fit: 'contain',
      placeholder: false,
      x: left, y: c.margin + inset, width: MARK_W, height: MARK_H,
    }, 'Brand mark'),
    conditional: headOnField ? 'org && org.markMono' : 'org && org.mark',
  });

  // ── Head: wordmark, rule, tagline, marker ────────────────────────────────
  blocks.push(block('text-block', {
    body: `${opts.wordmarkTop}\n${opts.wordmarkBottom}`,
    bodySize: Math.max(8, Math.round(c.scale.coverEyebrow * 1.6)),
    bodyFont: 'token:display',
    bodyTracking: TRACKING.wordmark,
    bodyLineHeight: 1.35,
    color: headInk,
    x: left, y: headTop, width: width - 140,
  }, 'Wordmark'));

  blocks.push(block('divider', {
    color: 'token:primary',
    thickness: 1,
    x: left, y: headTop + 38, width: 74,
  }));

  blocks.push(block('text-block', {
    body: opts.tagline,
    bodySize: c.scale.coverEyebrow * 0.92,
    bodyFont: 'token:mono',
    bodyTracking: 0.24,
    color: plan.ground === 'paper' ? 'token:mutedInk' : 'token:mutedOnField',
    x: left, y: headTop + 46, width: width - 140,
  }, 'Tagline'));

  blocks.push(block('text-block', {
    body: opts.marker,
    bodySize: c.scale.coverEyebrow * 0.92,
    bodyFont: 'token:mono',
    bodyAlign: 'right',
    color: plan.ground === 'paper' ? 'token:mutedInk' : 'token:mutedOnField',
    x: left + width - 140, y: headTop, width: 140,
  }, 'Cover marker'));

  // ── Title block ──────────────────────────────────────────────────────────
  /*
   * The title, at whichever of two sizes the address needs.
   *
   * Bottom-anchoring stops the title running INTO the standfirst, which is the
   * defect the render showed. It cannot stop a long address running UP into the
   * head: at Luxury Editorial's 40pt over a 414pt measure the longest address
   * in the corpus is six lines, and the sixth reaches the tagline.
   *
   * A designer sets a long title smaller, and a template can too — the choice
   * is data, and the catalogue already expresses that as mutually exclusive
   * blocks carrying complementary conditionals (see `oneOf`). So the cover
   * emits the title twice at the same position: the display size while the
   * address fits the space above the rule, and a step down past that.
   *
   * Both numbers are DERIVED, per family, from the geometry this function has
   * already computed — the measure, the leading, and the distance from the rule
   * to the head — rather than being a constant that goes stale when a family's
   * scale changes. `titleCharsAt` is the same character-advance model
   * `textHeight` uses and is read slightly wide, which is the safe direction.
   */
  const titleWidth = plan.bleed ? width : Math.round(width * 0.86);
  // The tagline is the lowest thing in the head, at `headTop + 46`; the title
  // may grow up to just clear of it. 12pt is the tagline's own line, 18 the
  // clear space beneath it. (`headTop` is declared with the mark, above.)
  const titleCeiling = headTop + 46 + 12 + 18;
  const titleRoom = titleFoot - titleCeiling - eyebrowHeight;
  /** How many characters fit above the rule at `size`, at this measure. */
  const titleCharsAt = (size: number): number => {
    const perLine = Math.max(1, Math.floor(titleWidth / (size * 0.5)));
    const lines = Math.max(1, Math.floor(titleRoom / (size * 1.12)));
    return perLine * lines;
  };
  // The step-down size is the first that fits `LONGEST_ADDRESS`, so no stored
  // address can overrun it. See that constant for the measurement.
  const fullChars = titleCharsAt(c.scale.coverTitle);
  let smallSize = c.scale.coverTitle;
  while (smallSize > 12 && titleCharsAt(smallSize) < LONGEST_ADDRESS) smallSize = Math.round((smallSize - 1) * 10) / 10;

  const titleBlock = (size: number, when?: string) => {
    const b = block('text-block', {
      eyebrow: opts.eyebrow,
      eyebrowSize: c.scale.coverEyebrow,
      eyebrowFont: 'token:mono',
      eyebrowTracking: TRACKING.coverEyebrow,
      eyebrowColor: onField ? 'token:accentOnField' : 'token:accentInk',
      heading: opts.title,
      headingSize: size,
      headingFont: 'token:display',
      headingWeight: 400,
      headingLineHeight: 1.12,
      headingColor: bodyInk,
      x: left, y: titleTop, anchorBottom: titleFoot,
      width: titleWidth,
    }, 'Cover title');
    return when ? { ...b, conditional: when } : b;
  };

  if (smallSize >= c.scale.coverTitle) {
    // This family's display size already carries the longest address there is.
    blocks.push(titleBlock(c.scale.coverTitle));
  } else {
    // `property.address` is set on all 1,187 rows, so the guard is about the
    // namespace being present rather than about the field.
    const long = `property && property.address && property.address.length > ${fullChars}`;
    blocks.push(
      titleBlock(c.scale.coverTitle, `!(${long})`),
      titleBlock(smallSize, long),
    );
  }

  blocks.push(block('divider', {
    color: 'token:primary',
    thickness: RULE_WEIGHTS.hairline,
    x: left, y: ruleY, width,
  }));

  blocks.push(block('text-block', {
    body: opts.standfirst,
    bodySize: c.scale.coverStandfirst,
    bodyFont: 'token:heading',
    bodyStyle: 'italic',
    bodyLineHeight: 1.4,
    color: mutedInk,
    x: left, y: standfirstTop, width: Math.round(width * 0.86),
  }, 'Standfirst'));

  blocks.push(block('text-block', {
    body: opts.locations,
    bodySize: c.scale.runningHead * 1.12,
    bodyFont: 'token:mono',
    bodyTracking: 0.16,
    color: mutedInk,
    x: left, y: locationsTop, width,
  }, 'Locations'));

  // ── Foot: the ruled fact band ────────────────────────────────────────────
  blocks.push(block('kpi-grid', {
    variant: 'ruled',
    items: opts.facts,
    columns: opts.facts.length,
    valueFont: 'token:heading',
    labelFont: 'token:mono',
    labelSize: c.scale.kpiLabel,
    labelTracking: TRACKING.label,
    /*
     * `c.scale.coverFact`, not a density branch of its own.
     *
     * This read `c.density === 'spacious' ? 14 : 11` and was the only element
     * on the cover not routed through `scaleFor` — so it carried a SECOND
     * density behaviour and disagreed with the family's own on 22 of the 50
     * master/variant combinations. The compact half is what showed: every
     * other element on a compact cover shrinks 18% and this did not, so the
     * facts grew against their surroundings. See `COVER_FACT_BASE`.
     */
    valueSize: c.scale.coverFact,
    valueColor: bodyInk,
    labelColor: mutedInk,
    ruleColor: onField ? 'token:line' : 'token:line',
    emphasisColor: onField ? 'token:line' : 'token:ink',
    x: left, y: factsTop, width, height: factsHeight,
  }, 'Cover facts'));

  return page('Cover', blocks, onField ? 'token:bg' : 'token:surface');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section furniture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The number of characters a value actually sets, when it may be a binding.
 *
 * A binding's own source text is not what reaches the page:
 * `'{{portfolio.overview}}'` is 22 characters and the overview it resolves to
 * is ~170. Sizing a block from the former is how the Portfolio band came to
 * reserve one line for four — and because `hero` anchors its content to its own
 * bottom edge inside `overflow:hidden` (`hero.html.ts:78`), the surplus does not
 * push the page down. It rises out of the TOP of the band and is clipped away:
 * the eyebrow "The position" was drawn 42.5pt above a box starting at 92pt, on
 * six of the ten families, and never reached the paper at all.
 *
 * Guessing a default here would reintroduce exactly the silent mis-size this
 * exists to stop, so a binding with no measured length fails the build. There
 * are 115 openers in the catalogue and only a handful bind their text, so this
 * is a cheap invariant to hold.
 */
function boundChars(
  value: string,
  declared: number | undefined,
  field: string,
  block = 'sectionHeading',
): number {
  if (declared != null) return declared;
  if (!value.includes('{{')) return value.length;
  throw new Error(
    `${block}: \`${field}\` is bound (${value}), so its own length is not what sets on `
    + `the page. Pass \`${field}Chars\` with the length measured against production.`,
  );
}

/**
 * A section opener, in whichever shape `section_header_style` declares.
 *
 * Six kinds across the catalogue: a tracked eyebrow over a display heading, an
 * oversized numeral beside it, a heading alone (where the rail or masthead
 * carries the label), a filled band behind it, a decimal clause number before
 * it, and an italic standfirst under it.
 *
 * ## The standfirst is part of the block's height, in every kind
 *
 * It used to be counted only by `band`, and only from the binding's own source
 * length. The other kinds reserved a fixed multiple of the heading size and
 * drew the standfirst inside it regardless — so an opener with a real
 * standfirst set past its declared box and printed over whatever `flow()`
 * placed next. That is the Cash Flow Comparison verdict page, where the block
 * below the opener landed on the last lines of it.
 *
 * Each kind measures against the width it actually sets in: the band is inset
 * by its 24pt padding either side, the numeral opener sets in the right column
 * of a 0.26 two-column split, and the rest use the full measure.
 */
export function sectionHeading(opts: {
  eyebrow: string;
  heading: string;
  numeral?: string;
  standfirst?: string;
  /** Production-measured length of `heading`, required when it is a binding. */
  headingChars?: number;
  /** Production-measured length of `standfirst`, required when it is a binding. */
  standfirstChars?: number;
  height?: number;
}): FlowItem {
  const c = ctx();
  const kind = sectionHeaderKind(c.manifest.section_header_style);
  const headingChars = boundChars(opts.heading, opts.headingChars, 'heading');
  const standfirstChars = opts.standfirst
    ? boundChars(opts.standfirst, opts.standfirstChars, 'standfirst')
    : 0;
  /**
   * The standfirst's depth at the size and measure the chosen kind sets it in.
   *
   * Each kind hands it to a different block at a different size, and reading
   * the wrong one is not a rounding error: the band's subtitle sets at 14pt
   * (`hero.html.ts`'s default, which nothing here overrides) while this used to
   * size it from `c.scale.body`, 9 or 10 in every family. The band reserved
   * about two thirds of the depth its own standfirst needs.
   */
  const standfirstDepth = (width: number, size: number, lineHeight: number): number => (
    standfirstChars ? textHeight(standfirstChars, { size, width, lineHeight }) : 0
  );

  if (kind === 'numeral' && opts.numeral) {
    // `ratio: 0.26` with a 26pt gutter, so the standfirst sets in the right
    // column rather than across the measure — and as `bodySize`, which this
    // block sets to the eyebrow size.
    const rightColumn = Math.max(1, (c.contentWidth - 26) * 0.74);
    const height = opts.height
      ?? Math.round(c.scale.heading * 2.6) + 20
        + standfirstDepth(rightColumn, c.scale.eyebrow, 1.5);
    return {
      height,
      block: (y) => block('two-column', {
        leftHeading: opts.numeral,
        leftBody: opts.eyebrow,
        rightHeading: opts.heading,
        rightBody: opts.standfirst ?? '',
        ratio: 0.26,
        gap: 26,
        headingSize: c.scale.heading,
        headingColor: 'token:ink',
        bodySize: c.scale.eyebrow,
        bodyColor: 'token:accentInk',
        x: c.contentLeft, y, width: c.contentWidth,
      }, 'Section opener'),
    };
  }

  if (kind === 'band') {
    /*
     * A band is a `hero`, and a hero anchors its content to its own BOTTOM edge
     * inside `overflow:hidden` (`hero.html.ts:78`). A band that is too short
     * therefore does not spill downward where `flow()`'s guard would see it —
     * the content rises out of the TOP and is cut off. On the Portfolio holdings
     * page that printed "Every property, and what it" into the running head and
     * left the word "contributes" alone inside a black band; on the overview
     * page it took the eyebrow off six of the ten families entirely.
     *
     * So the depth is derived from what the hero actually draws, at the sizes
     * it actually uses. Three of those are the block's own defaults, which
     * nothing here overrides — reading them from anywhere else is what made the
     * band and the renderer disagree.
     */
    const HERO_PADDING = 24; // hero.html.ts:64 — left/right/bottom inset
    const HERO_EYEBROW = 8; // hero.html.ts:55 — `eyebrowSize` default
    const HERO_SUBTITLE = 14; // hero.html.ts:53 — `subtitleSize` default
    const inner = Math.max(1, c.contentWidth - HERO_PADDING * 2);
    // `displayLines` is the same arithmetic this line always used; the 0.52 it
    // spelled out is now `DISPLAY_ADVANCE`, so the band and the verdict cannot
    // measure the same faces differently.
    const headingLines = displayLines(headingChars, c.scale.heading, inner);
    const measured = Math.ceil(
      HERO_PADDING
      // The eyebrow and its 6pt margin-bottom.
      + HERO_EYEBROW * 1.2 + 6
      // The title, at the hero's own 1.1 leading.
      + headingLines * c.scale.heading * 1.1
      // The subtitle and its 6pt margin-top.
      + (standfirstChars ? 6 + standfirstDepth(inner, HERO_SUBTITLE, 1.45) : 0)
      + HERO_PADDING,
    );
    const height = opts.height ?? Math.max(Math.round(c.scale.heading * 2.4) + 24, measured);
    return {
      height,
      block: (y) => block('hero', {
        eyebrow: opts.eyebrow,
        title: opts.heading,
        subtitle: opts.standfirst ?? '',
        bg: 'token:bg',
        color: 'token:text',
        accent: 'token:primary',
        titleSize: c.scale.heading,
        x: c.contentLeft, y, width: c.contentWidth, height,
        // 'Section opener', like the other four kinds.
        //
        // The name is load-bearing: `pagesWithContent` and
        // `closeDroppedBlocks` classify furniture by block NAME, and
        // 'Section band' was in neither set. So on a band-header master a
        // heading counted as content that draws — which meant a page whose
        // only real block was conditional could never be dropped, and the
        // hole its absence left could never be closed. That is the Risk page
        // opening "Risk register / Manageable with verification, not without
        // it" over a third of a page of white.
      }, 'Section opener'),
    };
  }

  // Only the `standfirst` kind draws one — `bare`, `decimal` and `eyebrow`
  // drop it, so reserving depth for it there would open a hole in the page.
  const height = opts.height
    ?? Math.round(c.scale.heading * 2.2) + 18
      + (kind === 'standfirst' ? standfirstDepth(c.contentWidth, c.scale.body, 1.5) : 0);
  const decimal = kind === 'decimal' && opts.numeral ? `${opts.numeral}  ` : '';
  return {
    height,
    block: (y) => block('text-block', {
      // `bare` moves the label to the rail or masthead, so the opener is
      // heading only and the page reads from the rail inwards.
      ...(kind === 'bare' ? {} : {
        eyebrow: opts.eyebrow,
        eyebrowSize: c.scale.eyebrow,
        eyebrowFont: 'token:mono',
        eyebrowTracking: TRACKING.eyebrow,
        eyebrowColor: 'token:accentInk',
      }),
      heading: `${decimal}${opts.heading}`,
      headingSize: c.scale.heading,
      headingFont: 'token:heading',
      headingWeight: 400,
      headingLineHeight: 1.14,
      headingColor: 'token:ink',
      ...(kind === 'standfirst' && opts.standfirst ? {
        body: opts.standfirst,
        bodySize: c.scale.body,
        bodyFont: 'token:body',
        bodyStyle: 'italic',
        bodyLineHeight: 1.5,
        color: 'token:mutedInk',
      } : {}),
      x: c.contentLeft, y, width: c.contentWidth,
    }, 'Section opener'),
  };
}

/**
 * The verdict heading — the dashboard's oversized statement.
 *
 * ## The two lines are the design, and the type is fitted to them
 *
 * The declared height reserves `verdict * 2.2` at a leading of 1.1, which is
 * exactly TWO lines of heading, and the reservation was never measured against
 * the sentence that fills it. Measured across all fifty Compass masters on
 * 19 September 2026, at this file's own 0.52 advance ratio:
 *
 * | what the heading resolves to | masters where it sets past 2 lines |
 * | --- | ---: |
 * | `RECOMMENDATION_BY_GRADE`, unqualified (59-89 chars) | **27 of 50** |
 * | the same with `qualifyRecommendation`'s coverage sentence (142-181) | **50 of 50** |
 *
 * So this has been wrong since the masters shipped, and the appended sentence
 * only made it universal. On 42 Patya Circuit it printed the heading's last
 * two lines THROUGH the KPI band below — `$1,975,000` and `$850` struck
 * out — because `flow()` fixes the next block's `y` from the declared height
 * and the renderer positions absolutely: an overlong block does not push the
 * page down and does not overflow it, it lays over what comes next.
 *
 * ## Why the type moves and the box does not
 *
 * The dashboard page has **15pt of slack above the footer on 49 of the 50
 * masters** — it is full. Growing the block to fit four lines would push the
 * KPI band, the callout and the footer off the page on every one of them. So
 * the block keeps its footprint exactly, the page geometry is unchanged, and
 * the heading is set at the largest size that fits `headingChars` into the two
 * lines the block declares. Where the designed size already fits — 23 of the
 * 50 — nothing changes at all.
 *
 * `headingChars` is required when the heading is a binding, for the reason
 * `boundChars` gives: a guessed default is the silent mis-size this exists to
 * stop.
 */
export function verdict(opts: {
  eyebrow: string;
  heading: string;
  body: string;
  /** Production-measured length of `heading`, required when it is a binding. */
  headingChars?: number;
}): FlowItem {
  const c = ctx();
  const height = Math.round(c.scale.verdict * 2.2 + c.scale.body * 4.6) + 18;
  const headingSize = fitToLines(
    boundChars(opts.heading, opts.headingChars, 'heading', 'verdict'),
    c.scale.verdict,
    c.contentWidth,
    VERDICT_HEADING_LINES,
  );
  return {
    height,
    block: (y) => block('text-block', {
      eyebrow: opts.eyebrow,
      eyebrowSize: c.scale.eyebrow,
      eyebrowFont: 'token:mono',
      eyebrowTracking: TRACKING.eyebrow,
      eyebrowColor: 'token:accentInk',
      heading: opts.heading,
      headingSize,
      headingFont: 'token:heading',
      headingWeight: 400,
      headingLineHeight: 1.1,
      headingColor: 'token:ink',
      body: opts.body,
      bodySize: c.scale.body,
      bodyFont: 'token:body',
      bodyLineHeight: 1.6,
      color: 'token:ink',
      x: c.contentLeft, y, width: c.contentWidth,
    }, 'Verdict'),
  };
}

/**
 * The companion note — where the rest of the analysis is.
 *
 * ## What it is
 *
 * `TIER_CONTENT.companionNote` is the sentence each tier uses to send a reader
 * to its companion document: "Purchase costs, yield, loan structure, cash flow
 * and the ten-year projection are set out in the Financial Analysis Report for
 * this property" on the Compass, and its mirror on the Financial Analysis.
 * `reportBindingProjection` has published it as `report.companionNote` since
 * the tier split and `render-investment-report-pdf` draws it — but the
 * delivered document comes through the TEMPLATE route, and no master bound it:
 * zero occurrences across `scripts/template-library/`, zero in the seeded
 * catalogue. The tier that is told to point elsewhere never did, on any page of
 * any document a client opened.
 *
 * ## Why it is not the section heading's standfirst
 *
 * That was the first attempt, and building the fifty masters counted it: 32 of
 * 50 Contents pages carried the binding and 18 did not. `sectionHeading` says
 * why, in the module itself — "only the `standfirst` kind draws one; `bare`,
 * `decimal` and `eyebrow` drop it". That is right for a section opener's
 * subtitle, which is styling. It is wrong here. `hasContents` records the same
 * rule one level up, from the same cause: a family's `toc_style: none` was a
 * statement about the decorative index it draws and it silenced the contents
 * page outright, so ten masters shipped client documents with no way to
 * navigate them. **A family's styling decides how a thing is drawn, never
 * whether the document carries it.**
 *
 * So the note is its own block, drawn by every master, in exactly the treatment
 * the `standfirst` kind would have given it — italic, muted, at body size and
 * 1.5 leading — and its height is `standfirstDepth`'s own arithmetic rather
 * than a second opinion about the same sentence.
 *
 * `chars` is the longest note any tier publishes, measured over `TIER_CONTENT`
 * rather than estimated: a block that under-declares does not overflow the
 * page, it prints over whatever `flow()` puts next.
 */
export function companionNote(binding: string, chars: number): FlowItem {
  const c = ctx();
  return {
    height: textHeight(chars, { size: c.scale.body, lineHeight: 1.5 }),
    block: (y) => block('text-block', {
      body: binding,
      bodySize: c.scale.body,
      bodyFont: 'token:body',
      bodyStyle: 'italic',
      bodyLineHeight: 1.5,
      color: 'token:mutedInk',
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

export function prose(body: string, height?: number): FlowItem {
  const c = ctx();
  return {
    height: height ?? 56,
    block: (y) => block('text-block', {
      body,
      bodySize: c.scale.body,
      bodyFont: 'token:body',
      bodyLineHeight: 1.62,
      // Justified for the editorial families; ragged right everywhere else,
      // because justification without hyphenation opens rivers at this measure.
      bodyAlign: c.type.body === 'Noto Serif' ? 'justify' : 'left',
      color: 'token:ink',
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/**
 * A page's worth of model-authored Markdown, set as structure.
 *
 * Unlike every other body helper this takes **source** rather than resolved
 * text, because `markdown-block` renders it. That is what makes the content
 * safe — the renderer escapes before it parses — and it is why the block is in
 * `PRODUCTION_SAFE_BLOCK_TYPES` at all.
 *
 * `linesPerPage` has to be the same number the projection used to compute
 * `qa.answerPages`, or a master will make a page conditional on a count that
 * disagrees with what the block draws. Both default to
 * `DEFAULT_LINES_PER_PAGE`, and neither should be overridden alone.
 */
export function markdown(
  source: string,
  pageIndex: number,
  height: number,
  linesPerPage: number = MARKDOWN_LINES_PER_PAGE,
): FlowItem {
  const c = ctx();
  return {
    height,
    block: (y) => block('markdown-block', {
      source,
      pageIndex,
      linesPerPage,
      bodySize: c.scale.body,
      bodyFont: 'token:body',
      headingFont: 'token:heading',
      lineHeight: 1.55,
      color: 'token:ink',
      headingColor: 'token:accentInk',
      ruleColor: 'token:line',
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/**
 * Lines per Markdown page, shared by the masters and the projection.
 *
 * Mirrors `DEFAULT_LINES_PER_PAGE` in `reports/markdownPaging.pure.ts`. It is
 * restated rather than imported because this build script must stay free of
 * runtime imports from the edge tree, and a spec asserts the two agree.
 */
export const MARKDOWN_LINES_PER_PAGE = 34;

export function rule(weight: number = RULE_WEIGHTS.hairline): FlowItem {
  const c = ctx();
  return {
    height: 2,
    gap: c.spacing.headingGap,
    block: (y) => block('divider', {
      color: 'token:line',
      style: 'solid',
      thickness: weight,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────────────────────

export interface KpiItem {
  label: string;
  value: string;
  note?: string;
  accent?: string;
  /**
   * Production-measured length of `value`, for the figures that are text.
   *
   * A KPI value is normally a formatted number that cannot wrap. A few are
   * prose — an address, an investor profile, a band name — and those set at the
   * band's figure size, which is the largest type on the page: the Cash Flow
   * Comparison verdict band sets `ranked.0.shortAddress` at 30.75pt into a
   * half-measure cell, wraps to two lines, and runs 33pt past a box sized for
   * one. Declaring the length is what lets the band reserve the second line.
   */
  valueChars?: number;
}

/** How many figures this template's KPI arrangement wants. */
export function kpiCapacity(): number {
  return kpiPlan(ctx().manifest.kpi_layout).items;
}

/**
 * The KPI band, in whichever arrangement the manifest declares.
 *
 * This is the catalogue's principal structural variable — 31 declared layouts
 * across ten families — and the axis on which masters within a family most
 * visibly diverge. `resolvers.ts` maps each to a primitive and a column count.
 */
export function kpis(items: KpiItem[]): FlowItem {
  const c = ctx();
  const plan = kpiPlan(c.manifest.kpi_layout);
  const shown = items.slice(0, plan.items);

  const shared = {
    items: shown,
    valueFont: c.numericFont,
    labelFont: 'token:mono',
    noteFont: 'token:body',
    labelSize: c.scale.kpiLabel,
    noteSize: c.scale.kpiNote,
    labelTracking: TRACKING.label,
    // A KPI band is read across, so the figures have to sit on one baseline.
    // From four-up the cells are narrow enough that a two-word label wraps —
    // "WEEKLY POSITION" beside "WEEKLY RENT" — and that column's value drops a
    // line below its neighbours. Reserving the second line costs a little white
    // above the short labels and keeps the row aligned. `rows` and `stacked`
    // set the label beside the value, so they need no reservation.
    labelLines: plan.variant === 'rows' || plan.variant === 'stacked'
      ? 1
      : (plan.columns >= 4 ? 2 : 1),
    valueColor: 'token:ink',
    labelColor: 'token:mutedInk',
    ruleColor: 'token:line',
    emphasisColor: 'token:ink',
    valueWeight: 400,
    x: c.contentLeft,
    width: c.contentWidth,
  };

  /**
   * A note sets on its own line under the figure, and none of the heights
   * below reserved it.
   *
   * The KPI grid is given an explicit `height`, so its box is exactly what is
   * declared — and its content is not clipped, it spills. Measured on the
   * Portfolio overview: a five-row ledger declared 142pt and set 177, a
   * six-row one declared 162 and set 207, and in each case the block below was
   * printed across the last two figures. Nothing in the arithmetic guard could
   * see it, because the page bottom was never crossed.
   */
  const noteLine = shown.some((k) => k.note) ? Math.round(c.scale.kpiNote * 1.7) : 0;

  /**
   * The height of a grid of cells, derived from the cell the renderer draws.
   *
   * `display` and `ruled` are ONE branch in `kpiGrid.html.ts` — the same cell,
   * differing only in how many go on a row — so they are sized here by the same
   * arithmetic. It builds a cell as padding, a label band at 1.25, the figure
   * at `line-height:1` under an 8pt margin, an optional note at 1.35 under a
   * 5pt margin, and padding again.
   *
   * Both heights used to be a constant with no `valueSize` in it (`ruled`) or a
   * flat multiple of it (`display`), and neither counted a line that wrapped.
   * Measured in Chromium: Grid's verdict band declared 90pt and set 114.8,
   * Objective's declared 91 and set 122.4, and Night Desk's declared 144 and
   * set 164.1 — in each case the caption `flow()` placed underneath was printed
   * across the last line of the figures.
   *
   * The grid is `repeat(n, 1fr)` with NO gap, so a cell is the measure over the
   * columns less its own padding. At six columns that is under 60pt, narrow
   * enough that the label and note wrap as well as the figure — which is why
   * every line count is computed rather than assumed.
   */
  const gridHeight = (perRow: number, valueSize: number): number => {
    const rows = Math.ceil(shown.length / perRow);
    const padTop = plan.cellBorders ? 10 : 11;
    const padBottom = plan.cellBorders ? 11 : 12;
    const cellPad = plan.cellBorders ? 20 : 24;
    const cellWidth = Math.max(1, c.contentWidth / perRow - cellPad);
    const linesFor = (chars: number, size: number): number => Math.max(
      1, Math.ceil(chars / Math.max(1, Math.floor(cellWidth / (size * 0.5)))),
    );
    // A bound label or note cannot be measured from its own source text.
    const literal = (s: string | undefined): number => (s && !s.includes('{{') ? s.length : 0);
    const bound = (s: string | undefined): boolean => !!s && s.includes('{{');
    const labelLines = Math.max(
      shared.labelLines,
      ...shown.map((k) => linesFor(literal(k.label), c.scale.kpiLabel)),
    );
    const valueLines = Math.max(
      1, ...shown.map((k) => (k.valueChars ? linesFor(k.valueChars, valueSize) : 1)),
    );
    /*
     * A BOUND note is budgeted two lines, for the reason `shared.labelLines`
     * already budgets two for a bound label: `literal()` answers 0 for
     * anything carrying `{{`, so `linesFor` returns its floor of 1 and the
     * budget becomes a promise about text the template does not hold.
     *
     * Measured on the cash-flow page's "Where it lands", 21 Sep 2026: the
     * note under *Value at year ten* renders "From $1,336,400 at year one"
     * and sets two lines in the cell, and the block below — the optional
     * equity callout `ifItFits` keeps — took 2pt of it on four masters. The
     * comment two lines above states the limitation and the arithmetic then
     * ignored it.
     *
     * A note whose text IS literal is still measured from it, so nothing that
     * fits today grows.
     */
    const noteLines = shown.some((k) => k.note)
      ? Math.max(
        shown.some((k) => bound(k.note)) ? 2 : 1,
        ...shown.map((k) => linesFor(literal(k.note), c.scale.kpiNote)),
      )
      : 0;
    const cell = padTop
      + labelLines * c.scale.kpiLabel * 1.25
      + 8 + valueLines * valueSize
      + (noteLines ? 5 + noteLines * c.scale.kpiNote * 1.35 : 0)
      + padBottom;
    return Math.ceil(rows * cell);
  };

  if (plan.variant === 'display') {
    // `kpiGrid.html.ts` caps a display grid at two across, whatever the plan says.
    const height = gridHeight(Math.min(plan.columns, 2), c.scale.kpiValue);
    return {
      height,
      block: (y) => block('kpi-grid', {
        ...shared, variant: 'display', columns: plan.columns,
        valueSize: c.scale.kpiValue, y, height,
      }, 'KPI display'),
    };
  }

  if (plan.variant === 'rows') {
    const height = 12 + shown.length * (Math.round(c.scale.kpiValue * 0.72 + 16) + noteLine);
    return {
      height,
      block: (y) => block('kpi-grid', {
        ...shared, variant: 'rows',
        valueSize: Math.round(c.scale.kpiValue * 0.72), y, height,
      }, 'KPI ledger'),
    };
  }

  if (plan.variant === 'stacked') {
    const height = shown.length * (Math.round(c.scale.kpiValue * 0.8 + 26) + noteLine);
    return {
      height,
      block: (y) => block('kpi-grid', {
        ...shared, variant: 'stacked',
        accent: 'token:primary',
        valueSize: Math.round(c.scale.kpiValue * 0.8), y, height,
      }, 'KPI stack'),
    };
  }

  if (plan.variant === 'tile') {
    /*
     * Measured, like `display` and `ruled`, and spreading `shared` like all
     * four others.
     *
     * This declared `height = 82` and spread nothing, so it was the one
     * variant whose box was a guess and the one variant whose `labelLines`
     * reserve never reached the renderer. `kpiGrid.html.ts` draws a tile with
     * `overflow:hidden`, so where the others spill this one CLIPS: a prose
     * value — a withheld-grade sentence, say — was cut off mid-word, and
     * labels of different lengths wrapped independently so the tiles' bottoms
     * fell out of line. `card_row_with_trend` maps here, and the trend note
     * its name is about had nowhere to go.
     */
    const valueSize = Math.round(c.scale.kpiValue * 0.7);
    const height = gridHeight(plan.columns, valueSize);
    return {
      height,
      block: (y) => block('kpi-grid', {
        ...shared,
        variant: 'tile',
        columns: plan.columns,
        gap: 10,
        tileBg: 'token:panel',
        accent: 'token:primary',
        labelColor: 'token:mutedInk',
        radius: c.radius,
        valueSize, y, height,
      }, 'KPI cards'),
    };
  }

  // ruled — one or more rows of hairline-separated columns.
  //
  // Six columns give each figure ~78pt of measure; a formatted currency value
  // overruns the four-column size there, so the band steps down.
  const valueSize = plan.columns >= 6
    ? Math.round(c.scale.kpiValue * 0.62)
    : plan.columns === 5
      ? Math.round(c.scale.kpiValue * 0.74)
      : c.scale.kpiValue;
  const height = gridHeight(plan.columns, valueSize);
  return {
    height,
    block: (y) => block('kpi-grid', {
      ...shared, variant: 'ruled', columns: plan.columns,
      ...(plan.cellBorders ? { cellBorders: true } : {}),
      valueSize, y, height,
    }, 'KPI band'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

/** A table in whichever treatment `table_style` declares. */
/**
 * Column widths as FRACTIONS, from the point measures a table is laid out in.
 *
 * `data-table` renders `columnWidths` as percentages — `width:${w * 100}%` — so
 * a fraction is what it wants. Four masters passed POINTS instead
 * (`[c.contentWidth - 330, 90, 70, 70, 100]` is `width:18500%` on the first
 * column), and it only ever looked right because each array sums to exactly
 * `contentWidth`, so the browser's proportional normalisation lands on the
 * ratios a correct fraction array would have produced.
 *
 * That is luck holding a layout up: change one number without its partner, or
 * write an array that does not sum to the measure, and the columns silently
 * stop meaning what they say. Normalised against the array's own sum, so a
 * table whose widths do not add up is still drawn in the proportions its author
 * wrote rather than overflowing the measure. Already-fractional arrays are
 * unchanged — they sum to 1.
 */
export function cols(...points: number[]): number[] {
  const total = points.reduce((sum, w) => sum + w, 0);
  return total > 0 ? points.map((w) => w / total) : points;
}

/**
 * A table row, optionally guarded.
 *
 * A bare `string[]` is a row that always prints — every table in the catalogue
 * was written that way and none of them moves. `{ cells, when }` prints only
 * where the expression holds, which is how a page keeps the promise a label
 * makes: see `visibleTableRows` in `blocks/_data.ts` for the counted reason and
 * for why the choice is per row rather than per table.
 */
export type TableRowDef = string[] | { cells: string[]; when: string };

export function table(opts: {
  headers: string[];
  rows: TableRowDef[];
  columnWidths?: number[];
  /** Indices of rows that close a total. */
  totals?: number[];
  numeric?: number[];
  /**
   * The longest a cell runs, and in which column, when the text wraps.
   *
   * A table row is one line tall unless something in it is too long for its
   * column, and the declared height assumed the former for every table in the
   * catalogue. That is fine for a figure and wrong for a sentence: the
   * Commercial Capacity scenarios table sets a 177-character impact into a
   * 140pt column and a 164-character question across the measure, so its rows
   * wrap to three and four lines and the page ran 26pt past the footer on
   * `le-03` — declared nine rows, drew about thirty lines.
   *
   * Given this, the row height is sized from the wrap instead, the same way
   * `definitions` takes its `chars`. Omitted, the height is unchanged, so no
   * existing table moves.
   */
  wraps?: { chars: number; columnWidth: number };
}): FlowItem {
  const c = ctx();
  const plan = tablePlan(c.manifest.table_style);
  /*
   * The row height the renderer actually draws, not the spacing scale's idea
   * of one.
   *
   * `data-table` sets every cell `padding:${cellPad}pt 8pt` at `fontSize`, so a
   * one-line row is `2 × cellPad + fontSize × lineHeight` and nothing else.
   * `spacing.rowHeight` is a smaller number that no part of the renderer reads,
   * and the difference is per row — which is why the overlaps scaled with the
   * table: measured in Chromium at A4, Chancery draws 19.5pt where the scale
   * declared 13.25, so an eight-row table ran ~50pt past what `flow()` had
   * reserved and printed over the block beneath it. The Investment Compass QA
   * reported exactly that on 45 blocks, 33–52pt on the Commercial Capacity
   * constraints table alone.
   *
   * 1.3 is the line box, measured across the spacing range rather than assumed:
   * Chancery 19.5pt at 4.5pt padding and 8.5pt type, Grid 17.25 at 3.5/8.25,
   * Executive Rail 18 at 4/7.75 — a ratio of 1.235, rounded up so the
   * declaration is never the short side.
   *
   * Floored at the old value so no table in the catalogue gets *smaller*: this
   * may only ever reserve more space than it did.
   */
  const cellPad = plan.tight ? Math.max(1.5, c.spacing.cellPadding - 1.5) : c.spacing.cellPadding;
  const drawnRow = 2 * cellPad + c.scale.cell * 1.3;
  const scaleRow = plan.tight ? c.spacing.rowHeight - 3 : c.spacing.rowHeight;
  const flat = Math.max(scaleRow, drawnRow);
  const rowHeight = opts.wraps
    ? Math.max(flat, textHeight(opts.wraps.chars, {
      size: c.scale.cell,
      width: opts.wraps.columnWidth,
      extra: 2 * (plan.tight ? Math.max(1.5, c.spacing.cellPadding - 1.5) : c.spacing.cellPadding),
    }))
    : flat;
  const numericColumns = opts.numeric ?? opts.headers.map((_, i) => i).slice(1);
  // Same value as `cellPad` above; kept under its original name for the block
  // props below, which is what the renderer reads.
  const cellPadding = cellPad;

  return {
    height: 24 + opts.rows.length * rowHeight,
    block: (y) => block('data-table', {
      headers: opts.headers,
      rows: opts.rows.map((row) => (Array.isArray(row) ? { cells: row } : { cells: row.cells, when: row.when })),
      ...(opts.columnWidths ? { columnWidths: opts.columnWidths } : {}),
      headerStyle: plan.headerStyle,
      headerBg: 'token:primary',
      headerFg: 'token:onPrimary',
      headerFont: 'token:mono',
      headerSize: c.scale.columnHead,
      headerTracking: TRACKING.columnHead,
      numericFont: c.numericFont,
      numericColumns,
      ...(plan.doubleRuleTotals && opts.totals?.length ? { totalRows: opts.totals } : {}),
      rowRule: plan.rowRule,
      outerBorder: plan.outerBorder,
      ...(plan.gridLines ? { gridLines: true } : {}),
      stripeBg: plan.stripe ? 'token:panel' : 'transparent',
      cellFg: 'token:ink',
      borderColor: 'token:line',
      emphasisColor: 'token:ink',
      negativeColor: 'token:negative',
      fontSize: c.scale.cell,
      cellPadding,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Callouts, risk, recommendation
// ─────────────────────────────────────────────────────────────────────────────

/** A callout in whichever treatment `callout_style` declares. */
export function callout(title: string, body: string, height?: number): FlowItem {
  const c = ctx();
  const kind = calloutKind(c.manifest.callout_style);
  const style = kind === 'badge' ? 'badge' : kind === 'margin' ? 'margin' : 'bar';
  return {
    height: height ?? (kind === 'margin' ? 58 : 72),
    block: (y) => block('callout', {
      title,
      body,
      variant: 'info',
      style,
      accent: 'token:primary',
      titleColor: 'token:accentInk',
      // A flat block fills without an accent edge; a bar keeps the edge.
      bg: kind === 'margin' ? 'transparent' : 'token:panel',
      ...(kind === 'block' ? { barWidth: 0 } : {}),
      ruleColor: 'token:primary',
      color: 'token:ink',
      titleFont: 'token:mono',
      bodyFont: 'token:body',
      titleSize: c.scale.kpiLabel,
      titleTracking: TRACKING.label,
      bodySize: c.scale.cell,
      radius: c.radius,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/**
 * The risk presentation, per `risk_display`.
 *
 * `chars` is the longest of the per-row prose fields — `why` and the
 * verification action — measured rather than assumed. The register kind prints
 * both under the hazard, so a row is at least two paragraphs deep, and the flat
 * 46pt it reserved was right only for a one-line pair. On the Investment
 * Compass risk page that put the register across the recommendation beneath it
 * on 23 of the 50 masters, by up to 47pt.
 *
 * The `bars` kind draws a label and a bar and needs none of this.
 */
export function risks(
  title: string,
  items: Array<{ risk: string; rating: string; confidence: string; why: string; ddAction: string; note?: string }>,
  chars?: number,
): FlowItem {
  const c = ctx();
  const bars = riskKind(c.manifest.risk_display) === 'bars';
  /*
   * `+22` was 8pt of cell padding above, 8pt below and 6pt spare, and the
   * spare is what ran out. Measured on `Frontispiece [compass]` p6 with the
   * catalogue's real faces installed — the first measurement of this block
   * ever taken in the face it ships in, because every earlier run of the
   * geometry gate loaded no webfont at all (`assertDeclaredFacesResolve` in
   * `qa.ts`) — the register's ink ends at 369.1pt where the block below it
   * begins at 363.0pt: **6.1pt** past its declared slot.
   *
   * What made that 6.1pt a collision rather than a tight fit is the block
   * BELOW. The page declares the register at y=199, a withheld-register
   * callout at 363 and the recommendation at 437; the callout is conditional
   * on there being no risk string, so on a record that carries one it is
   * dropped and `closeDroppedBlocks` moves the recommendation up into the
   * band the callout held — onto the 6.1pt the register had already
   * overrun. Neither block is wrong on its own, which is why this needed a
   * render to find.
   *
   * 30 rather than 22: the observed shortfall plus headroom, since the two
   * prose columns are bound and this budget is a promise about text the
   * template does not hold.
   */
  const rowHeight = chars === undefined
    ? 46
    : Math.max(46, textHeight(chars, { size: c.scale.cell, width: c.contentWidth * 0.74 }) * 2 + 30);
  return {
    height: bars ? 26 + items.length * 24 : 44 + items.length * rowHeight,
    block: (y) => block('risk-register', {
      title,
      items,
      ...(bars ? { display: 'bars' } : {}),
      titleBg: 'token:bg',
      titleFg: 'token:accentOnField',
      headerBg: 'token:panel',
      headerFg: 'token:mutedInk',
      stripeBg: 'token:panel',
      rowBg: 'token:surface',
      cellFg: 'token:ink',
      mutedColor: 'token:mutedInk',
      borderColor: 'token:line',
      negativeColor: 'token:negative',
      cautionColor: 'token:caution',
      positiveColor: 'token:positive',
      labelFont: 'token:mono',
      bodyFont: 'token:body',
      eyebrowFont: 'token:mono',
      labelTracking: TRACKING.columnHead,
      eyebrowTracking: TRACKING.label,
      fontSize: c.scale.cell,
      titleSize: c.scale.eyebrow,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/**
 * The recommendation.
 *
 * Three kinds: a filled card on the field colour (the one place a content page
 * carries the cover's ground), ruled type on paper set like the rest of the
 * statement, and a bordered box.
 */
export function recommendation(heading: string, body: string): FlowItem {
  const c = ctx();
  const kind = recommendationKind(c.manifest.recommendation_style);

  if (kind === 'statement') {
    return {
      height: 96,
      block: (y) => block('text-block', {
        eyebrow: 'Recommendation',
        eyebrowSize: c.scale.kpiLabel,
        eyebrowFont: 'token:mono',
        eyebrowTracking: TRACKING.label,
        eyebrowColor: 'token:accentInk',
        heading,
        headingSize: Math.round(c.scale.heading * 0.78),
        headingFont: 'token:heading',
        headingWeight: 400,
        headingLineHeight: 1.2,
        headingColor: 'token:ink',
        body,
        bodySize: c.scale.body,
        bodyFont: 'token:body',
        bodyLineHeight: 1.55,
        color: 'token:ink',
        x: c.contentLeft, y, width: c.contentWidth,
      }, 'Recommendation'),
    };
  }

  const onField = kind === 'card';
  return {
    height: 96,
    block: (y) => block('decision-box', {
      heading,
      body,
      // The 60-word default silently truncates an adviser's recommendation, and
      // a client-facing sentence ending in an ellipsis is worse than a longer
      // card.
      maxWords: 90,
      accent: 'token:primary',
      bg: onField ? 'token:bg' : 'token:surface',
      color: onField ? 'token:text' : 'token:ink',
      headingColor: onField ? 'token:accentOnField' : 'token:accentInk',
      headingFont: 'token:mono',
      headingSize: c.scale.kpiLabel,
      headingTracking: TRACKING.label,
      bodyFont: 'token:body',
      bodySize: c.scale.body,
      radius: c.radius,
      barWidth: onField ? 2 : 1,
      x: c.contentLeft, y, width: c.contentWidth,
    }, 'Recommendation'),
  };
}

/**
 * Two marked columns — what is working against what to keep an eye on.
 *
 * The titles are overridable because the shape outlives the words: a portfolio's
 * risk page pairs its mitigations against its exposures, which is the same
 * positive/caution reading with different labels. Defaulting them keeps every
 * existing call site unchanged.
 */
export function strengthsWatch(
  strengths: string[],
  watch: string[],
  titles?: { strengths: string; watch: string },
  chars?: number,
): FlowItem {
  const c = ctx();
  // Each column is half the measure less the gap, so an item wraps at roughly
  // half the characters the same sentence would take across the page. `chars`
  // is the longest item the caller expects; see `textHeight`.
  const rowHeight = chars === undefined
    ? 32
    : Math.max(32, textHeight(chars, {
      size: c.scale.cell,
      width: c.contentWidth * 0.5 - 22,
      extra: 8,
    }));
  return {
    height: 36 + Math.max(strengths.length, watch.length) * rowHeight,
    block: (y) => block('strengths-watch', {
      strengthsTitle: titles?.strengths ?? 'Strengths',
      strengths,
      watchTitle: titles?.watch ?? 'Considerations',
      watch,
      positiveColor: 'token:positive',
      cautionColor: 'token:negative',
      onFillColor: 'token:surface',
      color: 'token:ink',
      // Marked the way this family marks a callout, rather than a solid band on
      // all fifty masters. See `strengthsWatchStyle`.
      style: strengthsWatchStyle(c.manifest.callout_style),
      titleFont: 'token:heading',
      titleSize: c.scale.columnHead,
      titleTracking: TRACKING.label,
      bodyFont: 'token:body',
      bodySize: c.scale.cell,
      ruleWeight: c.manifest.border_treatment === 'rule_2px' ? RULE_WEIGHTS.heavy : RULE_WEIGHTS.hairline,
      radius: c.radius,
      x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/**
 * A term/definition list.
 *
 * `chars` is the longest definition this list expects to be given, measured
 * against production rather than guessed. Without it every row is reserved a
 * single line — right for the one-word statuses this block was written for
 * ("Positive", "Comfortable"), and wrong by a factor of five for a paragraph.
 * See `textHeight`.
 */
export function definitions(
  title: string,
  items: Array<{ term: string; definition: string; when?: string }>,
  chars?: number,
): FlowItem {
  const c = ctx();
  /*
   * Derived from the row `extras.html.ts:364` draws, not from a flat 26.
   *
   * That row is `grid-template-columns:160pt 1fr` with a 14pt gutter, 8pt of
   * padding either side and a hairline under it, and BOTH columns set at 9.5pt
   * whatever the family's own scale says — the definition on a 1.45 leading.
   * So one line is already ~30.8pt and the reserved 26 was short on every row
   * of every definition list in the catalogue. It only showed where the rows
   * were numerous enough to accumulate: the Borrowing Capacity serviceability
   * page, six rows deep, printed its last line into the callout beneath it.
   *
   * The measure matters as much as the depth. The definition does not get two
   * thirds of the page — it gets whatever is left after a fixed 160pt term
   * column, which on a narrow master is closer to half.
   */
  const TERM_COLUMN = 160;
  const GUTTER = 14;
  const SIZE = 9.5;
  const LEADING = 1.45;
  const measure = Math.max(1, c.contentWidth - TERM_COLUMN - GUTTER);
  const lines = chars === undefined
    ? 1
    : Math.max(1, Math.ceil(chars / Math.max(1, Math.floor(measure / (SIZE * 0.5)))));
  const rowHeight = 8 + Math.max(SIZE * 1.2, lines * SIZE * LEADING) + 8 + 1;
  return {
    height: Math.ceil(30 + items.length * rowHeight),
    block: (y) => block('definition-list', {
      title, items, x: c.contentLeft, y, width: c.contentWidth,
    }),
  };
}

/**
 * A contents page, for the families whose `toc_style` is not `none`.
 *
 * ## The renderer writes the list; `entries` only sizes it
 *
 * `toc` does not draw what it is handed. It walks the document's own rendered
 * pages and sets one row per page, with that page's real name and real number —
 * which is the right behaviour, because it stays true when a conditional page
 * drops out and a hand-written list does not.
 *
 * `title` is the block's *heading*, and this used to be given
 * `entries.join('\n')`. A `<div>` collapses newlines, so every contents page in
 * seven formats printed all twelve section names as one run-on line at heading
 * size — "The verdict Executive summary The ranking The scorecard Money ·
 * return, cash flow …" — set above the real list, which was directly beneath it.
 * The page already carries a `sectionHeading` reading "Contents", so the block
 * wants no heading of its own: the renderer omits it when it is empty.
 *
 * `entries` is therefore a size hint and nothing else, and it is a floor rather
 * than the truth — the row count is the document's page count, which is larger
 * than the list of section names whenever a section runs to more than one page.
 * `ROW_SLACK` covers that gap, because a block that declares less height than
 * it draws does not overflow the page, it prints over whatever is under it.
 */
const CONTENTS_ROW = 20;
/**
 * Extra rows the contents block reserves beyond the section names it is given.
 *
 * Measured against the stored production rows: a Property Comparison renders 17
 * pages from a 12-name list, the widest gap of the seven formats that declare a
 * contents page. Reserving eight rows covers it with a row to spare, and an
 * over-declared block only leaves white space.
 */
const CONTENTS_ROW_SLACK = 8;

export function contents(entries: string[]): FlowItem {
  const c = ctx();
  return {
    height: 40 + (entries.length + CONTENTS_ROW_SLACK) * CONTENTS_ROW,
    block: (y) => block('toc', {
      // Deliberately no title: the page's own section heading says "Contents".
      title: '',
      titleSize: c.scale.heading,
      titleColor: 'token:ink',
      color: 'token:ink',
      indexColor: 'token:primary',
      size: c.scale.body,
      lineHeight: CONTENTS_ROW,
      x: c.contentLeft, y, width: c.contentWidth,
    }, 'Contents'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scenario chart, drawn by whichever block `chart_style` resolves to.
 *
 * `smallMultiples` families draw the series at panel size — the research
 * exhibit and the analyst's small multiples — which here means a shorter block,
 * since a panel is a fraction of a plate.
 */
export function scenarioChart(opts: {
  title: string;
  caption: string;
  dataPath: string;
  data: Array<{ label: string; value: number }>;
  height?: number;
  /**
   * Which keys of a bound element carry the label and the figure.
   *
   * Default `label`/`value`, which is the shape the Investment Compass masters
   * assume. A projection that publishes whole rows — the Cash Flow series is
   * ten objects of eight fields each — names the two it wants plotted rather
   * than being reshaped into a second array purely for the chart.
   */
  labelKey?: string;
  valueKey?: string;
  /**
   * How the y-axis ticks are worded.
   *
   * `plain` invents no unit and is the default; a caller plotting dollars says
   * so, and gets `$348k` … `$1.1m` down the axis instead of `348150`. The
   * renderer will not guess this — a chart that labels a ratio as currency is
   * a misstated figure on a client's page, which is the one thing the chart
   * path must never do.
   */
  axis?: 'money' | 'percent' | 'plain';
  /** Set beside the axis, rotated. Omitted, no title is drawn. */
  yAxisLabel?: string;
}): FlowItem {
  const c = ctx();
  const plan = chartPlan(c.manifest.chart_style);
  const base = c.density === 'compact' ? 158 : c.density === 'spacious' ? 224 : 186;
  const height = opts.height
    ?? (plan.block === 'sparkline' ? 92 : plan.smallMultiples ? Math.round(base * 0.72) : base);
  // `sparkline` takes a bare series rather than a titled chart.
  const isSparkline = plan.block === 'sparkline';
  return {
    height,
    block: (y) => block(plan.block, {
      // A sparkline is a bare series with no room for a scale, so it takes
      // neither the titles nor the axis.
      ...(isSparkline ? {} : {
        title: opts.title,
        caption: opts.caption,
        ...(opts.axis ? { axis: opts.axis } : {}),
        ...(opts.yAxisLabel ? { yAxisLabel: opts.yAxisLabel } : {}),
      }),
      dataPath: opts.dataPath,
      data: opts.data,
      labelKey: opts.labelKey ?? 'label',
      valueKey: opts.valueKey ?? 'value',
      accent: 'token:primary',
      x: c.contentLeft, y, width: c.contentWidth, height,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image plates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a plate's photograph comes from.
 *
 * `property.images` is a forward-looking path: **no adapter emits it today**.
 * That is deliberate rather than an oversight. A plate is a designed hole an
 * operator fills in the Builder for a specific report — the archetype's own
 * briefs say "Drop the hero photograph" — and binding it means the day an
 * adapter does carry photographs, every plate in two families fills itself with
 * no template change.
 *
 * Until then the binding resolves empty, and the plate prints nothing.
 */
function plateSrc(index: number): string {
  return `{{property.images.${index}}}`;
}

/**
 * The condition under which a plate renders at all.
 *
 * This is the whole answer to the catalogue's own warning — Monograph exists
 * because "empty plates never print as holes". Three failure modes are covered
 * by one expression:
 *
 *   - `property` absent entirely (a sparse report): `evalConditional` rejects an
 *     expression naming an unbound identifier and returns false. No render.
 *   - `property.images` absent: the guard is falsy. No render.
 *   - `property.images[n]` present but an empty string: also falsy, which is why
 *     the index is tested rather than the array's length.
 */
function plateConditional(index: number): string {
  return `property && property.images && property.images[${index}]`;
}

/**
 * A plate on its own page.
 *
 * ## Why a plate is a page and never a slot in the flow
 *
 * The archetype runs its narrative plate across the top of a content page with
 * the heading reversed out of it. That is the better picture and the wrong
 * shape for a fixed-position renderer with no reflow, for two reasons that
 * pull in the same direction:
 *
 *   - The pages the plates belong to are already full. Dropping 90mm of
 *     photograph into "The property" or "Investment thesis" overflowed eight of
 *     the ten plated variants — up to 123pt past the content bottom on
 *     `le-03`, which is a page and a half of prose pushed off the paper.
 *   - Most reports carry no photographs at all. An inline plate reserves its
 *     height whether or not it is filled, so the common case would be a hole in
 *     the middle of the argument, or (worse) type set over blank space where a
 *     picture was supposed to be.
 *
 * A page solves both. It always fits, because it is measured against nothing;
 * and it carries the plate's `conditional` on the PAGE, so an unfilled plate
 * costs no page rather than an empty one. `visiblePages` filters it out before
 * anything is laid out, which is why this is the only placement that vanishes
 * completely.
 *
 * ## The two treatments
 *
 * `bleed` is the family's difference, not a per-plate option. Luxury Editorial
 * is a monograph — its plates run to the trim with the asset's name reversed
 * out of a scrim at the foot, and the page ground is the field colour so an
 * unfilled edge is never white. Architectural Property measures instead of
 * bleeds: the plate is inset to the page margin and captioned "FIGURE N ·" in
 * tracked mono, which is what its `four_measured` slot plan names.
 */
export function platePage(opts: {
  index: number;
  brief: string;
  name: string;
  caption?: string;
  bleed: boolean;
}): PageDef {
  const blocks = opts.bleed ? bleedPlateBlocks(opts) : measuredPlateBlocks(opts);
  const p = page(opts.name, blocks, opts.bleed ? 'token:bg' : 'token:surface');
  return { ...p, conditional: plateConditional(opts.index) };
}

/** Luxury Editorial: to the trim, with a reversed caption band at the foot. */
function bleedPlateBlocks(opts: {
  index: number; brief: string; caption?: string;
}): BlockDef[] {
  const c = ctx();
  // Deep enough for a tracked label over two lines of address at heading size,
  // plus the run-up the fade needs: the scrim reaches full strength over the
  // bottom two fifths, so a band sized to the type alone would ramp under it.
  const band = c.margin * 2 + Math.round(c.scale.heading * 2.4) + 90;
  return [
    block('image', {
      src: plateSrc(opts.index),
      fit: 'cover',
      // Never a grey "No image" rectangle on a client's report.
      placeholder: false,
      x: 0, y: 0, width: PAGE.width, height: PAGE.height,
    }, opts.brief),
    // `tint` rather than `bg`: the hero paints its tint at 0.55 opacity, which
    // is what makes reversed type legible over an unknown photograph. `bg` is
    // opaque and would hide the foot of the plate entirely — and `tintFade`
    // ramps it in, because a flat band draws a hard edge across the picture.
    block('hero', {
      tintFade: true,
      title: '{{property.address}}',
      titleSize: c.scale.heading,
      titleFont: 'token:heading',
      titleColor: 'token:text',
      ...(opts.caption
        ? {
          eyebrow: opts.caption,
          eyebrowSize: c.scale.eyebrow,
          eyebrowFont: 'token:mono',
          eyebrowTracking: TRACKING.label,
          eyebrowColor: 'token:accentOnField',
        }
        : {}),
      tint: 'token:bg',
      padding: c.margin,
      x: 0, y: PAGE.height - band, width: PAGE.width, height: band,
    }, 'Plate caption'),
  ];
}

/**
 * Architectural Property: inset to the page margin and captioned.
 *
 * Symmetric on `margin` rather than the content measure: a plate page carries
 * no running head and no rail, so there is no lane for it to align to, and a
 * plate pushed 30pt right of centre to clear a rail that is not drawn reads as
 * a mistake.
 *
 * The caption is the `image` block's own — it reserves its height inside the
 * box, so the picture shortens to make room rather than the caption falling off
 * the page.
 */
function measuredPlateBlocks(opts: {
  index: number; brief: string; caption?: string;
}): BlockDef[] {
  const c = ctx();
  return [
    block('image', {
      src: plateSrc(opts.index),
      ...(opts.caption ? { caption: opts.caption } : {}),
      captionColor: 'token:mutedInk',
      captionSize: c.scale.kpiNote,
      captionFont: 'token:mono',
      captionStyle: 'normal',
      captionTransform: 'uppercase',
      captionTracking: TRACKING.label,
      fit: 'cover',
      radius: c.radius,
      placeholder: false,
      x: c.margin,
      y: c.margin,
      width: PAGE.width - c.margin * 2,
      height: PAGE.height - c.margin * 2,
    }, opts.brief),
  ];
}

/**
 * The cover's photographic ground.
 *
 * Emitted as the first block on the cover so the wordmark, title and fact band
 * paint over it. When it is absent the cover falls back to its field colour,
 * which is exactly the typographic cover the `three_interior` and `none`
 * variants use — so the two are one composition rather than two.
 *
 * The scrim is what makes reversed type legible over an unknown photograph. The
 * archetype uses two gradients; this uses one flat tint at the same intent,
 * because a `hero`'s `tint` is a solid and a gradient stop would have to be a
 * literal colour, which `isBrandSafe()` would fail.
 */
export function coverHero(index: number, brief: string): BlockDef[] {
  return [
    block('image', {
      src: plateSrc(index),
      fit: 'cover',
      placeholder: false,
      x: 0, y: 0, width: PAGE.width, height: PAGE.height,
    }, brief),
    // `tint` rather than `bg`: the hero paints a tint at 0.55 opacity, which is
    // what makes reversed type legible over an unknown photograph. `bg` is
    // opaque and would hide the plate entirely.
    block('hero', {
      title: '',
      tint: 'token:bg',
      x: 0, y: 0, width: PAGE.width, height: PAGE.height,
    }, 'Cover scrim'),
  ].map((b) => ({ ...b, conditional: plateConditional(index) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Appendix
// ─────────────────────────────────────────────────────────────────────────────

export function disclaimerPage(text: string): PageDef {
  return page('Important information', [
    block('disclaimer', {
      companyName: '{{org.name}}',
      abn: '{{org.abn}}',
      address: '{{org.address}}',
      phone: '{{org.phone}}',
      email: '{{org.email}}',
      website: '{{org.website}}',
      // The second of the two surfaces `REPORT_RULES.md` §5 allows a mark on.
      // This page is an obsidian ground, so it takes the mono lockup — the mark
      // is a gold gradient and is never auto-inverted. The block omits it when
      // the binding resolves to nothing.
      mark: '{{org.markMono}}',
      markHeight: 37,
      /*
       * The deployment's own disclaimer, not this constant.
       *
       * `text` is `STANDARD_DISCLAIMER` — five lines of generic boilerplate —
       * and baking it into the schema meant all 543 seeded templates carried
       * it verbatim. This deployment has `professional_disclaimer` set:
       * ~1,400 characters over nine paragraphs, `is_enabled: true`, written
       * for a Buyers Agent. It reached the legacy composer and nothing else,
       * so every design-system document showed the wrong disclaimer — which
       * is what "the disclaimer section isn't rendering" turned out to be.
       *
       * Bound rather than seeded, so editing it on the Report Settings page
       * changes the next document instead of requiring a re-seed of the
       * catalogue. `?? ...` is the block's own fallback for a deployment that
       * has set none, and it is the same constant as before.
       */
      disclaimerText: `{{org.disclaimer}}`,
      disclaimerFallback: text,
      // 'small' | 'medium' | 'large'. The firm's setting is "medium"; the
      // hardcoded 8 was below the block's own small.
      fontSize: '{{org.disclaimerFontSize}}',
      fontSizeFallback: 'small',
    }),
  ]);
}

/**
 * Render-time part furniture.
 *
 * A compose-time `partNo += 1` keeps counting pages a `conditional` later
 * drops, so a document with dropped pages ships with holes in its own
 * numbering — a real three-property comparison's running heads jumped
 * Part 12 → Part 19. `{{partNumber}}` is resolved by the renderer over the
 * pages that actually draw, and binding it anywhere on a page is also the
 * page's opt-in to the count — the cover binds nothing and stays outside it.
 * The running head and the section numeral resolve from the same per-page
 * value, so the two can never disagree.
 */
export const renderTimePart = (label: string): string => `Part {{partNumber | pad2}} · ${label}`;
export const RENDER_TIME_NUMERAL = '{{partNumber | pad2}}';
