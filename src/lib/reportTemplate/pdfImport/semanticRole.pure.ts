/**
 * What each imported element IS — the source's own classification, kept.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * Docling classifies every text item it extracts: `title`, `section_header`
 * with a level, `page_header`, `page_footer`, `caption`, `footnote`,
 * `list_item`, `code`, `formula`. `mapDoclingToRawBlocks` reads those labels and
 * uses them — they pick a default weight, a default size, a block type, and they
 * route page furniture to a master page.
 *
 * Then the plan builder drops them. `blockToOverlay` carries `groupId` across
 * and nothing else, so the stored template knows the geometry of every box on
 * the page and the meaning of none of them.
 *
 * WHAT THAT COSTS, MEASURED
 * -------------------------
 * Every text overlay renders as a `<div>`, and `render-template-pdf` asks
 * WeasyPrint for `pdf/ua-1` with `tagged: true`. Rendered and read back with
 * PyMuPDF, an imported page's structure tree is:
 *
 *     /StructTreeRoot → /Document → [ /Div /Div /Figure /Div … ]
 *
 * Flat. Zero headings, in a document that claims to conform to an accessibility
 * standard whose whole point is that structure is present. The same probe shows
 * WeasyPrint emits `/S /H2` the moment the element is an `<h2>` — the engine was
 * never the limitation, the missing classification was.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It is not a classifier. It maps a label the source pipeline already assigned
 * onto a role this codebase can act on, and returns `null` for a label it has
 * not been taught rather than guessing — a wrong role is worse than none,
 * because Stage 4 restyles from it and an exported document asserts it.
 *
 * Annotation only: nothing here moves a box, changes a size, or picks a colour.
 * The heading tag it enables is a tag, and the render is pixel-identical.
 */

export const SEMANTIC_ANNOTATION_VERSION = 'semantic-annotation-v1';

/**
 * What an imported element is, in terms this codebase can act on.
 *
 * Deliberately smaller than Docling's label set: `paragraph` and `text` both
 * mean body copy here, and `equation` and `formula` are one thing. A role only
 * earns a place when something can do something different because of it.
 */
export type SemanticRole =
  | 'title'
  | 'heading'
  | 'body'
  | 'listItem'
  | 'caption'
  | 'footnote'
  | 'pageHeader'
  | 'pageFooter'
  | 'code'
  | 'formula'
  | 'figure'
  | 'table';

export interface SemanticAnnotation {
  version: typeof SEMANTIC_ANNOTATION_VERSION;
  role: SemanticRole;
  /** 1–6, present only for `title` and `heading`. */
  headingLevel?: number;
  /** Position in the SOURCE's reading order, which paint order does not preserve. */
  readingOrder?: number;
  /** Shared by a contiguous run of list items, as the source grouped them. */
  listGroupId?: string;
}

const LABEL_ROLES: Readonly<Record<string, SemanticRole>> = {
  title: 'title',
  section_header: 'heading',
  paragraph: 'body',
  text: 'body',
  list_item: 'listItem',
  caption: 'caption',
  footnote: 'footnote',
  page_header: 'pageHeader',
  page_footer: 'pageFooter',
  code: 'code',
  formula: 'formula',
  equation: 'formula',
  picture: 'figure',
  table: 'table',
};

/** Deepest heading level a document structure can express. */
export const MAX_HEADING_LEVEL = 6;

function clampLevel(level: unknown, fallback: number): number {
  const n = Number(level);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_HEADING_LEVEL, Math.round(n)));
}

export interface SemanticSource {
  label?: unknown;
  /** Docling's heading depth, when it stated one. */
  headingLevel?: unknown;
  readingOrder?: unknown;
  listGroupId?: unknown;
}

/**
 * The annotation for one imported block, or null when the source said nothing
 * this module understands.
 *
 * Null is a real outcome. An unlabelled item is not "body copy by default": the
 * non-Docling import paths emit no labels at all, and defaulting every box on
 * those pages to `body` would state a classification nobody made.
 */
export function annotateFromSource(source: SemanticSource | null | undefined): SemanticAnnotation | null {
  const label = typeof source?.label === 'string' ? source.label.trim().toLowerCase() : '';
  const role = LABEL_ROLES[label];
  if (!role) return null;

  const readingOrder = Number(source?.readingOrder);
  const listGroupId = typeof source?.listGroupId === 'string' && source.listGroupId
    ? source.listGroupId
    : undefined;

  return {
    version: SEMANTIC_ANNOTATION_VERSION,
    role,
    // A title is the document's H1; a section header defaults to H2 because a
    // page can hold many and only one can be the title.
    ...(role === 'title' ? { headingLevel: clampLevel(source?.headingLevel, 1) } : {}),
    ...(role === 'heading' ? { headingLevel: clampLevel(source?.headingLevel, 2) } : {}),
    ...(Number.isFinite(readingOrder) && readingOrder >= 0
      ? { readingOrder: Math.round(readingOrder) }
      : {}),
    ...(listGroupId ? { listGroupId } : {}),
  };
}

/**
 * The HTML heading tag for an annotation, or null when it is not a heading.
 *
 * WeasyPrint builds the PDF structure tree from the element name, so this is
 * the single decision that turns a flat run of `/Div`s into `/H1`…`/H6`.
 */
export function headingTagFor(annotation: SemanticAnnotation | null | undefined): string | null {
  if (!annotation) return null;
  if (annotation.role !== 'title' && annotation.role !== 'heading') return null;
  const level = clampLevel(annotation.headingLevel, annotation.role === 'title' ? 1 : 2);
  return `h${level}`;
}

/**
 * Alternative text for an imported figure, or null when the source gave none.
 *
 * PDF/UA requires a figure to carry alternative text, and the probe above
 * confirms WeasyPrint writes `/Alt` straight from the `alt` attribute. The
 * source's own description comes first, then its caption; a classifier's guess
 * at the picture KIND is last, because "bar chart" is a weak description and a
 * real one should never lose to it.
 *
 * Returns null rather than a placeholder. `[image]` as alternative text is
 * worse than none: it satisfies a checker while telling a reader nothing, and
 * that is exactly the failure this stage exists to stop asserting.
 */
/**
 * A description has to describe. A caption that is only a number does not.
 *
 * Caption pairing falls back to the nearest `caption`-labelled block within
 * 36pt, and a chart's axis ticks and value labels are small text sitting
 * exactly there — so a bar chart could take `"186,000"` as its alternative
 * text, naming one number and calling it a description. Stage 2 made that reach
 * `/Alt` in a tagged PDF, where a screen reader would read it out as the whole
 * content of the figure.
 *
 * Found by a test, not in production: the fixture that exposed it was a chart
 * whose ticks were labelled captions.
 */
function describesSomething(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // A bare number, currency amount, percentage or year — with or without a
  // trailing unit — is a datum, not a description.
  return !/^[$€£¥]?\s?-?\d[\d,. ]*\s?[%kKmMbB]?$/.test(trimmed);
}

export function figureAltText(source: {
  altText?: unknown;
  caption?: unknown;
  /**
   * The paired caption's words. Docling states a caption by REFERENCE, so
   * `caption` is usually empty while the text sits in its own block — the
   * reason a figure's alternative text could not see the caption printed
   * directly beneath it.
   */
  captionText?: unknown;
  pictureClass?: unknown;
} | null | undefined): string | null {
  const explicit = firstText(source?.altText, source?.caption, source?.captionText);
  if (explicit && describesSomething(explicit)) return explicit;
  const kind = typeof source?.pictureClass === 'string' ? source.pictureClass.trim() : '';
  if (!kind) return null;
  // `bar_chart` → `Bar chart`. A classifier label is a machine token; putting it
  // on a page unchanged reads as a leaked internal.
  const words = kind.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}
